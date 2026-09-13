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
for (const f of ["util.js", "iso.js", "save.js", "data.js", "flowfield.js", "entities.js", "game.js"]) {
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

    /* T2: chain core→link→link→plant: atoms flow, everything online and cool */
    {
      const g = makeGame();
      put(g, "link", 10, 8);
      put(g, "link", 10, 6);
      put(g, "plant", 10, 4);
      finishAll(g);
      g.energyTick();
      const es = g.energyStats();
      check("T2 gen = core+plant", es.gen === CFG.CORE_GEN + TOWERS.plant.tiers[0].gen, "gen=" + es.gen);
      check("T2 edges exist", g.flowEdges.length >= 3, "edges=" + g.flowEdges.length + " " + JSON.stringify(g.flowEdges.map(e => e.flow.toFixed(1))));
      const links = g.towerList.filter((t) => t.key === "link");
      check("T2 links online", links.every((l) => l.online), links.map((l) => l.online).join(","));
      check("T2 plant online", g.towerList.find((t) => t.key === "plant").online === true);
      check("T2 links cool", links.every((l) => l.heat === 0), "maxHeat=" + Math.max(...links.map((l) => l.heat)));
    }

    /* T3: overload — 24 e/s through a thin chain burns the bottleneck link;
     * the orphaned far side becomes a powerless island instead of exploding */
    {
      const g = makeGame();
      put(g, "link", 10, 8);
      put(g, "link", 10, 6);
      const p1 = put(g, "plant", 10, 4);
      const p2 = put(g, "plant", 9, 5);
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

    /* T5: brownout — demand > generation → partial supply */
    {
      const g = makeGame();
      put(g, "harvester", 13, 12);
      check("T5 harvester out of network rejected", !g.towerList.some((t) => t.key === "harvester"), "5 cells from core");
      put(g, "link", 11, 11);
      put(g, "link", 12, 12);
      put(g, "harvester", 13, 12);
      finishAll(g);
      g.energyTick();
      const h = g.towerList.find((t) => t.key === "harvester");
      const es = g.energyStats();
      check("T5 brownout supply<1", !!h && h._supplyT < 1, "supply=" + (h ? h._supplyT.toFixed(2) : "none") + " gen=" + es.gen + " demand=" + es.demand);
      check("T5 demand counted", es.demand >= 4.5, "demand=" + es.demand);
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
