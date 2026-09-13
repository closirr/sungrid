/* SUNGRID — map validator (node tools/validate.js)
   Checks every map in js/maps.js: 20x20 size, legend chars, single core,
   deposits near the core, free start area, spawn reachability (BFS with
   no corner cutting, like the game's FlowField) and spawn placement. */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SIZE = 20;                 // maps are SIZE x SIZE
const LEGEND = ".#MWSK";
const DEPOT_RADIUS = 6;          // Chebyshev radius: >=1 deposit (M/W) from K
const START_RADIUS = 2;          // Chebyshev radius: >=8 free tiles around K
const START_FREE_MIN = 8;        // free = '.' / 'M' / 'W' (K itself excluded)
const ENEMY_TYPES = new Set([
  "crawler", "swarm", "tank", "kamikaze", "teleporter", "sapper", "rocket", "boss",
]);

/* Load js/maps.js the same way laserlink's validator loads data.js:
   run the script in a vm sandbox context, then read the global const. */
const ctx = vm.createContext({ console, Math, JSON });
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "maps.js"), "utf8"),
  ctx,
  { filename: "js/maps.js" },
);
const MAPS = vm.runInContext("MAPS", ctx);

let problems = 0;
const problem = (msg) => { problems++; console.log("     ✗ " + msg); };
const cheb = (a, b) => Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));

function validate(level, label) {
  console.log(
    `\n${label}  "${level.name}"  waves:${level.waves}  enemies:[${(level.enemies || []).join(",")}]`,
  );

  /* --- structural checks ------------------------------------------------ */
  if (typeof level.name !== "string" || !level.name.trim()) problem("missing name");
  if (!Number.isInteger(level.waves) || level.waves < 1) problem("waves must be a positive integer");
  if (!Array.isArray(level.enemies) || !level.enemies.length) problem("enemies must be a non-empty array");
  else for (const e of level.enemies) if (!ENEMY_TYPES.has(e)) problem(`unknown enemy type '${e}'`);
  if (!Array.isArray(level.tutorial)) problem("tutorial must be an array (possibly empty)");
  else for (const t of level.tutorial) if (typeof t !== "string") problem("tutorial lines must be strings");

  /* --- (а) size and legend ---------------------------------------------- */
  const m = level.map;
  if (!Array.isArray(m) || m.length !== SIZE) {
    problem(`expected ${SIZE} rows, got ${m ? m.length : "none"}`);
    return null;
  }
  let cores = 0;
  const spawns = [];
  const deposits = [];
  for (let r = 0; r < m.length; r++) {
    const row = m[r];
    if (typeof row !== "string" || row.length !== SIZE) {
      problem(`row ${r} length ${row ? row.length : "n/a"} != ${SIZE}`);
      continue;
    }
    for (let c = 0; c < SIZE; c++) {
      const ch = row[c];
      if (!LEGEND.includes(ch)) problem(`bad char '${ch}' at ${c},${r}`);
      if (ch === "K") { cores++; deposits.push({ c, r, ch }); }
      if (ch === "S") spawns.push({ c, r });
      if (ch === "M" || ch === "W") deposits.push({ c, r, ch });
    }
  }

  /* --- (б) exactly one core --------------------------------------------- */
  if (cores !== 1) {
    problem(`expected exactly 1 core 'K', got ${cores}`);
    return null;
  }
  const core = deposits.find((d) => d.ch === "K");
  if (!spawns.length) problem("no spawns 'S'");

  /* --- (в) >=1 deposit within Chebyshev radius 6 of the core ------------- */
  const nearDepots = deposits.filter((d) => d.ch !== "K" && cheb(d, core) <= DEPOT_RADIUS);
  if (!nearDepots.length) problem(`no deposit (M/W) within Chebyshev radius ${DEPOT_RADIUS} of core`);

  /* --- (д) >=8 free tiles ('.'/'M'/'W') within Chebyshev radius 2 of K --- */
  let freeAroundCore = 0;
  for (let r = Math.max(0, core.r - START_RADIUS); r <= Math.min(SIZE - 1, core.r + START_RADIUS); r++) {
    for (let c = Math.max(0, core.c - START_RADIUS); c <= Math.min(SIZE - 1, core.c + START_RADIUS); c++) {
      if (c === core.c && r === core.r) continue;
      if (".MW".includes(m[r][c])) freeAroundCore++;
    }
  }
  if (freeAroundCore < START_FREE_MIN) {
    problem(`only ${freeAroundCore} free tiles within radius ${START_RADIUS} of core, need ${START_FREE_MIN}`);
  }

  /* --- (г) BFS from core, 8-dir with no corner cutting (FlowField-style) - */
  const passable = (c, r) => c >= 0 && r >= 0 && c < SIZE && r < SIZE && m[r][c] !== "#";
  const dist = Array.from({ length: SIZE }, () => new Array(SIZE).fill(-1));
  dist[core.r][core.c] = 0;
  const q = [core];
  for (let h = 0; h < q.length; h++) {
    const { c, r } = q[h];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc, nr = r + dr;
        if (!passable(nc, nr) || dist[nr][nc] !== -1) continue;
        // diagonal move only when both orthogonal neighbours are open
        if (dc && dr && (!passable(c + dc, r) || !passable(c, r + dr))) continue;
        dist[nr][nc] = dist[r][c] + 1;
        q.push({ c: nc, r: nr });
      }
    }
  }
  for (const s of spawns) {
    if (dist[s.r][s.c] === -1) problem(`spawn ${s.c},${s.r} cannot reach the core`);
  }

  /* --- (е) spawns not wedged into corners: >=1 orthogonal passable neigb. - */
  for (const s of spawns) {
    if ((s.c === 0 || s.c === SIZE - 1) && (s.r === 0 || s.r === SIZE - 1)) {
      problem(`spawn ${s.c},${s.r} sits in a map corner`);
    }
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dc, dr]) => passable(s.c + dc, s.r + dr));
    if (!open) problem(`spawn ${s.c},${s.r} has no passable neighbour tile`);
  }

  const rich = deposits.filter((d) => d.ch === "W").length;
  console.log(
    `     spawns:${spawns.length}` +
    `  deposits:${deposits.length - 1} (near<=${DEPOT_RADIUS}:${nearDepots.length}, rich W:${rich})` +
    `  free@K:${freeAroundCore}` +
    `  pathLen:[${spawns.map((s) => dist[s.r][s.c]).join(",")}]`,
  );
  return true;
}

console.log(`=== SUNGRID MAP VALIDATOR (${SIZE}x${SIZE} · legend ${LEGEND}) ===`);

if (!MAPS || !Array.isArray(MAPS.campaign)) {
  problem("MAPS.campaign must be an array");
} else {
  if (MAPS.campaign.length !== 12) problem(`expected 12 campaign maps, got ${MAPS.campaign.length}`);
  MAPS.campaign.forEach((lvl, i) => {
    if (!lvl || !lvl.name) { problems++; console.log(`\nL${i + 1} — missing level object/name`); return; }
    validate(lvl, `L${String(i + 1).padStart(2)}`);
  });
}
if (!MAPS || typeof MAPS.arena !== "object" || !MAPS.arena) {
  problem("MAPS.arena must be an object");
} else {
  validate(MAPS.arena, "AR ");
}

const total = (MAPS && Array.isArray(MAPS.campaign) ? MAPS.campaign.length : 0) + 1;
console.log(
  problems
    ? `\nRESULT: FAILED — ${problems} problem(s) across ${total} map(s)`
    : `\nRESULT: all ${total} maps OK`,
);
if (problems) process.exitCode = 1;
