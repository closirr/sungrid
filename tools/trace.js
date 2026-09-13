/* LASERLINK — seeded reproduction + frame trace of stuck enemies
   usage: node tools/trace.js find <levelIdx>   |   node tools/trace.js trace <levelIdx> <seed> */
"use strict";
const fs = require("fs");
const vm = require("vm");

function makeCtx(seed) {
  const sandbox = {
    console, Math, JSON, performance: { now: () => Date.now() },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  const ctx = vm.createContext(sandbox);
  const rng = String.raw`
    Math.random = (function (seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(SEEDVAL);
  `.replace("SEEDVAL", String(seed));
  vm.runInContext(rng, ctx);
  vm.runInContext(`
    var Snd = { init(){}, resume(){}, setMuted(){}, laser(){}, tone(){}, noise(){}, click(){}, place(){}, sell(){}, upgrade(){}, boost(){}, error(){}, boom(){}, coreHit(){}, horn(){}, win(){}, lose(){} };
    var UI = { toast(){}, refreshPalette(){}, refreshTowerPanel(){}, updateHUD(){} };
    var Save = { data:{}, completeLevel(){}, setEndlessBest(){}, starsFor(){ return 0; } };
  `, ctx);
  for (const f of ["js/util.js", "js/iso.js", "js/save.js", "js/maps.js", "js/data.js", "js/flowfield.js", "js/entities.js", "js/game.js", "js/bot.js"]) {
    vm.runInContext(fs.readFileSync(f, "utf8"), ctx, { filename: f });
  }
  return ctx;
}

const mode = process.argv[2] || "find";
const levelIdx = parseInt(process.argv[3] || "10", 10);

if (mode === "find") {
  for (let seed = 1; seed <= 80; seed++) {
    const ctx = makeCtx(seed);
    const res = vm.runInContext(`
      (function () {
        const g = new Game(${levelIdx});
        g.onWin = () => {}; g.onLose = () => {};
        let simT = 0, buildTick = 0, lastKills = 0, lastCore = g.coreHp, lastProgressT = 0;
        while (simT < 700 && g.state !== "won" && g.state !== "lost") {
          if (++buildTick % 30 === 0) Bot.spend(g);
          if (g.state === "build" && g.breakT < 4) g.callWave(true);
          g.update(1 / 60);
          simT += 1 / 60;
          if (g.kills !== lastKills || g.coreHp !== lastCore) { lastKills = g.kills; lastCore = g.coreHp; lastProgressT = simT; }
          if (simT - lastProgressT > 90) break;
        }
        return JSON.stringify({ seed: ${seed}, state: g.state, wave: g.wave, stuck: (g.state !== "won" && g.state !== "lost") ? simT.toFixed(0) : null });
      })()
    `, ctx);
    const r = JSON.parse(res);
    if (r.stuck) console.log("STUCK seed:", JSON.stringify(r));
    else console.log("seed", seed, "->", r.state, "wave", r.wave);
  }
} else {
  const seed = parseInt(process.argv[4] || "1", 10);
  const ctx = makeCtx(seed);
  vm.runInContext(`
    (function () {
      const g = new Game(${levelIdx});
      g.onWin = () => {}; g.onLose = () => {};
      let simT = 0, buildTick = 0, lastKills = 0, lastCore = g.coreHp, lastProgressT = 0;
      let traced = false;
      const history = [];
      while (simT < 700 && g.state !== "won" && g.state !== "lost") {
        if (++buildTick % 30 === 0) Bot.spend(g);
        if (g.state === "build" && g.breakT < 4) g.callWave(true);
        g.update(1 / 60);
        simT += 1 / 60;
        if (g.kills !== lastKills || g.coreHp !== lastCore) { lastKills = g.kills; lastCore = g.coreHp; lastProgressT = simT; }
        if (!traced && simT - lastProgressT > 60) {
          traced = true;
          console.log("=== entering stuck window at t=", simT.toFixed(1), "enemies:", g.enemies.length);
        }
        if (traced && g.enemies.length && history.length < 240) {
          const e = g.enemies[0];
          const c = Math.floor(e.x / CELL), r = Math.floor(e.y / CELL);
          let nt = null, nd = Infinity;
          for (const t of g.towerList) { const d = Math.hypot(t.x - e.x, t.y - e.y); if (d < nd) { nd = d; nt = t; } }
          history.push("t=" + simT.toFixed(1) + " e=" + e.key + " pos(" + e.x.toFixed(1) + "," + e.y.toFixed(1) + ") cell " + c + "," + r +
            " fd " + g.flow.at(c, r) + " chewT " + e.chewT.toFixed(2) +
            " nearest " + (nt ? nt.key + "@" + nt.c + "," + nt.r + " hp" + Math.round(nt.hp) + " d=" + nd.toFixed(0) : "NONE") +
            " towers=" + g.towerList.length);
        }
        if (simT - lastProgressT > 90) break;
      }
      console.log("final:", g.state, "wave", g.wave, "simT", simT.toFixed(0));
      history.slice(0, 10).forEach((l) => console.log(l));
      console.log("...");
      history.slice(-10).forEach((l) => console.log(l));
    })()
  `, ctx);
}
