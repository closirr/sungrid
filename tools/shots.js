/* LASERLINK — full-page screenshots of DOM overlays (node tools/shots.mjs) */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const base = "http://localhost:8123/";
const outDir = path.resolve(__dirname, "..", "output", "ui");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(outDir, name + ".png") });
    console.log("shot:", name);
  };

  // title
  await page.goto(base);
  await shot("01-title");

  // how to play
  await page.click("#btn-howto");
  await shot("02-howto");
  await page.click("#screen-howto .back-btn");

  // level select
  await page.click("#btn-play");
  await shot("03-levels");

  // start level 1 via UI click on first tile
  await page.click("#levels-grid .lvl:not(.locked)");
  await shot("04-game-build");

  // build via game API (visual test of beams/ghost + panel)
  await page.evaluate(() => {
    const g = window.LL.App.game;
    g.place("laser", 10, 5);
    g.place("laser", 14, 6);
    g.place("extractor", 11, 5);
    const t = window.LL.App.game.towers[5 * 24 + 10];
    window.LL.App.game.selected = t;
    window.LL.UI.refreshTowerPanel(g);
  });
  await shot("05-game-towerpanel");

  // call wave + combat
  await page.evaluate(() => window.LL.App.game.callWave(true));
  await page.waitForTimeout(4500);
  await shot("06-game-combat");

  // pause
  await page.click("#btn-pause");
  await shot("07-pause");
  await page.click("#btn-resume");

  // win screen (force)
  await page.evaluate(() => { const g = window.LL.App.game; g.coreHp = g.coreMax; g.win(); });
  await shot("08-win");

  // lose screen
  await page.evaluate(() => { window.LL.App.startLevel(1); window.LL.App.game.onCoreHit(999); });
  await shot("09-lose");

  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
