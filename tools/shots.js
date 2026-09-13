/* SUNGRID — full-page screenshots of every screen (node tools/shots.js)
 * Captures the WHOLE page (no clip) so DOM overlays (HUD, panels, menus) are included.
 * Output: output/shots/01-title.png … 08-lose.png, each verified >20KB.
 *
 * Free-placement / packets era: the world is continuous px around (0,0) with the
 * starter harvester (10,-31), conduit (30,0), solar (34,50) and the megamineral
 * (-36,-20). Game pages load with ?test=1 (frozen sim; staged moments via
 * advanceTime + a few sim-API spawns, which is allowed for screenshot staging).
 * Camera aiming = direct Renderer.cam assignment (world center + zoom). */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const base = "http://localhost:8124/";
const outDir = path.resolve(__dirname, "..", "output", "shots");
// light theme + flat ground compresses very well (blank would be ~7KB)
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

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, "main");

  let okCount = 0;
  const shot = async (name) => {
    await page.waitForTimeout(350);
    const file = path.join(outDir, name + ".png");
    await page.screenshot({ path: file }); // full page, NO clip — DOM overlays included
    const kb = Math.round(fs.statSync(file).size / 1024);
    const ok = fs.statSync(file).size > MIN_BYTES;
    if (ok) okCount++;
    console.log(`shot: ${name}.png  ${kb}KB ${ok ? "OK" : "  <-- TOO SMALL / BLANK?"}`);
  };

  const goto = async (url) => {
    await page.goto(base + url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function");
    await page.waitForTimeout(400);
  };

  const play = async () => {
    await page.click("#btn-play");
    await page.waitForFunction(() => window.SG.App.state === "game");
  };

  /* aim the camera at a world point with a zoom (staging helper) */
  const cam = (x, y, z) => page.evaluate(([cx, cy, cz]) => {
    const R = window.SG.Renderer;
    R.cam = { x: cx, y: cy, z: cz };
    R.clampCam();
    return { ...R.cam };
  }, [x, y, z]);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

  /* ---------- 1. title ---------- */
  await goto("");
  await shot("01-title");

  /* ---------- 2. howto ---------- */
  await page.click("#btn-howto");
  await shot("02-howto");

  /* ---------- 3. game start: default camera z=2 centered on (0,0) ---------- */
  await goto("?test=1");
  await play();
  await cam(0, 0, 2);
  console.log("start:", JSON.stringify(await state()));
  await shot("03-game-start");

  /* ---------- 4. big map overview at zoom 0.6 ---------- */
  await goto("?test=1");
  await play();
  await cam(0, 0, 0.6);
  await shot("04-game-grid");

  /* ---------- 5. packets flying between starter solar → conduit → harvester ---------- */
  await goto("?test=1");
  await play();
  await cam(30, 0, 2);
  // organic traffic first (harvester saturates ~t=15s, surplus starts relaying)
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.advanceTime(500));
    if ((await state()).packets >= 2) break;
  }
  // top up with staged packets converging from a ring so the swarm is spread
  // (same-origin packets would overlap into a single dot). previous must be a
  // REAL unit — a bounced-back packet calls previous.consumeEnergyPacket().
  const pk = await page.evaluate(() => {
    const sim = window.SG.App.sim;
    const cond = sim.units.find((u) => u.kind === "conduit" && Math.round(u.x) === 30);
    const solar = sim.units.find((u) => u.kind === "solar" && Math.round(u.x) === 34);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      sim.spawn(new EnergyPacket(cond.x + Math.cos(a) * 70, cond.y + Math.sin(a) * 70, cond, solar));
    }
    window.advanceTime(250);
    return sim.units.filter((u) => u instanceof EnergyPacket && !u.dead).length;
  });
  console.log("packets in frame:", pk);
  await shot("05-game-packets");

  /* ---------- 6. chained laser firing at a UFO (staged via sim API) ---------- */
  await goto("?test=1");
  await play();
  const laserInfo = await page.evaluate(() => {
    const sim = window.SG.App.sim;
    if (typeof Laser !== "function" || typeof Ufo !== "function" || typeof Conduit !== "function")
      return { ok: false };
    const receiver = sim.spawn(new Laser(120, 20));      // shooter
    const feeder = sim.spawn(new Laser(90, 60));         // feeds the receiver
    feeder.linkLaser(receiver, sim);
    receiver.charges = 60;
    feeder.charges = 45;
    const c1 = sim.spawn(new Conduit(60, -20));
    const c2 = sim.spawn(new Conduit(90, -40));
    c1.linkConduit(c2);
    const solar = sim.units.find((u) => u.kind === "solar" && Math.round(u.x) === 34);
    if (solar) { sim.spawnPacket(solar, feeder); sim.spawnPacket(solar, c1); }
    const ufo = sim.spawn(new Ufo(185, 45));             // 69.6px: outside single 64, inside chained 76.8
    window.advanceTime(1200);                            // a few laser ticks: beam + hp drop
    return {
      ok: true,
      ufoHp: Math.round(ufo.hp),
      receiverCharges: receiver.charges,
      receiverDmg: receiver._dmg,
      receiverRange: Math.round(receiver._range),
      beam: !!(receiver.target && receiver.charges > 0),
    };
  });
  console.log("laser staging:", JSON.stringify(laserInfo));
  await cam(130, 0, 2);
  await shot("06-game-laser");

  /* ---------- 7. conduit overload: packet flood → red-hot relay + sparks ---------- */
  await goto("?test=1");
  await play();
  await cam(30, 0, 2);
  const flood = await page.evaluate(() => {
    const sim = window.SG.App.sim;
    const cond = sim.units.find((u) => u.kind === "conduit" && Math.round(u.x) === 30 && Math.round(u.y) === 0);
    const solar = sim.units.find((u) => u.kind === "solar" && Math.round(u.x) === 34);
    // staged dense packet chain: packets from staggered rings all aimed at the
    // relay — arrival times spread out, so individual atoms stay readable and
    // the red-hot conduit body peeks through the middle
    // (real production 0.5 packet/s can never outpace the 10 heat/s decay)
    // previous = the real solar unit: a bounced-back packet needs a live target
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      const r = 70 + (i % 6) * 34;
      sim.spawn(new EnergyPacket(cond.x + Math.cos(a) * r, cond.y + Math.sin(a) * r, cond, solar));
    }
    return sim.units.filter((u) => u instanceof EnergyPacket && !u.dead).length;
  });
  let heat = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.advanceTime(150));
    heat = await page.evaluate(() => {
      const c = window.SG.App.sim.units.find((u) => u.kind === "conduit" && Math.round(u.x) === 30 && Math.round(u.y) === 0);
      return c ? c.heat : 0;
    });
    if (heat > 60) break;
  }
  console.log("overload: staged packets", flood, "heat", heat);
  await shot("07-game-overload");

  /* ---------- 8. lose: all buildings destroyed ---------- */
  await goto("?test=1");
  await play();
  // the lose check arms at sim.time > 3…
  await page.evaluate(() => window.advanceTime(3600));
  // …then wipe every building (task recipe); deaths emit nothing, so the next
  // wave tick's lose-check flips the screen
  await page.evaluate(() => {
    const g = window.SG.App.sim;
    g.units.forEach((u) => {
      if (u.kind !== "mineral" && u.kind !== "packet" && !u.isAlien) u.hp = 0;
    });
  });
  let mode = "";
  for (let i = 0; i < 14 && mode !== "lose"; i++) {
    await page.evaluate(() => window.advanceTime(1000));
    mode = await page.evaluate(() => window.SG.App.state);
  }
  const loseState = await page.evaluate(() => ({
    state: window.SG.App.state,
    sub: document.getElementById("lose-sub").textContent,
  }));
  console.log("lose screen:", JSON.stringify(loseState));
  await shot("08-lose");

  await browser.close();
  console.log(`\ndone: ${okCount} shots OK in ${outDir}`);
  console.log("errors:", errors.length ? errors : "none");
  process.exit(errors.length || okCount < 8 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
