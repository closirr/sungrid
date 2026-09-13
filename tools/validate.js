/* LASERLINK — map validator + analytic wave-balance report (node tools/validate.js) */
"use strict";
const fs = require("fs");
const vm = require("vm");

const ctx = vm.createContext({ console, Math, JSON });
for (const f of ["js/util.js", "js/data.js", "js/flowfield.js"]) {
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
}

const { CFG, LEVELS, ENDLESS, ENEMIES, wavePoints } =
  vm.runInContext("({ CFG, LEVELS, ENDLESS, ENEMIES, wavePoints })", ctx);
let problems = 0;
const problem = (msg) => { problems++; console.log("  ✗ " + msg); };

function validateMap(level, label) {
  const m = level.map;
  if (m.length !== 14) problem(`${label}: expected 14 rows, got ${m.length}`);
  let cores = 0;
  const spawns = [];
  for (let r = 0; r < m.length; r++) {
    if (m[r].length !== 24) problem(`${label}: row ${r} length ${m[r].length} != 24`);
    for (let c = 0; c < 24; c++) {
      const ch = m[r][c];
      if (!".#CRSK".includes(ch)) problem(`${label}: bad char '${ch}' at ${c},${r}`);
      if (ch === "K") cores++;
      if (ch === "S") spawns.push({ c, r });
    }
  }
  if (cores !== 1) problem(`${label}: expected exactly 1 core, got ${cores}`);
  if (!spawns.length) problem(`${label}: no spawns`);

  // path check: BFS from core over non-rock
  let core = null;
  for (let r = 0; r < m.length && !core; r++) {
    const c = m[r].indexOf("K");
    if (c !== -1) core = { c, r };
  }
  const walk = (c, r) => c >= 0 && r >= 0 && c < 24 && r < 14 && m[r][c] !== "#";
  const dist = Array.from({ length: 14 }, () => new Array(24).fill(-1));
  const q = [core];
  dist[core.r][core.c] = 0;
  for (let h = 0; h < q.length; h++) {
    const { c, r } = q[h];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (walk(nc, nr) && dist[nr][nc] === -1) { dist[nr][nc] = dist[r][c] + 1; q.push({ c: nc, r: nr }); }
    }
  }
  for (const s of spawns) {
    if (dist[s.r][s.c] === -1) problem(`${label}: spawn ${s.c},${s.r} cannot reach core`);
  }

  // crystal report
  let near = 0, far = 0, rich = 0;
  for (let r = 0; r < 14; r++) for (let c = 0; c < 24; c++) {
    const ch = m[r][c];
    if (ch === "C" || ch === "R") {
      if (ch === "R") rich++;
      const d = Math.hypot(c - core.c, r - core.r);
      if (d <= 3.4) near++; else far++;
    }
  }
  return { spawns: spawns.length, near, far, rich, spawnDists: spawns.map((s) => dist[s.r][s.c]) };
}

console.log("=== MAP VALIDATION ===");
LEVELS.forEach((lvl, i) => {
  const res = validateMap(lvl, `L${i + 1} ${lvl.name}`);
  console.log(`L${String(i + 1).padStart(2)} ${lvl.name.padEnd(20)} spawns:${res.spawns} nearCrystals:${res.near} farCrystals:${res.far} rich:${res.rich} pathLen:${res.spawnDists.join(",")}`);
});
validateMap(ENDLESS, "Endless");
console.log(problems ? `PROBLEMS: ${problems}` : "all maps OK");

console.log("\n=== WAVE BUDGET TABLE (enemy HP totals per wave) ===");
console.log("lvl mult waves | w1 w2 w3 w4 w5(boss) ... wN  -> total HP scaled");
for (let i = 0; i < LEVELS.length; i++) {
  const L = LEVELS[i];
  const per = [];
  for (let w = 1; w <= L.waves; w++) {
    // approximate composition: greedy by cost with the unlock table
    let budget = wavePoints(w, L.mult);
    if (w % 5 === 0) budget -= ENEMIES.destroyer.cost;
    let hp = 0;
    const pool = Object.keys(ENEMIES).filter((k) => !ENEMIES[k].boss && ENEMIES[k].unlockWave <= w);
    let guard = 0;
    let b = budget;
    while (b > 0.45 && guard++ < 300) {
      const k = pool[guard % pool.length];
      const def = ENEMIES[k];
      if (def.cost <= b + 0.01) { hp += def.hp; b -= def.cost; }
      else if (pool.every((kk) => ENEMIES[kk].cost > b + 0.01)) break;
    }
    if (w % 5 === 0) hp += ENEMIES.destroyer.hp;
    const scale = 1 + CFG.HP_SCALE * (w - 1);
    per.push(Math.round(hp * scale * L.mult));
  }
  console.log(`L${String(i + 1).padStart(2)} mult=${L.mult} waves=${L.waves} | ${per.join(" ")}`);
}
