/* SUNGRID — full-page screenshots of every screen (node tools/shots.js)
 * Captures the WHOLE page (no clip) so DOM overlays (HUD, panels, menus) are included.
 * Output: output/shots/01-title.png … 11-lose.png, each verified >30KB.
 *
 * 32×32-map / camera era: canvas clicks go through the live camera
 * (ISO.px → Renderer.worldToScreen), and gameplay shots (05-07) aim the camera
 * at the action: Renderer.centerOn(core) + zoomAt to ~1.0-1.2 so the fight
 * fills the frame instead of a tiny fit-zoom overview. */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const base = "http://localhost:8124/";
const outDir = path.resolve(__dirname, "..", "output", "shots");
// light theme + flat sky compresses very well (title is ~28KB, blank would be ~7KB)
const MIN_BYTES = 20 * 1024;

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
    // page-side camera aiming helper: centerOn the tile (fit zoom), zoomAt on
    // that exact world point up to the wanted zoom, then pan it to mid-canvas
    await page.evaluate(() => {
      window.__focusCam = (c, r, z) => {
        const R = window.SG.Renderer;
        R.centerOn(c, r);
        const p = window.SG.ISO.px(c, r);
        let s = R.worldToScreen(p.x, p.y);
        R.zoomAt(s.x, s.y, z / R.cam.z);
        s = R.worldToScreen(p.x, p.y);
        R.panBy(s.x - CFG.W / 2, s.y - CFG.H / 2);
        return { z: R.cam.z, at: R.worldToScreen(p.x, p.y) };
      };
    });
  };

  // helper: click a grid cell on the canvas (real mouse click at the camera-
  // projected point), temporarily hiding any DOM overlay that covers the point
  // (banner/toasts/panel). +4px vertical nudge: the tile center sits exactly on
  // an ISO.pick() cell boundary, so float32 clientY rounding could flip it.
  const clickCanvasAt = async (page, c, r) => {
    const pt = await page.evaluate(([cc, rr]) => {
      const cv = document.getElementById("game");
      const w = window.SG.ISO.px(cc, rr);
      const s = window.SG.Renderer.worldToScreen(w.x, w.y);
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + (s.x / CFG.W) * rect.width, y: rect.top + ((s.y + 4) / CFG.H) * rect.height };
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

  /* put-style placement for STATIC shots: instant built=1 (the only way to get
   * finished buildings on demand — real construction needs grid atoms/time) */
  const putFn = () => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    window.__put = (type, c, r, built = 1) => {
      const t = g.place(type, c, r);
      if (t) {
        t.built = built;
        g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains();
      }
      return t;
    };
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
  await page.evaluate(putFn);
  const core5 = await page.evaluate(() => {
    const K = g.core;
    __put("link", K.c + 1, K.r - 1);
    __put("link", K.c + 1, K.r + 1);
    __put("link", K.c - 2, K.r - 2);       // chain toward the south-west mineral pair
    __put("link", K.c - 3, K.r - 3);
    __put("harvester", K.c - 4, K.r - 4);  // on a real mineral deposit (income > 0)
    __put("laser", K.c + 2, K.r);          // receiver — will be selected with a canvas click
    __put("laser", K.c + 2, K.r - 2, 0.55); // one still under construction (gold ring)
    __put("laser", K.c + 2, K.r + 2);
    __focusCam(K.c, K.r, 1.05);            // camera on the core: the build matters, not the whole map
    return { c: K.c, r: K.r };
  });
  console.log("shot5 core:", JSON.stringify(core5));
  await clickCanvasAt(page, core5.c + 2, core5.r);
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
    const K = g.core;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    put("link", K.c - 2, K.r - 2);
    put("link", K.c - 3, K.r - 3);
    put("harvester", K.c - 4, K.r - 4);    // economy: atoms visibly flowing in
    const receiver = put("laser", K.c + 2, K.r);
    const f1 = put("laser", K.c + 1, K.r - 1);
    const f2 = put("laser", K.c + 1, K.r + 1);
    g.linkLaser(f1, receiver);
    g.linkLaser(f2, receiver);
    // NOTE: enemies at the core die silently (entities.js), so spawn crawlers on
    // the west approach and step time until they enter the boosted receiver range.
    const spots = [[K.c - 4, K.r], [K.c - 4, K.r - 2], [K.c - 4, K.r + 2], [K.c - 3, K.r - 1], [K.c - 3, K.r + 1], [K.c - 5, K.r]];
    for (const [c, r] of spots) g.spawnTestEnemy("crawler", c, r);
    for (let i = 0; i < 30; i++) {
      window.advanceTime(300);
      const alive = g.enemies.filter((e) => !e.dead);
      if (alive.length < 3) break;
      const minD = Math.min(...alive.map((e) => U.dist(e.gc, e.gr, receiver.c, receiver.r)));
      if (minD <= 2.8) break; // in receiver range — beams are firing
    }
    __focusCam(receiver.c, receiver.r, 1.0); // camera on the gunfight
    return {
      alive: g.enemies.filter((e) => !e.dead).length,
      kills: g.kills, feeders: receiver.boost.n,
    };
  });
  console.log("fight: alive", fight.alive, "kills", fight.kills, "feeders", fight.feeders);
  await shot(page, "06-game-wave-fight");

  /* ---------- 7. game overload: red-hot links (2-hop chain, plants at the end) ---------- */
  await goto(page, "?level=0&test=1");
  const ov = await page.evaluate(() => {
    window.g = window.SG.App.game;
    g.energy = 9999;
    const K = g.core;
    const put = (type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); }
      return !!t;
    };
    put("link", K.c, K.r + 3);             // hop 1 (inside core radius)
    put("link", K.c, K.r + 5);             // hop 2 (hangs off link 1)
    put("plant", K.c - 1, K.r + 7);        // plants at the chain's end → 26 e/s through 20 e/s
    put("plant", K.c + 1, K.r + 7);
    // heat up in small steps, stop before burnout (heat >= 80 → red, still alive)
    let maxHeat = 0;
    for (let i = 0; i < 40; i++) {
      window.advanceTime(300);
      const hs = g.towerList.filter((t) => t.key === "link").map((t) => t.heat);
      maxHeat = hs.length ? Math.max(...hs) : 0;
      if (maxHeat >= 80) break;
    }
    __focusCam(K.c, K.r + 5, 1.15);        // camera mid-chain: links + plants in frame
    return {
      maxHeat: Math.round(maxHeat),
      linksAlive: g.towerList.filter((t) => t.key === "link" && !t.dead).length,
    };
  });
  console.log("overload: maxHeat", ov.maxHeat, "linksAlive", ov.linksAlive);
  await shot(page, "07-game-overload");

  /* ---------- 8. pause (Esc in game) ---------- */
  await goto(page, "?level=0&test=1");
  await page.evaluate(putFn);
  await page.evaluate(() => {
    const K = g.core;
    __put("link", K.c + 1, K.r - 1);
    __put("laser", K.c + 2, K.r);
    __put("harvester", K.c - 4, K.r - 4);
    __focusCam(K.c, K.r, 1.0);
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
