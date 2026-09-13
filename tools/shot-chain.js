/* SUNGRID — one-off visual probe: laser chain feeding a receiver, crawlers as targets.
 * Usage: node tools/shot-chain.js [outPng] */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const out = process.argv[2] || path.join(__dirname, "..", "output", "web-game", "chain.png");
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:8124/?level=0&test=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => {
    const g = window.SG.App.game;
    g.energy = 10000;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    // receiver near the core, two feeders behind it, a third laser left unlinked
    // (links first: they extend the build network for the far lasers)
    const link1 = put("link", 13, 8);
    const link2 = put("link", 13, 10);
    const receiver = put("laser", 12, 9);
    const f1 = put("laser", 14, 8);
    const f2 = put("laser", 14, 10);
    const lone = put("laser", 12, 12);
    const l1 = g.linkLaser(f1, receiver);
    const l2 = g.linkLaser(f2, receiver);
    // wave of crawlers marching from the west spawn
    for (let i = 0; i < 6; i++) g.spawnTestEnemy("crawler", 1, 5 + i);
    for (let i = 0; i < 3; i++) window.advanceTime(900); // 2.7s: ramp focuses
    return {
      linked: [l1, l2],
      boost: receiver.boost,
      ramp: +receiver.ramp.toFixed(2),
      enemies: g.enemies.length,
      kills: g.kills,
      text: window.render_game_to_text(),
    };
  });

  console.log("linked:", state.linked, "boost:", JSON.stringify(state.boost), "ramp:", state.ramp);
  console.log("enemies:", state.enemies, "kills:", state.kills);
  console.log("state:", state.text.slice(0, 600));
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot:", out);
  console.log("pageErrors:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
