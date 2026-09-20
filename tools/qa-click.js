/* QA click-through: drives every screen/flow with real clicks and logs findings.
 * node tools/qa-click.js  (serves output/web-game, runs ~40s) */
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "output", "web-game");

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, path.normalize(req.url.split("?")[0]).replace(/^([/\\])+/, ""));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(p);
    res.writeHead(200, { "Content-Type": ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream" });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(8125, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const vis = (id) => page.evaluate((id) => !document.getElementById(id).classList.contains("hidden"), id);
  const state = () => page.evaluate(() => SG.App.state);
  const findings = [];
  const note = (ok, name, detail) => { findings.push((ok ? "OK   " : "FAIL ") + name + (detail ? " — " + detail : "")); };

  await page.goto("http://127.0.0.1:8125/index.html", { waitUntil: "load" });
  await page.waitForTimeout(400);
  note(await vis("screen-title"), "title screen shows on load");
  await page.screenshot({ path: path.join(OUT, "snap-qa-title.png") });

  // howto round trip
  await page.click("#btn-howto");
  await page.waitForTimeout(150);
  note(await vis("screen-howto"), "HOW TO PLAY opens");
  await page.click(".back-btn");
  await page.waitForTimeout(150);
  note(await vis("screen-title"), "BACK returns to title");

  // new game: hint panel, build one panel by click, speed toggle
  await page.click("#btn-play");
  await page.waitForTimeout(400);
  note((await state()) === "game", "NEW GAME enters the game");
  note(await vis("hint-panel"), "first-steps hint panel shows");
  await page.screenshot({ path: path.join(OUT, "snap-hints.png") });
  const hintLen = await page.evaluate(() => document.getElementById("hint-text").textContent.length);
  note(hintLen > 20 && hintLen < 110, "hint is one short line, not a wall of text", "len=" + hintLen);
  await page.click("#btn-hint-ok");
  await page.waitForTimeout(100);
  note(!(await vis("hint-panel")), "GOT IT dismisses the hint panel");
  const before = await page.evaluate(() => {
    const e = SG.App.engine;
    // clear random minerals that would legitimately block the build spot
    e.GetAllGameUnitsArray(true)
      .filter((u) => u instanceof SG.UnitMineral && Math.hypot(u.Position.x - 220, u.Position.y - 60) < 90)
      .forEach((u) => u.Destroy(e, true));
    return e.Resources;
  });
  await page.keyboard.press("3"); // solar panel tool
  const spot = await page.evaluate(() => SG.Renderer.worldToScreen(220, 60));
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(200);
  const built = await page.evaluate(() => ({
    wip: SG.App.engine.GetAllGameUnitsArray().some((u) => u.Name === "solarpanel_wip"),
    res: SG.App.engine.Resources,
  }));
  note(built.wip && built.res < before, "click-build places a WIP and charges R$", JSON.stringify(built));
  await page.keyboard.press("Space");
  const sp = await page.evaluate(() => ({ s: SG.App.speed, label: document.getElementById("btn-speed").textContent }));
  note(sp.s === 2 && sp.label === "2×", "Space toggles 2× speed", JSON.stringify(sp));
  await page.keyboard.press("Space");

  // pause menu round trip
  await page.click("#btn-pause");
  await page.waitForTimeout(150);
  note((await state()) === "pause", "pause button pauses");
  await page.screenshot({ path: path.join(OUT, "snap-qa-pause.png") });
  await page.click("#btn-resume");
  await page.waitForTimeout(150);
  note((await state()) === "game", "RESUME returns to the game");
  await page.click("#btn-pause");
  await page.waitForTimeout(150);
  await page.click("#btn-quit");
  await page.waitForTimeout(200);
  note((await state()) === "title", "QUIT TO MENU returns to title");
  note(await vis("btn-continue"), "CONTINUE offered after quitting a live base");
  await page.click("#btn-continue");
  await page.waitForTimeout(300);
  note((await state()) === "game", "CONTINUE resumes the saved base");

  // lose flow: wait out the 5s grace, flatten the base, lose screen, retry
  await page.waitForTimeout(2600); // engine.Time > 5 — the anti-instant-loss gate
  await page.evaluate(() => {
    const e = SG.App.engine;
    e.GetAllGameUnitsArray(true)
      .filter((u) => u instanceof SG.UnitConduit || u instanceof SG.UnitSolarPanel || u instanceof SG.UnitHarvester || u instanceof SG.UnitLaser || u instanceof SG.UnitBuildingWIP)
      .forEach((u) => u.Destroy(e, true));
  });
  let lost = false;
  for (let i = 0; i < 24 && !lost; i++) { await page.waitForTimeout(300); lost = (await state()) === "lose"; }
  note(lost, "losing every building shows the lose screen");
  const loseText = await page.evaluate(() => document.getElementById("lose-sub").textContent);
  note(/survived/i.test(loseText), "lose screen shows survival stats", loseText);
  await page.screenshot({ path: path.join(OUT, "snap-qa-lose.png") });
  await page.click("#btn-retry");
  await page.waitForTimeout(300);
  note((await state()) === "game", "RETRY starts a fresh game");
  const fresh = await page.evaluate(() => ({ res: SG.App.engine.Resources, wave: SG.App.engine.CurWave, aliens: SG.App.engine.GetAllGameUnitsArray().filter((u) => u instanceof SG.UnitAlienUfo).length }));
  note(fresh.res === 200 && fresh.wave <= 1 && fresh.aliens === 0, "RETRY is a clean slate", JSON.stringify(fresh));

  note(errors.length === 0, "no console/page errors", errors.slice(0, 3).join(" | "));
  console.log(findings.join("\n"));
  console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "");
  await browser.close();
  server.close();
  process.exit(findings.some((f) => f.startsWith("FAIL")) ? 1 : 0);
})();
