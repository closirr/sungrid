/* SUNGRID — functional interaction tests via REAL user actions (Playwright).
 * Everything is driven by palette clicks, canvas tile clicks and HUD buttons.
 * No game-API writes: the game is only OBSERVED through window.render_game_to_text()
 * and fast-forwarded with window.advanceTime() (allowed test hooks).
 *
 * Run: node tools/functest.js   (local server on :8124 must be up)
 * Pages load with &test=1 (deterministic stepping, no autoplay). Each pass
 * reloads the page fresh, so passes are independent. Failure screenshots
 * go to output/functest/ (never to output/web-game/).
 *
 * 32×32-map / camera era notes:
 *  - Canvas clicks go THROUGH the live camera: world = SG.ISO.px(c,r) →
 *    screen = SG.Renderer.worldToScreen(wx, wy) → page px via the canvas rect.
 *  - render_game_to_text does not expose the core cell, so each pass may use
 *    ONE evaluate at its start (JSON.stringify(SG.App.game.core) / free-cell
 *    scan) purely to PLAN clicks; every interaction is still a real mouse event.
 *  - Construction is atomic: a fresh building has built=0 and is raised by
 *    energy atoms pulled from the grid (want 22 e/s, core generates 6 e/s),
 *    so passes fast-forward with advanceTime() until built=1. */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = "http://localhost:8124/";
