/* SUNGRID — game data: config, buildings, enemies, wave math, fallback test map */
"use strict";

const CFG = {
  COLS: 20, ROWS: 20,
  W: 1280, H: 720,
  CORE_RANGE: 3.5,      // core feeds cells within this radius
  CORE_GEN: 4,          // core generates e/s
  LINK_CAP: 20,         // e/s max through one link (tier 1)
  ETICK: 0.1,           // energy flow simulation tick, s
  START_CREDITS: 200,
  SELL_RATIO: 0.7,
  BUILD_MIN: 2,         // build time at full supply, s
  BUILD_MAX: 4,         // build time at zero supply, s
  WAVE_BREAK: 20,       // s between waves
  FIRST_BREAK: 25,      // s of build time before wave 1
  CALL_BONUS: 2,        // credits per unused second when calling a wave early
  HP_SCALE: 0.22,       // enemy hp growth per wave
  MAX_FEEDERS: 8,       // max lasers feeding one receiver (chains of 5-10 like the original)
  RAMP_TIME: 2,         // seconds for a chain to focus from 0% to full power
  HEAT_BURN: 60,        // heat level where a link starts glowing red
  HEAT_MAX: 100,        // heat level where a link burns out
  K_HEAT: 4,            // heat gain per excess e/s per second
  K_COOL: 12,           // heat loss per second when within capacity
  ATOMS_PER: 5,         // e/s of flow per one visible sun atom
  WAVE_GOLD: 360,       // wave attack: gold medal time, s
  WAVE_SILVER: 540,     // wave attack: silver medal time, s
};

/*
 * Buildings. Credits buy them; ENERGY makes them work (speed, not on/off).
 * tiers: per-tier stats. drain: e/s while active (idle drain where noted).
 * upCost = [t1→t2, t2→t3].
 */
const TOWERS = {
  plant: {
    key: "plant", name: "Power Plant", hotkey: "1", cost: 100, hp: 220, unlock: 0,
    color: "#4de1ff", desc: "Generates energy and anchors the grid. More plants → more sun atoms.",
    tiers: [{ gen: 10, range: 2.5 }, { gen: 16, range: 2.8 }, { gen: 24, range: 3.1 }],
    upCost: [80, 140],
    statLine: (t) => `+${t.gen} e/s · grid radius ${t.range}`,
  },
  link: {
    key: "link", name: "Energy Link", hotkey: "2", cost: 25, hp: 120, unlock: 0,
    color: "#7dff9a", desc: "Carries sun atoms and lets you build nearby. Overloads if pushed past its capacity.",
    tiers: [{ range: 2.5, cap: 20 }, { range: 3.2, cap: 26 }, { range: 4.0, cap: 34 }],
    upCost: [20, 40],
    statLine: (t) => `radius ${t.range} · ${t.cap} e/s capacity`,
  },
  harvester: {
    key: "harvester", name: "Mineral Harvester", hotkey: "3", cost: 60, hp: 150, unlock: 1,
    color: "#ffd94d", desc: "Must sit on a mineral deposit. Digs credits — but constantly eats energy.",
    tiers: [{ rate: 8, drain: 4 }, { rate: 11, drain: 5 }, { rate: 14, drain: 6 }],
    upCost: [50, 90],
    statLine: (t) => `+${t.rate} cr/s · ${t.drain} e/s`,
  },
  laser: {
    key: "laser", name: "Laser Tower", hotkey: "4", cost: 50, hp: 150, unlock: 0,
    color: "#4de1ff", desc: "Continuous beam. LINK lasers into each other: a receiver gains +50% damage and +25% range per feeder.",
    tiers: [{ dps: 25, range: 3.0, drain: 6 }, { dps: 38, range: 3.4, drain: 8 }, { dps: 58, range: 3.8, drain: 11 }],
    upCost: [45, 80],
    statLine: (t) => `${t.dps} DPS · range ${t.range} · ${t.drain} e/s firing`,
  },
  missile: {
    key: "missile", name: "Missile Turret", hotkey: "5", cost: 80, hp: 170, unlock: 4,
    color: "#ff9a4d", desc: "Splash shells, fast fire, hungry for energy. Cannot feed other lasers.",
    tiers: [{ dmg: 40, rate: 1.8, range: 3.5, aoe: 1.2, drain: 10 }, { dmg: 62, rate: 1.7, range: 3.8, aoe: 1.3, drain: 13 }, { dmg: 90, rate: 1.6, range: 4.1, aoe: 1.4, drain: 16 }],
    upCost: [60, 100],
    statLine: (t) => `${t.dmg} splash · every ${t.rate}s · range ${t.range}`,
  },
  bomb: {
    key: "bomb", name: "Sun Bomb", hotkey: "6", cost: 30, hp: 80, unlock: 5,
    color: "#ff5cf0", desc: "Charges with energy, then detonates: huge area damage. Click to fire, or enemies set it off.",
    tiers: [{ dmg: 300, aoe: 2.5 }, { dmg: 420, aoe: 2.8 }, { dmg: 600, aoe: 3.1 }],
    upCost: [25, 45],
    statLine: (t) => `${t.dmg} damage · area ${t.aoe} · charge 40 e`,
  },
};
const PALETTE_ORDER = ["plant", "link", "harvester", "laser", "missile", "bomb"];

