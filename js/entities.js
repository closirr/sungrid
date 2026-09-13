/* SUNGRID — entities: enemies, buildings (towers), shells, particles, floaters.
 * Buildings live in GRID space (c, r ints); enemies too (gc, gr floats);
 * rendering projects both via ISO. Particles/floaters are screen-space fx. */
"use strict";

class Enemy {
  constructor(typeKey, spawn, game) {
    const def = ENEMIES[typeKey];
    this.key = typeKey;
    this.def = def;
    this.wave = game.wave;
    const scale = 1 + (def.hpScale || CFG.HP_SCALE) * (game.wave - 1);
    this.maxHp = def.hp * scale * (game.level.mult || 1);
    this.hp = this.maxHp;
    this.speed = def.speed;           // cells/s
    this.dmg = def.dmg;
    this.reward = def.reward;
    this.size = def.size;             // footprint in cells
    this.gc = spawn.c + U.rand(-0.15, 0.15);
    this.gr = spawn.r + U.rand(-0.15, 0.15);
    this.offX = U.rand(-0.22, 0.22);  // persistent lateral offset so packs don't stack
    this.offY = U.rand(-0.22, 0.22);
    this.slowF = 0;
    this.flash = 0;
    this.dead = false;
    this.chewT = 0;
    this.chewTarget = null;
    this.retargetT = 0;
    this.stuckT = 0;
    this.stuckIdx = 0;
    this.lastGc = 0; this.lastGr = 0;
    this.face = 0;                    // screen-space angle for drawing
    this.wob = Math.random() * Math.PI * 2;
    this.firing = false;              // semantics per type (phase 5)
  }

  blockedAt(game, c, r) {
    if (!U.inBounds(c, r)) return true;
    const i = U.idx(c, r);
    return game.terr[i] === 1 || !!(game.towers[i] && game.towers[i].key !== "bomb");
  }

  /* axis-separated collision in GRID units: never enter rocks/buildings unless inside */
  moveStep(game, dx, dy, sp, dt) {
    const len = Math.hypot(dx, dy) || 1;
    const nx = this.gc + (dx / len) * sp * dt;
    const ny = this.gr + (dy / len) * sp * dt;
    const inWall = this.blockedAt(game, Math.floor(this.gc), Math.floor(this.gr));
    if (inWall) { this.gc = nx; this.gr = ny; return; } // escape a sealed cell
    if (!this.blockedAt(game, Math.floor(nx), Math.floor(this.gr))) this.gc = nx;
    if (!this.blockedAt(game, Math.floor(this.gc), Math.floor(ny))) this.gr = ny;
    // screen-space facing for the renderer
    const d = ISO.dir(dx, dy);
    this.face = Math.atan2(d.y, d.x);
  }

  update(dt, game) {
    switch (this.key) {
      case "kamikaze": return this.updateKamikaze(dt, game);
      case "sapper": return this.updateSapper(dt, game);
      case "teleporter": return this.updateTeleporter(dt, game);
      case "boss": this.updateBossSmash(dt, game); break;
    }
    this.baseUpdate(dt, game);
  }

