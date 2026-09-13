/* SUNGRID — functional interaction tests via REAL user actions (Playwright).
 * Everything is driven by palette clicks, canvas tile clicks and HUD buttons.
 * No game-API writes: the game is only OBSERVED through window.render_game_to_text()
 * and fast-forwarded with window.advanceTime() (allowed test hooks).
 *
 * Run: node tools/functest.js   (local server on :8124 must be up)
 * Pages load with &test=1 (deterministic stepping, no autoplay). Each pass
 * reloads the page fresh, so passes are independent. Failure screenshots
 * go to output/functest/ (never to output/web-game/). */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = "http://localhost:8124/";
const FAIL_DIR = path.join(__dirname, "..", "output", "functest");

/* ISO projection mirrored from js/iso.js: canvas px of a tile CENTER (c, r).
 * x = (c - r) * 32 + 640, y = (c + r) * 16 + 58   (tile 64x32, canvas 1280x720).
 * No magic offsets: clicks land exactly on the tile center, ISO.pick() floors
 * back to the same cell. */
const isoPx = (c, r) => ({ x: (c - r) * 32 + 640, y: (c + r) * 16 + 58 });

let passed = 0, failed = 0;
const results = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  /* ---- observation + real input helpers ---- */
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((ms) => window.advanceTime(ms), ms);
  const domText = (sel) => page.evaluate(
    (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; }, sel);
  const domHidden = (sel) => page.evaluate(
    (s) => { const el = document.querySelector(s); return !el || el.classList.contains("hidden"); }, sel);

  async function goto(url) {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function");
    await page.waitForTimeout(250);
  }

  /* Click a grid tile: ISO formula -> canvas px -> page px via the live canvas rect. */
  async function clickTile(c, r, opts = {}) {
    const b = await page.locator("#game").boundingBox();
    const p = isoPx(c, r);
    await page.mouse.click(b.x + p.x * (b.width / 1280), b.y + p.y * (b.height / 720), opts);
  }

  const clickCard = (key) => page.click(`.pcard[data-key="${key}"]`);
  const clickBtn = (id) => page.click("#" + id);
  /* right-click on empty ground = documented "cancel placement / link mode" */
  const cancelPlacing = () => clickTile(0, 17, { button: "right" });
  const bld = (s, type, c, r) => s.buildings.find((t) => t.type === type && t.c === c && t.r === r);
  const ck = (cond, msg) => { if (!cond) throw new Error(msg); };

  async function runPass(num, name, url, fn) {
    const errStart = errors.length;
    let ok = true, note = "";
    try {
      await goto(url);
      await fn();
    } catch (e) {
      ok = false;
      note = String((e && e.message) || e).split("\n")[0];
      try {
        fs.mkdirSync(FAIL_DIR, { recursive: true });
        await page.screenshot({ path: path.join(FAIL_DIR, `fail-P${num}.png`) });
      } catch (_) { /* screenshot is best-effort */ }
    }
    const passErrors = errors.slice(errStart);
    if (passErrors.length) {
      ok = false;
      note += (note ? "; " : "") + passErrors.length + " page/console error(s): " + passErrors[0];
    }
    if (ok) { passed++; results.push(`  ✓ P${num} ${name}`); console.log(`  ✓ P${num} ${name}`); }
    else { failed++; results.push(`  ✗ P${num} ${name} — ${note}`); console.log(`  ✗ P${num} ${name} — ${note}`); }
  }

  console.log("SUNGRID functest @ " + BASE);

  /* ------------------------------------------------------------------ */
  await runPass(1, "menu → PLAY → level 1 starts (game/build)", BASE + "?test=1", async () => {
    ck((await state()).mode === "title", "title screen shown");
    ck(!(await domHidden("#screen-title")), "title overlay visible");
    await clickBtn("btn-play");
    ck(!(await domHidden("#screen-select")), "level select visible after PLAY");
    await page.click("#levels-grid .lvl");            // first campaign level (L1)
    const s = await state();
    ck(s.mode === "game" && s.phase === "build", `mode=game phase=build, got ${s.mode}/${s.phase}`);
    ck(s.level === "First Grid" && s.gameMode === "campaign", `L1 loaded, got "${s.level}"`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(2, "palette Link → tile (10,8) builds, energyPool 200→175", BASE + "?level=0&test=1", async () => {
    const s0 = await state();
    ck(s0.phase === "build" && s0.energyPool === 200, `fresh L1: build phase, 200 pool (got ${s0.energyPool})`);
    await clickCard("link");
    ck((await state()).placing === "link", "palette selected Energy Link");
    await clickTile(10, 8);                           // free ground next to the core (10,9)
    const s1 = await state();
    ck(!!bld(s1, "link", 10, 8), "link appears at (10,8) right after the click");
    ck(s1.energyPool === 175, `energyPool 200-25=175, got ${s1.energyPool}`);
    await advance(4500);                              // construction is 4s at zero supply
    const b = bld(await state(), "link", 10, 8);
    ck(b && b.built === 1, `link built=1 (got ${b && b.built})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(3, "palette Plant → tile (12,9), energyGen 4→14, surplus banks", BASE + "?level=0&test=1", async () => {
    ck((await state()).energyGen === 4, "core alone generates 4 e/s");
    await clickCard("plant");
    await clickTile(12, 9);                           // free ground 2 cells east of the core
    const sNow = await state();
    ck(sNow.energyPool === 100, `pool 200-100=100 right after placement (got ${sNow.energyPool})`);
    await advance(4500);
    const s = await state();
    const b = bld(s, "plant", 12, 9);
    ck(b && b.built === 1, `plant built=1 (got ${b && b.built})`);
    ck(s.energyGen === 14, `energyGen 4→14, got ${s.energyGen}`);
    ck(s.energyPool > 100, `surplus production banks into the pool (got ${s.energyPool})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(4, "laser chain: LINK button, boost x1.50→x2.25, Shift+click unlink", BASE + "?level=2&test=1", async () => {
    const s0 = await state();
    ck(s0.level === "The Throat", `on L3 (lasers unlocked), got "${s0.level}"`);
    await clickCard("laser");
    await clickTile(14, 8); await clickTile(15, 8); await clickTile(16, 8); // row north of core (15,9)
    await advance(5000);
    let s = await state();
    ck([14, 15, 16].every((c) => { const b = bld(s, "laser", c, 8); return b && b.built === 1; }),
      "3 lasers built at (14..16,8)");
    await cancelPlacing();                            // drop the palette ghost first
    await clickTile(14, 8);                           // select feeder A
    s = await state();
    ck(s.selected && s.selected.type === "laser" && s.selected.c === 14, "laser A selected by canvas click");
    await clickBtn("tp-link");                        // LINK
    ck((await state()).linking === true, "LINK mode entered");
    await clickTile(15, 8);                           // aim at receiver B
    s = await state();
    const A = bld(s, "laser", 14, 8), B = bld(s, "laser", 15, 8);
    ck(A && A.feedTo === "15,8", `A.feedTo=15,8 (got ${A && A.feedTo})`);
    ck(B && B.feeders === 1 && (B.boost || "").startsWith("x1.50"),
      `B boosted x1.50 (got feeders=${B && B.feeders} boost=${B && B.boost})`);
    await clickTile(16, 8);                           // select second feeder C
    await clickBtn("tp-link");
    await clickTile(15, 8);                           // C → B as well
    s = await state();
    const C = bld(s, "laser", 16, 8), B2 = bld(s, "laser", 15, 8);
    ck(C && C.feedTo === "15,8", `C.feedTo=15,8 (got ${C && C.feedTo})`);
    ck(B2.feeders === 2 && B2.boost.startsWith("x2.25"),
      `B boosted x2.25 with 2 feeders (got feeders=${B2.feeders} boost=${B2.boost})`);
    await page.keyboard.down("Shift");
    await clickTile(14, 8);                           // shift-click feeder A → unlink
    await page.keyboard.up("Shift");
    s = await state();
    const A2 = bld(s, "laser", 14, 8), B3 = bld(s, "laser", 15, 8);
    ck(A2 && A2.feedTo === undefined, "A.feedTo gone after Shift+click");
    ck(B3.feeders === 1, `B back to 1 feeder (got ${B3.feeders})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(5, "bomb: charge 40 → DETONATE → building gone", BASE + "?level=5&test=1", async () => {
    const s0 = await state();
    ck(s0.level === "Islands", `on L6 (bomb unlocked), got "${s0.level}"`);
    await clickCard("bomb");
    await clickTile(10, 7);                           // free ground next to the core (10,8)
    await advance(15000);                             // 4s build + ~10s charging at 50% supply
    let s = await state();
    let b = bld(s, "bomb", 10, 7);
    ck(b && b.charge === 40, `bomb fully charged (got ${b && b.charge})`);
    await cancelPlacing();
    await clickTile(10, 7);                           // select the bomb
    s = await state();
    ck(s.selected && s.selected.type === "bomb", "bomb selected by canvas click");
    ck(!(await domHidden("#tp-link")), "DETONATE button visible");
    ck((await domText("#tp-link")) === "DETONATE", `button says DETONATE (got "${await domText("#tp-link")}")`);
    await clickBtn("tp-link");
    s = await state();
    ck(!bld(s, "bomb", 10, 7) && s.buildings.length === 0, "bomb removed from the grid");
  });

  /* ------------------------------------------------------------------ */
  await runPass(6, "overload: core→link→2 plants (24 e/s) burns the 20 e/s link", BASE + "?level=0&test=1", async () => {
    await clickCard("link");
    await clickTile(10, 11);                          // link inside core radius; plants hang only off it
    await advance(4500);                              // link built
    await clickCard("plant");
    await clickTile(9, 13);                           // plant 1: out of core range (4.12>3.5), in link range (2.24)
    await clickBtn("btn-call");                       // real HUD action: early call funds plant 2
    const s1 = await state();
    ck(s1.phase === "wave" && s1.wave === 1, "wave 1 called via CALL button");
    await clickTile(11, 13);                          // plant 2, paid by the early-call bonus
    const s2 = await state();
    ck(!!bld(s2, "plant", 11, 13), `plant 2 placed (energyPool=${s2.energyPool})`);
    await advance(5000);                              // both plants finish (4s each)
    let s = await state();
    ck(s.energyGen === 24, `gen core+2 plants = 24 e/s (got ${s.energyGen})`);
    let link = bld(s, "link", 10, 11);
    ck(link && link.heat > 0, `bottleneck link heating (heat=${link && link.heat})`);
    await advance(7000);                              // 24 e/s through 20 e/s → burnout after ~6.3s hot
    s = await state();
    link = bld(s, "link", 10, 11);
    ck(!link, `link burned out and removed (heat=${link && link.heat})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(7, "HUD: pause/resume, speed 2×, sound toggle", BASE + "?level=0&test=1", async () => {
    await clickBtn("btn-pause");
    ck((await state()).mode === "pause", "paused via #btn-pause");
    await clickBtn("btn-pause");                      // top bar stays clickable under the overlay
    ck((await state()).mode === "game", "resumed via #btn-pause again");
    await clickBtn("btn-speed");
    ck((await state()).speed === 2, "speed toggled to 2×");
    ck((await domText("#btn-speed")) === "2×", `speed label 2× (got "${await domText("#btn-speed")}")`);
    await clickBtn("btn-speed");
    ck((await state()).speed === 1, "speed back to 1×");
    const t0 = await domText("#btn-sound");
    await clickBtn("btn-sound");
    ck((await domText("#btn-sound")) !== t0, "sound toggled off (♪→✕)");
    await clickBtn("btn-sound");
    ck((await domText("#btn-sound")) === t0, "sound restored");
  });

  /* ------------------------------------------------------------------ */
  await runPass(8, "Esc → PAUSED panel → RESUME", BASE + "?level=0&test=1", async () => {
    await page.keyboard.press("Escape");
    const s = await state();
    ck(s.mode === "pause", `Esc pauses (mode=${s.mode})`);
    ck(!(await domHidden("#screen-pause")), "PAUSED panel visible");
    ck(((await domText("#screen-pause")) || "").includes("PAUSED"), "panel is the PAUSED menu");
    await clickBtn("btn-resume");
    const s2 = await state();
    ck(s2.mode === "game", "RESUME returns to game");
    ck(await domHidden("#screen-pause"), "panel hidden again");
  });

  /* ------------------------------------------------------------------ */
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (errors.length) {
    console.log("PAGE ERRORS:");
    errors.forEach((e) => console.log("  " + e));
  } else {
    console.log("no page errors");
  }
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
