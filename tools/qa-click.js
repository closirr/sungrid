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

  // P2-2 sell: select a starter building → the panel offers SELL → click it:
  // refund lands, the building is gone, the tile is rebuildable
  if (await vis("hint-panel")) { await page.click("#btn-hint-ok"); await page.waitForTimeout(100); }
  const sellStage = await page.evaluate(() => {
    const e = SG.App.engine;
    // clear random minerals that would legitimately block the probe tile
    e.GetAllGameUnitsArray(true)
      .filter((u) => u instanceof SG.UnitMineral && Math.hypot(u.Position.x - 32, u.Position.y) < 90)
      .forEach((u) => u.Destroy(e, true));
    const cond = e.GetAllGameUnitsArray().find((u) => u.Name === "conduit" && !u.Destroyed);
    return { found: !!cond, pos: cond ? { x: cond.Position.x, y: cond.Position.y } : null, res0: e.Resources };
  });
  if (sellStage.found) {
    const spot = await page.evaluate((p) => SG.Renderer.worldToScreen(p.x, p.y), sellStage.pos);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(150);
    const sold = await page.evaluate((stage) => {
      const e = SG.App.engine;
      const btn = document.querySelector("#up-buttons .nbtn");
      const name = document.getElementById("up-name").textContent;
      const label = btn ? btn.textContent : null;
      if (btn) btn.click(); // the real onclick → UI.sellSelected → engine.SellUnit
      const alive = e.GetAllGameUnitsArray().filter((u) => u.Name === "conduit" && !u.Destroyed).length;
      return { name, label, delta: e.Resources - stage.res0, alive };
    }, sellStage);
    await page.waitForTimeout(150); // the panel closes on the next rendered frame
    const after = await page.evaluate((stage) => {
      const e = SG.App.engine;
      const probe = new SG.HSGameToolConduit(); // fresh tool: ghost + footprint 16 preloaded
      return { panelHidden: document.getElementById("unit-panel").classList.contains("hidden"),
        rebuildable: probe.IsValidLocation(e, stage.pos) };
    }, sellStage);
    note(sold.name === "Conduit" && sold.label === "SELL +2 R$", "unit panel offers SELL +2 R$ for a conduit", JSON.stringify({ name: sold.name, label: sold.label }));
    note(sold.delta === 2 && sold.alive === 0, "SELL pays +2 R$ and removes the building", JSON.stringify({ delta: sold.delta, alive: sold.alive }));
    note(after.panelHidden && after.rebuildable, "panel closes and the sold tile is rebuildable", JSON.stringify(after));
  } else note(false, "sell check staged", "no building left to click");

  // early-call bonus: selling back the wait pays floor(remaining) × 2 R$ and toasts;
  // a sub-second window pays nothing and stays quiet (set + click in ONE evaluate —
  // no sim tick may run between staging the window and pressing the button)
  const early = await page.evaluate(() => {
    const e = SG.App.engine;
    const bonusToasts = () => Array.from(document.querySelectorAll("#toasts .toast")).map((t) => t.textContent).filter((t) => t.includes("early raid bonus"));
    const res0 = e.Resources;
    e.NextWaveSpawnTime = e.Time + 10.3; // a known ~10s window to sell back
    document.getElementById("btn-callwave").click();
    return { delta: e.Resources - res0, toasts: bonusToasts().length };
  });
  note(early.delta === Math.floor(10.3) * 2 && early.toasts === 1, "early call pays floor(remaining)×2 R$ and toasts", JSON.stringify(early));
  const subSecond = await page.evaluate(() => {
    const e = SG.App.engine;
    const bonusToasts = () => Array.from(document.querySelectorAll("#toasts .toast")).map((t) => t.textContent).filter((t) => t.includes("early raid bonus"));
    const res0 = e.Resources;
    const toastsBefore = bonusToasts().length;
    e.NextWaveSpawnTime = e.Time + 0.4; // less than a second left — nothing to sell
    document.getElementById("btn-callwave").click();
    return { delta: e.Resources - res0, toastsBefore, toastsAfter: bonusToasts().length };
  });
  note(subSecond.delta === 0 && subSecond.toastsAfter === subSecond.toastsBefore, "sub-second call pays nothing and stays quiet", JSON.stringify(subSecond));

  // blocked-placement feedback: a build click on an occupied tile names WHY it refused
  // (the toast matches the red BLOCKED ghost state) and still places nothing
  const blockedStage = await page.evaluate(() => {
    const e = SG.App.engine;
    const isB = (u) => u instanceof SG.UnitConduit || u instanceof SG.UnitSolarPanel || u instanceof SG.UnitHarvester || u instanceof SG.UnitLaser || u instanceof SG.UnitBuildingWIP;
    const b = e.GetAllGameUnitsArray().find((u) => isB(u) && !u.Destroyed);
    if (!b) return { ok: false };
    // clear random minerals that would legitimately block this spot with a different reason
    e.GetAllGameUnitsArray(true)
      .filter((u) => u instanceof SG.UnitMineral && Math.hypot(u.Position.x - b.Position.x, u.Position.y - b.Position.y) < 90)
      .forEach((u) => u.Destroy(e, true));
    e.Resources = 50; // afford the build so the ONLY refusal is the occupied tile
    document.getElementById("toasts").innerHTML = "";
    SG.UI.SelectTool(SG.UI.GameTools[0]); // Conduit
    return { ok: true, pos: { x: b.Position.x, y: b.Position.y } };
  });
  if (blockedStage.ok) {
    const spot = await page.evaluate((p) => {
      const sp = SG.Renderer.worldToScreen(p.x, p.y);
      const r = SG.Renderer.canvas.getBoundingClientRect();
      return { cx: r.left + sp.x, cy: r.top + sp.y };
    }, blockedStage.pos);
    await page.mouse.click(spot.cx, spot.cy);
    await page.waitForTimeout(200);
    const blocked = await page.evaluate(() => ({
      toast: document.getElementById("toasts").textContent,
      res: SG.App.engine.Resources,
    }));
    note(/Space occupied/.test(blocked.toast), "occupied-tile build click shows WHY it refused", blocked.toast.slice(0, 90));
    note(blocked.res === 50, "occupied-tile click places nothing", "res=" + blocked.res);
    await page.screenshot({ path: path.join(OUT, "snap-qa-blocked.png") });
  } else note(false, "blocked-click check staged", "no building left to click");

  note(errors.length === 0, "no console/page errors", errors.slice(0, 3).join(" | "));
  console.log(findings.join("\n"));
  console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "");
  await browser.close();
  server.close();
  process.exit(findings.some((f) => f.startsWith("FAIL")) ? 1 : 0);
})();