  /* flow-following march toward the core (crawler/swarm/tank/rocket/boss) */
  baseUpdate(dt, game) {
    const sp = this.speed * (1 - this.slowF);
    const c = Math.floor(this.gc), r = Math.floor(this.gr);
    const myDist = game.flow.at(c, r);

    // reached the core?
    if (myDist === 0 && U.dist2(this.gc, this.gr, game.core.c + 0.5, game.core.r + 0.5) < 0.62 ** 2) {
      game.onCoreHit(this.dmg);
      this.dead = true;
      return;
    }

    // best next cell: strictly lower flow distance, straight steps preferred on ties
    let bc = -1, br = -1, bestScore = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        const d = game.flow.at(nc, nr);
        if (d < 0 || d >= myDist) continue;
        const score = d * 2 + (dc === 0 || dr === 0 ? 0 : 1);
        if (score < bestScore) { bestScore = score; bc = nc; br = nr; }
      }
    }

    if (bc !== -1) {
      this.moveStep(game, bc + 0.5 + this.offX - this.gc, br + 0.5 + this.offY - this.gr, sp, dt);
    } else if (myDist === 0) {
      this.moveStep(game, game.core.c + 0.5 - this.gc, game.core.r + 0.5 - this.gr, sp, dt);
    } else {
      // cut off from the core: eat the nearest buildings until a path opens
      this.retargetT -= dt;
      if (this.retargetT <= 0 || !this.chewTarget || this.chewTarget.dead) {
        this.retargetT = 0.8;
        const sorted = game.towerList.slice().sort(
          (p, q) => U.dist2(this.gc, this.gr, p.c, p.r) - U.dist2(this.gc, this.gr, q.c, q.r)
        );
        this.chewTarget = sorted[Math.min(this.stuckIdx, sorted.length - 1)] || null;
      }
      const t = this.chewTarget;
      if (t) {
        const d = U.dist2(this.gc, this.gr, t.c + 0.5, t.r + 0.5);
        if (d > 1.15 ** 2) {
          this.moveStep(game, t.c + 0.5 - this.gc, t.r + 0.5 - this.gr, sp, dt);
          this.stuckT += dt;
          if (this.stuckT > 2) {
            if (U.dist2(this.gc, this.gr, this.lastGc, this.lastGr) < 0.01) this.stuckIdx++;
            this.stuckT = 0;
            this.lastGc = this.gc; this.lastGr = this.gr;
          }
        } else {
          this.chewT -= dt;
          if (this.chewT <= 0) {
            t.damage(this.dmg * 1.5, game);
            this.chewT = 0.5;
            const p = ISO.px(t.c, t.r);
            game.spawnHitParticles(p.x, p.y - 14, "#9aa7c7", 3);
          }
          this.stuckT = 0; this.lastGc = this.gc; this.lastGr = this.gr;
        }
      }
    }

    // contact-detonate charged bombs we walk onto
    const cellTower = game.towers[U.idx(Math.floor(this.gc), Math.floor(this.gr))];
    if (cellTower && cellTower.key === "bomb" && cellTower.done && cellTower.charge >= BOMB_CHARGE) {
      game.detonateBomb(cellTower);
    }
  }

  /* kamikaze: dive the densest laser/link cluster (or the core), blow up on contact */
  updateKamikaze(dt, game) {
    if (!this.targetTower || (this.targetTower.dead !== undefined && this.targetTower.dead)) {
      let best = null, bs = -Infinity;
      for (const t of game.towerList) {
        if (t.key !== "laser" && t.key !== "link") continue;
        let cluster = 0;
        for (const o of game.towerList) {
          if (o !== t && (o.key === "laser" || o.key === "link") && U.dist(t.c, t.r, o.c, o.r) <= 2) cluster++;
        }
        const score = cluster * 10 - U.dist(this.gc, this.gr, t.c, t.r);
        if (score > bs) { bs = score; best = t; }
      }
      this.targetTower = best || game.core;
    }
    const tx = this.targetTower.c + 0.5, ty = this.targetTower.r + 0.5;
    const d = U.dist(this.gc, this.gr, tx, ty);
    if (d <= 0.55) {
      const aoe = this.def.boom ? this.def.boom.aoe : 1.5;
      for (const t of game.towerList) {
        if (!t.dead && U.dist(t.c, t.r, tx - 0.5, ty - 0.5) <= aoe) t.damage(this.dmg, game);
      }
      if (U.dist(game.core.c, game.core.r, tx - 0.5, ty - 0.5) <= aoe) game.onCoreHit(this.dmg);
      const p = ISO.px(this.gc, this.gr);
      game.spawnBurst(p.x, p.y - 8, "#ffd94d", 20, { speed: 170 });
      game.shake = Math.max(game.shake, 6);
      Snd.boom(false);
      this.dead = true;
      return;
    }
    // flying drone: ignores the maze, beelines the target
    const len = d || 1;
    this.gc += ((tx - this.gc) / len) * this.speed * dt;
    this.gr += ((ty - this.gr) / len) * this.speed * dt;
    const dir = ISO.dir(tx - this.gc, ty - this.gr);
    this.face = Math.atan2(dir.y, dir.x);
  }

  /* sapper: latch the nearest energy link and drink the grid dry through it */
  updateSapper(dt, game) {
    if (this.latch && (this.latch.dead || this.latch.heat >= CFG.HEAT_MAX)) {
      this.latch._sapped = false;
      this.latch = null;
    }
    if (!this.latch) {
      let best = null, bd = Infinity;
      for (const t of game.towerList) {
        if (t.key !== "link" || t._sapped) continue;
        const d = U.dist2(this.gc, this.gr, t.c + 0.5, t.r + 0.5);
        if (d < bd) { bd = d; best = t; }
      }
      if (!best) { this.baseUpdate(dt, game); return; } // no links: act like a walker
      const d = Math.sqrt(bd);
      if (d <= 1.1) {
        this.latch = best;
        best._sapped = true;
        const p = ISO.px(best.c, best.r);
        game.spawnBurst(p.x, p.y - 12, this.def.color, 8, { speed: 60 });
        if (typeof Snd.zap === "function") Snd.zap();
      } else {
        // fly to the chosen link
        const len = d || 1;
        this.gc += ((best.c + 0.5 - this.gc) / len) * this.speed * dt;
        this.gr += ((best.r + 0.5 - this.gr) / len) * this.speed * dt;
        const dir = ISO.dir(best.c - this.gc, best.r - this.gr);
        this.face = Math.atan2(dir.y, dir.x);
      }
      return;
    }
    // latched: sit on the link, wiggle
    this.face += dt * 3;
    this.latch.drainPulse = game.time;
  }

  /* teleporter: hovers beyond ordinary laser range, blinks closer every few seconds */
  updateTeleporter(dt, game) {
    const distCore = U.dist(this.gc, this.gr, game.core.c + 0.5, game.core.r + 0.5);
    if (distCore < 3) { this.baseUpdate(dt, game); return; }
    let nearest = Infinity;
    for (const t of game.towerList) nearest = Math.min(nearest, U.dist(this.gc, this.gr, t.c, t.r));
    this.blinkT = (this.blinkT || 0) + dt;
    if (nearest > this.def.hoverAt) {
      this.baseUpdate(dt, game);
      return;
    }
    // hover: slow drift, waiting out the blink
    this.strafeT = (this.strafeT || 0) + dt;
    this.moveStep(game, Math.cos(this.wob + this.strafeT * 0.7), Math.sin(this.wob * 1.3 + this.strafeT * 0.7), 0.3, dt);
    if (this.blinkT >= this.def.blinkEvery) {
      this.blinkT = 0;
      const dx = game.core.c + 0.5 - this.gc, dy = game.core.r + 0.5 - this.gr;
      const len = Math.hypot(dx, dy) || 1;
      for (let k = Math.min(2, len - 0.6); k > 0.3; k -= 0.5) {
        const nc = this.gc + (dx / len) * k, nr = this.gr + (dy / len) * k;
        if (!this.blockedAt(game, Math.floor(nc), Math.floor(nr))) {
          const p = ISO.px(this.gc, this.gr);
          game.spawnBurst(p.x, p.y - 8, this.def.color, 10, { speed: 90 });
          this.gc = nc; this.gr = nr;
          const p2 = ISO.px(this.gc, this.gr);
          game.spawnBurst(p2.x, p2.y - 8, this.def.color, 10, { speed: 90 });
          if (typeof Snd.zap === "function") Snd.zap();
          break;
        }
      }
    }
  }

  /* boss: periodic ground smash that pulverises nearby buildings */
  updateBossSmash(dt, game) {
    this.smashT = (this.smashT === undefined ? this.def.smash.every * 0.6 : this.smashT) - dt;
    if (this.smashT > 0) return;
    this.smashT = this.def.smash.every;
    let hitAny = false;
    for (const t of game.towerList) {
      if (!t.dead && U.dist(t.c, t.r, this.gc, this.gr) <= this.def.smash.aoe) {
        t.damage(this.def.smash.dmg, game);
        hitAny = true;
      }
    }
    if (hitAny) {
      const p = ISO.px(this.gc, this.gr);
      game.spawnBurst(p.x, p.y - 8, "#ff9a4d", 16, { speed: 140 });
      game.shake = Math.max(game.shake, 6);
      Snd.boom(false);
    }
  }
}

