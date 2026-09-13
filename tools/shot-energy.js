/* SUNGRID — one-off visual probe: build an energy chain on L1 and screenshot the atoms.
 * Usage: node tools/shot-energy.js [outPng] */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const out = process.argv[2] || path.join(__dirname, "..", "output", "web-game", "energy.png");
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
      link: put("link", 12, 8),
      plant: put("plant", 14, 7),
      harvester: put("harvester", 10, 6),
      extraLink: put("link", 13, 7),
    };
    window.advanceTime(12000); // 12s: builds finish, atoms flow
    return { res, text: window.render_game_to_text() };
  });

  console.log("placed:", JSON.stringify(state.res));
  console.log("state:", state.text);
  await page.screenshot({ path: out });
  await browser.close();
  console.log("shot:", out);
  console.log("pageErrors:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})();
