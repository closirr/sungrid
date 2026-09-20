/* AUDIT scenario suite: walks ALL SIX LEVELS through the REAL UI — wave composition,
 * win/lose, the next-level unlock chain, star rating, save persistence and the
 * endless record. Complements browsertest (single-level flows) with the full campaign.
 * node tools/audit-scenarios.js  (runs ~60s) */
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

(async () => {
  await new Promise((r) => server.listen(8127, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const checks = [];
  const check = (name, ok, detail) => { checks.push(!!ok); console.log((ok ? "OK   " : "FAIL ") + name + (detail ? " — " + detail : "")); };
  const state = () => page.evaluate(() => SG.App.state);
  const waitFor = async (fn, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await fn()) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };

  try {
    await page.goto("http://127.0.0.1:8127/index.html", { waitUntil: "load" });
    await page.waitForTimeout(400);
    // fresh campaign save
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500);

    /* ---- S1. fresh save: only level 1 unlocked, locked cards ignore clicks ---- */
    const freshGrid = await page.evaluate(() => ({
      unlocked: SG.Save.data.unlocked,
      locked: [...document.querySelectorAll("#level-grid .lcard")].map((c) => c.classList.contains("locked")),
    }));
    check("S1 fresh save: only level 1 of 6 unlocked", freshGrid.unlocked === 1 && freshGrid.locked.length === 6 && freshGrid.locked[0] === false && freshGrid.locked.slice(1).every(Boolean), JSON.stringify(freshGrid));
    await page.click('#level-grid .lcard.locked'); // locked card must be inert
    await page.waitForTimeout(250);
    check("S1 locked level card ignores clicks", (await state()) === "title");

    /* ---- S2. wave composition per level (raid size within cap, enemy mix rules,
     *         boss cadence) — sampled straight from the live engine ---- */
    const comp = await page.evaluate(() => {
      const e = SG.App.engine;
      const out = [];
      for (let li = 0; li < SG.LEVELS.length; li++) {
        const cfg = SG.LEVELS[li];
        e.LevelConfig = cfg;
        const raids = [];
        const last = isFinite(cfg.waves) ? cfg.waves : 8;
        for (let w = 0; w < last; w++) {
          const s = e.SpawnEnemyWave(w);
          raids.push({
            n: s.length,
            cruisers: s.filter((u) => u instanceof SG.UnitAlienCruiser).length,
            scouts: s.filter((u) => u instanceof SG.UnitAlienScout).length,
          });
        }
        e.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitAlienUfo).forEach((u) => u.Destroy(e, true));
        out.push({ name: cfg.name, cap: cfg.waveCap, bossEvery: cfg.bossEvery, raids });
      }
      e.LevelConfig = null;
      e.Effects.length = 0;
      return out;
    });
    check("S2 raid sizes stay within each level's cap",
      comp.every((l) => l.raids.every((r) => r.n >= 1 && r.n <= l.cap)), JSON.stringify(comp.map((l) => l.raids.map((r) => r.n))));
    check("S2 levels 1-3 never field cruisers",
      comp.slice(0, 3).every((l) => l.raids.every((r) => r.cruisers === 0)));
    check("S2 level 4+ fields cruisers on late raids",
      comp[3].raids.slice(5).some((r) => r.cruisers > 0) && comp[4].raids.some((r) => r.cruisers > 0));
    check("S2 Boss Citadel escorts every 3rd raid (raids 4 and 7)",
      comp[4].raids[3].cruisers >= 2 && comp[4].raids[6].cruisers >= 2, JSON.stringify(comp[4].raids.map((r) => r.cruisers)));
    check("S2 Endless escorts every 5th raid (raid 6 in the sample)",
      comp[5].raids[5].cruisers >= 2, JSON.stringify(comp[5].raids.map((r) => r.cruisers)));
    check("S2 opening raids are scouts everywhere",
      comp.every((l) => l.raids[0].scouts === l.raids[0].n && l.raids[1].scouts === l.raids[1].n));

    /* ---- S3. the campaign chain: win L1..L5, each win unlocks the next.
     *         Staged loss counts pin the star rating: 0→3★, 1→2★, 5→1★ ---- */
    const starPlan = [0, 1, 5, 0, 0];
    const expectedStars = [3, 2, 1, 3, 3];
    await page.click("#level-grid .lcard"); // level 1
    for (let i = 0; i < 5; i++) {
      check("S3 level " + (i + 1) + " started", await waitFor(() => page.evaluate((idx) => SG.App.state === "game" && SG.App.currentLevel === idx, i), 5000));
      const staged = await page.evaluate((lost) => {
        const e = SG.App.engine;
        if (e.Time < 6) e._timerElapsed = 6; // pass the anti-instant-loss grace honestly (the level still "played")
        SG.App.buildingsLost = lost;
        e.CurWave = e.LevelConfig.waves; // final raid is out — the spawner stands down (audit fix)
        e.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitAlienUfo && !u.Destroyed)
          .forEach((u) => u.ReceiveDamage(e, null, 1e5)); // wipe the raiders
        return e.LevelConfig.name;
      }, starPlan[i]);
      check("S3 level " + (i + 1) + " (" + staged + ") win fires", await waitFor(() => page.evaluate(() => SG.App.state === "win"), 6000));
      const win = await page.evaluate((idx) => ({
        stars: document.querySelectorAll("#win-stars span.on").length,
        saved: SG.Save.starsFor(idx),
        unlocked: SG.Save.data.unlocked,
        hasNext: !document.getElementById("btn-next").classList.contains("hidden"),
      }), i);
      check("S3 level " + (i + 1) + " shows " + expectedStars[i] + "★ and saves it", win.stars === expectedStars[i] && win.saved === expectedStars[i], JSON.stringify(win));
      check("S3 winning level " + (i + 1) + " unlocks level " + (i + 2), win.unlocked === i + 2, "unlocked=" + win.unlocked);
      check("S3 NEXT LEVEL offered on level " + (i + 1), win.hasNext);
      if (i < 4) { await page.click("#btn-next"); await page.waitForTimeout(400); }
    }

    /* ---- S4. endless: no win, defeat saves the record, lose screen shows it ---- */
    await page.click("#btn-next"); // Boss Citadel's NEXT LEVEL is the endless siege
    check("S4 endless level started (last of the chain)", await waitFor(() => page.evaluate(() => SG.App.state === "game" && SG.App.currentLevel === 5), 5000));
    await page.evaluate(() => {
      const e = SG.App.engine;
      e.CurWave = 7; // the siege reached raid 7 before the base fell
      if (e._timerElapsed < 6) e._timerElapsed = 6;
      e.GetAllGameUnitsArray(true)
        .filter((u) => u instanceof SG.UnitConduit || u instanceof SG.UnitSolarPanel || u instanceof SG.UnitHarvester || u instanceof SG.UnitLaser || u instanceof SG.UnitBuildingWIP)
        .forEach((u) => u.Destroy(e, true));
    });
    check("S4 endless defeat shows the lose screen", await waitFor(() => page.evaluate(() => SG.App.state === "lose"), 8000));
    const lose = await page.evaluate(() => ({
      sub: document.getElementById("lose-sub").textContent,
      best: SG.Save.data.endlessBest,
    }));
    check("S4 endless record saved on defeat (=7) and shown", lose.best === 7 && /record/i.test(lose.sub), JSON.stringify(lose));

    /* ---- S5. everything persists across a page reload ---- */
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(500);
    const saved = await page.evaluate(() => ({
      unlocked: SG.Save.data.unlocked,
      stars: [0, 1, 2, 3, 4].map((i) => SG.Save.starsFor(i)),
      best: SG.Save.data.endlessBest,
      locked: [...document.querySelectorAll("#level-grid .lcard")].map((c) => c.classList.contains("locked")),
    }));
    check("S5 reload keeps the unlock chain (6/6)", saved.unlocked === 6 && saved.locked.every((l) => !l), JSON.stringify(saved));
    check("S5 reload keeps per-level stars [3,2,1,3,3]", JSON.stringify(saved.stars) === JSON.stringify(expectedStars), JSON.stringify(saved.stars));
    check("S5 reload keeps the endless record", saved.best === 7, "best=" + saved.best);

    /* ---- S6. a star upgrade overwrites the old best, never downgrades ---- */
    await page.click("#level-grid .lcard:nth-child(3)"); // level 3 (has 1★)
    await waitFor(() => page.evaluate(() => SG.App.state === "game"), 5000);
    await page.evaluate(() => {
      const e = SG.App.engine;
      if (e.Time < 6) e._timerElapsed = 6;
      SG.App.buildingsLost = 0; // flawless replay
      e.CurWave = e.LevelConfig.waves;
      e.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitAlienUfo && !u.Destroyed).forEach((u) => u.ReceiveDamage(e, null, 1e5));
    });
    check("S6 flawless replay of level 3 wins again", await waitFor(() => page.evaluate(() => SG.App.state === "win"), 6000));
    const up = await page.evaluate(() => SG.Save.starsFor(2));
    check("S6 star best upgraded 1★ → 3★", up === 3, "stars=" + up);

    await page.screenshot({ path: path.join(OUT, "snap-audit-scenarios.png") });
  } catch (e) {
    check("EXCEPTION", false, e && e.message ? e.message : String(e));
  } finally {
    try { await browser.close(); } catch (err) {}
    try { server.close(); } catch (err) {}
  }

  const failed = checks.filter((c) => !c).length;
  console.log("\n" + (failed ? failed + " CHECK(S) FAILED of " + checks.length : "ALL SCENARIO CHECKS PASSED (" + checks.length + " checks)"));
  process.exit(failed ? 1 : 0);
})();