const BOMB_CHARGE = 40; // energy units for a full sun bomb

class Tower {
  constructor(typeKey, c, r) {
    const def = TOWERS[typeKey];
    this.key = typeKey;
    this.def = def;
    this.c = c; this.r = r;
    this.tier = 0;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.invested = def.cost;
    this.dead = false;

    this.built = 0;            // 0..1 construction progress
    this.supply = 0;           // smoothed supplyRatio 0..1 (energy network, phase 3)
    this.online = false;       // built && connected

    // laser chains (phase 4)
    this.linkTo = null;        // Tower — receiver this laser feeds
    this.feeders = [];         // Towers feeding THIS laser
    this.ramp = 0;             // 0..1 chain focus ramp-up
    this.target = null;
    this.retargetT = 0;
    this.beamHeat = 0;

    // energy link (phase 3)
    this.heat = 0;             // 0..100 overload heat

    // missile
    this.cool = 0;
    // bomb
    this.charge = 0;

    this.face = U.rand(0, Math.PI * 2);
    this.pulse = U.rand(0, Math.PI * 2);
  }

  get t() { return this.def.tiers[this.tier]; }
  get done() { return this.built >= 1; }

  /* range of the network node this building anchors (plant/link); core handled separately */
  get nodeRange() { return this.t.range; }

