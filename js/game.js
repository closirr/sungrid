/* SUNGRID — core game logic: map, energy-grid flow, placement, economy.
 * Phase 3: energy flow + overload. Placement/building chains come in phase 4,
 * enemies/waves in phase 5. */
"use strict";

const LINK_RANGE = 3.5;   // max distance of a laser→laser feed link, cells

class Game {
  constructor(levelIdx, mode) {
    this.levelIdx = levelIdx;
    this.mode = mode || (levelIdx === -1 ? "endless" : "campaign"); // campaign | wave | endless
    this.endless = this.mode === "endless";
    this.waveMode = this.mode === "wave";
    this.level = this.mode === "campaign" ? LEVELS[levelIdx] : ENDLESS;
    this.wavesTotal = this.waveMode ? 10 : (this.endless ? Infinity : this.level.waves);
    this.parseMap();

    this.towers = new Array(CFG.COLS * CFG.ROWS).fill(null);
    this.towerList = [];
    this.enemies = [];
    this.shells = [];
    this.particles = [];
    this.floaters = [];

    this.energy = CFG.START_ENERGY;
    this.coreMax = this.level.coreHp || 100;
    this.coreHp = this.coreMax;
    this.core = { c: this._coreC, r: this._coreR };

    this.wave = 0;
    this.state = "build";    // build | wave | won | lost
    this.breakT = CFG.FIRST_BREAK;
    this.runTime = 0;        // total clock (wave-mode medal)

    this.speed = 1;
    this.flow = new FlowField();
    this.netNodes = [];      // [{c, r, range, tower|null}] — build-radius anchors
    this.shake = 0;
    this.time = 0;
    this.kills = 0;

    this.placing = null;     // building type being placed
    this.linkFrom = null;    // laser being linked (phase 4)
    this.selected = null;
    this.hover = { c: -1, r: -1 };

    this.etickT = 0;
    this.flowEdges = [];     // [{a, b, flow, heat}] — atom renderer input
    this._gen = CFG.CORE_GEN;
    this._demand = 0;

    this.recomputeNetwork();
    this.recomputeFlow();
  }

