/* SUNGRID — functional interaction tests via REAL user actions (Playwright).
 * The game is the free-placement Harvesturr port: continuous world px around
 * (0,0), energy as physical packets, 10s UFO waves. Everything here is driven
 * by palette clicks, canvas world clicks and HUD buttons. No game-API writes:
 * the game is only OBSERVED through window.render_game_to_text() and
 * fast-forwarded with window.advanceTime() (allowed test hooks).
 *
 * Run: node tools/functest.js   (local server on :8124 must be up)
 * Pages load with &test=1 (deterministic stepping, no autoplay). Each pass
 * reloads the page fresh, so passes are independent. Failure screenshots
 * go to output/functest/ (never to output/shots/).
 *
 * Era notes (free-placement / packets):
 *  - Canvas clicks go THROUGH the live camera: screen = SG.Renderer.worldToScreen
 *    (wx, wy) → page px via the live canvas bounding box.
 *  - Placement costs R$ up front; the starter harvester mines the megamineral
 *    at ~1 R$ / 5s, so passes fast-forward with advanceTime(5000) chunks until
 *    they can afford a building. A placed building is a WIP that EATS packets
 *    (conduit 5, solar 15, laser 10) before it goes live.
 *  - Planning evaluates only: pick a canPlace-free spot near the wanted
 *    coordinate (minerals are randomly scattered) and count aliens in P6.
 *    Every game action is still a real mouse/keyboard event. */
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
    await page.waitForTimeout(250); // let rAF run once so the canvas is painted
  }

  /* Real canvas click at WORLD coordinates through the live camera:
   * world → screen (1280×720 canvas space) → page px via the canvas rect. */
  async function clickWorld(wx, wy) {
    const s = await page.evaluate(([x, y]) => {
      const sc = window.SG.Renderer.worldToScreen(x, y);
      return { x: sc.x, y: sc.y };
    }, [wx, wy]);
    const b = await page.locator("#game").boundingBox();
    await page.mouse.click(b.x + s.x * (b.width / 1280), b.y + s.y * (b.height / 720));
  }

  const clickCard = (key) => page.click(`.pcard[data-key="${key}"]`);
  const clickBtn = (id) => page.click("#" + id);
  /* real input: enter the game from the title screen */
  const startGame = async () => {
    await clickBtn("btn-play");
    await waitState("mode=game after PLAY", (s) => s.mode === "game", { chunk: 250, tries: 8 });
  };
  const bld = (s, kind, x, y) => s.buildings.find((t) => t.kind === kind && t.x === x && t.y === y);
  const wipAt = (s, x, y) => s.buildings.find((t) => t.kind === "wip" && t.x === x && t.y === y);
  const ck = (cond, msg) => { if (!cond) throw new Error(msg); };

  /* PLANNING evaluate (observation only): nearest point to (cx,cy) that the sim
   * accepts with a ±1px click-tolerance margin (sub-pixel click jitter), while
   * staying within `r` px of the anchor unit {kind,x,y} so packets still reach
   * it. Minerals are scattered randomly per load, hence the search. */
  async function planSpot(cx, cy, tool, anchor) {
    return page.evaluate(([cx, cy, tool, anchor]) => {
      const sim = window.SG.App.sim;
      const def = window.SG.SIM_DEFS[tool];
      const anch = sim.units.find((u) => !u.dead && u.kind === anchor.kind &&
        Math.round(u.x) === anchor.x && Math.round(u.y) === anchor.y);
      let best = null;
      for (let dx = -120; dx <= 120; dx += 2) {
        for (let dy = -120; dy <= 120; dy += 2) {
          const x = cx + dx, y = cy + dy;
          if (!sim.canPlace(x, y, def.size)) continue;
          // click lands ±1px: require a small clear margin around the point
          if (!(sim.canPlace(x + 1, y, def.size) && sim.canPlace(x - 1, y, def.size) &&
                sim.canPlace(x, y + 1, def.size) && sim.canPlace(x, y - 1, def.size))) continue;
          if (!anch || Math.hypot(x - anch.x, y - anch.y) > anchor.r) continue;
          const d = Math.hypot(dx, dy);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      if (!best) return null;
      return { x: best.x, y: best.y, cost: def.cost, packets: def.packets };
    }, [cx, cy, tool, anchor]);
  }

  /* advance in chunks until cond(state) holds (checked before each advance) */
  async function waitState(what, cond, { chunk = 5000, tries = 12 } = {}) {
    let s = await state();
    for (let i = 0; i < tries; i++) {
      if (cond(s)) return s;
      await advance(chunk);
      s = await state();
    }
    throw new Error(what + " never became true (last: " + JSON.stringify(s).slice(0, 400) + ")");
  }

  /* Full real-input build: select tool card → wait for R$ (starter harvester
   * mines ~1 R$/5s) → canvas click → WIP assertions. Returns the spot. */
  async function placeWithTool(tool, cx, cy, anchor) {
    await clickCard(tool);
    const sel = await page.evaluate((t) => {
      const c = document.querySelector(`.pcard[data-key="${t}"]`);
      return !!(c && c.classList.contains("selected")) && window.SG.UI.activeTool === t;
    }, tool);
    ck(sel, `palette card "${tool}" selected`);
    const spot = await planSpot(cx, cy, tool, anchor);
    ck(spot, `planning found a free ${tool} spot near (${cx},${cy}) within ${anchor.r}px of ${anchor.kind} (${anchor.x},${anchor.y})`);
    const sR = await waitState(`resources ≥ ${spot.cost} for ${tool}`,
      (s) => s.resources >= spot.cost, { chunk: 5000, tries: 24 });
    await clickWorld(spot.x, spot.y);
    const s1 = await state();
    const w = wipAt(s1, spot.x, spot.y);
    ck(w && w.remaining === spot.packets,
      `${tool} WIP remaining ${spot.packets} at (${spot.x},${spot.y}), got ${JSON.stringify(w)}`);
    ck(s1.resources === sR.resources - spot.cost,
      `resources ${sR.resources}-${spot.cost}=${sR.resources - spot.cost} after placement (got ${s1.resources})`);
    return spot;
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
  await runPass(1, "title → PLAY → game with starters, wave 0, 0 R$", BASE + "?test=1", async () => {
    const s0 = await state();
    ck(s0.mode === "title", `title screen shown (got ${s0.mode})`);
    ck(!(await domHidden("#screen-title")), "title overlay visible");
    await clickBtn("btn-play");
    const s = await state();
    ck(s.mode === "game", `mode=game after PLAY (got ${s.mode})`);
    ck(s.wave === 0 && s.resources === 0, `wave 0 / 0 R$ at t=0 (got wave ${s.wave}, R$ ${s.resources})`);
    const has = (kind, x, y) => s.buildings.some((b) => b.kind === kind && b.x === x && b.y === y);
    ck(has("harvester", 10, -31) && has("conduit", 30, 0) && has("solar", 34, 50),
      "starter harvester/conduit/solar at the Harvesturr coordinates");
    ck(!(await domHidden("#hud")), "HUD visible in game");
  });

  /* ------------------------------------------------------------------ */
  await runPass(2, "conduit tool → click (60,20) after mining ≥5 R$ → WIP remaining 5", BASE + "?test=1", async () => {
    await startGame();
    // placement must FAIL while broke: the starter harvester needs time —
    // income is 1 R$ per 5s (packet → charge → mineral)
    const spot = await planSpot(60, 20, "conduit", { kind: "solar", x: 34, y: 50, r: 96 });
    ck(spot, "planning found a free conduit spot near (60,20) in solar packet range");
    const sBefore = await state();
    if (sBefore.resources < 5) {
      await clickCard("conduit");
      await clickWorld(spot.x, spot.y);           // too broke — must be a no-op
      const sBroke = await state();
      ck(!wipAt(sBroke, spot.x, spot.y) && sBroke.resources === sBefore.resources,
        `broke click is a no-op (R$ ${sBefore.resources} kept, no WIP)`);
    }
    const sR = await waitState("resources ≥ 5 (harvester mined)", (s) => s.resources >= 5,
      { chunk: 5000, tries: 12 });
    await clickCard("conduit");
    await clickWorld(spot.x, spot.y);
    const s1 = await state();
    const w = wipAt(s1, spot.x, spot.y);
    ck(w && w.remaining === 5, `conduit WIP remaining 5 at (${spot.x},${spot.y}), got ${JSON.stringify(w)}`);
    ck(s1.resources === sR.resources - 5, `R$ ${sR.resources}-5=${sR.resources - 5} (got ${s1.resources})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(3, "conduit finishes; starter solar (34,50) packets reach it", BASE + "?test=1", async () => {
    await startGame();
    const spot = await placeWithTool("conduit", 60, 20, { kind: "solar", x: 34, y: 50, r: 96 });
    let sawPackets = 0;
    await waitState(`conduit live at (${spot.x},${spot.y})`, (s) => {
      sawPackets = Math.max(sawPackets, s.packets);
      return !!bld(s, "conduit", spot.x, spot.y);
    }, { chunk: 1000, tries: 90 });
    ck(sawPackets > 0, `packets observed in flight while building (max ${sawPackets})`);
    const s = await state();
    const c = bld(s, "conduit", spot.x, spot.y);
    ck(c && typeof c.heat === "number", `conduit relaying (heat=${c && c.heat})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(4, "solar tool → WIP remaining 15 → solar panel", BASE + "?test=1", async () => {
    await startGame();
    const spot = await placeWithTool("solar", 90, 30, { kind: "conduit", x: 30, y: 0, r: 96 });
    await waitState(`solar live at (${spot.x},${spot.y})`, (s) => !!bld(s, "solar", spot.x, spot.y),
      { chunk: 1000, tries: 120 });
    const s = await state();
    ck(!!bld(s, "solar", spot.x, spot.y), `solar panel built at (${spot.x},${spot.y})`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(5, "laser tool → WIP → laser charges (+15/packet, cap 60)", BASE + "?test=1", async () => {
    await startGame();
    const spot = await placeWithTool("laser", 110, 40, { kind: "conduit", x: 30, y: 0, r: 96 });
    // wait for the WIP to eat its 10 packets (fine steps near the end)
    let s = await state(), guard = 0;
    while (!bld(s, "laser", spot.x, spot.y) && guard++ < 400) {
      const w = wipAt(s, spot.x, spot.y);
      await advance(w && w.remaining <= 2 ? 100 : 1000);
      s = await state();
    }
    const laser = bld(s, "laser", spot.x, spot.y);
    ck(laser, `laser built at (${spot.x},${spot.y})`);
    // NOTE: a fresh laser spawns with charges 0 (verified with an isolated
    // placement), but by the time 10 R$ are saved up the starter solar↔conduit
    // corridor carries a backlog of relaying packets that back-feeds the new
    // laser within the same second — so only the [0..60] invariant holds here.
    ck(Number.isInteger(laser.charges) && laser.charges >= 0 && laser.charges <= 60,
      `laser charges within [0,60] at birth (got ${laser.charges})`);
    console.log(`    laser first-seen charges: ${laser.charges}`);
    // packets keep flowing → charges grow to the cap (+15 per packet, max 60)
    await waitState("laser charged to the 60 cap", (st) => {
      const l = bld(st, "laser", spot.x, spot.y);
      return l && l.charges === 60;
    }, { chunk: 2000, tries: 15 });
  });

  /* ------------------------------------------------------------------ */
  await runPass(6, "UFO waves: 60s fast-forward → wave ≥ 4; aliens seen by wave ≥ 8", BASE + "?test=1", async () => {
    await startGame();
    const base0 = await state();
    const minerals0 = base0.units;                   // units = aliens + minerals
    let maxUnits = base0.units, lastWave = 0;
    for (let i = 0; i < 12; i++) {                   // the 60s sweep, 5s frames
      await advance(5000);
      const s = await state();
      ck(s.mode === "game", `still in game at t=${s.time} (got ${s.mode})`);
      maxUnits = Math.max(maxUnits, s.units);
      lastWave = s.wave;
    }
    ck(lastWave >= 4, `wave ≥ 4 after +60s (got ${lastWave})`);
    // keep rolling until wave ≥ 8 (first UFOs spawn at wave 8 = count (8-5)/5*2),
    // still recording the units counter (aliens inflate it above the mineral base)
    for (let i = 0; i < 8 && lastWave < 8; i++) {
      await advance(5000);
      const s = await state();
      ck(s.mode === "game", `still in game at t=${s.time} (got ${s.mode})`);
      maxUnits = Math.max(maxUnits, s.units);
      lastWave = s.wave;
    }
    ck(lastWave >= 8, `wave ≥ 8 reached (got ${lastWave})`);
    // ONE planning/observation evaluate: exact alien + mineral counts
    const counts = await page.evaluate(() => {
      const u = window.SG.App.sim.units.filter((x) => !x.dead);
      return { aliens: u.filter((x) => x.isAlien).length, minerals: u.filter((x) => x.kind === "mineral").length };
    });
    ck(counts.aliens > 0, `UFOs appeared (aliens=${counts.aliens})`);
    ck(maxUnits > counts.minerals, `units counter grew above the current mineral count (max ${maxUnits} > minerals ${counts.minerals})`);
    console.log(`    wave=${lastWave} aliens=${counts.aliens} maxUnits=${maxUnits} units0=${minerals0}`);
  });

  /* ------------------------------------------------------------------ */
  await runPass(7, "HUD: pause/resume (advance frozen), speed 1×↔2×, sound ♪/✕", BASE + "?test=1", async () => {
    await clickBtn("btn-play");
    await clickBtn("btn-pause");
    ck((await state()).mode === "pause", "paused via #btn-pause");
    const t0 = (await state()).time;
    await advance(1000);
    ck((await state()).time === t0, "advanceTime is a no-op while paused");
    await clickBtn("btn-pause");                     // top bar stays clickable under the overlay
    ck((await state()).mode === "game", "resumed via #btn-pause");
    await advance(1000);
    ck((await state()).time === +(t0 + 1).toFixed(1), "time flows again after resume");
    await clickBtn("btn-speed");
    ck((await domText("#btn-speed")) === "2×", `speed label 2× (got "${await domText("#btn-speed")}")`);
    await clickBtn("btn-speed");
    ck((await domText("#btn-speed")) === "1×", "speed back to 1×");
    const snd0 = await domText("#btn-sound");
    await clickBtn("btn-sound");
    ck((await domText("#btn-sound")) !== snd0, "sound toggled (♪→✕)");
    await clickBtn("btn-sound");
    ck((await domText("#btn-sound")) === snd0, "sound restored");
  });

  /* ------------------------------------------------------------------ */
  await runPass(8, "Esc → PAUSED panel → RESUME", BASE + "?test=1", async () => {
    await clickBtn("btn-play");
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
