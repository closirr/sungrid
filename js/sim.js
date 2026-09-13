/* SUNGRID — simulation core, ported 1:1 from the Harvesturr clone (sbarisic/Harvesturr)
 * of Harvest: Massive Encounter. Free placement (world px, no build grid), energy
 * travels as physical packets between units. All numbers below are the clone's. */
"use strict";

/* ---- exact constants from the reference implementation ---- */
const HS = {
  PACKET_SPEED: 96,
  CONNECT_RANGE_POWER: 96,
  CONDUIT_COST: 5, CONDUIT_PACKETS: 5,
  SOLAR_COST: 10, SOLAR_PACKETS: 15, SOLAR_INTERVAL: 2,
  HARVESTER_COST: 8, HARVESTER_PACKETS: 10, HARVEST_RANGE: 64, HARVEST_INTERVAL: 5,
  HARVESTER_MOVE_REFUND: 2,
  LASER_COST: 10, LASER_PACKETS: 10,
  LASER_SINGLE_DMG: 1, LASER_SINGLE_RNG: 64,
  LASER_MAX_CHARGES: 60, LASER_CHARGES_PER_PACKET: 15, LASER_TICK: 0.1,
  CONDUIT_HEAT_DECAY: 2, CONDUIT_SLOW_INTERVAL: 0.2, CONDUIT_HEAT_MAX: 100,
  UNIT_MAX_HP: 100,
  MINERAL_COUNT: [20, 40], MEGA_MINERAL_COUNT: [300, 400], MEGA_CHANCE: 0.198,
  MINERAL_CLUSTERS: 50, MINERALS_PER_CLUSTER: 15, CLUSTER_OFFSET: 120, MIN_CENTER_DIST: 120,
  MAP_HALF: 1696,            // 106×106 tiles × 32px, centered at (0,0)
  UFO_HP: 50, UFO_DMG: 5, UFO_ATTACK_INTERVAL: 1, UFO_SPEED: 8,
  UFO_SCAN_RANGE: 4000, UFO_DMG_RANGE: 16, UFO_KNOCKBACK: 128, UFO_ROT_SPEED: 48,
  WAVE_INTERVAL: 10,
  PACKET_BUILD_POINT: 1,     // 1 packet = 1 build point on a WIP
  START_BUILDINGS: [{ type: "harvester", x: 10, y: -31 }, { type: "conduit", x: 30, y: 0 }, { type: "solar", x: 34, y: 50 }],
  START_MEGAMINERAL: { x: -36, y: -20 },
};