const FAIL_DIR = path.join(__dirname, "..", "output", "functest");

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
    await page.waitForTimeout(250); // let rAF run once: static layer + camera center on the core
  }

  /* The ONE planning evaluate allowed per pass: the core cell. */
  const getCore = async () => JSON.parse(
    await page.evaluate(() => JSON.stringify(window.SG.App.game.core)));

  /* Click a grid tile: world = ISO.px → screen = Renderer.worldToScreen (live
   * camera) → page px via the live canvas rect. No magic numbers.
   * +4px vertical nudge: the tile center sits EXACTLY on an ISO.pick() cell
   * boundary (floor-based pick) and the float32 clientY rounding of the
   * browser can flip the pick to the neighbour above; a small downward nudge
   * lands deterministically inside the intended tile's pick cell at any zoom. */
  async function clickTile(c, r, opts = {}) {
    const p = await page.evaluate(([cc, rr]) => {
      const w = window.SG.ISO.px(cc, rr);
      const s = window.SG.Renderer.worldToScreen(w.x, w.y);
      return { x: s.x, y: s.y + 4 };
    }, [c, r]);
    const b = await page.locator("#game").boundingBox();
    await page.mouse.click(b.x + p.x * (b.width / 1280), b.y + p.y * (b.height / 720), opts);
  }

  const clickCard = (key) => page.click(`.pcard[data-key="${key}"]`);
  const clickBtn = (id) => page.click("#" + id);
  /* right-click on open ground near the core = documented "cancel placement" */
  const cancelPlacing = (core) => clickTile(core.c - 3, core.r - 3, { button: "right" });
  const bld = (s, type, c, r) => s.buildings.find((t) => t.type === type && t.c === c && t.r === r);
  const ck = (cond, msg) => { if (!cond) throw new Error(msg); };

  /* Atomic construction: a site pulls up to 22 e/s but the fresh grid only
   * generates ~6 e/s, so cost-C buildings take ~C/6 s of game time. Fast-
   * forward in chunks until built=1 (robust against drain-ordering details). */
  async function waitBuilt(type, c, r, { chunk = 2000, tries = 25 } = {}) {
    let last = null;
    for (let i = 0; i < tries; i++) {
      const s = await state();
      last = bld(s, type, c, r);
      if (last && last.built === 1) return last;
      await advance(chunk);
    }
    throw new Error(`${type} (${c},${r}) never reached built=1 (last: ${JSON.stringify(last)})`);
  }

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
  await runPass(2, "palette Link → tile east of core builds, energyPool 200→175", BASE + "?level=0&test=1", async () => {
    const core = await getCore();
    const s0 = await state();
    ck(s0.phase === "build" && s0.energyPool === 200, `fresh L1: build phase, 200 pool (got ${s0.energyPool})`);
    await clickCard("link");
    ck((await state()).placing === "link", "palette selected Energy Link");
    const t = { c: core.c + 1, r: core.r };           // free ground next to the core
    await clickTile(t.c, t.r);
    const s1 = await state();
    ck(!!bld(s1, "link", t.c, t.r), "link appears right after the click");
    ck(s1.energyPool === 175, `energyPool 200-25=175, got ${s1.energyPool}`);
    const b = await waitBuilt("link", t.c, t.r);      // grid atoms raise it (~25/6 s)
    ck(b.built === 1, `link built=1 (got ${b.built})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(3, "palette Plant → core+2,+2 builds, energyGen 6→16, surplus banks", BASE + "?level=0&test=1", async () => {
    const core = await getCore();
    ck((await state()).energyGen === 6, "core alone generates 6 e/s");
    await clickCard("plant");
    const t = { c: core.c + 2, r: core.r + 2 };       // 2 cells south-east, inside core radius
    await clickTile(t.c, t.r);
    const sNow = await state();
    ck(sNow.energyPool === 100, `pool 200-100=100 right after placement (got ${sNow.energyPool})`);
    await waitBuilt("plant", t.c, t.r, { chunk: 2500, tries: 16 }); // 100 e at ~6 e/s ≈ 17 s
    const s = await state();
    const b = bld(s, "plant", t.c, t.r);
    ck(b && b.built === 1, `plant built=1 (got ${b && b.built})`);
    ck(s.energyGen === 16, `energyGen 6→16, got ${s.energyGen}`);
    ck(s.energyPool > 100, `surplus production banks into the pool (got ${s.energyPool})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(4, "laser chain on L3: LINK button, boost x1.50→x2.25, Shift+click unlink", BASE + "?level=2&test=1", async () => {
    const core = await getCore();
    ck((await state()).level === "The Throat", `on L3 (lasers unlocked), got "${(await state()).level}"`);
    const A = { c: core.c + 1, r: core.r - 1 };
    const B = { c: core.c + 2, r: core.r - 1 };
    const C = { c: core.c + 3, r: core.r - 1 };       // row north of the core, all free ground
    await clickCard("laser");
    await clickTile(A.c, A.r); await clickTile(B.c, B.r); await clickTile(C.c, C.r);
    await cancelPlacing(core);                        // drop the palette ghost first
    // 3×50 e at ~6 e/s (built one after another, idle drains steal a little)
    // → the last laser finishes around t≈46 s of game time.
    await waitBuilt("laser", A.c, A.r, { chunk: 4000, tries: 20 });
    await waitBuilt("laser", B.c, B.r, { chunk: 4000, tries: 20 });
    await waitBuilt("laser", C.c, C.r, { chunk: 4000, tries: 20 });
    let s = await state();
    ck([A, B, C].every((p) => { const b = bld(s, "laser", p.c, p.r); return b && b.built === 1; }),
      "3 lasers built next to the core");
    await clickTile(A.c, A.r);                        // select feeder A
    s = await state();
    ck(s.selected && s.selected.type === "laser" && s.selected.c === A.c, "laser A selected by canvas click");
    await clickBtn("tp-link");                        // LINK
    ck((await state()).linking === true, "LINK mode entered");
    await clickTile(B.c, B.r);                        // aim at receiver B
    s = await state();
    const bA = bld(s, "laser", A.c, A.r), bB = bld(s, "laser", B.c, B.r);
    ck(bA && bA.feedTo === `${B.c},${B.r}`, `A.feedTo=${B.c},${B.r} (got ${bA && bA.feedTo})`);
    ck(bB && bB.feeders === 1 && (bB.boost || "").startsWith("x1.50"),
      `B boosted x1.50 (got feeders=${bB && bB.feeders} boost=${bB && bB.boost})`);
    await clickTile(C.c, C.r);                        // select second feeder C
    await clickBtn("tp-link");
    await clickTile(B.c, B.r);                        // C → B as well
    s = await state();
    const bC = bld(s, "laser", C.c, C.r), bB2 = bld(s, "laser", B.c, B.r);
    ck(bC && bC.feedTo === `${B.c},${B.r}`, `C.feedTo=${B.c},${B.r} (got ${bC && bC.feedTo})`);
    ck(bB2.feeders === 2 && bB2.boost.startsWith("x2.25"),
      `B boosted x2.25 with 2 feeders (got feeders=${bB2.feeders} boost=${bB2.boost})`);
    await page.keyboard.down("Shift");
    await clickTile(A.c, A.r);                        // shift-click feeder A → unlink
    await page.keyboard.up("Shift");
    s = await state();
    const bA2 = bld(s, "laser", A.c, A.r), bB3 = bld(s, "laser", B.c, B.r);
    ck(bA2 && bA2.feedTo === undefined, "A.feedTo gone after Shift+click");
    ck(bB3.feeders === 1, `B back to 1 feeder (got ${bB3.feeders})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(5, "bomb on L6: charge 40 → DETONATE → building gone", BASE + "?level=5&test=1", async () => {
    const core = await getCore();
    ck((await state()).level === "Islands", `on L6 (bomb unlocked), got "${(await state()).level}"`);
    await clickCard("bomb");
    const t = { c: core.c + 1, r: core.r };           // free ground next to the core
    await clickTile(t.c, t.r);
    await cancelPlacing(core);
    await waitBuilt("bomb", t.c, t.r, { chunk: 2000, tries: 10 }); // 30 e ≈ 5 s
    let s, b, tries = 0;
    do { await advance(1500); s = await state(); b = bld(s, "bomb", t.c, t.r); }
    while (b && b.charge < 40 && ++tries < 14);       // 40 e at ~6 e/s ≈ 7 s
    ck(b && b.charge === 40, `bomb fully charged (got ${b && b.charge})`);
    await clickTile(t.c, t.r);                        // select the bomb
    s = await state();
    ck(s.selected && s.selected.type === "bomb", "bomb selected by canvas click");
    ck(!(await domHidden("#tp-link")), "DETONATE button visible");
    ck((await domText("#tp-link")) === "DETONATE", `button says DETONATE (got "${await domText("#tp-link")}")`);
    await clickBtn("tp-link");
    s = await state();
    ck(!bld(s, "bomb", t.c, t.r) && s.buildings.length === 0, "bomb removed from the grid");
  });

  /* ------------------------------------------------------------------ */
  await runPass(6, "overload: core→link→link→2 plants (26 e/s) burns the 20 e/s link", BASE + "?level=0&test=1", async () => {
    // ONE planning evaluate: free buildable cells around the core. Real clicks follow.
    const plan = JSON.parse(await page.evaluate(() => {
      const g = window.SG.App.game;
      const free = [];
      for (let r = 0; r < CFG.ROWS; r++) {
        for (let c = 0; c < CFG.COLS; c++) {
          const i = U.idx(c, r);
          if (g.terr[i] === 0 && !g.towers[i] && !(c === g.core.c && r === g.core.r) &&
              Math.abs(c - g.core.c) <= 9 && Math.abs(r - g.core.r) <= 9) free.push([c, r]);
        }
      }
      return JSON.stringify({ core: g.core, free });
    }));
    const has = (c, r) => plan.free.some(([fc, fr]) => fc === c && fr === r);
    const pick = (cands, what) => {
      for (const [c, r] of cands) if (has(c, r)) return { c, r };
      throw new Error(`no free tile for ${what} (tried ${JSON.stringify(cands)})`);
    };
    const K = plan.core;
    const link1 = pick([[K.c, K.r + 3], [K.c + 3, K.r], [K.c, K.r - 3], [K.c - 3, K.r]], "link 1");
    const link2 = pick([[K.c, K.r + 5], [K.c + 5, K.r], [K.c, K.r - 5], [K.c - 5, K.r]], "link 2");
    const p1 = pick([[K.c - 1, K.r + 7], [K.c + 1, K.r + 7], [K.c - 1, K.r - 7], [K.c + 1, K.r - 7]], "plant 1");
    const p2 = pick([[K.c + 1, K.r + 7], [K.c - 1, K.r + 7], [K.c + 1, K.r - 7], [K.c - 1, K.r - 7]], "plant 2");
    // sanity: the chain is 2+ hops (link 2 + plants unreachable from the core directly)
    ck(Math.hypot(link2.c - K.c, link2.r - K.r) > 4 && Math.hypot(p1.c - K.c, p1.r - K.r) > 4 &&
       Math.hypot(p2.c - K.c, p2.r - K.r) > 4, "link 2 and plants sit outside core radius");

    await clickCard("link");
    await clickTile(link1.c, link1.r);                // link 1: inside core radius
    await waitBuilt("link", link1.c, link1.r, { chunk: 2000, tries: 8 });
    await clickTile(link2.c, link2.r);                // link 2: 2 hops out, hangs off link 1
    await waitBuilt("link", link2.c, link2.r, { chunk: 2000, tries: 8 }); // must be DONE to anchor plants
    await clickCard("plant");
    await clickTile(p1.c, p1.r);                      // plant 1: off link 2 only
    await clickBtn("btn-call");                       // real HUD action: early call funds plant 2
    const s1 = await state();
    ck(s1.phase === "wave" && s1.wave === 1, "wave 1 called via CALL button");
    await clickTile(p2.c, p2.r);                      // plant 2, paid by the early-call bonus
    const s2 = await state();
    ck(!!bld(s2, "plant", p2.c, p2.r), `plant 2 placed (energyPool=${s2.energyPool})`);
    await waitBuilt("plant", p1.c, p1.r, { chunk: 2500, tries: 16 }); // 100 e each, sequential
    await waitBuilt("plant", p2.c, p2.r, { chunk: 2500, tries: 16 });
    await advance(1000);                              // let the overload heat begin
    let s = await state();
    ck(s.energyGen === 26, `gen core+2 plants = 26 e/s (got ${s.energyGen})`);
    let link = bld(s, "link", link1.c, link1.r);
    ck(link && link.heat > 0, `bottleneck link heating (heat=${link && link.heat})`);
    let tries = 0;
    do { await advance(2000); s = await state(); link = bld(s, "link", link1.c, link1.r); }
    while (link && ++tries < 15);                     // 26 e/s through 20 e/s → burnout ~5 s
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
