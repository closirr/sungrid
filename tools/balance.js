/* SUNGRID — node balance harness: Bot.play over ALL campaign levels × reps + Endless,
 * stuck watchdog, results table + JSON. Usage: node tools/balance.js [reps] */
"use strict";
const fs = require("fs");
const vm = require("vm");

const REPS = parseInt(process.argv[2] || "3", 10);

/* vm sandbox. Game classes live in the context's LEXICAL scope (top-level
 * const/class), so every game call — including Bot.play — must be executed
 * through vm.runInContext. Snd/UI are stubs (audio.js/ui.js need a browser);
 * save.js is the real one, backed by the localStorage stub. */
const sandbox = {
  console, Math, JSON, performance: { now: () => Date.now() },
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null, setItem: () => {} },
};
const ctx = vm.createContext(sandbox);
vm.runInContext(`
  var Snd = { init(){}, resume(){}, setMuted(){}, laser(){}, tone(){}, noise(){}, click(){},
    place(){}, sell(){}, upgrade(){}, boost(){}, error(){}, boom(){}, coreHit(){}, horn(){},
    overcharge(){}, burnout(){}, missile(){}, zap(){}, atoms(){}, win(){}, lose(){} };
  var UI = { toast(){}, refreshPalette(){}, refreshTowerPanel(){}, updateHUD(){}, el: {} };
`, ctx);
for (const f of ["js/util.js", "js/iso.js", "js/save.js", "js/maps.js", "js/data.js",
                 "js/flowfield.js", "js/entities.js", "js/game.js", "js/bot.js"]) {
  vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
}
/* compat shim: entities.js chews buildings via game.spawnHitParticles, which the
 * headless Game doesn't define yet — map it onto spawnBurst (harness-only patch) */
vm.runInContext(
  "if (typeof Game !== 'undefined' && !Game.prototype.spawnHitParticles) " +
  "Game.prototype.spawnHitParticles = function (x, y, color, n) { " +
  "this.spawnBurst(x, y, color, n || 3, { speed: 90 }); };", ctx);

/* executed in-context so Bot / Game / LEVELS (lexical globals of the sandbox) resolve */
const play = vm.runInContext("(levelIdx, opts) => Bot.play(levelIdx, opts)", ctx);

const results = [];
const total = vm.runInContext("LEVELS.length", ctx);
for (let i = 0; i < total; i++) {
  for (let rep = 0; rep < REPS; rep++) results.push(play(i));
}
results.push(play(-1)); // Endless arena (watchdog + maxSim live inside Bot.play)

console.log("lvl outcome wave  core%  kills twr link chn  simT  (x" + REPS + " reps)");
let idx = null;
for (const r of results) {
  if (r.levelIdx !== idx) { idx = r.levelIdx; console.log("---"); }
  console.log(
    String(r.levelIdx === -1 ? "E" : String(r.levelIdx + 1)).padStart(3) +
    "  " + String(r.outcome).padEnd(6) +
    " " + String(r.wave).padStart(3) +
    " " + String(r.corePct).padStart(5) + "%" +
    "  " + String(r.kills).padStart(5) +
    " " + String(r.towers).padStart(4) +
    " " + String(r.links).padStart(4) +
    " " + String(r.chains).padStart(3) +
    " " + String(r.simT).padStart(5) + "s" +
    (r.stuck ? "  *** STUCK at " + r.stuck.toFixed(0) + "s: " + (r.dump || []).join(" ; ") : "")
  );
}

const camp = results.filter((r) => r.levelIdx >= 0);
const won = camp.filter((r) => r.outcome === "won");
const avgCore = won.length
  ? Math.round(won.reduce((a, r) => a + r.corePct, 0) / won.length)
  : 0;
const stuckRuns = results.filter((r) => r.stuck);
console.log("\nwins: " + won.length + "/" + camp.length +
  " campaign; avg core% on wins: " + avgCore + "%; stuck: " + stuckRuns.length +
  (stuckRuns.length ? " (levels " + stuckRuns.map((r) => r.levelIdx === -1 ? "E" : String(r.levelIdx + 1)).join(",") + ")" : ""));
fs.writeFileSync(__dirname + "/balance-results.json", JSON.stringify(results, null, 2));
console.log("results -> tools/balance-results.json");