  damage(dmg, game) {
    this.hp -= dmg;
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      game.onTowerDestroyed(this);
    }
  }

  /* laser effective stats with feeder boost: ×1.5 DPS, ×1.25 range per feeder.
   * (The chain-focus ramp is applied once in updateLaser, not here.) */
  get boost() { return this._boost || { n: 0, mult: 1, rangeMult: 1 }; }
  get effDps() { return this.t.dps * this.boost.mult; }
  get effRange() { return this.t.range * this.boost.rangeMult; }
}

class Shell {
  /* grid-space arcing shell; projected to screen at draw time */
  constructor(tower, tc, tr, dmg, aoe) {
    this.sc = tower.c; this.sr = tower.r;
    this.tc = tc; this.tr = tr;
    this.dmg = dmg; this.aoe = aoe;      // aoe in cells
    this.T = Math.max(0.25, U.dist(tower.c, tower.r, tc, tr) / 7);
    this.t = 0;
    this.done = false;
  }
  pos() {
    const k = this.t / this.T;
    return {
      c: U.lerp(this.sc, this.tc, k),
      r: U.lerp(this.sr, this.tr, k),
      lift: Math.sin(k * Math.PI) * 1.4, // height in h units
    };
  }
}

class Particle {
  constructor(x, y, color, opts = {}) {
    this.x = x; this.y = y;
    const a = opts.angle !== undefined ? opts.angle : U.rand(0, Math.PI * 2);
    const v = opts.speed || U.rand(30, 130);
    this.vx = Math.cos(a) * v; this.vy = Math.sin(a) * v;
    this.life = opts.life || U.rand(0.25, 0.6);
    this.maxLife = this.life;
    this.color = color;
    this.size = opts.size || U.rand(2, 4.5);
    this.grav = opts.grav || 0;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.vy += this.grav * dt;
    this.life -= dt;
  }
}

class Floater {
  constructor(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 0.9; this.maxLife = 0.9;
  }
  update(dt) { this.y -= 34 * dt; this.life -= dt; }
}