const Utils2 = {
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  normalize: (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; },
  rectsOverlap: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
  pointInRect: (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h,
  randomPointOnRect: (bounds) => {
    const per = bounds.w * 2 + bounds.h * 2;
    let t = Math.random() * per;
    if (t < bounds.w) return { x: bounds.x + t, y: bounds.y };
    t -= bounds.w;
    if (t < bounds.w) return { x: bounds.x + t, y: bounds.y + bounds.h };
    t -= bounds.w;
    if (t < bounds.h) return { x: bounds.x, y: bounds.y + t };
    t -= bounds.h;
    return { x: bounds.x + bounds.w, y: bounds.y + t };
  },
};

/* per-unit static defs shared by placement UI and the WIP builder */
const SIM_DEFS = {
  conduit: { name: "Conduit", cost: HS.CONDUIT_COST, packets: HS.CONDUIT_PACKETS, size: { w: 26, h: 44 } },
  solar: { name: "Solar Panel", cost: HS.SOLAR_COST, packets: HS.SOLAR_PACKETS, size: { w: 46, h: 34 } },
  harvester: { name: "Harvester", cost: HS.HARVESTER_COST, packets: HS.HARVESTER_PACKETS, size: { w: 44, h: 34 } },
  laser: { name: "Laser", cost: HS.LASER_COST, packets: HS.LASER_PACKETS, size: { w: 40, h: 36 } },
};

const SIM_MAKE = {
  conduit: (x, y) => new Conduit(x, y),
  solar: (x, y) => new SolarPanel(x, y),
  harvester: (x, y) => new Harvester(x, y),
  laser: (x, y) => new Laser(x, y),
};

/* ============================== units ============================== */
class SimUnit {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.dead = false;
    this.pickable = true;
    this.maxHp = HS.UNIT_MAX_HP;
    this.hp = this.maxHp;
    this.canLinkEnergy = false;
    this.updateInterval = 1;
    this._nextSlow = 0;
    this.awaitingPacket = null;
    this.hover = false;
    this.kind = "unit";
  }
  get bounding() {
    const hw = this.size.w / 2, hh = this.size.h / 2;
    return { x: this.x - hw, y: this.y - hh, w: this.size.w, h: this.size.h };
  }
  update(dt, sim) {
    if (this.hp <= 0) { this.destroy(sim); return; }
    this._slowT = (this._slowT === undefined ? 0 : this._slowT) + dt;
    if (this._nextSlow < sim.time) {
      this._nextSlow = sim.time + this.updateInterval;
      this.slowUpdate(sim);
    }
  }
  slowUpdate(sim) {}
  receiveDamage(sim, dmg) { this.hp -= dmg; }
  destroy(sim) { this.dead = true; if (this.onDestroyed) this.onDestroyed(sim); }
  /* default: packets relay through (return true = pick next target from here) */
  consumeEnergyPacket(sim, packet) { return true; }
  canAcceptPacket() { return false; }
}

class SolarPanel extends SimUnit {
  constructor(x, y) {
    super(x, y);
    this.kind = "solar";
    this.canLinkEnergy = true;
    this.updateInterval = HS.SOLAR_INTERVAL;
    this.size = { w: 46, h: 34 };
  }
  slowUpdate(sim) {
    const targets = sim.unitsInRange(this, HS.CONNECT_RANGE_POWER, (u) => u instanceof Conduit || u instanceof BuildingWIP);
    const t = targets.length ? Utils2.choice(targets) : null;
    if (t) sim.spawnPacket(this, t);
  }
}

class Conduit extends SimUnit {
  constructor(x, y) {
    super(x, y);
    this.kind = "conduit";
    this.canLinkEnergy = true;
    this.updateInterval = HS.CONDUIT_SLOW_INTERVAL;
    this.heat = 0;
    this.linkedConduit = null;
    this.size = { w: 26, h: 44 };
  }
  linkConduit(u) { this.linkedConduit = (u === this || u == null) ? null : u; }
  get liveLink() { return (this.linkedConduit && !this.linkedConduit.dead) ? this.linkedConduit : null; }
  slowUpdate(sim) { this.heat = Math.max(0, this.heat - HS.CONDUIT_HEAT_DECAY); }
  consumeEnergyPacket(sim, packet) {
    this.heat++;
    if (this.heat > HS.CONDUIT_HEAT_MAX) {
      this.heat = HS.CONDUIT_HEAT_MAX;
      packet.dead = true; // overflow: the packet is lost
      return false;
    }
    return true; // relay on
  }
}

