/* SUNGRID — dev-only autoplay bot for balance simulation.
 * Browser: loader-style global const Bot (exposed as window.SG.bot by main.js).
 * Node: loaded into a vm sandbox by tools/balance.js — no DOM/window access here.
 *
 * Priorities (HANDOFF §2, lessons §4):
 *   plants → links → harvesters → lasers → chains (linkLaser) → upgrades.
 * Credits are the ONLY currency (there is no g.energy!); energy is a FLOW read
 * through g.energyStats() → { gen, demand }.
 * Economy rules that keep the flow healthy:
 *   - gates count buildings still UNDER CONSTRUCTION (they drain once done);
 *   - while a plant is wanted and unaffordable, the bot SAVES up for it;
 *   - until the first harvester pays, one link chain at a time (bootstrap).
 * Livelock guards (lesson 5):
 *   1) never build while enemies are chewing a building;
 *   2) after EVERY placement check every spawn — a sealed path (fd < 0)
 *      → sell it back and blacklist the cell. */
"use strict";

const Bot = {
  /* =============================== driver =============================== */

  /* Simulate one level to won/lost (or watchdog). Returns a result row for
   * tools/balance.js. Watchdog: 90 s of game time without a kill or a core
   * hit → outcome "stuck" + a short dump of enemy types/positions. */
  play(levelIdx, opts = {}) {
    const g = new Game(levelIdx);
    g.onWin = () => {};
    g.onLose = () => {};
    const maxSim = opts.maxSim || ((levelIdx === -1 || levelIdx >= 11) ? 1100 : 900);
    const dt = 1 / 60;
    let simT = 0, buildTick = 0;
    let lastKills = -1, lastCore = -1, lastProgT = 0, stuckAt = 0, lastKillT = 0;
    this._badSpots = new Set();
    this._laserStarved = false;
    this._stall = false;

    while (simT < maxSim && g.state !== "won" && g.state !== "lost") {
      if (++buildTick % 30 === 0) this.spend(g);                 // decide ~2×/s
      if (g.state === "build" && g.breakT < 4) g.callWave(true); // don't idle the break
      g.update(dt);
      simT += dt;
      // kill-stall: defense already engaged (a kill happened) but nothing dies
      // for 25 s → someone is parked out of reach; the build order switches to
      // forward chains (see addChain). No kills YET just means they're marching.
      this._stall = lastKillT > 0 && g.enemies.length > 0 && simT - lastKillT > 25;
      if (g.kills !== lastKills || g.coreHp !== lastCore) {
        if (g.kills !== lastKills) lastKillT = simT;
        lastKills = g.kills; lastCore = g.coreHp; lastProgT = simT;
      } else if (simT - lastProgT > 90) { stuckAt = simT; break; }
    }

    const lasers = g.towerList.filter((t) => t.key === "laser");
    const dump = stuckAt ? g.enemies.slice(0, 10).map((e) => {
      const c = Math.floor(e.gc), r = Math.floor(e.gr);
      return e.key + "@(" + e.gc.toFixed(1) + "," + e.gr.toFixed(1) + ") fd " +
        g.flow.at(c, r) + " hp " + Math.round(e.hp);
    }) : null;
    const outcome = stuckAt ? "stuck"
      : (g.state === "won" || g.state === "lost") ? g.state : "timeout";
    return {
      levelIdx, name: g.level.name,
      outcome,
      wave: g.wave,
      corePct: Math.round((g.coreHp / g.coreMax) * 100),
      kills: g.kills, simT: Math.round(simT),
      towers: g.towerList.length,
      links: g.towerList.filter((t) => t.key === "link").length,
      chains: lasers.reduce((m, t) => Math.max(m, t.boost.n), 0),
      stuck: stuckAt || undefined,
      dump: dump || undefined,
    };
  },

  /* ============================= build order ============================= */

  spend(g) {
    if (!this._badSpots) { this._badSpots = new Set(); this._laserStarved = false; }
    // (a) livelock guard (lesson 5): enemies CUT OFF from the core (fd < 0) chew
    // buildings — never feed them (harmless cut-off sappers don't count). Damage
    // while enemies are still on the path (kamikaze dives, boss smashes) must not
    // freeze the build, or long waves stall the whole economy; the seal-undo
    // protects every placement anyway.
    const cutOffChewer = g.enemies.some((e) => !e.dead && e.dmg > 0 &&
      g.flow.at(Math.floor(e.gc), Math.floor(e.gr)) < 0);
    if (cutOffChewer && g.towerList.some((t) => t.hp < t.maxHp)) return;
    const es = g.energyStats();
    const st = {
      gen: es.gen + this.pendingGen(g),           // incl. plants being built
      dem: es.demand + this.pendingDemand(g),     // incl. idle drains of WIP buildings
      plants: 0, hasIncome: false, wantPlant: false, save: false, defenseOk: false,
    };
    st.plants = g.towerList.filter((t) => t.key === "plant").length;
    st.hasIncome = g.towerList.some((t) => t.key === "harvester");
    st.wantPlant = st.plants < 4 && st.dem + 3 > st.gen;
    st.save = st.wantPlant && g.credits < TOWERS.plant.cost;
    const lasers = g.towerList.filter((t) => t.key === "laser").length;
    const want = Math.round(2 + g.wave * (1 + g.spawns.length));
    // expansion waits until core defense exists (or the grid is rich, or lasers
    // starve for room and need links to grow)
    st.defenseOk = lasers >= Math.min(4, want) || this._laserStarved || g.credits >= 200;
    const building = g.state === "build";

    // EMERGENCY: kill-stall (defense already engaged, but nothing dies for 25 s)
    // means someone is parked out of every laser's reach — usually a latched
    // sapper on a far link. The stall-breaker bomb keeps the watchdog at zero.
    if (this._stall && this.dropBomb(g)) return;

    if (!st.hasIncome) {
      /* BOOTSTRAP — the opening moves. Kill rewards are the only income until
       * the first harvester pays, so the 200 starting credits buy the engine
       * in this order: laser #1 → link → harvester → (rich-only plant) →
       * laser #2 — never dipping into the harvester pot on the way. */
      if (lasers < 1 && this.addLaser(g, st, true)) return;
      if (building && this.addLink(g, st)) return;
      if (building && this.addHarvester(g, st)) return;
      if (st.wantPlant && g.credits >= 160 && this.addPlant(g, st)) return;
      if (lasers < 2 && g.credits >= 110 && this.addLaser(g, st, true)) return;
      if (this.addChain(g, es)) return;
      return;
    }

    /* NORMAL — (b) plants → (c) links → (d) harvesters → (e) lasers →
     * (f) chains → (g) upgrades */
    if (this.addPlant(g, st)) return;             // energy = speed first
    if (building && st.defenseOk && this.addLink(g, st)) return;   // reach deposits
    if (building && this.addHarvester(g, st)) return;              // income
    if (this.addLaser(g, st, false)) return;                       // defense
    if (this.addChain(g, es)) return;                              // laser chains (USP)
    this.upgradeStuff(g, st);                                      // tiers
  },

  /* Stall-breaker (25 s without a kill while enemies are on the field):
   * latched sappers never move, drink the grid sappers-first (the newest,
   * forwardmost lasers end up with supply 0 and can't shoot), and often sit in
   * a link pocket where every laser placement would seal a spawn. A sun bomb
   * doesn't block pathing → drop it 1.7–2.8 cells from the camper (outside a
   * possible link-burnout blast, inside its own 2.5 AOE) and detonate in the
   * SAME tick — a waiting bomb could be destroyed by the burning links. */
  dropBomb(g) {
    // victims: LATCHED sappers only — they never move again, so the bomb cannot
    // miss, and no laser will ever reach them (they sit where links are)
    const shooters = g.towerList.filter((t) => t.key === "laser" && t.done && !t.linkTo);
    let victim = null;
    for (const e of g.enemies) {
      if (e.dead || !e.def.sapper || !e.latch || e.latch.dead) continue;
      const inReach = shooters.some((l) => l.sup > 0.05 &&
        U.dist2(l.c, l.r, e.gc, e.gr) <= l.effRange * l.effRange);
      if (inReach) continue;
      if (!victim || U.dist2(e.gc, e.gr, g.core.c, g.core.r) <
          U.dist2(victim.gc, victim.gr, g.core.c, g.core.r)) victim = e;
    }
    if (!victim || g.credits < TOWERS.bomb.cost) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      if (!g.canPlace("bomb", c, r)) return;
      const d = U.dist(c, r, victim.gc, victim.gr);
      if (d > 2.8) return;                          // 2.5 AOE + 0.3 size
      // prefer the 1.7–2.8 band (survives a burnout blast), closest first
      const k = (d < 1.7 ? 10 : 0) + d;
      if (k < bs) { bs = k; best = { c, r }; }
    });
    if (!best) {
      // (1) sacrifice a NEIGHBOR link within blast reach of the camper
      // (never its own perch, never one a sapper is standing on)
      let cand = null, cd = Infinity;
      for (const t of g.towerList) {
        if (t.key !== "link" || t.dead) continue;
        if (victim.latch === t) continue;
        const busy = g.enemies.some((e) => !e.dead &&
          Math.floor(e.gc) === t.c && Math.floor(e.gr) === t.r);
        if (busy) continue;
        const d = U.dist(t.c, t.r, victim.gc, victim.gr);
        if (d <= 2.8 && d < cd) { cd = d; cand = t; }
      }
      if (cand) {
        g.sell(cand);                               // 70% refund keeps this cheap
        const t = g.place("bomb", cand.c, cand.r);
        if (!t) return false;
        g.detonateBomb(t);
        return true;
      }
      // (2) isolated perch (single-link pocket): sell the latch link itself —
      // the sapper must take off, the sap-block lifts (lasers get supply back
      // and can shoot it mid-flight), and it re-latches somewhere reachier
      if (victim.latch && !victim.latch.dead) {
        g.sell(victim.latch);
        return true;
      }
      return false;
    }
    const t = g.place("bomb", best.c, best.r);      // direct: no seal risk for bombs
    if (!t) return false;
    g.detonateBomb(t);                              // instant: nothing can defuse it
    return true;
  },

  /* (b) plant: keep a small reserve (~3 e/s) of generation above demand, max 4.
   * Over-building plants ALSO overloads thin grids (surplus circulates through
   * the tree!), so the gate matters as much as the cap. Near the core, off the
   * corridor; plants double as network anchors. */
  addPlant(g, st) {
    if (st.plants >= 4 || st.dem + 3 <= st.gen) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      const fd = g.flow.at(c, r);
      if (fd < 2 || fd > 9) return;
      if (!g.canPlace("plant", c, r) || this._bad(c, r, "plant")) return;
      const score = U.dist(c, r, g.core.c, g.core.r) + fd * 0.25;
      if (score < bs) { bs = score; best = { c, r }; }
    });
    return best ? !!this.place(g, "plant", best.c, best.r) : false;
  },

  /* (c) link: extend the grid toward the nearest unreachable deposit (income
   * first), or — when lasers starve for room — toward open laser spots near the
   * corridor. Deposit cells dedupe into ~2.2-cell clusters (one link covers a
   * patch); anchors include links still being built. Until the first harvester
   * exists, bootstrap ONE link chain at a time and keep credits for the
   * harvester that link is for. */
  addLink(g, st) {
    const deps = [];
    this.forEachCell((c, r) => {
      if (g.terr[r * CFG.COLS + c] >= 2) deps.push({ c, r, net: g.inNetwork(c, r) });
    });
    const targets = [];
    // orphaned link islands (a burned relay cut them off) — reconnect them, or
    // everything downstream stays dead and latched sappers become unkillable
    for (const t of g.towerList) {
      if (t.key === "link" && t.done && !t.online) targets.push({ c: t.c, r: t.r, harv: true });
    }
    for (const d of deps) {
      if (d.net) continue;
      let covered = false;
      for (const o of deps) {           // a linked deposit nearby already covers this one
        if (o.net && U.dist(d.c, d.r, o.c, o.r) < 2.2) { covered = true; break; }
      }
      if (!covered) for (const T of targets) {
        if (U.dist(d.c, d.r, T.c, T.r) < 2.2) { covered = true; break; }
      }
      if (!covered) targets.push({ c: d.c, r: d.r, harv: true });
    }
    if (!targets.length && this._laserStarved) {
      this.forEachCell((c, r) => {
        const i = r * CFG.COLS + c;
        if (g.terr[i] !== 0 || g.towers[i]) return;
        const fd = g.flow.at(c, r);
        if (fd >= 2 && fd <= 8 && !g.inNetwork(c, r)) targets.push({ c, r, harv: false });
      });
    }
    if (!targets.length) return false;
    if (!st.hasIncome) {
      const pending = g.towerList.filter((t) => t.key === "link" && !t.done).length;
      if (pending >= 1) return false;   // bootstrap: one link chain at a time
    }
    // anchors: finished net nodes PLUS links still under construction
    const anchors = g.netNodes.map((n) => ({ c: n.c, r: n.r, range: n.range }));
    for (const t of g.towerList) {
      if (t.key === "link" && !t.done) anchors.push({ c: t.c, r: t.r, range: t.nodeRange });
    }
    const dNet = (c, r) => {
      let d = Infinity;
      for (const a of anchors) d = Math.min(d, U.dist(c, r, a.c, a.r));
      return d;
    };
    // deposits before laser spots, nearest-to-grid first (cheap link chains)
    targets.sort((a, b) => (b.harv - a.harv) || (dNet(a.c, a.r) - dNet(b.c, b.r)));
    for (const T of targets.slice(0, 4)) {
      const dT = dNet(T.c, T.r);
      let best = null, bs = Infinity;
      this.forEachCell((c, r) => {
        if (g.flow.at(c, r) < 2) return;              // don't wall the core throat
        if (!g.canPlace("link", c, r) || this._bad(c, r, "link")) return;
        const d = U.dist(c, r, T.c, T.r);
        if (d < bs) { bs = d; best = { c, r }; }
      });
      if (best && bs < dT - 0.8 && g.credits >= TOWERS.link.cost) {
        return !!this.place(g, "link", best.c, best.r);
      }
    }
    return false;
  },

  /* (d) harvester on every free deposit the grid already reaches (rich first);
   * each one eats 4 e/s — normally only build while the flow has headroom.
   * The FIRST harvester skips the check (no income at all yet = starvation is
   * worse than a brownout), and a rich bot (> 200 cr) keeps expanding income
   * even in deficit — credits idle in a siege help nobody. */
  addHarvester(g, st) {
    if (st.hasIncome && st.gen - st.dem < 4 && g.credits < 200) return false;
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      const i = r * CFG.COLS + c;
      if (g.terr[i] < 2 || !g.canPlace("harvester", c, r) || this._bad(c, r, "harvester")) return;
      const score = (g.terr[i] === 3 ? 0 : 10) + U.dist(c, r, g.core.c, g.core.r);
      if (score < bs) { bs = score; best = { c, r }; }
    });
    return best ? !!this.place(g, "harvester", best.c, best.r) : false;
  },

  /* (e) laser: keep want ≈ 2 + wave × (1 + spawns). Place off the corridor
   * (fd ≥ 2), hugging the core — a tight cluster chains easily (LINK_RANGE 3.5)
   * and is the cheapest spot to defend. The fd window stretches toward far
   * enemies (sappers parked on far links!) so no wave can hang forever.
   * Floor lasers (isFloor) always apply; EXTRA lasers wait until the first
   * harvester exists (income before more guns) and until saving is done. */
  addLaser(g, st, isFloor) {
    if (st.save) return false;
    if (!isFloor && !st.hasIncome) return false;
    if (st.gen - st.dem < 2) return false;
    let fdMax = 8;
    for (const e of g.enemies) {
      if (e.dead) continue;
      const efd = g.flow.at(Math.floor(e.gc), Math.floor(e.gr));
      if (efd > fdMax) fdMax = Math.min(24, efd + 2);
    }
    const lasers = g.towerList.filter((t) => t.key === "laser").length;
    const want = Math.round(2 + g.wave * (1 + g.spawns.length));
    if (lasers >= want) {
      this._laserStarved = false;
      return false;
    }
    let best = null, bs = Infinity;
    this.forEachCell((c, r) => {
      const fd = g.flow.at(c, r);
      if (fd < 2 || fd > fdMax) return;
      if (!g.canPlace("laser", c, r) || this._bad(c, r, "laser")) return;
      const score = fd * 10 + U.dist(c, r, g.core.c, g.core.r);
      if (score < bs) { bs = score; best = { c, r }; }
    });
    if (!best) { this._laserStarved = true; return false; } // ask addLink for room
    return !!this.place(g, "laser", best.c, best.r);
  },

  /* (f) chains: once 4+ lasers are up and the flow is stable (gen − demand ≥ 4),
   * feed rear lasers into the biggest cluster (≤ 4 feeders per receiver).
   * The 2 front lasers (highest flow distance = first contact) stay separate
   * so several targets can be engaged at once (Harvest tactic) — UNLESS far
   * enemies (teleporters hovering past single-tower range, sappers latched to
   * far links) are on the field: then the front-most laser gets the feeders,
   * because its ×1.25^n range is the only thing that reaches them. */
  addChain(g, es) {
    const lasers = g.towerList.filter((t) => t.key === "laser" && t.done);
    if (lasers.length < 4 || es.gen - es.demand < 4) return false;
    const fd = (t) => g.flow.at(t.c, t.r);
    const unlinked = lasers.filter((l) => !l.linkTo);
    if (unlinked.length < 4) return false;
    let farFd = 0, reach = 0;
    for (const e of g.enemies) {
      if (!e.dead) farFd = Math.max(farFd, g.flow.at(Math.floor(e.gc), Math.floor(e.gr)));
    }
    for (const l of lasers) reach = Math.max(reach, fd(l) + l.effRange);
    const farCampers = farFd > reach + 2 || !!this._stall;
    const sorted = unlinked.slice().sort((a, b) => fd(b) - fd(a));
    let front, pool, receiverOrder;
    if (farCampers) {
      // feed the FRONT-MOST laser: extended range reaches the far campers
      front = new Set();
      pool = sorted.filter((l) => fd(l) >= farFd - 10);
      receiverOrder = (a, b) => fd(b) - fd(a);
    } else {
      front = new Set(sorted.slice(0, 2));
      pool = sorted.filter((l) => !front.has(l));
      receiverOrder = (a, b) => (b.boost.n - a.boost.n) || (fd(a) - fd(b));
    }
    const receivers = pool
      .filter((l) => l.boost.n < 4)
      .sort(receiverOrder);
    for (const R of receivers) {
      let feeder = null, bd = Infinity;
      for (const f of pool) {
        if (f === R || f.linkTo) continue;
        const d = U.dist(f.c, f.r, R.c, R.r);
        if (d > LINK_RANGE) continue;
        if (d < bd) { bd = d; feeder = f; }
      }
      if (feeder) return !!g.linkLaser(feeder, R);
    }
    return false;
  },

  /* (g) upgrades once credits pile up (> 150): laser → plant → harvester.
   * Plant tiers are skipped while the flow already runs a big surplus —
   * over-production burns links out just like undersized wiring. */
  upgradeStuff(g, st) {
    if (g.credits <= 150) return;
    const order = ["laser", "plant", "harvester"];
    for (const key of order) {
      if (key === "plant" && st.gen - st.dem > 10) continue;
      const cand = g.towerList
        .filter((t) => t.key === key && t.tier < 2 && g.credits >= t.def.upCost[t.tier])
        .sort((a, b) => (b.tier - a.tier) ||
          (U.dist(a.c, a.r, g.core.c, g.core.r) - U.dist(b.c, b.r, g.core.c, g.core.r)));
      if (cand[0]) { g.upgrade(cand[0]); return; }
    }
  },

  /* =============================== helpers =============================== */

  /* idle drains / generation of buildings still under construction — the flow
   * gates must see them, or the grid brownouts right after a build spree */
  pendingDemand(g) {
    let d = 0;
    for (const t of g.towerList) {
      if (t.done) continue;
      if (t.key === "harvester") d += 4;
      else if (t.key === "laser") d += 2;
      else if (t.key === "missile") d += 3;
      else if (t.key === "link") d += 0.5;
    }
    return d;
  },

  pendingGen(g) {
    return g.towerList.filter((t) => t.key === "plant" && !t.done).length * 10;
  },

  /* place + undo. Before paying: never put a building right next to a living
   * moving enemy — that boxes it into a pocket (flow still finds a way out for
   * the SPAWN, but the enemy is physically walled and parks forever). Latched
   * sappers are exempt: they never move, and getting a weapon next to them is
   * the point. After paying: if the new building seals ANY spawn off from the
   * core, sell it immediately and blacklist the cell (lesson 5). */
  place(g, type, c, r) {
    for (const e of g.enemies) {
      if (e.dead || e.def.sapper) continue;
      if (Math.abs(e.gc - (c + 0.5)) <= 1.5 && Math.abs(e.gr - (r + 0.5)) <= 1.5) return null;
    }
    const t = g.place(type, c, r);
    if (!t) return null;
    for (const s of g.spawns) {
      if (g.flow.at(s.c, s.r) < 0) {
        g.sell(t);
        this._badSpots.add(type + "|" + c + "," + r);
        return null;
      }
    }
    return t;
  },

  _bad(c, r, type) { return this._badSpots.has(type + "|" + c + "," + r); },

  forEachCell(fn) {
    for (let r = 0; r < CFG.ROWS; r++)
      for (let c = 0; c < CFG.COLS; c++) fn(c, r);
  },
};
