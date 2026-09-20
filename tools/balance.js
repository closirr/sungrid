/* SUNGRID — autoplay balance bot (the README's "balance runs" tool, planned but never
 * built until now). Plays EVERY level with a scripted build — 3 panels, a conduit spine
 * and an 8-laser ring, topped up as things die — fast-forwards sim time and reports
 * win/lose, waves, kills and losses per level.
 *
 * Abstraction: the bot spawns FINISHED buildings and pays their R$ cost (construction
 * logistics are covered by browsertest/longplay); combat, economy drain and raid pacing
 * are the real simulation. A level the bot cannot win is a BALANCE DATA POINT, not a
 * suite failure — the run only fails on crashes.
 *
 * Usage: node tools/balance.js   (serves the game, runs ~2-4 min) */
"use strict";
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "output", "web-game");
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, path.normalize(req.url.split("?")[0]).replace(/^([/\\])+/, ""));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(p);
    res.writeHead(200, { "Content-Type": ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream" });
    res.end(data);
  });
});

/* the bot's build book (world coords around the base at 0,0) */
const BOT_LAYOUT = {
  panels: [[-100, -40], [-100, 40], [-100, -100], [-100, 100], [-140, 0], [-140, 60]],
  conduits: [[-50, -20], [-50, 40], [0, -40], [0, 40], [40, 0]],
  // 8-laser ring at r=110 — every slot is within 96px of a spine conduit (packet-fed)
  laserRing: [[110, 0], [78, 78], [0, 110], [-78, 78], [-110, 0], [-78, -78], [0, -110], [78, -78]],
  costs: { solarpanel: 10, conduit: 5, laser: 10, harvester: 8 },
};

(async () => {
  await new Promise((r) => server.listen(8130, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const rows = [];
  try {
    await page.goto("http://127.0.0.1:8130/index.html", { waitUntil: "load" });
    await page.waitForTimeout(400);

    // in-page bot helpers, installed once
    await page.evaluate((L) => {
      window.__bot = {
        place(kind, x, y) {
          const e = SG.App.engine;
          const fp = kind === "solarpanel" ? 36 : 16;
          const pos = SG.HSBuildSnap(fp, { x, y });
          const blocked = e.GetAllGameUnitsArray(true).some((u) =>
            !u.Destroyed && !(u instanceof SG.UnitEnergyPacket) && !(u instanceof SG.UnitAlienUfo) &&
            SG.HSFootprintsOverlap(pos, fp, u.Position, SG.HSFootprintWidth(u)));
          if (blocked) return null;
          const cls = { solarpanel: SG.UnitSolarPanel, conduit: SG.UnitConduit, laser: SG.UnitLaser, harvester: SG.UnitHarvester }[kind];
          if (!e.TryConsumeResources(L.costs[kind])) return null;
          const u = e.Spawn(new cls(pos));
          u.SpawnTime = -10; // no rise-in
          return u;
        },
        act(tick) {
          const e = SG.App.engine;
          const count = (name) => e.GetAllGameUnitsArray(true).filter((u) => !u.Destroyed && u.Name === name).length;
          const lasers = count("laser");
          if (lasers < L.laserRing.length) {
            const slot = L.laserRing[lasers];
            this.place("laser", slot[0], slot[1]);
          }
          // keep ~1 panel per 2 lasers so charges keep up
          if (count("solarpanel") < Math.min(6, 3 + Math.floor(count("laser") / 2))) {
            const slot = L.panels[count("solarpanel")] || L.panels[L.panels.length - 1];
            this.place("solarpanel", slot[0], slot[1]);
          }
          if (count("conduit") < L.conduits.length) {
            const slot = L.conduits[count("conduit")];
            this.place("conduit", slot[0], slot[1]);
          }
          // a second harvester once the money flows
          if (count("harvester") < 2 && e.Resources > 60 && tick > 30) {
            const m = e.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitMineral && !u.Destroyed
              && V2.dist(u.Position, { x: 0, y: 0 }) < 260);
            if (m) this.place("harvester", m.Position.x + 30, m.Position.y - 14);
          }
        },
      };
    }, BOT_LAYOUT);

    for (let idx = 0; idx < (await page.evaluate(() => SG.LEVELS.length)); idx++) {
      const started = await page.evaluate((i) => {
        SG.App.startLevel(i);
        SG.App.engine.Resources = Math.max(SG.App.engine.Resources, 200); // uniform starting purse
        return { name: SG.App.engine.LevelConfig.name, waves: SG.App.engine.LevelConfig.waves };
      }, idx);
      const budget = isFinite(started.waves) ? 480 : 240; // sim seconds per level
      let t = 0;
      await page.evaluate(() => window.__bot.act(0));
      while (t < budget) {
        await page.evaluate(() => { window.advanceTime(5000); window.__bot.act(++window.__botTick || (window.__botTick = 1)); });
        t += 5;
        if (await page.evaluate(() => SG.App.state !== "game")) break;
      }
      const row = await page.evaluate((i) => ({
        name: SG.App.engine.LevelConfig.name,
        outcome: SG.App.state === "game" ? "stood " + Math.round(SG.App.engine.Time) + "s" : SG.App.state,
        waves: SG.App.engine.CurWave,
        kills: SG.App.kills,
        lost: SG.App.buildingsLost,
        stars: SG.Save.starsFor(i),
        res: Math.round(SG.App.engine.Resources),
      }), idx);
      rows.push(row);
      console.log(`L${idx + 1} ${row.name.padEnd(15)} ${String(row.outcome).padEnd(12)} waves=${String(row.waves).padEnd(3)} kills=${String(row.kills).padEnd(4)} lost=${String(row.lost).padEnd(3)} stars=${row.stars} res=${row.res}`);
      if (row.outcome === "win") { await page.evaluate(() => SG.App.showScreen("title")); }
    }

    await page.screenshot({ path: path.join(OUT, "snap-balance-end.png") });
    const wins = rows.filter((r) => r.outcome === "win").length;
    console.log(`\nbot won ${wins}/${rows.length} levels — hard levels the bot loses are balance signals (check enemy caps vs its 8-laser build)`);
  } catch (e) {
    console.log("EXCEPTION " + (e && e.message ? e.message : String(e)));
    errors.push(String(e));
  } finally {
    try { await browser.close(); } catch (err) {}
    try { server.close(); } catch (err) {}
  }
  if (errors.length) { console.log("ERRORS:\n" + errors.slice(0, 5).join("\n")); process.exit(1); }
  process.exit(0);
})();