  parseMap() {
    const { COLS, ROWS } = CFG;
    this.terr = new Uint8Array(COLS * ROWS); // 0 ground, 1 rock, 2 mineral, 3 rich
    this.spawns = [];
    this._coreC = 10; this._coreR = 10;
    const m = this.level.map;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = m[r][c];
        const i = r * COLS + c;
        if (ch === "#") this.terr[i] = 1;
        else if (ch === "M") this.terr[i] = 2;
        else if (ch === "W") this.terr[i] = 3;
        else if (ch === "S") this.spawns.push({ c, r });
        else if (ch === "K") { this._coreC = c; this._coreR = r; }
      }
    }
  }

  /* ---------- power network geometry (build-radius anchors) ---------- */
  recomputeNetwork() {
    this.netNodes = [{ c: this.core.c, r: this.core.r, range: CFG.CORE_RANGE, tower: null }];
    const candidates = this.towerList.filter((t) => t.done && (t.key === "plant" || t.key === "link"));
    for (const b of candidates) b._inNet = false; // fresh flood every pass
    let added = true;
    while (added) {
      added = false;
      for (const b of candidates) {
        if (b._inNet) continue;
        for (const n of this.netNodes) {
          // a node joins when the EXISTING grid reaches it (core radius 3.5 > link 2.5)
          if (U.dist(b.c, b.r, n.c, n.r) <= n.range + 0.01) {
            b._inNet = true;
            this.netNodes.push({ c: b.c, r: b.r, range: b.nodeRange, tower: b });
            added = true;
            break;
          }
        }
      }
    }
    for (const b of candidates) b.online = !!b._inNet;
  }

  inNetwork(c, r) {
    for (const n of this.netNodes) {
      if (U.dist(c, r, n.c, n.r) <= n.range + 0.01) return true;
    }
    return false;
  }

  /* ---------- pathing ---------- */
  recomputeFlow() {
    // bombs don't block: enemies walk onto them and set them off
    const blocked = (i) => this.terr[i] === 1 || !!(this.towers[i] && this.towers[i].key !== "bomb");
    this.flow.compute(this.core, (i) => !blocked(i));
  }

  /* ---------- placement ---------- */
  canPlace(type, c, r) {
    if (!U.inBounds(c, r)) return false;
    const i = U.idx(c, r);
    const terr = this.terr[i];
    if (terr === 1) return false;
    if (this.towers[i]) return false;
    if (c === this.core.c && r === this.core.r) return false;
    for (const s of this.spawns) if (s.c === c && s.r === r) return false;
    // harvesters go ON deposits; everything else on plain ground only
    if (type === "harvester") { if (terr < 2) return false; }
    else if (terr !== 0) return false;
    for (const e of this.enemies) {
      if (!e.dead && Math.floor(e.gc) === c && Math.floor(e.gr) === r) return false;
    }
    return this.inNetwork(c, r);
  }

  place(type, c, r) {
    if (!this.canPlace(type, c, r)) { Snd.error(); return false; }
    const def = TOWERS[type];
    if (this.energy < def.cost) { Snd.error(); UI.toast("Not enough energy!"); return false; }
    this.energy -= def.cost;
    const t = new Tower(type, c, r);
    this.towers[U.idx(c, r)] = t;
    this.towerList.push(t);
    this.recomputeNetwork();
    this.recomputeFlow();
    Snd.place();
    return t;
  }

  sell(tower) {
    if (!tower || tower.dead) return;
    const refund = Math.round(tower.invested * CFG.SELL_RATIO);
    this.energy += refund;
    this.removeTower(tower);
    const p = ISO.px(tower.c, tower.r);
    this.floaters.push(new Floater(p.x, p.y - 30, "+" + refund, "#ffd94d"));
    Snd.sell();
  }

  removeTower(tower) {
    tower.dead = true;
    const i = U.idx(tower.c, tower.r);
    if (this.towers[i] === tower) this.towers[i] = null;
    this.towerList = this.towerList.filter((t) => t !== tower);
    for (const t of this.towerList) {
      if (t.linkTo === tower) t.linkTo = null;
      t.feeders = t.feeders.filter((f) => f !== tower);
    }
    if (this.selected === tower) this.selected = null;
    if (this.linkFrom === tower) this.linkFrom = null;
    this.recomputeNetwork();
    this.recomputeFlow();
    this.recomputeChains();
  }

  onTowerDestroyed(tower) {
    const p = ISO.px(tower.c, tower.r);
    this.spawnBurst(p.x, p.y - 10, tower.def.color, 14);
    UI.toast(tower.def.name + " destroyed!");
    this.removeTower(tower);
    Snd.boom(false);
  }

  upgrade(tower) {
    if (!tower || tower.tier >= 2) return;
    const cost = tower.def.upCost[tower.tier];
    if (this.energy < cost) { Snd.error(); UI.toast("Not enough energy!"); return; }
    this.energy -= cost;
    tower.invested += cost;
    tower.tier++;
    tower.maxHp = tower.def.hp + tower.tier * 60;
    tower.hp = tower.maxHp;
    this.recomputeNetwork();
    this.recomputeChains();
    Snd.upgrade();
  }

  /* ---------- laser chains (the USP) ----------
   * A laser can stop shooting and FEED another laser: the receiver gains
   * ×1.5 DPS and ×1.25 range per feeder (compounding through chains:
   * A→B→C counts as two feeders on C). The focused power ramps 0→100% over
   * CFG.RAMP_TIME seconds. Chains cap at CFG.MAX_FEEDERS. */
  recomputeChains() {
    const lasers = this.towerList.filter((t) => t.key === "laser" && !t.dead);
    for (const t of lasers) {
      t._boost = { n: 0, mult: 1, rangeMult: 1 };
      t.feeders = [];
    }
    for (const root of lasers) {
      if (root.linkTo) continue; // feeders don't shoot themselves
      const found = [];
      const seen = new Set([root]);
      let frontier = [root];
      while (frontier.length && found.length < CFG.MAX_FEEDERS) {
        const next = [];
        for (const node of frontier) {
          for (const f of lasers) {
            if (seen.has(f) || f.linkTo !== node) continue;
            seen.add(f);
            found.push(f);
            next.push(f);
            if (found.length >= CFG.MAX_FEEDERS) break;
          }
          if (found.length >= CFG.MAX_FEEDERS) break;
        }
        frontier = next;
      }
      root.feeders = found;
      if (found.length) {
        root._boost = {
          n: found.length,
          mult: Math.pow(1.5, found.length),
          rangeMult: Math.pow(1.25, found.length),
        };
      }
    }
  }

  linkLaser(feeder, receiver) {
    if (!feeder || !receiver || feeder === receiver) return false;
    if (feeder.key !== "laser" || receiver.key !== "laser") return false;
    if (feeder.dead || receiver.dead || !feeder.done || !receiver.done) return false;
    if (U.dist(feeder.c, feeder.r, receiver.c, receiver.r) > LINK_RANGE + 0.01) return false;
    // no cycles: the receiver's chain must not reach back to the feeder
    let v = receiver;
    let guard = 0;
    while (v && guard++ < 64) {
      if (v === feeder) return false;
      v = v.linkTo;
    }
    if (receiver.boost.n + 1 > CFG.MAX_FEEDERS) return false;
    feeder.linkTo = receiver;
    feeder.ramp = 0;
    this.recomputeChains();
    return true;
  }

  unlinkLaser(feeder) {
    if (!feeder || feeder.key !== "laser" || !feeder.linkTo) return false;
    feeder.linkTo = null;
    feeder.ramp = 0;
    this.recomputeChains();
    return true;
  }

  unlinkAll() {
    let n = 0;
    for (const t of this.towerList) {
      if (t.key === "laser" && t.linkTo) { t.linkTo = null; t.ramp = 0; n++; }
    }
    if (n) this.recomputeChains();
    return n;
  }

  /* ---------- energy flow ----------
   * Every ETICK the sources (core + plants wired back to the core) push their
   * generation into the relay graph; consumers pull along their shortest source
   * path — allocation is deliberately NOT capped per link: carrying more than a
   * link's rating HEATS it (0..100). Surplus generation (G > demand) circulates
   * through the tree as well, so over-building plants also overloads thin grids.
   * heat ≥ HEAT_BURN → red atoms + bell. heat ≥ HEAT_MAX → burnout: the link
   * explodes, everything past it goes offline until rebuilt. */
  updateEnergy(dt) {
    this.etickT -= dt;
    if (this.etickT <= 0) {
      this.etickT += CFG.ETICK;
      this.energyTick();
    }
    // smooth supply toward the tick's target: fast attack, slow release
    for (const t of this.towerList) {
      const target = t._supplyT || 0;
      const step = target > t.supply ? 8 * dt : 2.5 * dt;
      t.supply += U.clamp(target - t.supply, -step, step);
    }
  }

  energyTick() {
    /* nodes */
    const relays = [{ c: this.core.c, r: this.core.r, range: CFG.CORE_RANGE, gen: CFG.CORE_GEN, tower: null }];
    for (const t of this.towerList) {
      if (!t.done) continue;
      if (t.key === "plant") relays.push({ c: t.c, r: t.r, range: t.nodeRange, gen: t.t.gen, tower: t });
      else if (t.key === "link") relays.push({ c: t.c, r: t.r, range: t.nodeRange, gen: 0, tower: t });
    }
    const consumers = [];
    for (const t of this.towerList) {
      // construction sites pull atoms from the grid — nothing builds on a timer
      if (!t.done) { consumers.push({ tower: t, want: CFG.BUILD_RATE, building: true }); continue; }
      // idle + active drains (energy = speed: firing hardware pulls more)
      let drain = 0;
      if (t.key === "harvester") drain = t.t.drain;
      else if (t.key === "link") drain = 0.5;
      else if (t.key === "laser") drain = 2 + (t.firing ? 4 : 0);
      else if (t.key === "missile") drain = 3 + (t.firing ? 7 : 0);
      else if (t.key === "bomb" && t.charging) drain = 8;
      if (drain > 0) consumers.push({ tower: t, want: drain });
    }

    /* relay adjacency: two relays joined when either reaches the other */
    const n = relays.length;
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (U.dist(relays[i].c, relays[i].r, relays[j].c, relays[j].r) <= Math.max(relays[i].range, relays[j].range) + 0.01) {
          adj[i].push(j); adj[j].push(i);
        }
      }
    }

    /* BFS from the core (node 0) — the grid is exactly what the core reaches.
     * A plant feeds the grid only when the core can reach it. */
    const srcIdx = [];
    relays.forEach((nd, i) => { if (nd.gen > 0 && i !== 0) srcIdx.push(i); });
    const dist = new Array(n).fill(-1);
    const parent = new Array(n).fill(-1);
    const bfs = [0];
    dist[0] = 0;
    for (let head = 0; head < bfs.length; head++) {
      const v = bfs[head];
      for (const w of adj[v]) {
        if (dist[w] !== -1) continue;
        dist[w] = dist[v] + 1;
        parent[w] = v;
        bfs.push(w);
      }
    }
    const onGrid = (i) => dist[i] !== -1;

    let gridGen = CFG.CORE_GEN;
    for (const i of srcIdx) if (i !== 0 && onGrid(i)) gridGen += relays[i].gen;

    /* harvesters are generators too: minerals in → energy out, onto the grid.
     * Output scales with the PREVIOUS tick's supply (breaks the feedback loop). */
    for (const t of this.towerList) {
      if (t.key !== "harvester" || !t.done) continue;
      let attached = false;
      for (let i = 0; i < n && !attached; i++) {
        if (onGrid(i) && U.dist(t.c, t.r, relays[i].c, relays[i].r) <= relays[i].range + 0.01) attached = true;
      }
      if (attached) gridGen += t.t.rate * (this.terr[U.idx(t.c, t.r)] === 3 ? 1.75 : 1) * t.supply;
    }

    for (const nd of relays) if (nd.tower && nd.tower.key === "plant") nd.tower.online = false;
    for (const i of srcIdx) if (i !== 0 && onGrid(i) && relays[i].tower) relays[i].tower.online = true;

    const edgeFlow = new Map(); // "i-j" (i<j) → e/s carried
    const addEdgeFlow = (a, b, f) => {
      const k = a < b ? a + "-" + b : b + "-" + a;
      edgeFlow.set(k, (edgeFlow.get(k) || 0) + f);
    };

    /* sappers first: a latched link drinks the grid and blacks out everything
     * whose path runs through it */
    let allocated = 0;
    const sapped = new Array(n).fill(false);
    for (const e of this.enemies) {
      if (e.key !== "sapper" || e.dead || !e.latch || e.latch.dead) continue;
      const idx = relays.findIndex((nd) => nd.tower === e.latch);
      if (idx === -1 || !onGrid(idx)) continue;
      sapped[idx] = true;
      const alloc = Math.min(ENEMIES.sapper.drain, Math.max(0, gridGen - allocated));
      allocated += alloc;
      e.drainRate = alloc;
      let v = idx;
      while (v !== -1 && parent[v] !== -1) {
        addEdgeFlow(v, parent[v], alloc);
        v = parent[v];
      }
    }

    /* consumers pull along their shortest source path (closest loads win) */
    const consumerEdges = []; // atoms flowing the last hop into the building
    for (const cs of consumers) {
      const t = cs.tower;
      let best = -1, bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!onGrid(i)) continue;
        const d = U.dist(t.c, t.r, relays[i].c, relays[i].r);
        if (d <= relays[i].range + 0.01 && dist[i] * 100 + d < bd) { bd = dist[i] * 100 + d; best = i; }
      }
      if (best === -1) { t._supplyT = 0; continue; }
      // a sapped link on the path cuts this consumer off completely
      let pv = best, sapBlocked = false;
      while (pv !== -1) { if (sapped[pv]) { sapBlocked = true; break; } pv = parent[pv]; }
      if (sapBlocked) { t._supplyT = 0; continue; }
      const alloc = Math.min(cs.want, Math.max(0, gridGen - allocated));
      allocated += alloc;
      t._supplyT = alloc / cs.want;
      t._alloc = alloc; // construction sites turn this into build progress
      if (alloc > 0.05 && (t.c !== relays[best].c || t.r !== relays[best].r)) {
        consumerEdges.push({ a: { c: relays[best].c, r: relays[best].r }, b: { c: t.c, r: t.r }, flow: alloc, heat: 0 });
      }
      let v = best;
      while (v !== -1 && parent[v] !== -1) {
        addEdgeFlow(v, parent[v], alloc);
        v = parent[v];
      }
    }

    /* surplus circulates from the core down the BFS tree — over-production
     * heats thin grids just like undersized wiring */
    const surplus = Math.max(0, gridGen - allocated);
    if (surplus > 0.01) {
      const children = Array.from({ length: n }, () => []);
      for (let v = 0; v < n; v++) if (parent[v] !== -1) children[parent[v]].push(v);
      const q2 = [{ node: 0, amt: surplus }];
      let guard = 0;
      while (q2.length && guard++ < 500) {
        const { node, amt } = q2.shift();
        const kids = children[node];
        if (!kids.length) continue;
        const share = amt / kids.length;
        for (const k of kids) {
          addEdgeFlow(node, k, share);
          q2.push({ node: k, amt: share });
        }
      }
    }

    /* link heat: a link carries max(flow to its parent, sum of children flows) —
     * pass-through counts once, aggregation sums */
    const kids = Array.from({ length: n }, () => []);
    for (let v = 0; v < n; v++) if (parent[v] !== -1) kids[parent[v]].push(v);
    const edgeKey = (a, b) => (a < b ? a + "-" + b : b + "-" + a);
    for (let i = 0; i < n; i++) {
      const t = relays[i].tower;
      if (!t || t.key !== "link") continue;
      const parentFlow = parent[i] !== -1 ? (edgeFlow.get(edgeKey(i, parent[i])) || 0) : 0;
      let childSum = 0;
      for (const k of kids[i]) childSum += (edgeFlow.get(edgeKey(i, k)) || 0);
      const load = Math.max(parentFlow, childSum);
      const over = load - t.t.cap;
      const wasHot = t.heat >= CFG.HEAT_BURN;
      if (over > 0) t.heat = U.clamp(t.heat + over * CFG.K_HEAT * CFG.ETICK, 0, CFG.HEAT_MAX);
      else t.heat = U.clamp(t.heat - CFG.K_COOL * CFG.ETICK, 0, CFG.HEAT_MAX);
      if (!wasHot && t.heat >= CFG.HEAT_BURN) {
        if (typeof Snd.overcharge === "function") Snd.overcharge();
        UI.toast("Link overcharged! Add links or cut production");
      }
      if (t.heat >= CFG.HEAT_MAX) this.burnOutLink(t);
    }

    /* edges for the atom renderer */
    this.flowEdges = [];
    for (const [k, f] of edgeFlow) {
      const [i, j] = k.split("-").map(Number);
      this.flowEdges.push({
        a: { c: relays[i].c, r: relays[i].r },
        b: { c: relays[j].c, r: relays[j].r },
        flow: f,
        heat: Math.max(relays[i].tower ? relays[i].tower.heat : 0, relays[j].tower ? relays[j].tower.heat : 0),
      });
    }
    for (const ce of consumerEdges) this.flowEdges.push(ce);

    /* HUD totals */
    let demand = 0;
    for (const cs of consumers) demand += cs.want;
    for (const e of this.enemies) {
      if (e.key === "sapper" && e.latch && !e.latch.dead) demand += ENEMIES.sapper.drain;
    }
    this._gen = gridGen;
    this._demand = demand;
  }

  burnOutLink(t) {
    t.heat = 0;
    const p = ISO.px(t.c, t.r);
    this.spawnBurst(p.x, p.y - 12, "#ff9a4d", 26, { speed: 190 });
    this.spawnBurst(p.x, p.y - 12, "#ffd94d", 14, { speed: 120 });
    this.shake = Math.max(this.shake, 6);
    if (typeof Snd.burnout === "function") Snd.burnout();
    UI.toast("Energy Link BURNED OUT!");
    // the blast damages nearby buildings (enemies join in phase 5)
    for (const o of this.towerList) {
      if (o === t || o.dead) continue;
      if (U.dist(o.c, o.r, t.c, t.r) <= 1.6) o.damage(60, this);
    }
    this.removeTower(t);
  }

  /* ---------- economy ---------- */
  /* net energy flow: what's left to bank into the pool each second */
  income() {
    return this.energyStats().net;
  }

  /* energy produced / requested per second (HUD summary) */
  energyStats() {
    const gen = this._gen || 0, demand = this._demand || 0;
    return { gen, demand, net: gen - demand };
  }

  /* ---------- waves ----------
   * Threat budget: 10 × threat^1.2 × level.mult, threat = wave number.
   * The pool comes from the level's enemy list, gated by unlockWave;
   * boss closes the final campaign wave / every 10th endless wave. */
  buildComposition(wave) {
    let budget = wavePoints(wave, this.level.mult || 1);
    const pool = (this.level.enemies && this.level.enemies.length)
      ? this.level.enemies.slice()
      : ["crawler"];
    const list = [];
    const bossNow = pool.includes("boss") &&
      (this.endless ? wave % 10 === 0 : wave === this.level.waves);
    if (bossNow) { list.push("boss"); budget -= ENEMIES.boss.cost; }
    const avail = pool
      .filter((k) => { const d = ENEMIES[k]; return !d.boss && (d.unlockWave || 1) <= wave; })
      .sort((a, b) => ENEMIES[b].cost - ENEMIES[a].cost);
    if (!avail.length) avail.push("crawler");
    let guard = 0;
    while (budget > 0.4 && guard++ < 500) {
      const affordable = avail.filter((k) => ENEMIES[k].cost <= budget + 0.01);
      if (!affordable.length) break;
      // bias toward the strongest affordable type, with some jitter
      const key = affordable[Math.floor(Math.pow(Math.random(), 1.6) * affordable.length)];
      const def = ENEMIES[key];
      if (def.pack) {
        const cnt = U.randi(def.pack[0], def.pack[1]);
        for (let i = 0; i < cnt && budget > 0; i++) { list.push(key); budget -= def.cost; }
      } else {
        list.push(key);
        budget -= def.cost;
      }
    }
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  callWave(early = false) {
    if (this.state !== "build") return;
    if (early) {
      const bonus = Math.floor(this.breakT * CFG.CALL_BONUS);
      if (bonus > 0) {
        this.energy += bonus;
        const p = ISO.px(this.core.c, this.core.r);
        this.floaters.push(new Floater(p.x, p.y - 30, "+" + bonus, "#ffd94d"));
      }
    }
    this.wave++;
    const comp = this.buildComposition(this.wave);
    const interval = Math.max(0.55, 1.4 - this.wave * 0.05);
    let t = 0.3;
    this.pending = [];
    comp.forEach((key, i) => {
      const spawn = this.spawns[i % this.spawns.length];
      this.pending.push({ t, key, spawn });
      t += interval * (ENEMIES[key].pack ? 0.16 : 1) * U.rand(0.75, 1.25);
    });
    this.pending.sort((a, b) => a.t - b.t);
    this.waveT = 0;
    this.state = "wave";
    Snd.horn();
  }

  updateWaves(dt) {
    if (this.state === "build") {
      this.breakT -= dt;
      if (this.breakT <= 0) this.callWave(false);
    } else if (this.state === "wave") {
      this.waveT += dt;
      while (this.pending.length && this.pending[0].t <= this.waveT) {
        const item = this.pending.shift();
        this.enemies.push(new Enemy(item.key, item.spawn, this));
      }
      if (!this.pending.length && !this.enemies.length) {
        const bonus = 30 + 12 * this.wave;
        this.energy += bonus;
        const p = ISO.px(this.core.c, this.core.r);
        this.floaters.push(new Floater(p.x, p.y - 34, "+" + bonus + " WAVE BONUS", "#7dff9a"));
        const last = this.waveMode ? 10 : this.level.waves;
        if (!this.endless && this.wave >= last) this.win();
        else { this.state = "build"; this.breakT = CFG.WAVE_BREAK; }
      }
    }
  }

  /* ---------- combat ---------- */
  updateTowers(dt) {
    for (const t of this.towerList) {
      if (t.dead || !t.done) continue;
      t.pulse += dt;
      const sup = t.supply;
      switch (t.key) {
        case "laser": this.updateLaser(t, dt, sup); break;
        case "missile": this.updateMissile(t, dt, sup); break;
        case "bomb":
          t.charging = t.charge < BOMB_CHARGE;
          if (t.charging) t.charge = Math.min(BOMB_CHARGE, t.charge + 8 * sup * dt);
          break;
      }
      // self-repair runs at supply speed (energy = velocity, not on/off)
      if (t.hp < t.maxHp) t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.02 * sup * dt);
    }
  }

  laserFactor(e) { return e.def.laserResist !== undefined ? 1 - e.def.laserResist : 1; }

  acquireTarget(t) {
    const range = t.effRange;
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = U.dist2(t.c, t.r, e.gc, e.gr);
      if (d > range * range) continue;
      const fd = this.flow.at(Math.floor(e.gc), Math.floor(e.gr));
      const score = (fd < 0 ? 9999 : fd) * 10000 + d;
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }

  updateLaser(t, dt, sup) {
    t.firing = false;
    if (t.linkTo) {
      // feeder: focus the chain instead of shooting
      t.ramp = Math.min(1, t.ramp + dt / CFG.RAMP_TIME);
      t.beamHeat = Math.min(1, t.beamHeat + dt * 3);
      return;
    }
    t.ramp = t.boost.n ? Math.min(1, t.ramp + dt / CFG.RAMP_TIME)
                       : Math.max(0, t.ramp - dt / CFG.RAMP_TIME);
    t.retargetT = (t.retargetT || 0) - dt;
    if (!t.target || t.target.dead || t.retargetT <= 0 ||
        U.dist2(t.c, t.r, t.target.gc, t.target.gr) > t.effRange * t.effRange) {
      t.retargetT = 0.4;
      t.target = this.acquireTarget(t);
    }
    if (t.target && sup > 0.05) {
      t.firing = true;
      t.beamHeat = Math.min(1, t.beamHeat + dt * 6);
      const tp = ISO.px(t.target.gc, t.target.gr);
      const mp = ISO.px(t.c, t.r);
      t.face = Math.atan2(tp.y - mp.y, tp.x - mp.x);
      const mult = t.boost.n ? t.ramp : 1;
      this.damageEnemy(t.target, t.effDps * mult * (0.3 + 0.7 * sup) * dt * this.laserFactor(t.target));
    } else {
      t.beamHeat = Math.max(0, t.beamHeat - dt * 4);
    }
  }

  updateMissile(t, dt, sup) {
    t.cool -= dt * (0.4 + 0.6 * sup); // energy speeds the reload
    t.firing = t.cool > 0;
    if (t.cool > 0) return;
    const best = this.acquireTarget(t);
    if (best) {
      this.shells.push(new Shell(t, best.gc, best.gr, t.t.dmg, t.t.aoe));
      t.cool = t.t.rate;
      const tp = ISO.px(best.gc, best.gr), mp = ISO.px(t.c, t.r);
      t.face = Math.atan2(tp.y - mp.y, tp.x - mp.x);
      if (typeof Snd.missile === "function") Snd.missile();
      else Snd.tone(140, 0.12, "square", 0.1, 60);
      const p = ISO.px(t.c, t.r);
      this.spawnBurst(p.x, p.y - 16, "#ff9a4d", 4, { speed: 60 });
    }
  }

  detonateBomb(t) {
    if (!t || t.dead || t.key !== "bomb") return;
    const def = t.t;
    const p = ISO.px(t.c, t.r);
    this.spawnBurst(p.x, p.y - 10, "#ff5cf0", 30, { speed: 200 });
    this.spawnBurst(p.x, p.y - 10, "#ffd94d", 18, { speed: 140 });
    this.shake = Math.max(this.shake, 8);
    Snd.boom(true);
    for (const e of this.enemies) {
      if (!e.dead && U.dist2(t.c, t.r, e.gc, e.gr) <= (def.aoe + e.size) * (def.aoe + e.size)) {
        this.damageEnemy(e, def.dmg);
      }
    }
    this.removeTower(t);
  }

  damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp <= 0) {
      e.dead = true;
      if (e.latch) { e.latch._sapped = false; e.latch = null; } // release a latched sapper's link
      this.kills++; // kills score, they do NOT fund construction — the grid does
      const p = ISO.px(e.gc, e.gr);
      this.spawnBurst(p.x, p.y - 10, e.def.color, e.def.boss ? 40 : 10, { speed: e.def.boss ? 220 : 130 });
      if (e.def.boss) { Snd.boom(true); this.shake = Math.max(this.shake, 7); }
      else Snd.noise(0.12, 0.08, 1400);
    }
  }

  onCoreHit(dmg) {
    this.coreHp = Math.max(0, this.coreHp - dmg);
    this.shake = Math.max(this.shake, 6);
    const p = ISO.px(this.core.c, this.core.r);
    this.spawnBurst(p.x, p.y, "#ff6b57", 16, { speed: 160 });
    this.floaters.push(new Floater(p.x, p.y - 40, "-" + dmg, "#ff6b57"));
    Snd.coreHit();
    if (this.coreHp <= 0) this.lose();
  }

  /* test/tooling hook: drop an enemy at a spawn (real waves come in phase 5) */
  spawnTestEnemy(key, sc, sr) {
    this.enemies.push(new Enemy(key, { c: sc, r: sr }, this));
  }

  /* ---------- fx ---------- */
  spawnBurst(x, y, color, n, opts = {}) {
    if (this.particles.length > 320) return;
    for (let i = 0; i < n; i++) this.particles.push(new Particle(x, y, color, opts));
  }

  spawnHitParticles(x, y, color, n) {
    this.spawnBurst(x, y, color, n, { speed: 70 });
  }

  /* ---------- main update ---------- */
  update(rawDt) {
    if (this.state === "won" || this.state === "lost") {
      this.updateFx(rawDt);
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;
    this.runTime += dt;
    this.updateWaves(dt);

    // construction: atoms delivered by the grid ARE the build progress
    for (const t of this.towerList) {
      if (!t.done) {
        t.built += ((t._alloc || 0) * dt) / t.def.cost;
        if (t.built >= 1) {
          t.built = 1;
          t._alloc = 0;
          this.recomputeNetwork();
          this.recomputeFlow();
          this.recomputeChains();
        }
      }
    }

    // surplus production banks into the energy pool (the only building currency)
    const es = this.energyStats();
    if (es.net > 0) this.energy += es.net * dt;

    this.updateTowers(dt);
    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.updateEnergy(dt);
    this.updateShells(dt);
    this.updateFx(dt);
  }

  updateShells(dt) {
    for (const s of this.shells) {
      s.t += dt;
      if (s.t >= s.T) {
        s.done = true;
        const p = s.pos();
        for (const e of this.enemies) {
          if (!e.dead && U.dist2(p.c, p.r, e.gc, e.gr) <= (s.aoe + e.size) * (s.aoe + e.size)) {
            this.damageEnemy(e, s.dmg);
          }
        }
        const sp = ISO.px(p.c, p.r);
        this.spawnBurst(sp.x, sp.y, "#ff9a4d", 12, { speed: 150 });
        this.spawnBurst(sp.x, sp.y, "#ffd94d", 8, { speed: 90 });
        Snd.boom(false);
        this.shake = Math.max(this.shake, 3);
      }
    }
    this.shells = this.shells.filter((s) => !s.done);
  }

  updateFx(dt) {
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) f.update(dt);
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 22);
  }

  /* ---------- end states ---------- */
  win() {
    this.state = "won";
    if (this.waveMode) {
      // medal by the clock: gold / silver / bronze
      this.medal = this.runTime <= CFG.WAVE_GOLD ? 3 : this.runTime <= CFG.WAVE_SILVER ? 2 : 1;
      this.stars = this.medal;
      Save.setWaveBest(this.medal, Math.round(this.runTime));
    } else {
      const pct = this.coreHp / this.coreMax;
      this.stars = pct >= 0.8 ? 3 : pct >= 0.4 ? 2 : 1;
      Save.completeLevel(this.levelIdx, this.stars, LEVELS.length);
    }
    Snd.win();
    if (this.onWin) this.onWin();
  }

  lose() {
    if (this.state === "lost") return;
    this.state = "lost";
    if (this.endless) Save.setEndlessBest(this.wave);
    Snd.lose();
    if (this.onLose) this.onLose();
  }
}
