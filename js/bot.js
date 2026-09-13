/* SUNGRID — dev-only autoplay bot for balance simulation (exposed as window.SG.bot) */
"use strict";

const Bot = {
  /* Play a level with a reasonable heuristic build order and simulate to the end. */
  play(levelIdx, opts = {}) {
    const g = new Game(levelIdx);
    g.onWin = () => {}; g.onLose = () => {};
    const maxSim = opts.maxSim || 1100; // seconds of game time
    let simT = 0;
    const dt = 1 / 60;
    let buildTick = 0;

    while (simT < maxSim && g.state !== "won" && g.state !== "lost") {
      if (++buildTick % 30 === 0) this.spend(g); // decide ~2×/s
      if (g.state === "build" && g.breakT < 4) g.callWave(true);
      g.update(dt);
      simT += dt;
    }
    return {
      levelIdx, name: g.level.name, outcome: g.state, wave: g.wave,
      corePct: Math.round((g.coreHp / g.coreMax) * 100),
      kills: g.kills, simT: Math.round(simT),
      towers: g.towerList.length,
    };
  },

  spend(g) {
    // someone is chewing a tower? stop rebuilding while under attack (avoid seal-livelock)
    if (g.enemies.length && g.towerList.some((t) => t.hp < t.maxHp)) return;
    // priority: income → defense → amplification → support → upgrades
    if (this.placeExtractors(g)) return;
    if (this.placeLasers(g)) return;
    if (this.placePylons(g)) return;
    if (this.placePrisms(g)) return;
    if (this.placeMortars(g)) return;
    if (this.placeFrost(g)) return;
    this.upgradeStuff(g);
  },

  // mortar: splash damage, counters armored shells and packs (only once defense is up)
  placeMortars(g) {
    if (g.levelIdx < 6 && g.levelIdx !== -1) return false;
    if (g.towerList.filter((t) => t.key === "laser").length < 5) return false;
    if (g.wave < 5) return false;
    const have = g.towerList.filter((t) => t.key === "mortar").length;
    if (have >= 2) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      if (!this.offCorridor(g, c, r, 2) || !g.canPlace("mortar", c, r)) return;
      const fd = g.flow.at(c, r);
      if (fd < 2 || fd > 7) return;
      const score = fd * 10 + U.dist(c, r, g.core.c, g.core.r);
      if (score < bs) { bs = score; best = { c, r }; }
    });
    if (best && g.energy >= TOWERS.mortar.cost + 60) {
      return !!this.place(g, "mortar", best.c, best.r);
    }
    return false;
  },

  // frost: slows chokepoints (only once defense is up)
  placeFrost(g) {
    if (g.levelIdx < 4 && g.levelIdx !== -1) return false;
    if (g.towerList.filter((t) => t.key === "laser").length < 5) return false;
    if (g.wave < 5) return false;
    const have = g.towerList.filter((t) => t.key === "frost").length;
    if (have >= 2) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      if (!this.offCorridor(g, c, r, 2) || !g.canPlace("frost", c, r)) return;
      const fd = g.flow.at(c, r);
      if (fd < 2 || fd > 5) return;
      const score = fd * 10 + U.dist(c, r, g.core.c, g.core.r);
      if (score < bs) { bs = score; best = { c, r }; }
    });
    if (best && g.energy >= TOWERS.frost.cost + 60) {
      return !!this.place(g, "frost", best.c, best.r);
    }
    return false;
  },

  // place, but undo if it seals any spawn off from the core
  place(g, type, c, r) {
    const t = g.place(type, c, r);
    if (!t) return null;
    for (const s of g.spawns) {
      if (g.flow.at(s.c, s.r) < 0) { g.sell(t); return null; }
    }
    return t;
  },

  forEachCell(fn) {
    for (let r = 0; r < CFG.ROWS; r++) for (let c = 0; c < CFG.COLS; c++) fn(c, r);
  },

  // keep a corridor near the core open so enemies are never fully sealed by accident
  offCorridor(g, c, r, minFd) {
    return g.flow.at(c, r) >= minFd;
  },

  placeExtractors(g) {
    if (g.levelIdx >= 1 || g.levelIdx === -1) {
      // prefer FAR crystals first — keep the core ring free for defense
      const spots = [];
      this.forEachCell((c, r) => {
        const i = r * CFG.COLS + c;
        if (g.terr[i] >= 2 && this.offCorridor(g, c, r, 1) && g.canPlace("extractor", c, r)) {
          spots.push({ c, r, fd: g.flow.at(c, r) });
        }
      });
      spots.sort((a, b) => b.fd - a.fd);
      if (spots.length && g.energy >= TOWERS.extractor.cost) {
        return !!this.place(g, "extractor", spots[0].c, spots[0].r);
      }
    }
    return false;
  },

  placeLasers(g) {
    const lasers = g.towerList.filter((t) => t.key === "laser").length;
    const lanes = 1 + (g.spawns.length - 1) * 0.35;
    const want = Math.min(10, Math.round(2 + g.wave * lanes));
    if (lasers >= want) { this._laserStarved = false; return false; }
    // best cell: beside the enemy path, close to the core, but not in the corridor itself
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      if (!this.offCorridor(g, c, r, 2) || !g.canPlace("laser", c, r)) return;
      const fd = g.flow.at(c, r);
      if (fd < 2 || fd > 8) return;
      const score = fd * 10 + U.dist(c, r, g.core.c, g.core.r);
      if (score < bs) { bs = score; best = { c, r }; }
    });
    if (best && g.energy >= TOWERS.laser.cost) {
      this._laserStarved = false;
      return !!this.place(g, "laser", best.c, best.r);
    }
    this._laserStarved = lasers < want;
    return false;
  },

  placePylons(g) {
    if (g.levelIdx < 3 && g.levelIdx !== -1) return false;
    let target = null;
    // priority 1: unreachable crystals
    this.forEachCell((c, r) => {
      if (target || g.terr[r * CFG.COLS + c] < 2) return;
      if (!g.inNetwork(c, r)) target = { c, r };
    });
    // priority 2: no room for lasers near the core — expand the network into open space
    if (!target && this._laserStarved) {
      let bs = Infinity;
      this.forEachCell((c, r) => {
        const fd = g.flow.at(c, r);
        if (fd < 4 || fd > 9) return;
        const i = r * CFG.COLS + c;
        if (g.towers[i] || g.terr[i] === 1) return;
        const d = U.dist(c, r, g.core.c, g.core.r);
        if (d < bs) { bs = d; target = { c, r }; }
      });
    }
    if (!target) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      if (!this.offCorridor(g, c, r, 2) || !g.canPlace("pylon", c, r)) return;
      const d = U.dist(c, r, target.c, target.r);
      if (d < bs) { bs = d; best = { c, r }; }
    });
    if (best && bs < TOWERS.pylon.tiers[0].range + 2.6 && g.energy >= TOWERS.pylon.cost + 30) {
      return !!this.place(g, "pylon", best.c, best.r);
    }
    return false;
  },

  placePrisms(g) {
    if (g.levelIdx < 2 && g.levelIdx !== -1) return false;
    const lasers = g.towerList.filter((t) => t.key === "laser");
    if (lasers.length < 4) return false; // defense before amplification
    const prisms = g.towerList.filter((t) => t.key === "prism").length;
    if (prisms >= lasers.length * 2 + 1) return false; // total cap — leave room to build
    for (const L of lasers) {
      // gradual chain growth: 1 prism per laser early, up to 4 late
      const wantN = Math.min(CFG.MAX_PRISMS, 1 + Math.floor(g.wave / 3));
      if (L.boost.n >= wantN) continue;
      let best = null, bs = Infinity;
      this.forEachCell((c, r) => {
        if (!this.offCorridor(g, c, r, 2) || !g.canPlace("prism", c, r)) return;
        const d = U.dist(c, r, L.c, L.r);
        if (d > LINK_RANGE) return;
        const score = d + (L.boost.n * 0.3);
        if (score < bs) { bs = score; best = { c, r }; }
      });
      if (best && g.energy >= TOWERS.prism.cost + 40) {
        const p = this.place(g, "prism", best.c, best.r);
        if (p) return true;
      }
    }
    return false;
  },

  upgradeStuff(g) {
    if (g.energy < 140) return;
    const cand = g.towerList
      .filter((t) => t.tier < 2 && g.energy >= t.def.upCost[t.tier] + 60)
      .sort((a, b) => (a.key === "laser" ? -1 : 1));
    if (cand[0]) g.upgrade(cand[0]);
  },
};
