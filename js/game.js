/* SUNGRID — core game logic: economy, power network, prism chains, waves, combat */
"use strict";

const LINK_RANGE = 2.5; // prism → target distance in cells

class Game {
  constructor(levelIdx) {
    this.levelIdx = levelIdx;
    this.endless = levelIdx === -1;
    this.level = this.endless ? ENDLESS : LEVELS[levelIdx];
    this.parseMap();

    this.towers = new Array(CFG.COLS * CFG.ROWS).fill(null);
    this.towerList = [];
    this.enemies = [];
    this.shells = [];
    this.particles = [];
    this.floaters = [];

    this.energy = CFG.START_ENERGY;
    this.coreMax = this.level.coreHp;
    this.coreHp = this.coreMax;
    this.core = { c: this._coreC, r: this._coreR, x: U.cx(this._coreC), y: U.cy(this._coreR) };

    this.wave = 0;
    this.state = "build";           // build | wave | won | lost
    this.breakT = CFG.FIRST_BREAK;
    this.pending = [];              // spawn queue {t, key, spawn}
    this.waveT = 0;

    this.speed = 1;
    this.flow = new FlowField();
    this.netNodes = [];
    this.shake = 0;
    this.time = 0;
    this.kills = 0;

    this.placing = null;            // tower type being placed
    this.linkFrom = null;           // prism being re-linked
    this.selected = null;           // selected Tower
    this.hover = { c: -1, r: -1 };

    this.recomputeNetwork();
    this.recomputeFlow();
    this.recomputeLinks();
  }

