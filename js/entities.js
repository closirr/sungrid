/* SUNGRID — entities: enemies, towers, shells, particles, floaters */
"use strict";

class Enemy {
  constructor(typeKey, spawn, game) {
    const def = ENEMIES[typeKey];
    this.key = typeKey;
    this.def = def;
    this.wave = game.wave;
    const scale = 1 + (def.hpScale || CFG.HP_SCALE) * (game.wave - 1);
    this.maxHp = def.hp * scale * game.level.mult;
    this.hp = this.maxHp;
    this.speed = def.speed;             // cells/s
    this.dmg = def.dmg;
    this.reward = def.reward;
    this.r = def.r;
    this.x = U.cx(spawn.c) + U.rand(-10, 10);
    this.y = U.cy(spawn.r) + U.rand(-10, 10);
    this.offX = U.rand(-11, 11);        // persistent lateral offset so packs don't stack
    this.offY = U.rand(-11, 11);
    this.slowF = 0;                     // set by frost coils each frame
    this.flash = 0;                     // hit flash timer
    this.dead = false;
    this.chewT = 0;
    this.wob = Math.random() * Math.PI * 2;
  }

  /* axis-separated collision: never enter rocks or towers (unless already inside one) */
  moveStep(game, a, sp, dt) {
    const nx = this.x + Math.cos(a) * sp * dt;
    const ny = this.y + Math.sin(a) * sp * dt;
    const blocked = (x, y) => {
      const c = U.cellAt(x), r = U.cellAt(y);
      if (c < 0 || r < 0 || c >= CFG.COLS || r >= CFG.ROWS) return true;
      const i = r * CFG.COLS + c;
      return game.terr[i] === 1 || !!game.towers[i];
    };
    if (blocked(this.x, this.y)) { this.x = nx; this.y = ny; return; } // escape a sealed-in cell
    if (!blocked(nx, this.y)) this.x = nx;
    if (!blocked(this.x, ny)) this.y = ny;
  }

  update(dt, game) {
    const { COLS } = CFG;
    const sp = this.speed * (1 - this.slowF) * CELL;
    const c = U.cellAt(this.x), r = U.cellAt(this.y);
    const myDist = game.flow.at(c, r);

    // reached the core?
    if (myDist === 0 && U.dist2(this.x, this.y, game.core.x, game.core.y) < (CELL * 0.62) ** 2) {
      game.onCoreHit(this.dmg);
      this.dead = true;
      return;
    }

    // find the best next cell: strictly lower flow distance, straight steps preferred on ties
    let bc = -1, br = -1, bestScore = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        const d = game.flow.at(nc, nr);
        if (d < 0 || d >= myDist) continue;
        const score = d * 2 + ((dc === 0 || dr === 0) ? 0 : 1);
        if (score < bestScore) { bestScore = score; bc = nc; br = nr; }
      }
    }

    if (bc !== -1) {
      // steer to the neighbor cell center + personal offset
      const tx = U.cx(bc) + this.offX, ty = U.cy(br) + this.offY;
      const a = U.angleTo(this.x, this.y, tx, ty);
      this.moveStep(game, a, sp, dt);
      this.face = a;
    } else if (myDist === 0) {
      // at the core cell but not yet in hit range — beeline to the core
      const a = U.angleTo(this.x, this.y, game.core.x, game.core.y);
      this.moveStep(game, a, sp, dt);
      this.face = a;
    } else {
      // cut off from the core (a building sealed the path): eat the nearest buildings
      // until a path opens; if wedged with no progress, try the next-nearest tower
      this.retargetT = (this.retargetT || 0) - dt;
      if (this.retargetT <= 0 || !this.chewTarget || this.chewTarget.dead) {
        this.retargetT = 0.8;
        const sorted = game.towerList.slice().sort(
          (p, q) => U.dist2(this.x, this.y, p.x, p.y) - U.dist2(this.x, this.y, q.x, q.y)
        );
        this.chewTarget = sorted[Math.min(this.stuckIdx || 0, sorted.length - 1)] || null;
      }
      const t = this.chewTarget;
      if (t) {
        const d = U.dist2(this.x, this.y, t.x, t.y);
        if (d > (CELL * 1.15) ** 2) {
          const a = U.angleTo(this.x, this.y, t.x, t.y);
          this.moveStep(game, a, sp, dt);
          this.face = a;
          this.stuckT = (this.stuckT || 0) + dt;
          if (this.stuckT > 2) {
            if (U.dist2(this.x, this.y, this.lastX || 0, this.lastY || 0) < 9) this.stuckIdx = (this.stuckIdx || 0) + 1;
            this.stuckT = 0;
            this.lastX = this.x; this.lastY = this.y;
          }
        } else {
          this.chewT -= dt;
          if (this.chewT <= 0) {
            t.damage(this.dmg * 1.5, game);
            this.chewT = 0.5;
            game.spawnHitParticles(t.x, t.y, "#9aa7c7", 3);
          }
          this.stuckT = 0; this.lastX = this.x; this.lastY = this.y;
        }
      }
    }
  }
}

class Tower {
  constructor(typeKey, c, r) {
    const def = TOWERS[typeKey];
    this.key = typeKey;
    this.def = def;
    this.c = c; this.r = r;
    this.x = U.cx(c); this.y = U.cy(r);
    this.tier = 0;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.invested = def.cost;
    this.dead = false;
    // laser
    this.target = null;
    this.retargetT = 0;
    this.beamHeat = 0;         // visual glow 0..1
    // prism
    this.linkTo = null;        // Tower
    this.active = false;       // part of a working chain
    // mortar
    this.cool = 0;
    this.face = U.rand(0, Math.PI * 2);
    this.pulse = Math.random() * Math.PI * 2;
  }

  get t() { return this.def.tiers[this.tier]; }

  damage(dmg, game) {
    this.hp -= dmg;
    if (this.hp <= 0 && !this.dead) {
      this.dead = true;
      game.onTowerDestroyed(this);
    }
  }

  /* ---- laser effective stats with prism boost ---- */
  get boost() { return this._boost || { mult: 1, rangeAdd: 0, rateAdd: 0, n: 0 }; }
  get effDps() { return this.t.dps * this.boost.mult * (1 + this.boost.rateAdd); }
  get effRange() { return this.t.range + this.boost.rangeAdd; }
  get pierce() { return this.boost.n >= 3 && this.tier >= 1; }
}

class Shell {
  constructor(tower, tx, ty, dmg, aoe) {
    this.sx = tower.x; this.sy = tower.y;
    this.tx = tx; this.ty = ty;
    this.dmg = dmg; this.aoe = aoe * CELL;
    this.T = U.dist(tower.x, tower.y, tx, ty) / (CELL * 7); // flight time
    this.t = 0;
    this.done = false;
  }
  pos() {
    const k = this.t / this.T;
    const x = U.lerp(this.sx, this.tx, k);
    const y = U.lerp(this.sy, this.ty, k) - Math.sin(k * Math.PI) * 46; // arc
    return { x, y };
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