class Laser extends SimUnit {
  constructor(x, y) {
    super(x, y);
    this.kind = "laser";
    this.canLinkEnergy = true;
    this.updateInterval = HS.LASER_TICK;
    this.maxCharges = HS.LASER_MAX_CHARGES;
    this.charges = 0;
    this.linkedLaser = null;   // this laser FEEDS linkedLaser
    this.target = null;
    this.isAttacking = false;
    this._dirty = true;
    this._dmg = HS.LASER_SINGLE_DMG;
    this._range = HS.LASER_SINGLE_RNG;
    this.size = { w: 40, h: 36 };
  }
  get liveLink() { return (this.linkedLaser && !this.linkedLaser.dead) ? this.linkedLaser : null; }
  linkLaser(u, sim) {
    if (u == null || u === this) {
      const old = this.linkedLaser;
      this.linkedLaser = null;
      if (old && !old.dead) old._dirty = true;
      this._dirty = true;
      return;
    }
    if (u.liveLink === this) u.linkLaser(null, sim);
    if (this.chainContains(u)) this.linkedLaser = null;
    else { this.linkedLaser = u; u._dirty = true; this._dirty = true; }
  }
  chainContains(l) {
    let cur = this.liveLink;
    let guard = 0;
    while (cur && guard++ < 64) {
      if (cur === l) return true;
      cur = cur.liveLink;
    }
    return false;
  }
  feeders() {
    return sim_ ? sim_.units.filter((u) => u instanceof Laser && !u.dead && u.liveLink === this) : [];
  }
  calc() {
    if (!this._dirty) return;
    this._dirty = false;
    this._dmg = HS.LASER_SINGLE_DMG;
    for (const f of this.feeders()) {
      f.calc();
      this._dmg += f._dmg;
    }
    this._range = HS.LASER_SINGLE_RNG + HS.LASER_SINGLE_RNG * (this._dmg / HS.LASER_SINGLE_DMG - 1) * 0.2;
    if (this.charges <= 0) { this._dmg = 0; this._range = HS.LASER_SINGLE_RNG; }
  }
  update(dt, sim) {
    sim_ = sim;
    if (this.liveLink == null && this.linkedLaser) this.linkedLaser = null;
    this.calc();
    // base class hp/SlowUpdate with LASER_TICK cadence
    if (this.hp <= 0) { this.destroy(sim); return; }
    this._slowT = (this._slowT === undefined ? 0 : this._slowT) + dt;
    if (this._nextSlow < sim.time) {
      this._nextSlow = sim.time + this.updateInterval;
      this.slowUpdate(sim);
    }
  }
  slowUpdate(sim) {
    if (this.charges <= 0) { this.isAttacking = false; return; }
    this._dirty = true;
    if (this.liveLink != null) {
      // feeder: drain while the receiver attacks
      this.isAttacking = this.liveLink.isAttacking;
      if (this.isAttacking) this.charges--;
      return;
    }
    // reference order: attack the locked target first, only then validate range/liveness
    if (this.target && !this.target.dead) {
      this.charges--;
      this.target.receiveDamage(sim, this._dmg);
    }
    if (this.target && (this.target.dead || Utils2.dist(this, this.target) > this._range)) this.target = null;
    if (!this.target) {
      const aliens = sim.unitsInRange(this, this._range, (u) => u.isAlien && !u.dead);
      this.target = aliens.length ? Utils2.choice(aliens) : null;
    }
    this.isAttacking = this.target != null;
  }
  consumeEnergyPacket(sim, packet) {
    if (this.charges >= this.maxCharges) return true; // full: relay on
    this.charges += HS.LASER_CHARGES_PER_PACKET;
    packet.dead = true;
    return false;
  }
  canAcceptPacket() { return !(this.awaitingPacket && !this.awaitingPacket.dead) && this.charges < this.maxCharges; }
}

class Harvester extends SimUnit {
  constructor(x, y) {
    super(x, y);
    this.kind = "harvester";
    this.canLinkEnergy = true;
    this.updateInterval = HS.HARVEST_INTERVAL;
    this.charges = 0;
    this._lastUse = 0;
    this.size = { w: 44, h: 34 };
  }
  slowUpdate(sim) {
    if (this.charges <= 0) return;
    const minerals = sim.unitsInRange(this, HS.HARVEST_RANGE, (u) => u instanceof Mineral && !u.dead);
    if (!minerals.length) {
      this.destroy(sim);
      sim.resources += HS.HARVESTER_MOVE_REFUND;
      return;
    }
    const m = Utils2.choice(minerals);
    if (m.harvest()) {
      this.charges--;
      if (this.charges <= 0) { this.charges = 0; this._lastUse = sim.time; }
      sim.resources += 1;
    }
  }
  consumeEnergyPacket(sim, packet) {
    this.charges++;
    packet.dead = true;
    return false;
  }
  canAcceptPacket() { return !(this.awaitingPacket && !this.awaitingPacket.dead) && this.charges <= 1; }
}