  parseMap() {
    const { COLS, ROWS } = CFG;
    this.terr = new Uint8Array(COLS * ROWS); // 0 floor, 1 rock, 2 crystal, 3 rich
    this.spawns = [];
    this._coreC = 12; this._coreR = 7;
    const m = this.level.map;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = m[r][c];
        const i = r * COLS + c;
        if (ch === "#") this.terr[i] = 1;
        else if (ch === "C") this.terr[i] = 2;
        else if (ch === "R") this.terr[i] = 3;
        else if (ch === "S") this.spawns.push({ c, r });
        else if (ch === "K") { this._coreC = c; this._coreR = r; }
      }
    }
  }

  /* ---------- power network ---------- */
  recomputeNetwork() {
    this.netNodes = [{ c: this.core.c, r: this.core.r, range: CFG.CORE_RANGE }];
    const pylons = this.towerList.filter((t) => t.key === "pylon" && !t.dead);
    let added = true;
    while (added) {
      added = false;
      for (const p of pylons) {
        if (p._inNet) continue;
        for (const n of this.netNodes) {
          if (U.dist(p.c, p.r, n.c, n.r) <= p.t.range + 0.01) {
            p._inNet = true;
            this.netNodes.push({ c: p.c, r: p.r, range: p.t.range });
            added = true;
            break;
          }
        }
      }
    }
    for (const p of pylons) p.active = !!p._inNet;
  }

  inNetwork(c, r) {
    for (const n of this.netNodes) {
      if (U.dist(c, r, n.c, n.r) <= n.range + 0.01) return true;
    }
    return false;
  }

  /* ---------- pathing ---------- */
  recomputeFlow() {
    const blocked = (i) => this.terr[i] === 1 || !!this.towers[i];
    this.flow.compute(this.core, (i) => !blocked(i));
  }

  /* ---------- prism chains ---------- */
  recomputeLinks() {
    for (const t of this.towerList) {
      if (t.key === "laser") t._boost = { mult: 1, rangeAdd: 0, rateAdd: 0, n: 0 };
      if (t.key === "prism") t.active = false;
    }
    for (const L of this.towerList) {
      if (L.key !== "laser") continue;
      const prisms = [];
      const seen = new Set([L]);
      let frontier = [L];
      while (frontier.length && prisms.length < CFG.MAX_PRISMS) {
        const next = [];
        for (const node of frontier) {
          for (const p of this.towerList) {
            if (p.key !== "prism" || p.dead || seen.has(p) || p.linkTo !== node) continue;
            seen.add(p);
            prisms.push(p);
            next.push(p);
            if (prisms.length >= CFG.MAX_PRISMS) break;
          }
          if (prisms.length >= CFG.MAX_PRISMS) break;
        }
        frontier = next;
      }
      if (prisms.length) {
        let mult = 1;
        for (const p of prisms) mult *= p.t.mult;
        L._boost = { mult, rangeAdd: 0.4 * prisms.length, rateAdd: 0.08 * prisms.length, n: prisms.length };
        for (const p of prisms) p.active = true;
      }
    }
  }

  linkPrism(prism, target) {
    if (!prism || prism.key !== "prism") return false;
    if (!target || target === prism || (target.key !== "laser" && target.key !== "prism")) return false;
    if (U.dist(prism.c, prism.r, target.c, target.r) > LINK_RANGE + 0.01) return false;
    prism.linkTo = target;
    this.recomputeLinks();
    return true;
  }

  autoLink(prism) {
    let best = null, bestScore = Infinity;
    for (const t of this.towerList) {
      if (t === prism || t.dead) continue;
      if (t.key !== "laser" && t.key !== "prism") continue;
      const d = U.dist(prism.c, prism.r, t.c, t.r);
      if (d > LINK_RANGE) continue;
      // prefer lasers directly; then active prisms; then idle prisms
      const score = d + (t.key === "laser" ? 0 : t.active ? 0.6 : 2);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) { prism.linkTo = best; this.recomputeLinks(); }
  }

  /* ---------- placement ---------- */
  canPlace(type, c, r) {
    if (c < 0 || r < 0 || c >= CFG.COLS || r >= CFG.ROWS) return false;
    const i = r * CFG.COLS + c;
    if (this.towers[i] || this.terr[i] === 1) return false;
    if (c === this.core.c && r === this.core.r) return false;
    for (const s of this.spawns) if (s.c === c && s.r === r) return false;
    for (const e of this.enemies) {
      if (!e.dead && U.cellAt(e.x) === c && U.cellAt(e.y) === r) return false;
    }
    if (type === "extractor") return this.terr[i] >= 2;
    if (type === "wall") return true;
    return this.inNetwork(c, r);
  }

  place(type, c, r) {
    if (!this.canPlace(type, c, r)) { Snd.error(); return false; }
    const def = TOWERS[type];
    if (this.energy < def.cost) { Snd.error(); UI.toast("Not enough energy!"); return false; }
    this.energy -= def.cost;
    const t = new Tower(type, c, r);
    if (type === "extractor" && this.terr[r * CFG.COLS + c] === 3) t.rich = true;
    this.towers[r * CFG.COLS + c] = t;
    this.towerList.push(t);
    this.recomputeNetwork();
    this.recomputeFlow();
    if (type === "prism") this.autoLink(t);
    this.recomputeLinks();
    Snd.place();
    return t;
  }

  sell(tower) {
    if (!tower || tower.dead) return;
    const refund = Math.round(tower.invested * 0.7);
    this.energy += refund;
    this.removeTower(tower);
    this.floaters.push(new Floater(tower.x, tower.y, "+" + refund, "#ffd94d"));
    Snd.sell();
  }

  removeTower(tower) {
    tower.dead = true;
    const i = tower.r * CFG.COLS + tower.c;
    if (this.towers[i] === tower) this.towers[i] = null;
    this.towerList = this.towerList.filter((t) => t !== tower);
    for (const t of this.towerList) if (t.linkTo === tower) t.linkTo = null;
    if (this.selected === tower) this.selected = null;
    if (this.linkFrom === tower) this.linkFrom = null;
    this.recomputeNetwork();
    this.recomputeFlow();
    this.recomputeLinks();
  }

  onTowerDestroyed(tower) {
    this.spawnBurst(tower.x, tower.y, tower.def.color, 14);
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
    if (tower.key === "wall") { tower.maxHp = tower.t.hp; tower.hp = tower.maxHp; }
    if (tower.key === "pylon") this.recomputeNetwork();
    this.recomputeLinks();
    Snd.upgrade();
  }

  /* ---------- waves ---------- */
  buildComposition(wave) {
    let budget = wavePoints(wave, this.level.mult);
    const list = [];
    if (wave % 5 === 0) {
      const bosses = this.levelIdx === 19 && wave === this.level.waves ? 3 : 1;
      for (let i = 0; i < bosses; i++) list.push("destroyer");
      budget -= bosses * ENEMIES.destroyer.cost;
    }
    const pool = [];
    for (const key in ENEMIES) {
      const def = ENEMIES[key];
      if (!def.boss && def.unlockWave <= wave) pool.push(key);
    }
    let guard = 0;
    while (budget > 0.45 && guard++ < 400) {
      const key = U.choice(pool);
      const def = ENEMIES[key];
      if (key === "swarmling") {
        const n = U.randi(3, 5);
        for (let i = 0; i < n; i++) list.push(key);
        budget -= n * def.cost;
      } else if (def.cost <= budget + 0.01) {
        list.push(key);
        budget -= def.cost;
      } else if (pool.every((k) => ENEMIES[k].cost > budget + 0.01)) break;
    }
    // shuffle
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
        this.floaters.push(new Floater(this.core.x, this.core.y - 30, "+" + bonus, "#ffd94d"));
      }
    }
    this.wave++;
    const comp = this.buildComposition(this.wave);
    const interval = Math.max(0.65, 1.4 - this.wave * 0.05);
    let t = 0.3;
    this.pending = [];
    comp.forEach((key, i) => {
      this.pending.push({ t, key, spawn: this.spawns[i % this.spawns.length] });
      t += interval * (key === "swarmling" ? 0.16 : 1) * U.rand(0.75, 1.25);
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
        // wave cleared
        const bonus = 30 + 10 * this.wave;
        this.energy += bonus;
        this.floaters.push(new Floater(this.core.x, this.core.y - 34, "+" + bonus + " WAVE BONUS", "#7dff9a"));
        if (!this.endless && this.wave >= this.level.waves) {
          this.win();
        } else {
          this.state = "build";
          this.breakT = CFG.WAVE_BREAK;
        }
      }
    }
  }

  /* ---------- combat ---------- */
  updateTowers(dt) {
    let beamIntensity = 0;
    for (const t of this.towerList) {
      if (t.dead) continue;
      t.pulse += dt;
      switch (t.key) {
        case "extractor": {
          const rate = t.t.rate * (t.rich ? 2 : 1);
          this.energy += rate * dt;
          break;
        }
        case "laser": this.updateLaser(t, dt); if (t.target) beamIntensity += 0.25; break;
        case "mortar": this.updateMortar(t, dt); break;
        case "frost": {
          const r2 = (t.t.range * CELL) ** 2;
          for (const e of this.enemies) {
            if (!e.dead && U.dist2(t.x, t.y, e.x, e.y) <= r2) e.slowF = Math.max(e.slowF, t.t.slow);
          }
          break;
        }
      }
    }
    Snd.laser(Math.min(1, beamIntensity));
  }

  laserFactor(e) { return e.def.laserResist !== undefined ? 1 - e.def.laserResist : 1; }

  updateLaser(t, dt) {
    t.retargetT -= dt;
    const range = t.effRange * CELL;
    const inRange = (e) => !e.dead && U.dist2(t.x, t.y, e.x, e.y) <= (range + e.r) ** 2;
    if (!t.target || t.target.dead || !inRange(t.target) || t.retargetT <= 0) {
      t.retargetT = 0.4;
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (!inRange(e)) continue;
        const fd = this.flow.at(U.cellAt(e.x), U.cellAt(e.y));
        const score = (fd < 0 ? 9999 : fd) * 10000 + U.dist2(t.x, t.y, e.x, e.y);
        if (score < bd) { bd = score; best = e; }
      }
      t.target = best;
    }
    if (t.target) {
      t.face = U.angleTo(t.x, t.y, t.target.x, t.target.y);
      t.beamHeat = Math.min(1, t.beamHeat + dt * 6);
      const dmg = t.effDps * dt * this.laserFactor(t.target);
      this.damageEnemy(t.target, dmg);
      if (t.pierce) {
        // supermode: the beam burns everything along its line
        const a = t.face;
        const ex = t.x + Math.cos(a) * range, ey = t.y + Math.sin(a) * range;
        for (const e of this.enemies) {
          if (e.dead || e === t.target) continue;
          if (this.segDist2(t.x, t.y, ex, ey, e.x, e.y) < (16 + e.r) ** 2) {
            this.damageEnemy(e, t.effDps * dt * this.laserFactor(e));
          }
        }
      }
    } else {
      t.beamHeat = Math.max(0, t.beamHeat - dt * 4);
    }
  }

  segDist2(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let tt = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    tt = U.clamp(tt, 0, 1);
    return U.dist2(x1 + dx * tt, y1 + dy * tt, px, py);
  }

  updateMortar(t, dt) {
    t.cool -= dt;
    if (t.cool > 0) return;
    const minR = 1.5 * CELL, maxR = t.t.range * CELL;
    let best = null, bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = U.dist2(t.x, t.y, e.x, e.y);
      if (d < minR * minR || d > maxR * maxR) continue;
      const fd = this.flow.at(U.cellAt(e.x), U.cellAt(e.y));
      const score = (fd < 0 ? 9999 : fd) * 10000 + d;
      if (score < bd) { bd = score; best = e; }
    }
    if (best) {
      // lead the shot a little
      const fly = Math.sqrt(U.dist2(t.x, t.y, best.x, best.y)) / (CELL * 7);
      const tx = best.x + Math.cos(best.face || 0) * best.speed * CELL * fly * 0.7;
      const ty = best.y + Math.sin(best.face || 0) * best.speed * CELL * fly * 0.7;
      this.shells.push(new Shell(t, tx, ty, t.t.dmg, t.t.aoe));
      t.cool = t.t.rate;
      t.face = U.angleTo(t.x, t.y, tx, ty);
      Snd.tone(140, 0.12, "square", 0.1, 60);
      this.spawnBurst(t.x, t.y, "#ff9a4d", 4, { speed: 60 });
    }
  }

  updateShells(dt) {
    for (const s of this.shells) {
      s.t += dt;
      if (s.t >= s.T) {
        s.done = true;
        const p = s.pos();
        for (const e of this.enemies) {
          if (!e.dead && U.dist2(p.x, p.y, e.x, e.y) <= (s.aoe + e.r) ** 2) {
            this.damageEnemy(e, s.dmg);
          }
        }
        this.spawnBurst(p.x, p.y, "#ff9a4d", 12, { speed: 150 });
        this.spawnBurst(p.x, p.y, "#ffd94d", 8, { speed: 90 });
        Snd.boom(false);
        this.shake = Math.max(this.shake, 3);
      }
    }
    this.shells = this.shells.filter((s) => !s.done);
  }

  damageEnemy(e, dmg) {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (e.hp <= 0) {
      e.dead = true;
      this.kills++;
      this.energy += e.reward;
      this.floaters.push(new Floater(e.x, e.y, "+" + e.reward, "#ffd94d"));
      this.spawnBurst(e.x, e.y, e.def.color, e.def.boss ? 40 : 10, { speed: e.def.boss ? 220 : 130 });
      if (e.def.boss) { Snd.boom(true); this.shake = Math.max(this.shake, 7); }
      else Snd.noise(0.12, 0.08, 1400);
    }
  }

  onCoreHit(dmg) {
    this.coreHp = Math.max(0, this.coreHp - dmg);
    this.shake = Math.max(this.shake, 6);
    this.spawnBurst(this.core.x, this.core.y, "#ff6b57", 16, { speed: 160 });
    this.floaters.push(new Floater(this.core.x, this.core.y - 40, "-" + dmg, "#ff6b57"));
    Snd.coreHit();
    if (this.coreHp <= 0) this.lose();
  }

  /* ---------- fx ---------- */
  spawnBurst(x, y, color, n, opts = {}) {
    if (this.particles.length > 320) return;
    for (let i = 0; i < n; i++) this.particles.push(new Particle(x, y, color, opts));
  }
  spawnHitParticles(x, y, color, n) {
    this.spawnBurst(x, y, color, n, { speed: 70 });
  }

  /* ---------- end states ---------- */
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

  /* ---------- main update ---------- */
  update(rawDt) {
    if (this.state === "won" || this.state === "lost") {
      // let particles settle
      this.updateFx(rawDt);
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    this.time += dt;
    this.updateWaves(dt);

    for (const e of this.enemies) e.slowF = 0;
    this.updateTowers(dt);
    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.enemies = this.enemies.filter((e) => !e.dead);

    this.updateShells(dt);
    this.updateFx(dt);
  }

  updateFx(dt) {
    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) f.update(dt);
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 22);
  }

  income() {
    let inc = CFG.CORE_INCOME;
    for (const t of this.towerList) {
      if (t.key === "extractor" && !t.dead) inc += t.t.rate * (t.rich ? 2 : 1);
    }
    return inc;
  }
}
