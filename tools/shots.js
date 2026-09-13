/* SUNGRID — full-page screenshots of every screen (node tools/shots.js)
 * Captures the WHOLE page (no clip) so DOM overlays (HUD, panels, menus) are included.
 * Output: output/shots/01-title.png … 11-lose.png, each verified >30KB. */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const base = "http://localhost:8124/";
const outDir = path.resolve(__dirname, "..", "output", "shots");
const MIN_BYTES = 30 * 1024;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // NOTE: no --use-gl/args here — the game canvas is 2D, and with swiftshader
  // headless Chromium hangs on every page.screenshot after the first one.
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  const watch = (page, tag) => {
    page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${tag}] console: ${m.text()}`); });
  };

  const newPage = async (tag) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page, tag);
    return page;
  };

  let okCount = 0;
  const shot = async (page, name) => {
    await page.waitForTimeout(350);
    const file = path.join(outDir, name + ".png");
    await page.screenshot({ path: file }); // full page, NO clip — DOM overlays included
    const kb = Math.round(fs.statSync(file).size / 1024);
    const ok = fs.statSync(file).size > MIN_BYTES;
    if (ok) okCount++;
    console.log(`shot: ${name}.png  ${kb}KB ${ok ? "OK" : "  <-- TOO SMALL / BLANK?"}`);
  };

  const goto = async (page, url) => {
    await page.goto(base + url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(450);
  };

  // helper: click a grid cell on the canvas (real mouse click at iso-projected point),
  // temporarily hiding any DOM overlay that covers the point (banner/toasts/panel).
  const clickCanvasAt = async (page, c, r) => {
    const pt = await page.evaluate(([cc, rr]) => {
      const cv = document.getElementById("game");
      const p = window.SG.ISO.px(cc, rr);
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + (p.x / CFG.W) * rect.width, y: rect.top + (p.y / CFG.H) * rect.height };
    }, [c, r]);
    await page.evaluate(({ x, y }) => {
      const cv = document.getElementById("game");
      const el = document.elementFromPoint(x, y);
      if (!el || el === cv) return false;
      window.__hiddenOverlays = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.style && n.style.visibility !== "hidden") {
          window.__hiddenOverlays.push([n, n.style.visibility]);
          n.style.visibility = "hidden";
        }
      }
      return document.elementFromPoint(x, y) !== cv;
    }, pt);
    await page.mouse.click(pt.x, pt.y);
    await page.evaluate(() => {
      (window.__hiddenOverlays || []).forEach(([n, v]) => { n.style.visibility = v; });
      window.__hiddenOverlays = null;
    });
    return pt;
  };

  /* ---------- 1. title ---------- */
  const page = await newPage("main");
  await goto(page, "");
  await shot(page, "01-title");

  /* ---------- 2. howto ---------- */
  await page.click("#btn-howto");
  await shot(page, "02-howto");

  /* ---------- 3. level select (fresh save: WAVE/ENDLESS locked) ---------- */
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.click("#btn-play");
  await shot(page, "03-select");

  /* ---------- 4. level select with injected progress (modes unlocked) ---------- */
  const page2 = await newPage("progress");
  await page2.addInitScript(() => {
    localStorage.setItem("sungrid-save-v1", JSON.stringify({
      unlocked: 12,
      // 7:2 added so ENDLESS is open too (ui.js opens it via starsFor(7), not `unlocked`)
      stars: { 0: 3, 1: 3, 2: 3, 3: 2, 4: 3, 7: 2 },
      endlessBest: 14,
      waveBest: { medal: 3, time: 321 },
      sound: true,
    }));
  });
  await goto(page2, "");
  await page2.click("#btn-play");
  await shot(page2, "04-select-progress");
  await page2.close();

  /* ---------- 5. game build: several buildings + tower panel via canvas click ---------- */
  await goto(page, "?level=0&test=1");
  await page.evaluate(() => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    const put = (type, c, r, built = 1) => {
      const t = g.place(type, c, r);
      if (t) { t.built = built; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    put("link", 13, 8);
    put("link", 13, 10);
    put("link", 12, 11);          // extends the network to the south mineral pair
    put("laser", 12, 9);          // receiver — will be selected with a canvas click
    put("laser", 14, 8, 0.55);    // one still under construction
    put("laser", 14, 10);
    put("harvester", 10, 12);     // on a real mineral deposit (income > 0)
    window.advanceTime(400);
  });
  await clickCanvasAt(page, 12, 9);
  await page.waitForTimeout(150);
  const panel = await page.evaluate(() => {
    const p = document.getElementById("tower-panel");
    return { visible: !p.classList.contains("hidden"), name: document.getElementById("tp-name").textContent };
  });
  console.log("tower panel:", JSON.stringify(panel));
  await shot(page, "05-game-build");

  /* ---------- 6. game wave fight: chained laser firing at crawlers ---------- */
  await goto(page, "?level=0&test=1");
  const fight = await page.evaluate(() => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    put("link", 13, 8);
    put("link", 13, 10);
    const receiver = put("laser", 12, 9);
    const f1 = put("laser", 14, 8);
    const f2 = put("laser", 14, 10);
    g.linkLaser(f1, receiver);
    g.linkLaser(f2, receiver);
    // NOTE: core is at (10,9) — spawning next to it makes crawlers reach the core
    // and die silently (entities.js: enemies at the core die without kills), so
    // spawn them on the west approach and step time until they enter laser range.
    const spots = [[4, 8], [4, 9], [4, 10], [5, 8], [5, 10], [6, 9], [5, 7], [5, 11]];
    for (const [c, r] of spots) g.spawnTestEnemy("crawler", c, r);
    for (let i = 0; i < 30; i++) {
      window.advanceTime(300);
      const alive = g.enemies.filter((e) => !e.dead);
      if (alive.length < 3) break;
      const minD = Math.min(...alive.map((e) => U.dist(e.gc, e.gr, 12, 9)));
      if (minD <= 2.8) break; // in receiver range — beams are firing
    }
    const alive = g.enemies.filter((e) => !e.dead).length;
    return { alive, kills: g.kills, feeders: receiver.boost.n };
  });
  console.log("fight: alive", fight.alive, "kills", fight.kills, "feeders", fight.feeders);
  await shot(page, "06-game-wave-fight");

  /* ---------- 7. game overload: red-hot links (geometry from shot-overload.js) ---------- */
  await goto(page, "?level=0&test=1");
  const ov = await page.evaluate(() => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); }
      return !!t;
    };
    put("link", 10, 7);
    put("link", 10, 5);
    put("plant", 10, 3);
    put("plant", 11, 4);
    // heat up in small steps, stop before burnout (heat >= 80 → red, still alive)
    let maxHeat = 0;
    for (let i = 0; i < 40; i++) {
      window.advanceTime(300);
      const hs = g.towerList.filter((t) => t.key === "link").map((t) => t.heat);
      maxHeat = hs.length ? Math.max(...hs) : 0;
      if (maxHeat >= 80) break;
    }
    return {
      maxHeat: Math.round(maxHeat),
      linksAlive: g.towerList.filter((t) => t.key === "link" && !t.dead).length,
    };
  });
  console.log("overload: maxHeat", ov.maxHeat, "linksAlive", ov.linksAlive);
  await shot(page, "07-game-overload");

  /* ---------- 8. pause (Esc in game) ---------- */
  await goto(page, "?level=0&test=1");
  await page.evaluate(() => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    put("link", 13, 8);
    put("laser", 12, 9);
    put("harvester", 12, 12);
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const paused = await page.evaluate(() => window.SG.App.state);
  console.log("pause state:", paused);
  await shot(page, "08-pause");

  /* ---------- 9. win: campaign LEVEL COMPLETE with stars ---------- */
  await goto(page, "?level=0&test=1");
  await page.evaluate(() => {
    const g = window.SG.App.game;
    g.coreHp = g.coreMax;
    g.win(); // sets state='won' and calls onWin → UI.showWin
  });
  const winState = await page.evaluate(() => ({
    state: window.SG.App.state,
    title: document.getElementById("win-title").textContent,
  }));
  console.log("win screen:", JSON.stringify(winState));
  await shot(page, "09-win");

  /* ---------- 10. win-wave: WAVE ATTACK — GOLD ---------- */
  await goto(page, "?mode=wave&test=1");
  await page.evaluate(() => {
    const g = window.SG.App.game;
    g.wave = 10;
    g.runTime = 185; // < WAVE_GOLD (360s) → GOLD medal
    g.coreHp = g.coreMax;
    g.win();
  });
  const waveWin = await page.evaluate(() => ({
    state: window.SG.App.state,
    title: document.getElementById("win-title").textContent,
  }));
  console.log("wave-win screen:", JSON.stringify(waveWin));
  await shot(page, "10-win-wave");

  /* ---------- 11. lose: CORE DESTROYED ---------- */
  await goto(page, "?level=0&test=1");
  await page.evaluate(() => window.SG.App.game.onCoreHit(9999));
  const loseState = await page.evaluate(() => ({
    state: window.SG.App.state,
    sub: document.getElementById("lose-sub").textContent,
  }));
  console.log("lose screen:", JSON.stringify(loseState));
  await shot(page, "11-lose");

  await browser.close();
  console.log(`\ndone: ${okCount} shots OK in ${outDir}`);
  console.log("errors:", errors.length ? errors : "none");
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