class Mineral extends SimUnit {
  constructor(x, y, mega) {
    super(x, y);
    this.kind = "mineral";
    this.pickable = true;
    this.mega = mega;
    this.count = mega ? Utils2.randi(HS.MEGA_MINERAL_COUNT[0], HS.MEGA_MINERAL_COUNT[1] - 1)
                      : Utils2.randi(HS.MINERAL_COUNT[0], HS.MINERAL_COUNT[1] - 1);
    this.size = { w: 30, h: 24 };
  }
  harvest() {
    if (this.count > 0) { this.count--; if (this.count <= 0) this.dead = true; return true; }
    this.dead = true;
    return false;
  }
  update() { /* minerals are static; never "die" from hp */ }
}

class BuildingWIP extends SimUnit {
  constructor(x, y, type) {
    super(x, y);
    this.kind = "wip";
    this.type = type;
    const def = SIM_DEFS[type];
    this.makeReal = { cost: def.packets, size: def.size }; // packets needed + final footprint
    this.remaining = def.packets;
    this.canLinkEnergy = true;
    this.size = def.size;
  }
  consumeEnergyPacket(sim, packet) {
    packet.dead = true;
    this.remaining--;
    if (this.remaining <= 0) {
      this.dead = true;
      const unit = SIM_MAKE[this.type](this.x, this.y);
      sim.spawn(unit);
      sim.relinkAround(this, unit);
    }
    return false;
  }
  canAcceptPacket() { return true; }
}

class Ufo extends SimUnit {
  constructor(x, y) {
    super(x, y);
    this.kind = "ufo";
    this.isAlien = true;
    this.pickable = true;
    this.maxHp = HS.UFO_HP; this.hp = this.maxHp;
    this.updateInterval = 2;          // retarget cadence
    this.moveSpeed = HS.UFO_SPEED;
    this.attackRange = HS.UFO_SCAN_RANGE;
    this.dmgRange = HS.UFO_DMG_RANGE;
    this.dmg = HS.UFO_DMG;
    this.attackInterval = HS.UFO_ATTACK_INTERVAL;
    this._nextAttack = 0;
    this.target = null;
    this.moveDir = { x: 0, y: 0 };
    this.vx = 0; this.vy = 0;
    this.spin = 0;
    this.size = { w: 34, h: 34 };
  }
  update(dt, sim) {
    this.spin += HS.UFO_ROT_SPEED * dt;
    this.x += this.moveDir.x * this.moveSpeed * dt + this.vx * dt;
    this.y += this.moveDir.y * this.moveSpeed * dt + this.vy * dt;
    this.vx *= 0.9; this.vy *= 0.9;
    if (this.target && this.target.dead) this.target = null;
    if (this.target) {
      if (Utils2.dist(this, this.target) <= this.dmgRange) {
        if (sim.time >= this._nextAttack) {
          this._nextAttack = sim.time + this.attackInterval;
          this.target.receiveDamage(sim, this.dmg);
          const fa = Utils2.rand(0, Math.PI * 2);
          this.vx += Math.cos(fa) * HS.UFO_KNOCKBACK;
          this.vy += Math.sin(fa) * HS.UFO_KNOCKBACK;
        }
      }
    }
    if (this.hp <= 0) { this.destroy(sim); return; }
    this._slowT = (this._slowT === undefined ? 0 : this._slowT) + dt;
    if (this._nextSlow < sim.time) {
      this._nextSlow = sim.time + this.updateInterval;
      this.slowUpdate(sim);
    }
  }
  slowUpdate(sim) {
    if (!this.target) {
      const cands = sim.unitsInRange(this, this.attackRange, (u) => !u.isAlien && u.pickable && !(u instanceof Mineral));
      this.target = cands.length ? cands.reduce((a, b) => Utils2.dist(this, a) < Utils2.dist(this, b) ? a : b) : null;
    }
    this.moveDir = (this.target && !this.target.dead && Utils2.dist(this, this.target) > this.dmgRange)
      ? Utils2.normalize({ x: this.target.x - this.x, y: this.target.y - this.y })
      : { x: 0, y: 0 };
  }
  destroy(sim) {
    this.dead = true;
    sim.onUfoKilled(this);
  }
}

