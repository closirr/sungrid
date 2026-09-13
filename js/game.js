/* SUNGRID — core game logic: map, energy-grid flow, placement, economy.
 * Phase 3: energy flow + overload. Placement/building chains come in phase 4,
 * enemies/waves in phase 5. */
"use strict";

const LINK_RANGE = 3.5;   // max distance of a laser→laser feed link, cells

class Game {
  constructor(levelIdx) {
    this.levelIdx = levelIdx;
    this.endless = levelIdx === -1;
    this.level = this.endless ? ENDLESS : LEVELS[levelIdx];
    this.parseMap();

    this.towers = new Array(CFG.COLS * CFG.ROWS).fill(null);
    this.towerList = [];
    this.enemies = [];       // phase 5
    this.shells = [];
    this.particles = [];
    this.floaters = [];

    this.credits = CFG.START_CREDITS;
    this.coreMax = this.level.coreHp || 100;
    this.coreHp = this.coreMax;
    this.core = { c: this._coreC, r: this._coreR };

    this.wave = 0;
    this.state = "build";    // build | wave | won | lost
    this.breakT = CFG.FIRST_BREAK;

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
          if (U.dist(b.c, b.r, n.c, n.r) <= Math.min(b.nodeRange, n.range) + 0.01) {
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
    if (this.credits < def.cost) { Snd.error(); UI.toast("Not enough credits!"); return false; }
    this.credits -= def.cost;
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
    this.credits += refund;
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
    if (this.credits < cost) { Snd.error(); UI.toast("Not enough credits!"); return; }
    this.credits -= cost;
    tower.invested += cost;
    tower.tier++;
    tower.maxHp = tower.def.hp + tower.tier * 60;
    tower.hp = tower.maxHp;
    this.recomputeNetwork();
    this.recomputeChains();
    Snd.upgrade();
  }

  /* ---------- laser chains (full logic in phase 4; API stubs) ---------- */
  recomputeChains() {}
  linkLaser(feeder, receiver) { return false; }   // phase 4
  unlinkLaser(feeder) {}                          // phase 4
  unlinkAll() {}                                  // phase 4

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
      if (!t.done) continue;
      // idle drains (phase 4 adds firing demand on top): laser 2, missile 3, harvester full, link 0.5
      const drain = t.key === "laser" ? 2 : t.key === "missile" ? 3 : t.key === "harvester" ? t.t.drain : t.key === "link" ? 0.5 : 0;
      if (drain > 0) consumers.push({ tower: t, want: drain });
    }

    /* relay adjacency: two relays joined when mutually in range */
    const n = relays.length;
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (U.dist(relays[i].c, relays[i].r, relays[j].c, relays[j].r) <= Math.min(relays[i].range, relays[j].range) + 0.01) {
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
    for (const nd of relays) if (nd.tower && nd.tower.key === "plant") nd.tower.online = false;
    for (const i of srcIdx) if (i !== 0 && onGrid(i) && relays[i].tower) relays[i].tower.online = true;

    const edgeFlow = new Map(); // "i-j" (i<j) → e/s carried
    const addEdgeFlow = (a, b, f) => {
      const k = a < b ? a + "-" + b : b + "-" + a;
      edgeFlow.set(k, (edgeFlow.get(k) || 0) + f);
    };

    /* consumers pull along their shortest source path (closest loads win) */
    let allocated = 0;
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
      const alloc = Math.min(cs.want, Math.max(0, gridGen - allocated));
      allocated += alloc;
      t._supplyT = alloc / cs.want;
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
  income() {
    let inc = 0;
    for (const t of this.towerList) {
      if (t.key === "harvester" && t.done) inc += t.t.rate * (this.terr[U.idx(t.c, t.r)] === 3 ? 1.75 : 1);
    }
    return inc;
  }

  /* energy produced / requested per second (HUD summary) */
  energyStats() {
    return { gen: this._gen || 0, demand: this._demand || 0 };
  }

  /* ---------- fx ---------- */
  spawnBurst(x, y, color, n, opts = {}) {
    if (this.particles.length > 320) return;
    for (let i = 0; i < n; i++) this.particles.push(new Particle(x, y, color, opts));
  }

  /* ---------- main update ---------- */
  update(rawDt) {
    if (this.state === "won" || this.state === "lost") {
      this.updateFx(rawDt);
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;

    // construction: faster with better supply
    for (const t of this.towerList) {
      if (!t.done) {
        t.built += dt / U.lerp(CFG.BUILD_MAX, CFG.BUILD_MIN, t.supply);
        if (t.built >= 1) {
          t.built = 1;
          this.recomputeNetwork();
          this.recomputeFlow();
        }
      } else if (t.key === "harvester") {
        this.credits += t.t.rate * (this.terr[U.idx(t.c, t.r)] === 3 ? 1.75 : 1) * dt * t.supply;
      }
    }

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
        const sp = ISO.px(p.c, p.r);
        // phase 5: damage enemies in aoe
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

  /* ---------- end states (used from phase 5 on) ---------- */
  win() {
    this.state = "won";
    const pct = this.coreHp / this.coreMax;
    this.stars = pct >= 0.8 ? 3 : pct >= 0.4 ? 2 : 1;
    if (!this.endless) Save.completeLevel(this.levelIdx, this.stars, LEVELS.length);
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
