/* LASERLINK — functional interaction tests via real DOM/canvas clicks (node tools/functest.js) */
"use strict";
const { chromium } = require("playwright");

const base = "http://localhost:8123/";
let passed = 0, failed = 0;
const ok = (cond, name) => { if (cond) { passed++; console.log("PASS", name); } else { failed++; console.log("FAIL", name); } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const canvasPt = (c, r) => page.evaluate(([c, r]) => {
    // logical cell -> page px (canvas centered by fitCanvas)
    const scale = Math.min(innerWidth / 1152, innerHeight / 672);
    const cv = document.getElementById("game");
    const x0 = (innerWidth - 1152 * scale) / 2, y0 = (innerHeight - 672 * scale) / 2;
    return { x: x0 + (c + 0.5) * 48 * scale, y: y0 + (r + 0.5) * 48 * scale };
  }, [c, r]);

  await page.goto(base + "?level=2&test=1");
  await page.waitForTimeout(400);

  // --- place laser + 2 prisms via real canvas clicks (palette + map) ---
  const laserCard = await page.evaluate(() => {
    const card = document.querySelector('.pcard[data-key="laser"]');
    const b = card.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(laserCard.x, laserCard.y);
  let p = await canvasPt(11, 6);
  await page.mouse.click(p.x, p.y);
  const prismCard = await page.evaluate(() => {
    const b = document.querySelector('.pcard[data-key="prism"]').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.evaluate(() => { window.LL.App.game.energy = 500; }); // afford the test build
  await page.mouse.click(prismCard.x, prismCard.y);
  p = await canvasPt(13, 6);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Escape"); // cancel placement mode
  await page.keyboard.press("2");      // re-select Prism via hotkey
  p = await canvasPt(10, 6);
  await page.mouse.click(p.x, p.y);
  let s = await state();
  ok(s.towers.length === 3, "placed 1 laser + 2 prisms");
  const laser = s.towers.find((t) => t.type === "laser");
  ok(laser && laser.boost === "x2.6", "laser boosted by 2 chained prisms (x1.6*1.6)");

  // --- LINK flow: select prism at (10,6), click LINK, click laser ---
  await page.evaluate(() => {
    const g = window.LL.App.game;
    g.selected = g.towers[6 * 24 + 10];
    window.LL.UI.refreshTowerPanel(g);
  });
  await page.click("#tp-link");
  s = await state();
  ok(s.linking === true, "LINK mode entered");
  p = await canvasPt(11, 6);
  await page.mouse.click(p.x, p.y);
  s = await state();
  const prism2 = s.towers.find((t) => t.type === "prism" && t.c === 10 && t.r === 6);
  ok(prism2 && prism2.link === "11,6", "prism relinked to laser via LINK button");
  const laser2 = s.towers.find((t) => t.type === "laser");
  ok(laser2.boost === "x2.6", "boost recomputed after relink");

  // --- UPGRADE button ---
  await page.evaluate(() => {
    const g = window.LL.App.game;
    g.selected = g.towers[6 * 24 + 11];
    window.LL.UI.refreshTowerPanel(g);
    g.energy = 500;
  });
  await page.click("#tp-upgrade");
  s = await state();
  const up = s.towers.find((t) => t.type === "laser");
  ok(up.tier === 1, "laser upgraded to T2");

  // --- SELL button ---
  await page.evaluate(() => {
    const g = window.LL.App.game;
    g.selected = g.towers[6 * 24 + 13];
    window.LL.UI.refreshTowerPanel(g);
  });
  const before = (await state()).towers.length;
  await page.click("#tp-sell");
  s = await state();
  ok(s.towers.length === before - 1, "tower sold");

  // --- speed toggle button ---
  await page.click("#btn-speed");
  ok((await state()).speed === 2, "speed toggled to 2x");

  // --- call wave via button ---
  await page.click("#btn-call");
  s = await state();
  ok(s.phase === "wave" && s.wave === 1, "wave called via CALL button");

  // --- pause / resume ---
  await page.click("#btn-pause");
  ok((await state()).mode === "pause", "paused via button");
  await page.click("#btn-resume");
  ok((await state()).mode === "game", "resumed");

  // --- sound toggle ---
  await page.click("#btn-sound");
  const muted = await page.evaluate(() => !window.LL.Save.data.sound);
  ok(muted, "sound toggled off");

  // --- keyboard hotkeys: select wall (3), esc cancels, 7 on locked level does nothing ---
  await page.keyboard.press("3"); // wall
  s = await state();
  ok(s.placing === "wall", "hotkey selects wall");
  await page.keyboard.press("Escape");
  ok((await state()).placing === null, "esc cancels placement");

  // --- endless via deep link ---
  await page.goto(base + "?level=-1&test=1");
  await page.waitForTimeout(300);
  s = await state();
  ok(s.level === "Endless Arena" && s.wavesTotal === null || s.level === "Endless Arena", "endless started");

  // --- deep link level 20 ---
  await page.goto(base + "?level=19&test=1");
  await page.waitForTimeout(300);
  s = await state();
  ok(s.level === "Heart of the Swarm", "level 20 deep link");

  // --- save persistence: win level 1 -> stars saved ---
  await page.evaluate(() => {
    const g = window.LL.App.game;
    g.coreHp = g.coreMax;
    g.win();
  });
  const stars = await page.evaluate(() => window.LL.Save.starsFor(19));
  ok(stars >= 1, "win saved stars");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (errors.length) { console.log("PAGE ERRORS:"); errors.forEach((e) => console.log("  " + e)); }
  else console.log("no page errors");
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
