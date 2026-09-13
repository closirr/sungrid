/* SUNGRID — one-off visual probe: overload a thin chain, capture red-hot links mid-heat.
 * Usage: node tools/shot-overload.js [outPng] */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const out = process.argv[2] || path.join(__dirname, "..", "output", "web-game", "overload.png");
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("http://localhost:8124/?level=0&test=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => {
    const g = window.SG.App.game;
    g.credits = 10000;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); }
      return !!t;
    };
    const res = {
      link1: put("link", 10, 7),
      link2: put("link", 10, 5),
      plant1: put("plant", 10, 3),
      plant2: put("plant", 11, 4),
    };
    // advance ~7.2s in 0.6s chunks, watch heat climb
    const heatLog = [];
    for (let i = 0; i < 12; i++) {
      window.advanceTime(600);
      heatLog.push(g.towerList.filter((t) => t.key === "link").map((t) => Math.round(t.heat)).join("/"));
      if (!g.towerList.some((t) => t.key === "link")) break;
    }
    window.render_game_to_text();
    return {
      res,
      heatLog,
      linksLeft: g.towerList.filter((t) => t.key === "link").length,
      text: window.render_game_to_text(),
    };
  });

  console.log("placed:", JSON.stringify(state.res));
  console.log("heat per 0.6s:", state.heatLog.join(" | "));
  console.log("links left:", state.linksLeft);
  console.log("state:", state.text.slice(0, 400));
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot:", out);
  console.log("pageErrors:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
