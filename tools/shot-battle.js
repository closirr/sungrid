/* SUNGRID — one-off visual probe: a real wave battle on L1 (chain defense vs crawlers).
 * Usage: node tools/shot-battle.js [outPng] */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const out = process.argv[2] || path.join(__dirname, "..", "output", "web-game", "battle.png");
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:8124/?level=0&test=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);

  const summary = await page.evaluate(() => {
    const g = window.SG.App.game;
    g.energy = 10000;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    put("link", 9, 8);
    put("link", 9, 10);
    const rcv = put("laser", 8, 9);
    const f1 = put("laser", 9, 7);
    const f2 = put("laser", 9, 11);
    g.linkLaser(f1, rcv);
    g.linkLaser(f2, rcv);
    put("harvester", 10, 12);
    window.advanceTime(3000); // ramp focus
    g.callWave(true);        // wave 1 NOW
    window.advanceTime(6500); // mid-fight
    const mid = window.render_game_to_text();
    window.advanceTime(30000); // let the wave resolve
    return { mid, end: window.render_game_to_text() };
  });

  console.log("MID:", summary.mid.slice(0, 700));
  console.log("END:", summary.end.slice(0, 700));
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot:", out);
  console.log("pageErrors:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
