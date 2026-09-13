/* SUNGRID — headless energy-network test (node tools/energtest.js)
 * Loads the game modules in a vm sandbox (classes live in the context's lexical
 * scope, so the suite itself runs inside the VM) and drives Game.energyTick(). */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const sandbox = {
  console, Math, JSON, performance: { now: () => Date.now() },
  setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
};
const ctx = vm.createContext(sandbox);
vm.runInContext(`
  var Snd = { init(){}, resume(){}, setMuted(){}, laser(){}, tone(){}, noise(){}, click(){}, place(){}, sell(){}, upgrade(){}, boost(){}, error(){}, boom(){}, coreHit(){}, horn(){}, win(){}, lose(){}, overcharge(){}, burnout(){} };
  var UI = { toast(){}, refreshPalette(){}, refreshTowerPanel(){}, updateHUD(){} };
`, ctx);
for (const f of ["util.js", "iso.js", "save.js", "maps.js", "data.js", "flowfield.js", "entities.js", "game.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), ctx, { filename: f });
}

const suite = vm.runInContext(`
  (function () {
    const results = [];
    const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) });

    const makeGame = () => {
      const g = new Game(0);
      g.credits = 100000;
      return g;
    };
    /* place and finish construction immediately (real game waits ticks) */
    const put = (g, type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); }
      return t;
    };
    const finishAll = (g) => { for (const t of g.towerList) t.built = 1; g.recomputeNetwork(); };

    /* T1: baseline grid — core only */
    {
      const g = makeGame();
      g.energyTick();
      check("T1 core gen", g.energyStats().gen === CFG.CORE_GEN, "gen=" + g.energyStats().gen);
      check("T1 no edges", g.flowEdges.length === 0, "edges=" + g.flowEdges.length);
    }

    /* T2: chain core→link→link→plant: atoms flow, everything online and cool
     * (L1: core at (10,9); deposits at (10,6),(11,6),(10,12),(11,12) — route around) */
    {
      const g = makeGame();
      put(g, "link", 10, 8);
      put(g, "link", 11, 7);
      const p = put(g, "plant", 12, 6);
      check("T2 chain placed", !!p, "plant at the far end");
      g.energyTick();
      const es = g.energyStats();
      check("T2 gen = core+plant", es.gen === CFG.CORE_GEN + TOWERS.plant.tiers[0].gen, "gen=" + es.gen);
      check("T2 edges exist", g.flowEdges.length >= 3, "edges=" + g.flowEdges.length + " " + JSON.stringify(g.flowEdges.map(e => e.flow.toFixed(1))));
      const links = g.towerList.filter((t) => t.key === "link");
      check("T2 links online", links.every((l) => l.online), links.map((l) => l.online).join(","));
      check("T2 plant online", g.towerList.find((t) => t.key === "plant").online === true);
      check("T2 links cool", links.every((l) => l.heat === 0), "maxHeat=" + Math.max(...links.map((l) => l.heat)));
    }

    /* T3: overload — 24 e/s through a thin far chain burns the bottleneck link;
     * the core's 3.5 radius makes parallel paths near the base, so the chain
     * must start beyond it. The orphaned far side becomes a powerless island. */
    {
      const g = makeGame();
      put(g, "link", 13, 9);   // at the edge of the core radius (dist 3)
      put(g, "link", 15, 9);   // one hop out — the bottleneck
      const p1 = put(g, "plant", 17, 9);
      const p2 = put(g, "plant", 16, 8);
      let ticks = 0;
      let burned = 0;
      while (ticks++ < 3000) {
        const before = g.towerList.filter((t) => t.key === "link").length;
        g.energyTick();
        const after = g.towerList.filter((t) => t.key === "link").length;
        if (after < before) {
          burned += before - after;
          if (burned >= 1 && after <= 1) break;
        }
      }
      check("T3 bottleneck burned out", burned >= 1, "burned=" + burned + " ticks=" + ticks);
      check("T3 downstream islanded", !!p1 && p1.online === false, "far plant online=" + (p1 && p1.online));
      for (let k = 0; k < 100; k++) g.energyTick(); // let the island cool down fully
      check("T3 island link cools (no flow)", g.towerList.filter((t) => t.key === "link").every((l) => l.heat < 1), "no flow on island");
    }

    /* T4: harvesters only on deposits */
    {
      const g = makeGame();
      put(g, "harvester", 10, 4);
      check("T4 harvester needs deposit", !g.towerList.some((t) => t.key === "harvester"), "plain ground must reject");
    }

    /* T5: brownout — demand > generation → partial supply (L1 deposits at (10,12),(11,12)) */
    {
      const g = makeGame();
      put(g, "harvester", 13, 12);
      check("T5 harvester needs deposit", !g.towerList.some((t) => t.key === "harvester"), "ground must reject");
      const h1 = put(g, "harvester", 10, 12);
      const h2 = put(g, "harvester", 11, 12);
      check("T5 both harvesters placed", !!h1 && !!h2, "on the two M deposits near the core");
      g.energyTick();
      const es = g.energyStats();
      // closest loads win: one harvester runs at full tilt, the other starves
      const total = h1._supplyT + h2._supplyT;
      check("T5 brownout splits supply", total < 1.99 && Math.min(h1._supplyT, h2._supplyT) < 0.01,
        "supplies=" + h1._supplyT.toFixed(2) + "/" + h2._supplyT.toFixed(2) + " gen=" + es.gen + " demand=" + es.demand);
      check("T5 demand counted", es.demand >= 8, "demand=" + es.demand);
    }

    /* T6: islanded plant (no path to core) produces nothing */
    {
      const g = makeGame();
      const p = put(g, "plant", 10, 8);           // in core range → fine
      put(g, "link", 5, 5);                        // near core? (5,5) is 10 cells away — should fail canPlace
      check("T6 far link rejected", !g.towerList.some((t) => t.key === "link" && t.c === 5 && t.r === 5), "out of network");
      finishAll(g);
      g.energyTick();
      check("T6 plant online near core", p && p.online === true, "online=" + (p && p.online));
    }

    /* T7: laser→laser link gives the receiver ×1.5 DPS, the feeder stops shooting */
    {
      const g = makeGame();
      const a = put(g, "laser", 11, 9);
      const b = put(g, "laser", 13, 9);
      const ok = g.linkLaser(a, b);
      check("T7 link accepted", ok, "a→b dist=" + U.dist(11, 9, 13, 9).toFixed(2));
      check("T7 receiver boosted ×1.5", b.boost.n === 1 && Math.abs(b.boost.mult - 1.5) < 1e-9, "mult=" + b.boost.mult);
      check("T7 feeder has no boost", a.boost.n === 0 && !!a.linkTo, "linkTo=" + (a.linkTo && a.linkTo === b));
      g.unlinkLaser(a);
      check("T7 unlink resets", b.boost.n === 0 && !a.linkTo, "n=" + b.boost.n);
    }

    /* T8: chain A→B→C stacks two feeders on C (×2.25) */
    {
      const g = makeGame();
      const a = put(g, "laser", 11, 9);
      const b = put(g, "laser", 13, 9);
      const c = put(g, "laser", 12, 8); // stays inside the core's build radius
      const l1 = g.linkLaser(a, b);
      const l2 = g.linkLaser(b, c);
      check("T8 chain linked", l1 && l2, "a→b " + l1 + ", b→c " + l2);
      check("T8 receiver ×2.25", c.boost.n === 2 && Math.abs(c.boost.mult - 2.25) < 1e-9, "mult=" + c.boost.mult);
      check("T8 range ×1.5625", Math.abs(c.boost.rangeMult - 1.5625) < 1e-9, "range=" + c.boost.rangeMult);
      check("T8 cycle rejected", !g.linkLaser(c, a), "c→a must fail (chain reaches back)");
      g.unlinkAll();
      check("T8 unlinkAll resets", a.linkTo === null && b.linkTo === null && c.boost.n === 0, "all clear");
    }

    /* T9: a laser kills a crawler; reward pays out */
    {
      const g = makeGame();
      const l = put(g, "laser", 10, 8);
      g.supplyOverride = 1; // not used by engine; supply comes from ticks below
      // power the grid ticks so the laser has supply
      g.energyTick();
      g.spawnTestEnemy("crawler", 10, 6); // 2 cells away, within range 3.0
      let frames = 0;
      while (g.enemies.length && !g.enemies[0].dead && frames++ < 60 * 30) g.update(1 / 60);
      check("T9 laser killed crawler", g.enemies.length === 0, "frames=" + frames + " supply=" + l.supply.toFixed(2));
      check("T9 kill reward", g.kills === 1, "kills=" + g.kills);
    }

    /* T10: charged bomb detonates on contact and splashes the pack */
    {
      const g = makeGame();
      const bomb = put(g, "bomb", 10, 8);
      bomb.charge = BOMB_CHARGE; // fully charged
      g.spawnTestEnemy("swarm", 10.5, 7.5);
      g.spawnTestEnemy("swarm", 10.4, 8.4);
      const hpBefore = g.enemies.map((e) => e.hp);
      // run until the walkers touch the bomb cell
      let frames = 0;
      while (g.enemies.some((e) => !e.dead) && frames++ < 60 * 20) g.update(1 / 60);
      check("T10 bomb contact detonated", !g.towerList.some((t) => t.key === "bomb"), "bomb gone after " + frames + " frames");
      check("T10 splash killed the pack", g.kills >= 2, "kills=" + g.kills + " hpBefore=" + hpBefore.join("/"));
    }

    /* T11: missile turret fires and its shell damages the target */
    {
      const g = makeGame();
      put(g, "laser", 11, 9); // spare — not needed
      const m = put(g, "missile", 10, 8);
      g.energyTick();
      g.spawnTestEnemy("tank", 10, 5);
      let frames = 0;
      let sawShell = false;
      while (g.enemies[0] && !g.enemies[0].dead && frames++ < 60 * 40) {
        g.update(1 / 60);
        if (g.shells.length) sawShell = true;
      }
      check("T11 missile fired a shell", sawShell, "frames=" + frames);
      const tank = g.enemies[0];
      check("T11 shell hurt/killed tank", !tank || tank.hp < tank.maxHp, "hp=" + (tank ? tank.hp.toFixed(0) : "dead") + "/" + (tank ? tank.maxHp.toFixed(0) : "0"));
    }

    return results;
  })()
`, ctx);

let fails = 0;
for (const r of suite) {
  console.log(`${r.pass ? "OK  " : "FAIL"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  if (!r.pass) fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nall energy tests passed");
process.exit(fails ? 1 : 0);
