/* SUNGRID — entities: buildings (towers), shells, particles, floaters.
 * Buildings live in GRID space (c, r ints); rendering projects them via ISO.
 * Particles/floaters are short-lived screen-space fx. */
"use strict";

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

  /* laser effective stats with feeder boost: +50% dps, +25% range per feeder */
  get boost() { return this._boost || { n: 0, mult: 1, rangeMult: 1 }; }
  get effDps() { return this.t.dps * this.boost.mult * (0.25 + 0.75 * this.ramp); }
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
