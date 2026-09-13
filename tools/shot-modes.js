/* SUNGRID — one-off visual probe: wave mode win flow (medal screen) + endless boot.
 * Usage: node tools/shot-modes.js [outPng] */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const out = process.argv[2] || path.join(__dirname, "..", "output", "web-game", "modes.png");
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // 1) endless boots
  await page.goto("http://localhost:8124/?mode=endless&test=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  const endless = await page.evaluate(() => {
    const g = window.SG.App.game;
    return { gameMode: g.mode, wavesTotal: String(g.wavesTotal), level: g.level.name, state: g.state };
  });

  // 2) wave mode → force-finish 10 waves → medal screen
  await page.goto("http://localhost:8124/?mode=wave&test=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  const wave = await page.evaluate(() => {
    const g = window.SG.App.game;
    const boot = { gameMode: g.mode, wavesTotal: g.wavesTotal };
    window.advanceTime(5000);                 // some clock time
    g.wave = 10; g.state = "wave";
    g.pending = []; g.enemies = [];
    g.updateWaves(0.016);                     // triggers win + medal
    const medal = g.medal;
    const stars = g.stars;
    const saved = window.SG.Save.data.waveBest;
    return { boot, medal, stars, saved, title: document.getElementById("win-title").textContent, sub: document.getElementById("win-sub").textContent };
  });

  console.log("endless:", JSON.stringify(endless));
  console.log("wave:", JSON.stringify(wave));
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot:", out);
  console.log("pageErrors:", errors.length ? errors : "none");
  const ok = endless.gameMode === "endless" && wave.boot.gameMode === "wave" && wave.boot.wavesTotal === 10 &&
    wave.medal >= 1 && wave.saved && wave.saved.medal >= 1 && !errors.length;
  process.exit(ok ? 0 : 1);
})();
