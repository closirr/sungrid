/* SUNGRID — core game logic: map, energy-grid geometry, placement, economy.
 * Phase 2: grid + placement + build progress (energy flow lands in phase 3,
 * laser chains phase 4, enemies/waves phase 5). */
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
    this.netNodes = [];      // [{c, r, range, tower|null}]
    this.shake = 0;
    this.time = 0;
    this.kills = 0;

    this.placing = null;     // building type being placed
    this.linkFrom = null;    // laser being linked (phase 4)
    this.selected = null;
    this.hover = { c: -1, r: -1 };

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

  /* ---------- power network geometry ---------- */
  /* Nodes = core + built plants + built links that join the flood from the core. */
  recomputeNetwork() {
    this.netNodes = [{ c: this.core.c, r: this.core.r, range: CFG.CORE_RANGE, tower: null }];
    const candidates = this.towerList.filter((t) => t.done && (t.key === "plant" || t.key === "link"));
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

  /* ---------- economy ---------- */
  income() {
    let inc = 0;
    for (const t of this.towerList) {
      if (t.key === "harvester" && t.done) inc += t.t.rate * (this.terr[U.idx(t.c, t.r)] === 3 ? 1.75 : 1);
    }
    return inc;
  }

  /* energy produced / requested per second (real flow model in phase 3) */
  energyStats() {
    let gen = CFG.CORE_GEN;
    let demand = 0;
    for (const t of this.towerList) {
      if (!t.done) continue;
      if (t.key === "plant" && t.online) gen += t.t.gen;
      else if (t.key === "harvester") demand += t.t.drain;
      else if (t.key === "laser") demand += t.t.drain * 0.5; // firing duty cycle estimate
      else if (t.key === "missile") demand += t.t.drain * 0.5;
      else if (t.key === "link") demand += 0.5;
    }
    return { gen, demand };
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

    // construction: faster with better supply (phase 3 wires real supplyRatio)
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
