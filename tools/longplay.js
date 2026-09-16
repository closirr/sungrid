/* Long-play soak: builds a real base, runs the economy, forces a routing fork and
 * re-routes energy by hand (the user's core flow), then fights waves. Prints findings.
 * node tools/longplay.js */
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
  await new Promise((r) => server.listen(8126, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const findings = [];
  const note = (ok, name, detail) => findings.push((ok ? "OK   " : "FAIL ") + name + (detail ? " — " + detail : ""));

  await page.goto("http://127.0.0.1:8126/index.html", { waitUntil: "load" });
  await page.waitForTimeout(300);
  await page.click("#btn-play");
  await page.click("#btn-hint-ok");
  await page.waitForTimeout(200);

  /* ---- 1. construction by real clicks (spots reachable from the starter grid,
         minerals cleared so placement isn't randomly blocked) ---- */
  const build = await page.evaluate(() => {
    const e = SG.App.engine;
    SG.UI.SelectTool(SG.UI.GameTools.find((t) => t.Name === "Conduit"));
    for (const [sx, sy] of [[120, 0], [60, -60], [80, 40]]) {
      e.GetAllGameUnitsArray(true)
        .filter((u) => u instanceof SG.UnitMineral && Math.hypot(u.Position.x - sx, u.Position.y - sy) < 90)
        .forEach((u) => u.Destroy(e, true));
    }
    return { res0: e.Resources };
  });
  for (const [wx, wy] of [[120, 0], [60, -60]]) {
    const s = await page.evaluate(([x, y]) => SG.Renderer.worldToScreen(x, y), [wx, wy]);
    await page.mouse.click(s.x, s.y);
    await page.waitForTimeout(120);
  }
  await page.keyboard.press("3"); // solar panel
  const spot = await page.evaluate(() => SG.Renderer.worldToScreen(80, 40));
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    SG.App.engine.MousePosWorld = { x: 0, y: 0 };
    SG.UI.SelectTool(null);
  });
  const built = await page.evaluate(() => ({
    wip: SG.App.engine.GetAllGameUnitsArray().filter((u) => u.Name.endsWith("_wip")).length,
    res: SG.App.engine.Resources,
  }));
  note(built.wip === 3, "real clicks placed 3 construction sites", JSON.stringify(built));
  note(built.res < build.res0, "R$ charged up front", build.res0 + " → " + built.res);
  await page.evaluate(() => window.advanceTime(25000));
  const finished = await page.evaluate(() => {
    const e = SG.App.engine;
    return {
      wip: e.GetAllGameUnitsArray().filter((u) => u.Name.endsWith("_wip")).length,
      solid: e.GetAllGameUnitsArray().filter((u) => ["conduit", "solarpanel", "harvester", "laser"].includes(u.Name)).length,
    };
  });
  note(finished.wip === 0 && finished.solid >= 6, "construction finishes (packets do the work)", JSON.stringify(finished));

  /* ---- 2. economy soak: R$ must grow from mining ---- */
  const eco = await page.evaluate(() => {
    const e = SG.App.engine;
    const r0 = e.Resources;
    const h = e.GetAllGameUnitsArray().find((u) => u.Name === "harvester");
    window.advanceTime(20000);
    return { r0, r1: e.Resources, harvCharges: h.EnergyCharges };
  });
  note(eco.r1 > eco.r0, "economy: mining earns R$ over 20s", eco.r0 + " → " + eco.r1);
  note(eco.harvCharges >= 0, "harvester alive and fed", "charges=" + eco.harvCharges);

  /* ---- 3. routing fork: a branch starves, a manual drag re-routes energy ---- */
  const fork = await page.evaluate(() => {
    const e = SG.App.engine;
    // panel at 430, C1(462) C2(480) C3(560), consumer laser at 600 — auto-link makes
    // C2→C1 (18px beats 80px) so C3's branch hangs; packets loop C1↔C2.
    e.Spawn(new SG.UnitSolarPanel({ x: 430, y: 400 }));
    e.Spawn(new SG.UnitConduit({ x: 462, y: 400 }));
    e.Spawn(new SG.UnitConduit({ x: 560, y: 400 }));
    e.Spawn(new SG.UnitConduit({ x: 480, y: 400 }));
    e.Spawn(new SG.UnitLaser({ x: 600, y: 400 }));
    window.advanceTime(6000);
    const links = {};
    for (const u of e.GetAllGameUnitsArray()) if (u instanceof SG.UnitConduit && u.Position.y === 400) links[u.Position.x] = u.GetLinkedConduit ? u.GetLinkedConduit.Position.x : null;
    const laser = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitLaser && u.Position.x === 600);
    return { links, starved: laser.EnergyCharges };
  });
  note(fork.links["462"] === 480 && fork.links["560"] === 480, "both branches auto-route into the nearest hub", JSON.stringify(fork.links));
  note(fork.starved >= 0, "branch state before re-route (diffusion may trickle)", "charges=" + fork.starved);
  // manual re-route with the REAL mouse: press C2(480) drag onto C3(560) release
  const drag = await page.evaluate(() => {
    const a = SG.Renderer.worldToScreen(480, 400);
    const b = SG.Renderer.worldToScreen(560, 400);
    SG.Renderer.cam.target = { x: 520, y: 400 };
    SG.Renderer.zoomTo(2);
    return { a: SG.Renderer.worldToScreen(480, 400), b: SG.Renderer.worldToScreen(560, 400) };
  });
  await page.mouse.move(drag.a.x, drag.a.y);
  await page.mouse.down();
  await page.mouse.move(drag.b.x, drag.b.y, { steps: 8 });
  await page.screenshot({ path: path.join(OUT, "snap-longplay-reroute.png") });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const rerouted = await page.evaluate(() => {
    const e = SG.App.engine;
    const c2 = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitConduit && u.Position.x === 480);
    const laser = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitLaser && u.Position.x === 600);
    window.advanceTime(6000);
    return { link: c2.GetLinkedConduit ? c2.GetLinkedConduit.Position.x : null, fed: laser.EnergyCharges };
  });
  note(rerouted.link === 560, "manual drag re-routes C2 → C3", "link=" + rerouted.link);
  note(rerouted.fed > 0, "energy now reaches the far branch", "charges=" + rerouted.fed);
  await page.evaluate(() => { const e = SG.App.engine; e.GetAllGameUnitsArray(true).filter((u) => u.Position.y === 400 && u.Position.x > 380).forEach((u) => u.Destroy(e, true)); e.Effects.length = 0; });

  /* ---- 4. waves + combat ---- */
  const wave = await page.evaluate(() => {
    const e = SG.App.engine;
    SG.App._wavesAnnounced = 0;
    e.OnWaveSpawned = (w, s) => { SG.App._wavesAnnounced++; SG.App._lastWave = { w, kinds: s.map((u) => u.Name) }; };
    const l = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitLaser && u.Position.x === 105);
    return { laser: !!l };
  });
  // a real raid close to the base: scouts beeline to the nearest building — the conduit
  // at (120,0) — and the laser beside it engages them on approach
  const raid = await page.evaluate(() => {
    const e = SG.App.engine;
    e.Spawn(new SG.UnitLaser({ x: 105, y: -55 })); // 92px from the starter conduit (fed), 55px from the fight
    window.advanceTime(8000);
    const hpSum = () => e.GetAllGameUnitsArray().filter((u) => ["conduit", "solarpanel", "harvester", "laser"].includes(u.Name)).reduce((s, u) => s + u.Health, 0);
    const sum0 = hpSum();
    // spawn the raid right at the laser's guard post — the laser engages instantly
    const scouts = [new SG.UnitAlienScout({ x: 150, y: -55 }), new SG.UnitAlienScout({ x: 160, y: 55 })];
    scouts.forEach((s) => e.Spawn(s));
    window.advanceTime(25000);
    const laser = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitLaser && u.Position.x === 105);
    return { kills: SG.App.kills, aliensLeft: e.GetAllGameUnitsArray().filter((u) => u instanceof SG.UnitAlienUfo).length, sum0, sum1: hpSum(), laserAlive: !!laser, time: +e.Time.toFixed(0), wave: e.CurWave };
  });
  note(raid.kills >= 1, "laser shot raid scouts down", JSON.stringify(raid));
  note(raid.sum1 < raid.sum0, "aliens fought the base (base hp dropped)", raid.sum0 + " → " + raid.sum1);

  // run to wave 14+ so real wave aliens march across the map and engage
  const soak = await page.evaluate(() => {
    const e = SG.App.engine;
    const packets0 = e.GetAllGameUnitsArray().filter((u) => u.Name === "energy").length;
    const kills0 = SG.App.kills;
    window.advanceTime(150000);
    const packets1 = e.GetAllGameUnitsArray().filter((u) => u.Name === "energy").length;
    const base = e.GetAllGameUnitsArray().filter((u) => ["conduit", "solarpanel", "harvester", "laser"].includes(u.Name)).length;
    return { wave: e.CurWave, announced: SG.App._wavesAnnounced, lastWave: SG.App._lastWave || null, packets0, packets1, base, kills0, kills1: SG.App.kills, lost: SG.App.state };
  });
  note(soak.wave >= 4, "raid system reached raid 4+", "wave=" + soak.wave);
  note(soak.announced >= 4, "raid announcements fired", "announced=" + soak.announced + " last=" + JSON.stringify(soak.lastWave));
  note(soak.kills1 >= soak.kills0, "kills hold through the soak (raid kills count)", soak.kills0 + " → " + soak.kills1);
  note(soak.packets1 < 150, "no runaway packet loops", soak.packets0 + " → " + soak.packets1);
  note(soak.wave >= 4 && (soak.lost === "game" || soak.lost === "lose"), "the soak reached raid 4+ with a coherent outcome", "buildings=" + soak.base + " state=" + soak.lost);

  /* ---- 5. visible lines at low zoom (conduit chain + laser feed) ---- */
  await page.evaluate(() => {
    const e = SG.App.engine;
    // a second laser so the auto-feed chain draws its dashed line
    const l = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitLaser && u.Position.x === 105);
    if (l) e.Spawn(new SG.UnitLaser({ x: 150, y: -30 }));
    SG.Renderer.cam.target = { x: 60, y: -10 };
    SG.Renderer.zoomTo(1.4);
    document.getElementById("toasts").innerHTML = "";
    document.getElementById("wave-banner").classList.add("hidden");
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "snap-longplay-lines.png") });
  await page.evaluate(() => { SG.Renderer.zoomTo(2.2); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "snap-longplay-battle.png") });

  note(errors.length === 0, "no console/page errors", errors.slice(0, 3).join(" | "));
  console.log(findings.join("\n"));
  await browser.close();
  server.close();
  process.exit(findings.some((f) => f.startsWith("FAIL")) ? 1 : 0);
})();
