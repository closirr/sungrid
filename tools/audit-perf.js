/* AUDIT performance + audio suite: builds a heavy scene (200+ units, saturated packet
 * flow, a live raid chewing the base), measures real FPS over 8s, verifies the memory
 * guards hold under load and that every Sfx entry point is throw-safe.
 * node tools/audit-perf.js */
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
  await new Promise((r) => server.listen(8128, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const checks = [];
  const check = (name, ok, detail) => { checks.push(!!ok); console.log((ok ? "OK   " : "FAIL ") + name + (detail ? " — " + detail : "")); };

  try {
    await page.goto("http://127.0.0.1:8128/index.html", { waitUntil: "load" });
    await page.waitForTimeout(400);
    await page.click("#btn-play");
    await page.click("#btn-hint-ok");
    await page.waitForTimeout(300);

    /* heavy scene: a dense grid city + a raid chewing on it */
    await page.evaluate(() => {
      const e = SG.App.engine;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 24; c++) e.Spawn(new SG.UnitConduit({ x: c * 72 - 800, y: r * 56 - 140 }));
      }
      for (let i = 0; i < 30; i++) e.Spawn(new SG.UnitSolarPanel({ x: -900 + (i % 6) * 60, y: Math.floor(i / 6) * 60 - 300 }));
      for (let i = 0; i < 20; i++) { const l = e.Spawn(new SG.UnitLaser({ x: 300 + (i % 5) * 60, y: Math.floor(i / 5) * 60 - 120 })); l.EnergyCharges = 60; }
      for (let i = 0; i < 10; i++) {
        e.Spawn(new SG.UnitMineral({ x: -200 + i * 40, y: 200 }, false));
        const h = e.Spawn(new SG.UnitHarvester({ x: -200 + i * 40, y: 160 }));
        h.EnergyCharges = 3;
      }
      // a live raid: enemies marching + dying feed hit/boom effects continuously
      for (let i = 0; i < 20; i++) e.Spawn(new SG.UnitAlienScout({ x: 500 + (i % 5) * 50, y: (i % 3) * 60 - 60 }));
      for (let i = 0; i < 4; i++) e.Spawn(new SG.UnitAlienCruiser({ x: 700 + i * 40, y: i * 40 }));
      window.advanceTime(20000); // saturate: packets, beams, deaths
      document.getElementById("wave-banner").classList.add("hidden");
      document.getElementById("toasts").innerHTML = "";
    });

    /* FPS over 8 real seconds (RAF-sampled inside the page) */
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 8000) requestAnimationFrame(tick);
        else resolve(Math.round(frames / ((performance.now() - t0) / 1000) * 10) / 10);
      };
      requestAnimationFrame(tick);
    }));
    check("P FPS under heavy scene >= 24 (measured " + fps + ")", fps >= 24, "fps=" + fps);

    /* memory guards hold under sustained load */
    const mem = await page.evaluate(() => {
      const e = SG.App.engine;
      window.advanceTime(60000); // a further minute of sim
      return {
        effects: e.Effects.length,
        deadSlots: e.GameUnits.filter((u) => u == null || u.Destroyed).length, // compaction keeps these below the 128 trigger
        live: e.GameUnits.filter((u) => u != null && !u.Destroyed).length,
        packets: e.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitEnergyPacket && !u.Destroyed).length,
      };
    });
    check("P effects stay swept under load (<100)", mem.effects < 100, JSON.stringify(mem));
    check("P packet flow stays bounded under load (<250)", mem.packets < 250, JSON.stringify(mem));
    check("P dead unit slots stay compacted (<128 trigger)", mem.deadSlots < 129, JSON.stringify(mem));

    await page.screenshot({ path: path.join(OUT, "snap-audit-perf.png") });

    /* audio: every Sfx entry point must be throw-safe (headless: ctx suspended or absent) */
    const snd = await page.evaluate(() => {
      try {
        SG.Snd.init();
        SG.Snd.resume();
        const probes = [
          () => SG.Snd.click(), () => SG.Snd.place(), () => SG.Snd.sell(), () => SG.Snd.upgrade(),
          () => SG.Snd.boost(), () => SG.Snd.error(), () => SG.Snd.boom(true), () => SG.Snd.boom(false),
          () => SG.Snd.coreHit(), () => SG.Snd.horn(), () => SG.Snd.win(), () => SG.Snd.lose(),
          () => SG.Snd.overcharge(), () => SG.Snd.burnout(), () => SG.Snd.missile(), () => SG.Snd.zap(),
          () => SG.Snd.laser(0.5), () => SG.Snd.atoms(0.5), () => SG.Snd.noise(0.1, 0.1, 800), () => SG.Snd.tone(440, 0.1),
          () => SG.Snd.setMuted(true), () => SG.Snd.setMuted(false),
        ];
        for (const p of probes) p();
        return { ok: true, ctx: SG.Snd.ctx ? SG.Snd.ctx.state : "absent" };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    check("P all Sfx entry points are throw-safe", snd.ok, JSON.stringify(snd));

    /* mute toggle drives UI + save */
    await page.click("#btn-sound");
    await page.waitForTimeout(150);
    const muted = await page.evaluate(() => ({
      label: document.getElementById("btn-sound").textContent,
      saved: SG.Save.data.sound,
    }));
    await page.click("#btn-sound");
    check("P sound toggle flips UI label and save", muted.label === "✕" && muted.saved === false, JSON.stringify(muted));
  } catch (e) {
    check("EXCEPTION", false, e && e.message ? e.message : String(e));
  } finally {
    try { await browser.close(); } catch (err) {}
    try { server.close(); } catch (err) {}
  }

  const failed = checks.filter((c) => !c).length;
  console.log("\n" + (failed ? failed + " CHECK(S) FAILED of " + checks.length : "ALL PERF/AUDIO CHECKS PASSED (" + checks.length + " checks)"));
  process.exit(failed ? 1 : 0);
})();
