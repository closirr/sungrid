/* LASERLINK — node balance harness: all levels × reps, stuck watchdog (node tools/balance.js) */
"use strict";
const fs = require("fs");
const vm = require("vm");

const REPS = parseInt(process.argv[2] || "3", 10);

const sandbox = {
  console, Math, JSON, performance: { now: () => Date.now() },
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null, setItem: () => {} },
};
const ctx = vm.createContext(sandbox);
vm.runInContext(`
  var Snd = { init(){}, resume(){}, setMuted(){}, laser(){}, tone(){}, noise(){}, click(){}, place(){}, sell(){}, upgrade(){}, boost(){}, error(){}, boom(){}, coreHit(){}, horn(){}, win(){}, lose(){} };
  var UI = { toast(){}, refreshPalette(){}, refreshTowerPanel(){}, updateHUD(){} };
  var Save = { data:{}, completeLevel(){}, setEndlessBest(){}, starsFor(){ return 0; } };
`, ctx);
for (const f of ["js/util.js", "js/data.js", "js/flowfield.js", "js/entities.js", "js/game.js", "js/bot.js"]) {
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
}

const run = vm.runInContext(`
  (function () {
    const playTracked = function (levelIdx, opts = {}) {
      const g = new Game(levelIdx);
      g.onWin = () => {}; g.onLose = () => {};
      const maxSim = opts.maxSim || 1100;
      let simT = 0, buildTick = 0, lastKills = 0, lastCore = g.coreHp, lastProgressT = 0;
      let stuck = null;
      while (simT < maxSim && g.state !== "won" && g.state !== "lost") {
        if (++buildTick % 30 === 0) Bot.spend(g);
        if (g.state === "build" && g.breakT < 4) g.callWave(true);
        g.update(1 / 60);
        simT += 1 / 60;
        if (g.kills !== lastKills || g.coreHp !== lastCore) {
          lastKills = g.kills; lastCore = g.coreHp; lastProgressT = simT;
        }
        if (simT - lastProgressT > 90) { stuck = simT; break; }
      }
      const dump = stuck ? g.enemies.map(e => {
        const c = Math.floor(e.x / CELL), r = Math.floor(e.y / CELL);
        return e.key + "@(" + e.x.toFixed(0) + "," + e.y.toFixed(0) + ") cell " + c + "," + r +
          " fd " + g.flow.at(c, r) + " hp " + e.hp.toFixed(0);
      }) : null;
      return {
        levelIdx, name: g.level.name, outcome: g.state, wave: g.wave,
        corePct: Math.round((g.coreHp / g.coreMax) * 100),
        kills: g.kills, simT: Math.round(simT), towers: g.towerList.length,
        stuck, dump,
      };
    };
    return playTracked;
  })()
`, ctx);

const results = [];
const total = vm.runInContext("LEVELS.length", ctx);
for (let i = 0; i < total; i++) {
  for (let rep = 0; rep < REPS; rep++) {
    results.push(run(i));
  }
}
results.push(run(-1, { maxSim: 900 }));

console.log("lvl  outcome  wave core%  kills towers simT  (x" + REPS + " reps)");
let idx = -1;
for (const r of results) {
  if (r.levelIdx !== idx) { idx = r.levelIdx; console.log("---"); }
  console.log(
    String(r.levelIdx === -1 ? "E" : r.levelIdx + 1).padStart(3) +
    "  " + String(r.outcome).padEnd(5) +
    "  " + String(r.wave).padStart(4) +
    "  " + String(r.corePct).padStart(3) + "%" +
    "  " + String(r.kills).padStart(5) +
    "  " + String(r.towers).padStart(4) +
    "  " + String(r.simT).padStart(5) + "s" +
    (r.stuck ? "  *** STUCK at " + r.stuck.toFixed(0) + "s: " + r.dump.join(" ; ") : "")
  );
}

const wins = results.filter((r) => r.outcome === "won").length;
const played = results.length - 1;
console.log(`\nwins: ${wins}/${played} campaign runs; avg core on win: ${
  Math.round(results.filter((r) => r.outcome === "won" && r.levelIdx >= 0).reduce((a, r) => a + r.corePct, 0) / Math.max(1, results.filter((r) => r.outcome === "won" && r.levelIdx >= 0).length))
}%`);
const stuckRuns = results.filter((r) => r.stuck);
if (stuckRuns.length) console.log("STUCK RUNS:", stuckRuns.length);
fs.writeFileSync(__dirname + "/balance-results.json", JSON.stringify(results, null, 2));