class EnergyPacket {
  constructor(x, y, target, previous) {
    this.x = x; this.y = y;
    this.target = target;
    this.previous = previous || null;
    this.dead = false;
    this.kind = "packet";
    this.pickable = false;
  }
  update(dt, sim) {
    if (this.target.dead) { this.dead = true; sim.addFx(this.x, this.y); return; }
    if (Utils2.dist(this, this.target) < 2) {
      this.arrive(sim);
      return;
    }
    const d = Utils2.normalize({ x: this.target.x - this.x, y: this.target.y - this.y });
    this.x += d.x * HS.PACKET_SPEED * dt;
    this.y += d.y * HS.PACKET_SPEED * dt;
  }
  arrive(sim) {
    const target = this.target;
    this.target = null;
    const wantsMore = target.consumeEnergyPacket(sim, this);
    if (this.dead) { sim.addFx(this.x, this.y); return; }
    let next = null;
    if (target instanceof Conduit || wantsMore) {
      next = sim.pickNextPacketTarget(target, target, this.previous);
      if (next == null) next = this.previous;
      this.previous = target;
    }
    if (next && next.dead) next = null;
    if (next == null) {
      if (this.target == null) { this.dead = true; sim.addFx(this.x, this.y); }
      return;
    }
    this.target = next;
    next.awaitingPacket = this;
  }
}

/* ============================== simulation ============================== */
let sim_ = null; // scratch ref for Laser.feeders()

class Sim {
  constructor() {
    sim_ = this;
    this.units = [];
    this.fx = [];
    this.resources = 0;
    this.time = 0;
    this.wave = 0;
    this._nextWave = HS.WAVE_INTERVAL;
    this.bounds = { x: -HS.MAP_HALF, y: -HS.MAP_HALF, w: HS.MAP_HALF * 2, h: HS.MAP_HALF * 2 };
    this.onEvent = null; // (type, payload) → UI/audio hooks
    this.spawnMinerals();
    this.spawnStarters();
  }

  emit(type, payload) { if (this.onEvent) this.onEvent(type, payload || {}); }

  spawn(u) { this.units.push(u); return u; }

  spawnMinerals() {
    for (let i = 0; i < HS.MINERAL_CLUSTERS; i++) {
      let cx, cy;
      do { cx = Utils2.rand(this.bounds.x + 200, this.bounds.x + this.bounds.w - 200); cy = Utils2.rand(this.bounds.y + 200, this.bounds.y + this.bounds.h - 200); }
      while (Math.hypot(cx, cy) < HS.MIN_CENTER_DIST);
      for (let j = 0; j < HS.MINERALS_PER_CLUSTER; j++) {
        const a = Utils2.rand(0, Math.PI * 2), rr = HS.CLUSTER_OFFSET * Math.sqrt(Math.random());
        this.spawn(new Mineral(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.random() < HS.MEGA_CHANCE));
      }
    }
  }

  spawnStarters() {
    this.spawn(new Mineral(HS.START_MEGAMINERAL.x, HS.START_MEGAMINERAL.y, true));
    for (const s of HS.START_BUILDINGS) {
      const u = this.spawn(s.type === "harvester" ? new Harvester(s.x, s.y) : s.type === "conduit" ? new Conduit(s.x, s.y) : new SolarPanel(s.x, s.y));
      u.built = true;
    }
  }