/* Enemies. size = footprint in cells. cost = threat-budget points.
 * unlockWave gates the composition pool inside a level (later waves bring worse foes). */
const ENEMIES = {
  crawler:    { key: "crawler",    hp: 40,   speed: 1.5, dmg: 6,  reward: 4,  cost: 1,   size: 0.30, color: "#ff6b57", unlockWave: 1 },
  swarm:      { key: "swarm",      hp: 10,   speed: 2.2, dmg: 2,  reward: 2,  cost: 0.5, size: 0.20, color: "#ff8ad8", unlockWave: 2, pack: [5, 8] },
  tank:       { key: "tank",       hp: 300,  speed: 0.8, dmg: 20, reward: 12, cost: 4,   size: 0.42, color: "#c8473f", unlockWave: 3 },
  kamikaze:   { key: "kamikaze",   hp: 30,   speed: 3.2, dmg: 60, reward: 8,  cost: 2,   size: 0.24, color: "#ffd94d", unlockWave: 4, boom: { aoe: 1.5 } },
  teleporter: { key: "teleporter", hp: 150,  speed: 1.0, dmg: 12, reward: 15, cost: 4,   size: 0.34, color: "#a48aff", unlockWave: 5, hoverAt: 4.5, blinkEvery: 4 },
  sapper:     { key: "sapper",     hp: 60,   speed: 1.3, dmg: 0,  reward: 18, cost: 3,   size: 0.30, color: "#8fd0ff", unlockWave: 6, sapper: true, drain: 15 },
  rocket:     { key: "rocket",     hp: 15,   speed: 4.5, dmg: 4,  reward: 3,  cost: 0.7, size: 0.16, color: "#ff9a4d", unlockWave: 7 },
  boss:       { key: "boss",       hp: 2500, speed: 0.6, dmg: 60, reward: 100, cost: 40, size: 0.60, color: "#ff2e2e", boss: true, hpScale: 0.13, smash: { every: 5, dmg: 40, aoe: 1.8 } },
};

/* threat budget: level.mult scales it */
function wavePoints(threat, mult) { return 10 * Math.pow(threat, 1.2) * (mult || 1); }

/*
 * Map legend:  "." ground   "#" rock (no walk, no build)   "M" mineral
 *              "W" rich mineral   "S" enemy spawn   "K" core (exactly one)
 * Phase 2 fallback map — replaced by window.MAPS (js/maps.js) when present.
 */
const TEST_MAP = {
  name: "Grid Primer", mult: 0.8, waves: 3, coreHp: 100,
  hint: "Build Links from the Core, a Power Plant, then harvest minerals.",
  map: [
    "....................",
    "..##.........M....S.",
    "..##................",
    "......###...........",
    "......###......W....",
    "....................",
    "....................",
    "..............##....",
    "...M..........##....",
    "....................",
    ".........K..........",
    "....................",
    ".....##......M......",
    ".....##........M....",
    "....................",
    ".............###....",
    "....W.........###...",
    "....................",
    "S...................",
    "....................",
  ],
};

/* campaign levels: from js/maps.js when loaded, else the test map */
const LEVELS = (typeof MAPS !== "undefined" && MAPS.campaign.length) ? MAPS.campaign : [TEST_MAP];
const ENDLESS = (typeof MAPS !== "undefined" && MAPS.arena) ? MAPS.arena : TEST_MAP;
