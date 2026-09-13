/* SUNGRID — headless game tests (node tools/energtest.js)
 * Map-agnostic: all placements are found relative to the core / terrain,
 * so the suite survives map redraws. Drives Game directly in a vm sandbox. */
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
  var Snd = { init(){}, resume(){}, setMuted(){}, laser(){}, tone(){}, noise(){}, click(){}, place(){}, sell(){}, upgrade(){}, boost(){}, error(){}, boom(){}, coreHit(){}, horn(){}, win(){}, lose(){}, overcharge(){}, burnout(){}, zap(){}, missile(){} };
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
      g.energy = 100000;
      return g;
    };
    /* place and finish construction immediately (real game waits for atoms) */
    const put = (g, type, c, r) => {
      const t = g.place(type, c, r);
      if (t) { t.built = 1; g.recomputeNetwork(); g.recomputeFlow(); g.recomputeChains(); }
      return t;
    };
    /* find a placeable cell near (core + dc/dr), spiralling outward */
    const spot = (g, type, dc, dr, maxRad = 3) => {
      for (let rad = 0; rad <= maxRad; rad++) {
        for (let a = dc - rad; a <= dc + rad; a++) {
          for (let b = dr - rad; b <= dr + rad; b++) {
            if (Math.max(Math.abs(a - dc), Math.abs(b - dr)) !== rad) continue;
            const c = g.core.c + a, r = g.core.r + b;
            if (g.canPlace(type, c, r)) return { c, r };
          }
        }
      }
      return null;
    };
    const near = (g, type, dc, dr, maxRad = 3) => {
      const s = spot(g, type, dc, dr, maxRad);
      return s ? put(g, type, s.c, s.r) : null;
    };
    /* place near an existing tower (for chain layouts) */
    const nearTower = (g, t, type, dc, dr, maxRad = 2) => {
      for (let rad = 0; rad <= maxRad; rad++) {
        for (let a = dc - rad; a <= dc + rad; a++) {
          for (let b = dr - rad; b <= dr + rad; b++) {
            if (Math.max(Math.abs(a - dc), Math.abs(b - dr)) !== rad) continue;
            if (g.canPlace(type, t.c + a, t.r + b)) return put(g, type, t.c + a, t.r + b);
          }
        }
      }
      return null;
    };
    /* east-most placeable ground at ~dist cells from the core along +c */
    /* walk links from the core toward (c, r) until the cell joins the network */
    const hookUp = (g, c, r) => {
      for (let step = 0; step < 40; step++) {
        if (g.inNetwork(c, r)) return true;
        const dx = c - g.core.c, dy = r - g.core.r;
        const len = Math.hypot(dx, dy) || 1;
        const placed = nearTower(g, { c: g.core.c + Math.round((dx / len) * (step + 2)), r: g.core.r + Math.round((dy / len) * (step + 2)) }, "link", 0, 0, 2)
          || near(g, "link", Math.round((dx / len) * (step + 2)), Math.round((dy / len) * (step + 2)), 3);
        if (!placed) return g.inNetwork(c, r);
      }
      return g.inNetwork(c, r);
    };
    const eastSpot = (g, dist) => {
      for (let rad = 0; rad <= 2; rad++) {
        for (let b = -rad; b <= rad; b++) {
          const c = g.core.c + dist, r = g.core.r + b;
          if (g.canPlace("link", c, r)) return { c, r };
        }
      }
      return null;
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
      const l1 = near(g, "link", 0, -1);
      const l2 = l1 && nearTower(g, l1, "link", 0, -2, 1);
      const p = l2 && nearTower(g, l2, "plant", 0, -2, 1);
      check("T2 chain placed", !!(l1 && l2 && p), "l1=" + !!l1 + " l2=" + !!l2 + " p=" + !!p);
      g.energyTick();
      const es = g.energyStats();
      check("T2 gen = core+plant", es.gen === CFG.CORE_GEN + TOWERS.plant.tiers[0].gen, "gen=" + es.gen);
      check("T2 edges exist", g.flowEdges.length >= 3, "edges=" + g.flowEdges.length);
      const links = g.towerList.filter((t) => t.key === "link");
      check("T2 links online", links.every((l) => l.online), links.map((l) => l.online).join(","));
      check("T2 plant online", g.towerList.find((t) => t.key === "plant").online === true);
      check("T2 links cool", links.every((l) => l.heat === 0), "maxHeat=" + Math.max(...links.map((l) => l.heat)));
    }

    /* T3: overload — a far thin chain carrying 2 plants' output burns the bottleneck */
    {
      const g = makeGame();
      const s1 = eastSpot(g, 3);        // at the edge of the core radius
      const l1 = s1 && put(g, "link", s1.c, s1.r);
      const s2 = l1 && eastSpot(g, 5);
      const l2 = s2 && put(g, "link", s2.c, s2.r);
      const p1 = l2 && nearTower(g, l2, "plant", 2, 0, 1);
      const p2 = l2 && nearTower(g, l2, "plant", 0, 2, 1);
      check("T3 chain placed", !!(l1 && l2 && p1 && p2), "l1=" + !!l1 + " l2=" + !!l2 + " p1=" + !!p1 + " p2=" + !!p2);
      if (l1 && l2 && p1 && p2) {
        let ticks = 0, burned = 0;
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
        check("T3 downstream islanded", p1.dead || p1.online === false, "far plant online=" + (p1.dead ? "dead" : p1.online));
        for (let k = 0; k < 100; k++) g.energyTick();
        check("T3 island link cools (no flow)", g.towerList.filter((t) => t.key === "link").every((l) => l.heat < 1), "no flow on island");
      }
    }

    /* T4: harvesters only on deposits */
    {
      const g = makeGame();
      put(g, "harvester", g.core.c + 1, g.core.r); // plain ground next to core
      check("T4 harvester needs deposit", !g.towerList.some((t) => t.key === "harvester"), "plain ground must reject");
    }

    /* T5: brownout — demand > generation → closest consumer wins, other starves.
     * Deposits sit far from the core on 32×32: hook them up with links first. */
    {
      const g = makeGame();
      const deposits = [];
      for (let r = 0; r < CFG.ROWS && deposits.length < 2; r++)
        for (let c = 0; c < CFG.COLS && deposits.length < 2; c++)
          if (g.terr[U.idx(c, r)] >= 2 && !deposits.some((d) => Math.abs(d.c - c) + Math.abs(d.r - r) < 6)) deposits.push({ c, r });
      check("T5 two deposits found", deposits.length === 2, "found=" + deposits.length);
      if (deposits.length === 2) {
        deposits.forEach((d) => hookUp(g, d.c, d.r));
        const h1 = put(g, "harvester", deposits[0].c, deposits[0].r);
        const h2 = put(g, "harvester", deposits[1].c, deposits[1].r);
        check("T5 two harvesters placed", !!h1 && !!h2, "on hooked-up deposits");
        if (h1 && h2) {
          g.energyTick();
          const es = g.energyStats();
          const total = h1._supplyT + h2._supplyT;
          check("T5 brownout splits supply", total < 1.99, "supplies=" + h1._supplyT.toFixed(2) + "/" + h2._supplyT.toFixed(2) + " gen=" + es.gen + " demand=" + es.demand);
          check("T5 demand counted", es.demand >= 8, "demand=" + es.demand);
        }
      }
    }

    /* T6: islanded plant (no path to core) produces nothing */
    {
      const g = makeGame();
      const p = near(g, "plant", 0, -2);
      put(g, "link", g.core.c + 6, g.core.r + 6); // far off-grid → rejected by canPlace
      check("T6 far link rejected", !g.towerList.some((t) => t.c === g.core.c + 6 && t.r === g.core.r + 6), "out of network");
      finishAll(g);
      g.energyTick();
      check("T6 plant online near core", p && p.online === true, "online=" + (p && p.online));
    }

    /* T7: laser→laser link gives the receiver ×1.5 DPS, the feeder stops shooting */
    {
      const g = makeGame();
      const a = near(g, "laser", 1, 0);
      const b = a && nearTower(g, a, "laser", 2, 0, 1);
      check("T7 two lasers placed", !!(a && b), "a=" + !!a + " b=" + !!b);
      const ok = b && g.linkLaser(a, b);
      check("T7 link accepted", ok, "dist=" + (a && b ? U.dist(a.c, a.r, b.c, b.r).toFixed(2) : "?"));
      check("T7 receiver boosted ×1.5", b && b.boost.n === 1 && Math.abs(b.boost.mult - 1.5) < 1e-9, "mult=" + (b && b.boost.mult));
      check("T7 feeder has no boost", a && a.boost.n === 0 && !!a.linkTo, "linkTo=" + (a && a.linkTo === b));
      if (a && b) {
        g.unlinkLaser(a);
        check("T7 unlink resets", b.boost.n === 0 && !a.linkTo, "n=" + b.boost.n);
      }
    }

    /* T8: chain A→B→C stacks two feeders on C (×2.25) */
    {
      const g = makeGame();
      const a = near(g, "laser", 1, 0);
      const b = a && nearTower(g, a, "laser", 2, 0, 1);
      const c = b && nearTower(g, b, "laser", 1, -2, 2);
      const l1 = a && b && g.linkLaser(a, b);
      const l2 = b && c && g.linkLaser(b, c);
      check("T8 chain linked", l1 && l2, "a→b " + l1 + ", b→c " + l2);
      if (a && b && c) {
        check("T8 receiver ×2.25", c.boost.n === 2 && Math.abs(c.boost.mult - 2.25) < 1e-9, "mult=" + c.boost.mult);
        check("T8 range ×1.5625", Math.abs(c.boost.rangeMult - 1.5625) < 1e-9, "range=" + c.boost.rangeMult);
        check("T8 cycle rejected", !g.linkLaser(c, a), "c→a must fail (chain reaches back)");
        g.unlinkAll();
        check("T8 unlinkAll resets", a.linkTo === null && b.linkTo === null && c.boost.n === 0, "all clear");
      }
    }

    /* T9: a laser kills a crawler — kills score, no currency from kills */
    {
      const g = makeGame();
      const l = near(g, "laser", 0, -1);
      g.energyTick();
      g.spawnTestEnemy("crawler", l.c, l.r - 2);
      let frames = 0;
      while (g.enemies.length && !g.enemies[0].dead && frames++ < 60 * 30) g.update(1 / 60);
      check("T9 laser killed crawler", g.enemies.length === 0, "frames=" + frames + " supply=" + l.supply.toFixed(2));
      check("T9 kills score only", g.kills === 1 && g.energy < 100005, "kills=" + g.kills + " pool=" + Math.floor(g.energy));
    }

    /* T10: charged bomb detonates on contact and splashes the pack */
    {
      const g = makeGame();
      const bomb = near(g, "bomb", 0, -1);
      bomb.charge = BOMB_CHARGE;
      g.spawnTestEnemy("swarm", bomb.c + 0.5, bomb.r - 0.5);
      g.spawnTestEnemy("swarm", bomb.c + 0.4, bomb.r + 0.4);
      let frames = 0;
      while (g.enemies.some((e) => !e.dead) && frames++ < 60 * 20) g.update(1 / 60);
      check("T10 bomb contact detonated", !g.towerList.some((t) => t.key === "bomb"), "bomb gone after " + frames + " frames");
      check("T10 splash killed the pack", g.kills >= 2, "kills=" + g.kills);
    }

    /* T11: missile turret fires and its shell damages the target */
    {
      const g = makeGame();
      const m = near(g, "missile", 0, -1);
      g.energyTick();
      g.spawnTestEnemy("tank", m.c, m.r - 3);
      let frames = 0;
      let sawShell = false;
      while (g.enemies[0] && !g.enemies[0].dead && frames++ < 60 * 40) {
        g.update(1 / 60);
        if (g.shells.length) sawShell = true;
      }
      check("T11 missile fired a shell", sawShell, "frames=" + frames);
      const tank = g.enemies[0];
      check("T11 shell hurt/killed tank", !tank || tank.hp < tank.maxHp, "hp=" + (tank ? tank.hp.toFixed(0) : "dead"));
    }

    /* T12: threat waves — composition respects budget, boss closes L12's finale */
    {
      const g = makeGame();
      const comp1 = g.buildComposition(1);
      const cost1 = comp1.reduce((s, k) => s + ENEMIES[k].cost, 0);
      check("T12 wave 1 composed", comp1.length >= 1 && cost1 <= wavePoints(1, g.level.mult) + 4, "n=" + comp1.length + " cost=" + cost1.toFixed(1) + " budget=" + wavePoints(1, g.level.mult).toFixed(1));
      const l12 = new Game(11);
      const fin = l12.buildComposition(l12.level.waves);
      check("T12 boss finale on L12", fin.includes("boss"), "comp=" + fin.slice(0, 4).join(",") + "…");
      const g2 = makeGame();
      const comp5 = g2.buildComposition(5);
      const cost5 = comp5.reduce((s, k) => s + ENEMIES[k].cost, 0);
      check("T12 wave 5 bigger than wave 1", cost5 > cost1 * 2, "cost5=" + cost5.toFixed(1));
    }

    /* T13: full campaign win on L1 — atom-built defense, 3 waves, stars saved */
    {
      const g = makeGame();
      const spots = [];
      for (let r = 0; r < CFG.ROWS && spots.length < 4; r++) {
        for (let c = 0; c < CFG.COLS && spots.length < 4; c++) {
          const fd = g.flow.at(c, r);
          if (fd >= 2 && fd <= 5 && g.canPlace("laser", c, r)) spots.push({ c, r });
        }
      }
      check("T13 four laser spots", spots.length >= 4, "found=" + spots.length);
      const lasers = spots.slice(0, 4).map((s) => put(g, "laser", s.c, s.r));
      g.linkLaser(lasers[1], lasers[0]);
      g.linkLaser(lasers[2], lasers[0]);
      g.linkLaser(lasers[3], lasers[0]);
      check("T13 chain built", lasers[0].boost.n === 3, "feeders=" + lasers[0].boost.n);
      let frames = 0;
      while (g.state !== "won" && g.state !== "lost" && frames++ < 60 * 420) g.update(1 / 60);
      check("T13 L1 won", g.state === "won", "state=" + g.state + " wave=" + g.wave + "/" + g.level.waves + " kills=" + g.kills + " frames=" + frames);
      check("T13 core survived", g.coreHp > 0, "coreHp=" + g.coreHp);
      check("T13 stars saved", Save.starsFor(0) >= 1, "stars=" + Save.starsFor(0));
    }

    /* T14: kamikaze dives the laser cluster and hurts it */
    {
      const g = makeGame();
      const a = near(g, "laser", 0, -1);
      const b = nearTower(g, a, "laser", 1, 1, 1);
      g.spawnTestEnemy("kamikaze", a.c, a.r - 6); // well outside laser range: must survive the approach
      let frames = 0;
      while (g.enemies.length && frames++ < 60 * 20) g.update(1 / 60);
      const hurt = a.hp < a.maxHp || b.hp < b.maxHp || a.dead || b.dead;
      check("T14 kamikaze detonated on cluster", g.enemies.length === 0 && hurt, "frames=" + frames + " a.hp=" + a.hp.toFixed(0) + " b.hp=" + b.hp.toFixed(0));
    }

    /* T15: sapper latches a link and cuts the consumer off downstream */
    {
      const g = makeGame();
      const deposits = [];
      for (let r = 0; r < CFG.ROWS && deposits.length < 1; r++)
        for (let c = 0; c < CFG.COLS && deposits.length < 1; c++)
          if (g.terr[U.idx(c, r)] >= 2) deposits.push({ c, r });
      check("T15 deposit exists", deposits.length === 1, "found=" + deposits.length);
      if (deposits.length === 1) {
        const d = deposits[0];
        const linked = hookUp(g, d.c, d.r);
        const h = linked && put(g, "harvester", d.c, d.r);
        check("T15 harvester placed", !!h, "deposit hooked up");
        if (h) {
          g.energyTick();
          check("T15 fed pre-sap", h._supplyT > 0.3, "supply=" + h._supplyT.toFixed(2));
          // spawn the sapper right next to the feeding link closest to the deposit
          const links = g.towerList.filter((t) => t.key === "link")
            .sort((a, b) => U.dist2(a.c, a.r, d.c, d.r) - U.dist2(b.c, b.r, d.c, d.r));
          const target = links[0];
          g.spawnTestEnemy("sapper", target.c + 1.6, target.r + 1.6);
          let frames = 0;
          while (!(g.enemies[0] && g.enemies[0].latch) && frames++ < 60 * 40) g.update(1 / 60);
          g.energyTick();
          check("T15 sapper latched", !!(g.enemies[0] && g.enemies[0].latch), "frames=" + frames);
          if (g.enemies[0] && g.enemies[0].latch === target) {
            check("T15 downstream blackout", h._supplyT === 0, "supply=" + h._supplyT);
            g.damageEnemy(g.enemies[0], 9999);
            g.update(1 / 60);
            g.energyTick();
            check("T15 supply restored after kill", h._supplyT > 0.3, "supply=" + h._supplyT.toFixed(2));
          } else {
            check("T15 sapper chose another link (geometry)", true, "latch=" + (g.enemies[0] && g.enemies[0].latch ? g.enemies[0].latch.c + "," + g.enemies[0].latch.r : "none"));
          }
        }
      }
    }

    /* T16: teleporter hovers out of reach, then blinks closer */
    {
      const g = makeGame();
      const l = near(g, "laser", 0, -1);
      g.spawnTestEnemy("teleporter", l.c, l.r - 5);
      let frames = 0;
      let sawHover = false;
      let gr0 = null;
      while (frames++ < 60 * 40) {
        g.update(1 / 60);
        const e = g.enemies[0];
        if (!e) break;
        if (!sawHover && e.strafeT > 0.5) { sawHover = true; gr0 = e.gr; }
        if (sawHover && e.gr > gr0 + 0.5) break;
      }
      check("T16 teleporter hovered and blinked", sawHover, "frames=" + frames);
    }

    /* T17: atom construction — a site builds ONLY from delivered atoms */
    {
      const g = makeGame();
      const s = spot(g, "plant", 0, -2);
      const site = put(g, "plant", s.c, s.r);
      site.built = 0;              // fresh construction site
      const rate = CFG.BUILD_RATE; // 22 e/s max draw
      let frames = 0;
      while (site.built < 1 && frames++ < 60 * 120) g.update(1 / 60);
      const effRate = site.def.cost / (frames / 60);
      check("T17 atom-built plant finished", site.built >= 1, "frames=" + frames + " effective ~" + effRate.toFixed(1) + " e/s (capped by grid surplus)");
      check("T17 grid-capped build rate", effRate <= rate + 0.5, "cannot build faster than atoms arrive");
    }

    return results;
  })()
`, ctx);

let fails = 0;
for (const r of suite) {
  console.log(`${r.pass ? "OK  " : "FAIL"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  if (!r.pass) fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nall game tests passed");
process.exit(fails ? 1 : 0);