  unitsInRange(u, range, filter) {
    const r2 = range * range;
    const out = [];
    for (const o of this.units) {
      if (o === u || o.dead) continue;
      const dx = o.x - u.x, dy = o.y - u.y;
      if (dx * dx + dy * dy <= r2 && (!filter || filter(o))) out.push(o);
    }
    return out;
  }

  /* direct port of GameEngine.PickNextEnergyPacketTarget:
   * first accepting non-conduit consumer wins immediately; otherwise the
   * player's linked conduit; otherwise a random conduit in range. */
  pickNextPacketTarget(cur, except1, except2) {
    const link = (cur instanceof Conduit) ? cur.liveLink : null;
    const inRange = this.unitsInRange(cur, HS.CONNECT_RANGE_POWER, () => true);
    const conduits = [];
    for (const u of inRange) {
      if (u === except1 || u === except2) continue;
      if (!u.pickable) continue; // packets are not targets
      if (u instanceof Mineral) continue;
      if (u instanceof Conduit) { conduits.push(u); continue; }
      if (!u.canAcceptPacket()) continue;
      return u;
    }
    if (!inRange.length) return link;
    if (link != null) return link;
    return conduits.length ? Utils2.choice(conduits) : link;
  }

  spawnPacket(from, to) {
    this.spawn(new EnergyPacket(from.x, from.y, to, from));
  }

  /* placement: free position, no overlap with pickable units, inside bounds */
  canPlace(x, y, size) {
    if (!Utils2.pointInRect({ x, y }, this.bounds)) return false;
    const rect = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
    for (const u of this.units) {
      if (u.dead || u.kind === "packet") continue;
      if (Utils2.rectsOverlap(rect, u.bounding)) return false;
    }
    return true;
  }

  placeBuilding(type, x, y) {
    const def = SIM_DEFS[type];
    if (!def) return false;
    if (!this.canPlace(x, y, def.size)) return false;
    if (this.resources < def.cost) return false;
    this.resources -= def.cost;
    if (def.packets <= 0) { this.spawn(SIM_MAKE[type](x, y)); this.emit("built", { kind: type }); }
    else {
      this.spawn(new BuildingWIP(x, y, type));
      this.emit("wip", { kind: type });
    }
    this.emit("placed", { kind: type, cost: def.cost });
    return true;
  }

  /* direct port of SpawnEnemyWave */
  updateWaves() {
    if (this.time < this._nextWave) return;
    this._nextWave = this.time + HS.WAVE_INTERVAL;
    this.wave++;
    let count = Math.floor(((this.wave - 5) / 5) * 2);
    if (count < 0) count = 0;
    for (let i = 0; i < count; i++) {
      const pt = Utils2.randomPointOnRect(this.bounds);
      this.spawn(new Ufo(pt.x, pt.y));
    }
    this.emit("wave", { wave: this.wave, count });
  }

  relinkAround(wip, unit) {
    for (const p of this.unitsInRange(wip, HS.CONNECT_RANGE_POWER, (u) => u instanceof EnergyPacket && u.target === wip)) {
      p.target = unit;
    }
    for (const c of this.unitsInRange(wip, HS.CONNECT_RANGE_POWER, (u) => u instanceof Conduit && u.linkedConduit === wip)) {
      c.linkConduit(unit);
    }
  }

  onUfoKilled(u) { this.emit("ufo_killed", {}); }

  addFx(x, y) {
    this.fx.push({ x, y, color: "#7ac8e8", until: this.time + 0.12 });
  }

  update(dt) {
    this.time += dt;
    this.updateWaves();
    for (const u of this.units) if (!u.dead) u.update(dt, this);
    this.units = this.units.filter((u) => !u.dead);
    this.fx = this.fx.filter((f) => f.until > this.time);
  }
}
