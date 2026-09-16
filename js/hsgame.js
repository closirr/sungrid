/* SUNGRID — full structural port of Harvesturr (sbarisic/Harvesturr, C#/Raylib) to JS.
 * C# class/field/method names are kept 1:1 where possible. All numbers are the
 * reference implementation's. Rendering is done by hsdraw.js reading this state. */
"use strict";

/* ---------- Vector2 helpers (System.Numerics mirror) ---------- */
const V2 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a, k) => ({ x: a.x * k, y: a.y * k }),
  dist: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  dist2: (a, b) => { const dx = b.x - a.x, dy = b.y - a.y; return dx * dx + dy * dy; },
  length: (a) => Math.hypot(a.x, a.y),
  normalize: (a) => { const l = Math.hypot(a.x, a.y); return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; },
};

/* ---------- texture sizes (data/textures/*.png — these ARE the hitboxes) ---------- */
const HS_TEX = {
  conduit: [16, 16], conduit_wip: [16, 16],
  harvester: [16, 18], harvester_wip: [16, 18],
  laser: [16, 32], laser_wip: [16, 32],
  solarpanel: [32, 32], solarpanel_wip: [32, 32],
  mineral: [14, 14], megamineral: [24, 24],
  ufo: [32, 32], energy: [6, 6],
};

/* ---------- Utils.cs ---------- */
const HSUtils = {
  RandomInt(incMin, exMax) { return Math.floor(incMin + Math.random() * (exMax - incMin)); },
  RandomFloat(min, max) { return min + Math.random() * (max - min); },
  RandomVec2(a, b) { return { x: this.RandomInt(Math.floor(a.x), Math.floor(b.x)), y: this.RandomInt(Math.floor(a.y), Math.floor(b.y)) }; },
  RandomDir() { const a = this.RandomInt(0, 360) * (Math.PI / 180); return { x: Math.cos(a), y: Math.sin(a) }; },
  RandomPoint(radius, uniform) {
    const ang = Math.random() * Math.PI * 2;
    const rad = uniform ? Math.sqrt(Math.random()) * radius : Math.random() * radius;
    return { x: rad * Math.cos(ang), y: rad * Math.sin(ang) };
  },
  RandomBool() { return this.RandomInt(0, 2) > 0; },
  RandomPointOnCircle(radius) { const a = this.RandomInt(0, 360) * (Math.PI / 180); return { x: radius * Math.cos(a), y: radius * Math.sin(a) }; },
  RandomPointOnRect(x, y, w, h) {
    if (this.RandomBool()) return { x: this.RandomFloat(x, x + w), y: this.RandomBool() ? y : y + h };
    return { x: this.RandomBool() ? x : x + w, y: this.RandomFloat(y, y + h) };
  },
  IsInside(rect, pos) {
    if (pos.x < rect.x || pos.y < rect.y) return false;
    if (pos.x >= rect.x + rect.w || pos.y >= rect.y + rect.h) return false;
    return true;
  },
  RandomFrom(arr) { return arr.length === 0 ? null : arr[this.RandomInt(0, arr.length)]; },
  Rearrange(arr) {
    let left = 0, right = 1;
    while (right < arr.length) {
      const L = arr[left], R = arr[right];
      if (L == null && R != null) { arr[left] = R; arr[right] = L; left++; right++; }
      else if (L == null && R == null) right++;
      else if (L != null && R != null) { left += 2; right += 2; }
      else { left++; right++; }
    }
    return this.IndexOfFirstNull(arr);
  },
  IndexOfFirstNull(arr) { for (let i = 0; i < arr.length; i++) if (arr[i] == null) return i; return -1; },
};

/* ---------- GameUnit base ---------- */
class HSGameUnit {
  constructor(unitName, position) {
    this.Position = position;
    this.Name = unitName;
    this.Pickable = true;
    this.LightningOnDestroy = false;
    this.IsMouseHover = false;
    this.MaxHealth = 100;
    this.Health = this.MaxHealth;
    this.CanLinkEnergy = false;
    this.UpdateInterval = 1;
    this.NextUpdateTime = 0;
    this.AwaitingPacket = null;
    this.Destroyed = false;
    this.DrawColorTint = null; // our renderer hook (C#: DrawColor)
    const tex = HS_TEX[unitName] || [32, 32];
    this.TexWidth = tex[0]; this.TexHeight = tex[1];
    this.Sfx_OnDestroy = null;
  }
  GetBoundingRect() {
    return { x: this.Position.x - this.TexWidth / 2, y: this.Position.y - this.TexHeight / 2, w: this.TexWidth, h: this.TexHeight };
  }
  Destroy(engine, suppressSfx) {
    if (this.Destroyed) return;
    if (!suppressSfx && this.Sfx_OnDestroy && engine.OnSfx) engine.OnSfx(this, this.Sfx_OnDestroy);
    this.Destroyed = true;
    if (this.LightningOnDestroy) engine.AddLightningEffect(this.Position);
    if (engine && engine.OnUnitDestroyed) engine.OnUnitDestroyed(this); // kill counters etc.
  }
  Update(engine, dt) {
    if (this.Health <= 0) { this.Destroy(engine); return; }
    if (this.NextUpdateTime < engine.Time) {
      this.NextUpdateTime = engine.Time + this.UpdateInterval;
      this.SlowUpdate(engine);
    }
  }
  ReceiveDamage(engine, attackingUnit, damage) {
    this.Health -= damage;
    // visual-only: brief white flash on whatever took the hit
    if (engine && engine.Time !== undefined) this.HitFlashUntil = engine.Time + 0.12;
  }
  SlowUpdate(engine) {}
  /* return true to route the packet on from this unit; false = consumed/destroyed */
  ConsumeEnergyPacket(engine, packet) { return true; }
  CanAcceptEnergyPacket() { return false; }
}

/* ---------- UnitConduit ---------- */
class UnitConduit extends HSGameUnit {
  static UNIT_NAME = "conduit";
  static BUILD_COST = 5;
  static ConnectRangePower = 96;
  constructor(position) {
    super(UnitConduit.UNIT_NAME, position);
    this.UpdateInterval = 0.2;
    this.CanLinkEnergy = true;
    this.Heat = 0;
    this.LinkedConduit = null;
    /* set once the player drag-links this node by hand — it then leaves the
       auto-connect pool (its links are user-controlled) */
    this.ManualLink = false;
    /* visual-only load meter (user request): packets per second hitting this node,
       smoothed. Nothing in the sim reads it — overload itself stays 1:1 (Heat). */
    this.LoadCount = 0;
    this._loadTicks = 0;
    this.PacketLoad = 0;
    this.Sfx_OnDestroy = "explosion_small";
  }
  LinkConduit(newConduit) {
    if (newConduit === this) { this.LinkedConduit = null; return; }
    this.LinkedConduit = newConduit;
  }
  get GetLinkedConduit() {
    if (this.LinkedConduit != null && this.LinkedConduit.Destroyed) return null;
    return this.LinkedConduit;
  }
  SlowUpdate(engine) {
    this.Heat -= 2; if (this.Heat < 0) this.Heat = 0;
    // load meter: packets arrive in bursts (panels share spawn ticks), so average over a full second
    this._loadTicks = (this._loadTicks + 1) % 5;
    if (this._loadTicks === 0) { this.PacketLoad = this.PacketLoad * 0.5 + this.LoadCount * 0.5; this.LoadCount = 0; }
    // AUTO-LINK (user request: no manual linking): an unlinked conduit grabs the
    // nearest unlinked conduit in range — one-way hops, no packet bouncing.
    // (Reference used manual drag-linking via the removed picker tool.)
    // Nodes the player has drag-linked by hand (ManualLink) stay user-controlled.
    if (this.GetLinkedConduit == null && !this.ManualLink) {
      let best = null, bestD = UnitConduit.ConnectRangePower;
      for (const u of engine.GetAllGameUnitsArray()) {
        if (!(u instanceof UnitConduit) || u === this || u.Destroyed) continue;
        if (u.GetLinkedConduit != null || u.ManualLink) continue;
        const d = V2.dist(this.Position, u.Position);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best != null) {
        this.LinkConduit(best);
        if (engine.AddLinkEffect) { engine.AddLinkEffect(this.Position); engine.AddLinkEffect(best.Position); }
      }
    }
  }
  Update(engine, dt) {
    if (this.LinkedConduit != null && this.LinkedConduit.Destroyed) this.LinkedConduit = null;
    super.Update(engine, dt);
  }
  ConsumeEnergyPacket(engine, packet) {
    this.LoadCount++; // load meter (visual only)
    this.Heat++;
    if (this.Heat > 100) { this.Heat = 100; packet.Destroy(engine); }
    return super.ConsumeEnergyPacket(engine, packet);
  }
  ToString() { return "Heat: " + this.Heat; }
}

/* ---------- UnitSolarPanel ---------- */
class UnitSolarPanel extends HSGameUnit {
  static UNIT_NAME = "solarpanel";
  static BUILD_COST = 15;
  /* DEV TWEAK (user request: livelier network / faster construction).
     Reference emits 1 packet per 2s — set back to 2 for strict 1:1. */
  static PacketInterval = 1;
  constructor(position) {
    super(UnitSolarPanel.UNIT_NAME, position);
    this.UpdateInterval = UnitSolarPanel.PacketInterval;
    this.CanLinkEnergy = true;
    this.Sfx_OnDestroy = "explosion_big";
  }
  SlowUpdate(engine) {
    const inRange = engine.PickInRange(this.Position, UnitConduit.ConnectRangePower)
      .filter((u) => u instanceof UnitConduit || u instanceof UnitBuildingWIP);
    const target = HSUtils.RandomFrom(inRange);
    if (target == null) return;
    engine.Spawn(new UnitEnergyPacket(this.Position, target));
  }
}

/* ---------- UnitBuildingWIP ---------- */
class UnitBuildingWIP extends HSGameUnit {
  constructor(engine, position, BaseBuildingType) {
    super(BaseBuildingType.UNIT_NAME + "_wip", position);
    this.BaseBuildingType = BaseBuildingType;
    this.MaxBuildCost = BaseBuildingType.BUILD_COST;
    this.BuildCostRemaining = this.MaxBuildCost;
    this.CanLinkEnergy = true;
    if (engine.DebugFastBuild) { this.MaxBuildCost = 1; this.BuildCostRemaining = 1; }
    this.Sfx_OnDestroy = "explosion_small";
  }
  ConsumeEnergyPacket(engine, packet) {
    packet.Destroy(engine, true);
    this.LastPacketTime = engine.Time; // renderer: starved-site "NO POWER" feedback
    this.BuildCostRemaining--;
    if (this.BuildCostRemaining <= 0) {
      if (engine.OnBuildingFinished) engine.OnBuildingFinished(this);
      this.Destroy(engine, true);
      const unit = new this.BaseBuildingType(this.Position);
      engine.Spawn(unit);
      // relink packets and conduits to the constructed building
      for (const p of engine.PickInRange(this.Position, UnitConduit.ConnectRangePower, true)) {
        if (p instanceof UnitEnergyPacket && !p.Destroyed && p.Target === this) p.Target = unit;
      }
      for (const c of engine.PickInRange(this.Position, UnitConduit.ConnectRangePower)) {
        if (c instanceof UnitConduit && c.GetLinkedConduit === this) c.LinkConduit(unit);
      }
    }
    return false;
  }
  CanAcceptEnergyPacket() { return true; }
}

/* ---------- UnitEnergyPacket ---------- */
class UnitEnergyPacket extends HSGameUnit {
  constructor(position, target, previous) {
    super(UnitEnergyPacket.UNIT_NAME, position);
    this.Target = target;
    this.Previous = previous || null;
    this.Pickable = false;
    this.LightningOnDestroy = true;
    this.Sfx_OnDestroy = "energy_packet_explode";
  }
  Update(engine, dt) {
    const MoveSpeed = 96;
    if (this.Target.Destroyed) { this.Destroy(engine); return; }
    const targetPos = this.Target.Position;
    if (V2.dist(this.Position, targetPos) < 2) { this.OnTargetReached(engine, this.Target); return; }
    const dir = V2.normalize(V2.sub(targetPos, this.Position));
    this.Position = V2.add(this.Position, V2.scale(dir, MoveSpeed * dt));
  }
  OnTargetReached(engine, target) {
    this.Target = null;
    const pickNextAnyway = target.ConsumeEnergyPacket(engine, this);
    if (this.Destroyed) return;
    let next = null;
    if (target instanceof UnitConduit || pickNextAnyway) {
      next = engine.PickNextEnergyPacketTarget(target, target, this.Previous);
      if (next == null) next = this.Previous;
      this.Previous = target;
    }
    if (next != null && next.Destroyed) next = null;
    if (next == null) {
      if (this.Target == null) { engine.AddPuffEffect(this.Position); this.Destroy(engine); }
      return;
    }
    this.Target = next;
    this.Target.AwaitingPacket = this;
  }
}
UnitEnergyPacket.UNIT_NAME = "energy";

/* ---------- UnitLaser ---------- */
class UnitLaser extends HSGameUnit {
  static UNIT_NAME = "laser";
  static BUILD_COST = 10;
  static SINGLE_LASER_DMG = 1;
  static SINGLE_LASER_RNG = 64;
  constructor(position) {
    super(UnitLaser.UNIT_NAME, position);
    this.MaxEnergyCharges = 60;
    this.EnergyCharges = 0;
    this.UpdateInterval = 0.1;
    this.CanLinkEnergy = true;
    this.CalculationDirty = true;
    this.AttackDamage = 1;
    this.AttackRange = UnitLaser.SINGLE_LASER_RNG;
    this.IsAttacking = false;
    this.Target = null;
    this.LinkedLaser = null;
    this.ManualLink = false; // drag-linked by hand — leaves the auto-feed pool
    this.Sfx_OnDestroy = "explosion_big";
    this.CalculateRangeAndDamage();
  }
  ContainsLaserInLinkChain(laser) {
    if (this.GetLinkedLaser === laser) return true;
    if (this.GetLinkedLaser != null && this.GetLinkedLaser.ContainsLaserInLinkChain(laser)) return true;
    return false;
  }
  LinkLaser(newLaser) {
    if (newLaser == null || newLaser === this) {
      const oldLaser = this.LinkedLaser;
      this.LinkedLaser = null;
      if (oldLaser != null && !oldLaser.Destroyed) oldLaser.CalculationDirty = true;
      this.CalculationDirty = true;
      return;
    }
    if (newLaser.GetLinkedLaser === this) newLaser.LinkLaser(null);
    if (newLaser.ContainsLaserInLinkChain(this)) this.LinkedLaser = null;
    else { this.LinkedLaser = newLaser; this.LinkedLaser.CalculationDirty = true; }
  }
  get GetLinkedLaser() {
    if (this.LinkedLaser != null && this.LinkedLaser.Destroyed) return null;
    return this.LinkedLaser;
  }
  GetLinkedLasers(engine) {
    return engine.GetAllGameUnits().filter((u) => u instanceof UnitLaser && u.GetLinkedLaser === this);
  }
  CalculateRangeAndDamage() {
    if (!this.CalculationDirty) return;
    this.CalculationDirty = false;
    this.AttackDamage = UnitLaser.SINGLE_LASER_DMG;
    for (const l of this.GetLinkedLasers(this.engine || HSEngine)) {
      l.CalculateRangeAndDamage();
      this.AttackDamage += l.AttackDamage;
    }
    this.AttackRange = UnitLaser.SINGLE_LASER_RNG + (UnitLaser.SINGLE_LASER_RNG * (this.AttackDamage / UnitLaser.SINGLE_LASER_DMG - 1) * 0.2);
    if (this.EnergyCharges <= 0) { this.AttackDamage = 0; this.AttackRange = UnitLaser.SINGLE_LASER_RNG; }
    if (this.LinkedLaser != null && !this.LinkedLaser.Destroyed) this.LinkedLaser.CalculationDirty = true;
  }
  Update(engine, dt) {
    this.engine = engine;
    if (this.LinkedLaser != null && this.LinkedLaser.Destroyed) this.LinkedLaser = null;
    this.CalculateRangeAndDamage();
    super.Update(engine, dt);
    if (this.EnergyCharges <= 0) this.DrawColorTint = "gray";
    else this.DrawColorTint = null;
  }
  SlowUpdate(engine) {
    // AUTO-FEED (user request: automatic intuitive connections): an unlinked
    // laser becomes a feeder of the nearest unlinked laser in base range —
    // chains stack damage exactly like manual reference links. LinkLaser's
    // cycle guard rejects invalid topologies.
    if (this.GetLinkedLaser == null && !this.ManualLink) {
      let best = null, bestD = UnitLaser.SINGLE_LASER_RNG;
      for (const u of engine.GetAllGameUnitsArray()) {
        if (!(u instanceof UnitLaser) || u === this || u.Destroyed) continue;
        if (u.GetLinkedLaser != null || u.ManualLink) continue;
        const d = V2.dist(this.Position, u.Position);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best != null) {
        this.LinkLaser(best);
        if (this.GetLinkedLaser === best && engine.AddLinkEffect) { engine.AddLinkEffect(this.Position); engine.AddLinkEffect(best.Position); }
      }
    }
    if (this.EnergyCharges <= 0) { this.IsAttacking = false; return; }
    this.CalculationDirty = true;
    // linked lasers don't attack; they drain while the receiver attacks
    if (this.GetLinkedLaser != null) {
      this.IsAttacking = this.GetLinkedLaser.IsAttacking;
      if (this.IsAttacking) this.EnergyCharges--;
      return;
    }
    if (this.Target == null) {
      const aliens = engine.PickInRange(this.Position, this.AttackRange).filter((u) => u instanceof GameUnitAlien);
      this.Target = HSUtils.RandomFrom(aliens);
    }
    if (this.Target != null && !this.Target.Destroyed) {
      this.EnergyCharges--;
      this.Target.ReceiveDamage(engine, this, this.AttackDamage);
    }
    if (this.Target != null && this.Target.Destroyed) this.Target = null;
    if (this.Target != null && V2.dist(this.Position, this.Target.Position) > this.AttackRange) this.Target = null;
    this.IsAttacking = this.Target != null;
  }
  Destroy(engine, suppressSfx) {
    super.Destroy(engine, suppressSfx);
    if (this.LinkedLaser != null && !this.LinkedLaser.Destroyed) this.LinkedLaser.CalculationDirty = true;
  }
  ConsumeEnergyPacket(engine, packet) {
    if (this.EnergyCharges >= this.MaxEnergyCharges) return true;
    this.EnergyCharges += 15;
    packet.Destroy(engine, true);
    return super.ConsumeEnergyPacket(engine, packet);
  }
  CanAcceptEnergyPacket() {
    if (this.AwaitingPacket != null && !this.AwaitingPacket.Destroyed) return false;
    return this.EnergyCharges < this.MaxEnergyCharges;
  }
}

/* ---------- UnitHarvester ---------- */
class UnitHarvester extends HSGameUnit {
  static UNIT_NAME = "harvester";
  static BUILD_COST = 10;
  static ConnectRangeHarvest = 64;
  constructor(position) {
    super(UnitHarvester.UNIT_NAME, position);
    this.EnergyCharges = 0;
    this.LastEnergyChargeUseTime = 0;
    this.UpdateInterval = 5;
    this.CanLinkEnergy = true;
    this.Sfx_OnDestroy = "explosion_small";
  }
  Update(engine, dt) {
    super.Update(engine, dt);
    if (this.EnergyCharges <= 0 && (engine.Time - this.LastEnergyChargeUseTime) > this.UpdateInterval) this.DrawColorTint = "gray";
    else this.DrawColorTint = null;
  }
  SlowUpdate(engine) {
    if (this.EnergyCharges <= 0) return;
    const minerals = engine.PickInRange(this.Position, UnitHarvester.ConnectRangeHarvest).filter((u) => u instanceof UnitMineral);
    if (minerals.length === 0) {
      this.Destroy(engine);
      engine.AddResource(2);
      return;
    }
    const targetMineral = HSUtils.RandomFrom(minerals);
    if (targetMineral == null || targetMineral.Destroyed) return;
    if (targetMineral.HarvestMineral()) {
      this.EnergyCharges--;
      if (this.EnergyCharges <= 0) { this.EnergyCharges = 0; this.LastEnergyChargeUseTime = engine.Time; }
      engine.AddResource(1);
      engine.AddFloatText({ x: this.Position.x, y: this.Position.y - 18 }, "+1");
      this.HarvestFxUntil = engine.Time + 0.3; // visual-only: mining beam + drill spin
      this.HarvestFxTarget = targetMineral;
    }
  }
  ConsumeEnergyPacket(engine, packet) {
    this.EnergyCharges++;
    packet.Destroy(engine, true);
    return super.ConsumeEnergyPacket(engine, packet);
  }
  CanAcceptEnergyPacket() {
    if (this.AwaitingPacket != null && !this.AwaitingPacket.Destroyed) return false;
    return this.EnergyCharges <= 1;
  }
}

/* ---------- UnitMineral ---------- */
class UnitMineral extends HSGameUnit {
  static UNIT_NAME_Mineral = "mineral";
  static UNIT_NAME_Megamineral = "megamineral";
  constructor(position, megamineral) {
    super(megamineral ? UnitMineral.UNIT_NAME_Megamineral : UnitMineral.UNIT_NAME_Mineral, position);
    this.Megamineral = !!megamineral;
    this.MineralCount = megamineral ? HSUtils.RandomInt(300, 400) : HSUtils.RandomInt(20, 40);
  }
  HarvestMineral() {
    let success = false;
    if (this.MineralCount > 0) { this.MineralCount--; success = true; }
    if (this.MineralCount <= 0) this.Destroyed = true;
    return success;
  }
  ToString() { return "Minerals: " + this.MineralCount; }
}

/* ---------- aliens ---------- */
class GameUnitAlien extends HSGameUnit {
  constructor(unitName, position) {
    super(unitName, position);
    this.AttackRange = 4000;          // scan range
    this.AttackDamageRange = 16;      // deal damage range
    this.AttackDamage = 5;
    this.AttackInterval = 1;
    this.NextAttackTime = 0;
    this.Rotate = true;
    this.RotationSpeed = 0;
    this.MoveSpeed = 0;
    this.Velocity = { x: 0, y: 0 };
    this.MoveDirection = { x: 0, y: 0 };
    this.AttackTarget = null;
    this.EnemyInDamageRange = false;
    this.Rotation = 0;
    this.UpdateInterval = 2;
    this.MaxHealth = 50;
    this.Health = this.MaxHealth;
  }
  ApplyForce(vec) { this.Velocity = V2.add(this.Velocity, vec); }
  Update(engine, dt) {
    if (this.Rotate && this.RotationSpeed !== 0) this.Rotation = engine.Time * this.RotationSpeed;
    this.Position = V2.add(this.Position, V2.add(V2.scale(this.MoveDirection, this.MoveSpeed * dt), V2.scale(this.Velocity, dt)));
    this.Velocity = V2.scale(this.Velocity, 0.9);
    if (this.AttackTarget != null && this.AttackTarget.Destroyed) this.AttackTarget = null;
    if (this.AttackTarget != null) {
      if (V2.dist(this.Position, this.AttackTarget.Position) <= this.AttackDamageRange) {
        this.EnemyInDamageRange = true;
        if (this.NextAttackTime < engine.Time) {
          this.NextAttackTime = engine.Time + this.AttackInterval;
          this.Attack(engine, this.AttackTarget);
        }
      } else this.EnemyInDamageRange = false;
    }
    if (this.Health <= 0) { this.Destroy(engine); return; }
    if (this.NextUpdateTime < engine.Time) {
      this.NextUpdateTime = engine.Time + this.UpdateInterval;
      this.SlowUpdate(engine);
    }
  }
  SlowUpdate(engine) {
    if (this.AttackTarget == null) this.AttackTarget = engine.PickNextAttackTarget(this.Position, this.AttackRange, true);
    this.MoveDirection = this.CalculateMoveDirection();
  }
  Attack(engine, target) {
    if (engine.OnSfx) engine.OnSfx(this, "hit");
    target.ReceiveDamage(engine, this, this.AttackDamage);
    if (engine.AddHitEffect) engine.AddHitEffect(target.Position); // red spark at the impact point
    this.ApplyForce(V2.scale(HSUtils.RandomDir(), 128));
  }
  Destroy(engine, suppressSfx) {
    super.Destroy(engine, suppressSfx);
    if (engine && engine.AddBoomEffect) engine.AddBoomEffect(this.Position); // visible death, no silent vanish
  }
  CalculateMoveDirection() {
    if (this.AttackTarget == null || this.EnemyInDamageRange) return { x: 0, y: 0 };
    return V2.normalize(V2.sub(this.AttackTarget.Position, this.Position));
  }
}

class UnitAlienUfo extends GameUnitAlien {
  static UNIT_NAME = "ufo";
  constructor(position) {
    super(UnitAlienUfo.UNIT_NAME, position);
    this.RotationSpeed = 48;
    this.MoveSpeed = 8;
  }
}

/* ---------- enemy variety (user request: "різних ворогів", "рівні") ----------
 * Authorized deviation from the reference (a single UFO): two extra hulls bracket the
 * original so waves read as levels — fast fragile scouts from the first raids, slow
 * heavy cruisers once the base has real defenses. Lasers, targeting and pick logic
 * treat all of them identically (shared GameUnitAlien). */
class UnitAlienScout extends UnitAlienUfo {
  static UNIT_NAME = "scout";
  constructor(position) {
    super(position);
    this.Name = UnitAlienScout.UNIT_NAME;
    this.MaxHealth = 20;
    this.Health = this.MaxHealth;
    this.MoveSpeed = 24;
    this.AttackDamage = 2;
    this.AttackInterval = 0.8;
    this.UpdateInterval = 1; // fast unit — re-scan targets more often
    this.Sfx_OnDestroy = "explosion_small";
  }
}
class UnitAlienCruiser extends UnitAlienUfo {
  static UNIT_NAME = "cruiser";
  constructor(position) {
    super(position);
    this.Name = UnitAlienCruiser.UNIT_NAME;
    this.MaxHealth = 160;
    this.Health = this.MaxHealth;
    this.MoveSpeed = 5;
    this.AttackDamage = 12;
    this.AttackInterval = 1.2;
    this.Sfx_OnDestroy = "explosion_big";
  }
}

/* wave composition by level tier: scouts open the game, the reference UFO is the
 * backbone, cruisers gate the late levels; every 10th wave is a boss raid */
function HSWaveEnemy(wave, position) {
  if (wave < 10) return new UnitAlienScout(position);
  if (wave < 15) return HSUtils.RandomInt(0, 100) < 50 ? new UnitAlienScout(position) : new UnitAlienUfo(position);
  if (wave < 20) return HSUtils.RandomInt(0, 100) < 30 ? new UnitAlienScout(position) : new UnitAlienUfo(position);
  const roll = HSUtils.RandomInt(0, 100);
  if (roll < 20) return new UnitAlienScout(position);
  if (roll < 75) return new UnitAlienUfo(position);
  return new UnitAlienCruiser(position);
}

/* ---------- build footprints (user request: sprite-sized, VISIBLE placement bounds) ----------
 * The reference blocks placement with texture-size AABBs (32×32 for a panel), which in iso
 * cover far more ground than the drawn sprite — the player could not tell why "BLOCKED"
 * fired or where their tile ended. User-authorized deviation: every building blocks a
 * footprint EQUAL to its drawn iso base diamond (2:1), and the build ghost snaps to that
 * footprint's tiling lattice so rows line up exactly. Overlap is exclusive — tiles that
 * merely touch an edge or corner are legal, mirroring the reference's exclusive rect pick. */
function HSFootprintWidth(u) {
  if (u instanceof UnitBuildingWIP) u = u.BaseBuildingType;
  if (u == null) return 16;
  if (typeof u.Footprint === "number") return u.Footprint; // build tools carry their own
  if (u === UnitSolarPanel || u instanceof UnitSolarPanel) return 36;
  if (u instanceof UnitMineral) return u.Megamineral ? 18 : 12;
  return 16; // conduit, laser, harvester — drawn bases are ~14-16 wide
}

/* footprint diamonds tile the plane; the ghost snaps to that lattice (same-parity points)
 * so buildings land edge-to-edge in clean rows */
function HSBuildSnap(width, pos) {
  const sx = width / 2, sy = width / 4; // half-diamond steps
  let i = Math.round(pos.x / sx), j = Math.round(pos.y / sy);
  if (((i + j) % 2 + 2) % 2 !== 0) { // landed between tiles — step to the closest legal one
    let best = [i, j], bestD = Infinity;
    for (const [ci, cj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      const d = Math.abs(pos.x - ci * sx) + 2 * Math.abs(pos.y - cj * sy);
      if (d < bestD) { bestD = d; best = [ci, cj]; }
    }
    [i, j] = best;
  }
  return { x: i * sx, y: j * sy };
}

/* exclusive diamond overlap: |dx| + 2|dy| < (wA + wB)/2 (all footprints are 2:1) */
function HSFootprintsOverlap(aPos, aW, bPos, bW) {
  return Math.abs(aPos.x - bPos.x) + 2 * Math.abs(aPos.y - bPos.y) < (aW + bW) / 2;
}

/* ---------- tools (GameTool*) ---------- */
class HSGameTool {
  constructor(name) { this.Name = name; this.Active = false; this.ToolGhost = null; this.MouseClickPos = null; this.InMouseClick = false; }
  OnSelected() {}
  OnWorldMousePress(engine, worldPos, press) {
    if (press) this.OnWorldClick(engine, worldPos);
    if (press) { this.MouseClickPos = worldPos; this.InMouseClick = true; }
    else if (this.InMouseClick) {
      this.InMouseClick = false;
      const endPos = engine.MousePosWorld;
      if (this.MouseClickPos.x !== endPos.x || this.MouseClickPos.y !== endPos.y) this.OnMouseDrag(engine, this.MouseClickPos, endPos);
    }
  }
  OnMouseDrag(engine, worldStart, worldEnd) {}
  OnWorldClick(engine, worldPos) {}
  Update(engine, dt) {}
  DrawWorldData(engine) { return null; } // our renderer hook
}

class HSGameToolPicker extends HSGameTool {
  constructor() { super("Select / Link"); }
  OnWorldClick(engine, worldPos) {
    const picked = engine.Pick(engine.MousePosWorld).find(() => true) || null;
    if (picked instanceof GameUnitAlien) {
      const force = 256;
      picked.ApplyForce(V2.scale(HSUtils.RandomDir(), force * 2)); // Random(new V2(-256), new V2(256)) per-axis
    }
  }
  OnMouseDrag(engine, worldStart, worldEnd) {
    const unitA = engine.Pick(worldStart).find(() => true) || null;
    let unitB = engine.Pick(worldEnd).find(() => true) || null;
    if (unitB != null && !unitB.CanLinkEnergy) unitB = null;
    if (unitA === unitB) unitB = null;

    if (unitA instanceof UnitConduit) {
      if (unitB != null && V2.dist(unitA.Position, unitB.Position) < UnitConduit.ConnectRangePower) {
        const wasLinked = unitA.GetLinkedConduit === unitB;
        unitA.LinkConduit(unitB);
        if (!wasLinked && engine.AddLinkEffect) { engine.AddLinkEffect(unitA.Position); engine.AddLinkEffect(unitB.Position); }
      } else unitA.LinkConduit(null);
    }
    if (unitA instanceof UnitLaser) {
      if (unitB instanceof UnitLaser && V2.dist(unitA.Position, unitB.Position) < unitA.AttackRange) {
        const wasLinked = unitA.GetLinkedLaser === unitB;
        unitA.LinkLaser(unitB);
        if (!wasLinked && engine.AddLinkEffect) { engine.AddLinkEffect(unitA.Position); engine.AddLinkEffect(unitB.Position); }
      } else unitA.LinkLaser(null);
    }
  }
  GetAttackRangeProxy() {}
}

class HSGameToolBuilder extends HSGameTool {
  constructor(name, buildCost) { super(name); this.BuildCost = buildCost; this.CurrentLocationValid = false; this.Footprint = 16; this.GhostPos = null; }
  Update(engine, dt) {
    // ghost snaps to this building's footprint lattice (user request) — what you see is
    // exactly the tile you'll occupy, rows line up edge-to-edge
    this.GhostPos = HSBuildSnap(this.Footprint, engine.MousePosWorld);
    this.CurrentLocationValid = this.IsValidLocation(engine, this.GhostPos);
  }
  IsValidLocation(engine, mouseWorld) {
    if (this.ToolGhost == null) return true;
    const w = HSFootprintWidth(this);
    for (const u of engine.GetAllGameUnitsArray()) {
      if (u == null || u.Destroyed || u instanceof UnitEnergyPacket) continue;
      if (HSFootprintsOverlap(mouseWorld, w, u.Position, HSFootprintWidth(u))) return false;
    }
    return true;
  }
  OnWorldClick(engine, worldPos) {
    // place where the ghost actually shows (snapped), not where the raw mouse point is
    const pos = this.GhostPos || worldPos;
    if (this.CurrentLocationValid) {
      if (engine.TryConsumeResources(this.BuildCost)) {
        if (engine.AddPlaceEffect) engine.AddPlaceEffect(pos); // green flash on valid placement
        this.OnSpawnSuccess(engine, pos);
      }
    }
  }
  OnSpawnSuccess(engine, worldPos) {}
}

class HSGameToolConduit extends HSGameToolBuilder {
  constructor() { super("Conduit", 5); this.ToolGhost = HS_TEX.conduit; }
  OnSpawnSuccess(engine, worldPos) { engine.Spawn(new UnitBuildingWIP(engine, worldPos, UnitConduit)); }
}
class HSGameToolHarvester extends HSGameToolBuilder {
  constructor() { super("Harvester", 8); this.ToolGhost = HS_TEX.harvester; }
  OnSpawnSuccess(engine, worldPos) { engine.Spawn(new UnitBuildingWIP(engine, worldPos, UnitHarvester)); }
}
class HSGameToolSolarPanel extends HSGameToolBuilder {
  constructor() { super("Solar Panel", 10); this.ToolGhost = HS_TEX.solarpanel; this.Footprint = 36; } // drawn base = 36×18 iso diamond
  OnSpawnSuccess(engine, worldPos) { engine.Spawn(new UnitBuildingWIP(engine, worldPos, UnitSolarPanel)); }
}
class HSGameToolLaser extends HSGameToolBuilder {
  constructor() { super("Laser", 10); this.ToolGhost = HS_TEX.laser; }
  OnSpawnSuccess(engine, worldPos) { engine.Spawn(new UnitBuildingWIP(engine, worldPos, UnitLaser)); }
}

/* ---------- Manual drag-link (user request) ----------
 * Press a conduit/laser, drag onto another node, release: energy gets routed that way.
 * The same drag again removes the link. Rules ported from the reference
 * GameToolPicker.OnMouseDrag (range checks, drag-to-nowhere unlinks) + the toggle.
 * Nodes touched by hand (ManualLink) leave the auto-connect pool for the session. */
function HSManualLink(engine, unitA, unitB) {
  if (unitA == null || unitA.Destroyed) return "none";
  unitA.ManualLink = true;
  const other = unitB && unitB !== unitA && !unitB.Destroyed ? unitB : null;
  if (other && (other instanceof UnitConduit || other instanceof UnitLaser)) other.ManualLink = true;

  if (unitA instanceof UnitConduit) {
    if (other instanceof UnitConduit && V2.dist(unitA.Position, other.Position) < UnitConduit.ConnectRangePower) {
      const was = unitA.GetLinkedConduit === other;
      unitA.LinkConduit(was ? null : other);
      if (!was && engine.AddLinkEffect) { engine.AddLinkEffect(unitA.Position); engine.AddLinkEffect(other.Position); }
      return was ? "unlink" : "link";
    }
    unitA.LinkConduit(null); // released on nothing valid — clear the node (reference rule)
    return "unlink";
  }
  if (unitA instanceof UnitLaser) {
    if (other instanceof UnitLaser && V2.dist(unitA.Position, other.Position) < unitA.AttackRange) {
      const was = unitA.GetLinkedLaser === other;
      unitA.LinkLaser(was ? null : other);
      const linked = unitA.GetLinkedLaser === other;
      if (!was && linked && engine.AddLinkEffect) { engine.AddLinkEffect(unitA.Position); engine.AddLinkEffect(other.Position); }
      if (!was && !linked) return "rejected"; // cycle guard refused the topology
      return was ? "unlink" : "link";
    }
    unitA.LinkLaser(null);
    return "unlink";
  }
  return "none";
}

/* ---------- laser chain + auto-link previews (clarity for the player) ----------
 * AttackDamage reads 0 while a laser is unpowered, which hides the chain
 * structure. HSPotentialDamage keeps the feeders' contribution visible so the
 * placement preview, hover readout and unit panel can show real numbers. */
function HSPotentialDamage(laser) {
  if (laser == null || laser.Destroyed) return 0;
  let dmg = 1;
  for (const f of laser.GetLinkedLasers(laser.engine || HSEngine)) dmg += HSPotentialDamage(f);
  return dmg;
}
function HSPotentialRange(dmg) {
  return UnitLaser.SINGLE_LASER_RNG * (1 + 0.2 * (dmg - 1));
}

/* Which units will auto-connect to a NEW node placed at pos (conduit or laser)?
 * Simulates the real rule in spawn order: each free node links to its nearest
 * free node in range (the new node counts as free, but links last) — so the
 * preview only ever draws links that will actually form, never wishful ones. */
function HSAutoLinkPreview(engine, pos, kind) {
  const isLaser = kind === "laser";
  const range = isLaser ? UnitLaser.SINGLE_LASER_RNG : UnitConduit.ConnectRangePower;
  const free = engine.GetAllGameUnitsArray().filter((u) =>
    !u.Destroyed &&
    (isLaser ? u instanceof UnitLaser : u instanceof UnitConduit) &&
    (isLaser ? u.GetLinkedLaser : u.GetLinkedConduit) == null && !u.ManualLink);
  const taken = new Set();
  const fedBy = [];
  for (const u of free) {
    if (taken.has(u)) continue; // an earlier node already linked to this one
    let best = null, bestD = range;
    const dGhost = V2.dist(u.Position, pos);
    if (dGhost < bestD) { bestD = dGhost; best = "GHOST"; }
    for (const o of free) {
      if (o === u || taken.has(o)) continue;
      const d = V2.dist(u.Position, o.Position);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best === "GHOST") { fedBy.push(u); taken.add(u); }
    else if (best != null) { taken.add(u); taken.add(best); }
  }
  return fedBy;
}

/* ---------- GameMap ---------- */
const HSMap = {
  TileWidth: 32, TileHeight: 32,
  X: 0, Y: 0, Width: 0, Height: 0,
  Tiles: null,
  get TotalWidth() { return this.Width * this.TileWidth; },
  get TotalHeight() { return this.Height * this.TileHeight; },
  Load(engine, mapName) {
    // reference loads a TMX CSV; we generate the same default "test" layout: 106×106
    this.Width = 106; this.Height = 106;
    this.Tiles = new Array(this.Width * this.Height).fill(0);
    this.X = -(this.TotalWidth / 2);
    this.Y = -(this.TotalHeight / 2);
    engine.ClearGameState();
    this.SpawnAllMinerals(engine);
    engine.SpawnStarters();
  },
  GetBounds() { return { x: this.X, y: this.Y, w: this.TotalWidth, h: this.TotalHeight }; },
  IsInBounds(pos) { return HSUtils.IsInside(this.GetBounds(), pos); },
  /* reference GameMap.RandomPoint(DistanceFromBounds): uniform point inside the map rect (inset). */
  RandomPoint(distanceFromBounds = 0) {
    const b = this.GetBounds();
    const x0 = b.x + distanceFromBounds, y0 = b.y + distanceFromBounds;
    const x1 = x0 + (b.w - distanceFromBounds * 2), y1 = y0 + (b.h - distanceFromBounds * 2);
    return { x: HSUtils.RandomFloat(x0, x1), y: HSUtils.RandomFloat(y0, y1) };
  },
  RandomMineralPoint(distanceFromBounds) {
    let pt = { x: 0, y: 0 };
    while (V2.dist({ x: 0, y: 0 }, pt) < 120) pt = this.RandomPoint(distanceFromBounds);
    return pt;
  },
  DestroyAllMinerals(engine) {
    for (const u of engine.GetAllGameUnits()) if (u instanceof UnitMineral) u.Destroyed = true;
  },
  SpawnAllMinerals(engine) {
    for (let i = 0; i < 50; i++) {
      const pt = this.RandomMineralPoint(200);
      for (let j = 0; j < 15; j++) {
        const offset = HSUtils.RandomPoint(120);
        engine.Spawn(new UnitMineral(V2.add(pt, offset), HSUtils.RandomInt(0, 100) > 80));
      }
    }
  },
};

/* ---------- GameEngine ---------- */
const HSEngine = {
  DebugView: true,
  DebugFast: false,
  DebugFastBuild: true,   // shipped default in Program.cs
  DebugDrawLaserRange: false,

  GameUnits: [],
  Effects: [],
  /* TEST TWEAK (user request): dev starting funds so the whole palette can be
     playtested immediately. Reference 1:1 starts at 0 R$ — set back to 0 for the true game. */
  StartMoney: 200,
  Resources: 0,
  IsGameRunning: false,

  ScreenWidth: 1280,
  ScreenHeight: 720,
  Camera: { target: { x: 0, y: 0 }, offset: { x: 640, y: 360 }, zoom: 2 },
  MousePosScreen: { x: 0, y: 0 },
  MousePosWorld: { x: 0, y: 0 },
  Zoom: 2,
  DrawZoomDetails: true,
  Time: 0,

  IsMouseDragging: false,
  _timerRunning: false,
  _waveAcc: 0,
  CurWave: 0,
  NextWaveSpawnTime: 0,
  SimulatedSteps: 0,
  _timerElapsed: 0,

  OnSfx: null,
  OnLoseCheck: null,

  ClearGameState() {
    this.IsGameRunning = false;
    this._timerElapsed = 0;
    this.SimulatedSteps = 0;
    for (const u of this.GetAllGameUnits(true)) u.Destroy(this, true);
    this.GameUnits = [];
    this.Effects = [];
    this.Resources = this.StartMoney;
    this.CurWave = 0;
    this.NextWaveSpawnTime = 0;
    this._timerElapsed = 0;
  },

  SpawnStarters() {
    this.Spawn(new UnitMineral({ x: -36, y: -20 }, true));
    this.Spawn(new UnitHarvester({ x: 10, y: -31 }));
    this.Spawn(new UnitConduit({ x: 30, y: 0 }));
    this.Spawn(new UnitSolarPanel({ x: 34, y: 50 }));
  },

  Update(dt, paused) {
    const reallyPaused = paused || (window.App && window.App.paused);
    // GUI input runs every call (mirrors Update being called even when paused)
    if (window.UI && UI.UpdateInput) UI.UpdateInput(this, dt);

    if (!reallyPaused) {
      for (let i = 0; i < this.GameUnits.length; i++) {
        const u = this.GameUnits[i];
        if (u == null) continue;
        if (u.Destroyed) { this.GameUnits[i] = null; continue; }
        u.IsMouseHover = this.MousePosWorld.x >= u.Position.x - u.TexWidth / 2 && this.MousePosWorld.x <= u.Position.x + u.TexWidth / 2 &&
                         this.MousePosWorld.y >= u.Position.y - u.TexHeight / 2 && this.MousePosWorld.y <= u.Position.y + u.TexHeight / 2;
        u.Update(this, dt);
      }
      if (this.NextWaveSpawnTime < this.Time) {
        this.NextWaveSpawnTime = this.Time + 10;
        this.SpawnEnemyWave(this.CurWave++);
      }
    }
    if (this.OnLoseCheck) this.OnLoseCheck();
  },

  Lockstep(stepInterval, maxTime) {
    // Time advances by real accumulated time (mirrors GameTimer elapsed)
    const requiredSteps = Math.floor((this._timerElapsed / stepInterval) - this.SimulatedSteps);
    if (requiredSteps <= 0) { this.Update(stepInterval, true); return; }
    for (let i = 0; i < requiredSteps; i++) {
      this.Update(stepInterval, false);
      this.SimulatedSteps++;
    }
  },

  /* GameTimer mirror — advanced by the frame loop while running */
  TickTimer(dt) { if (this._timerRunning) this._timerElapsed += dt; },
  PauseGame(pause) {
    const paused = !this._timerRunning;
    if (paused && !pause) this._timerRunning = true;
    else if (!paused && pause) this._timerRunning = false;
  },

  get Time() { return this._timerElapsed; },

  SpawnEnemyWave(wave) {
    let count = Math.floor(((wave - 5) / 5) * 2.0);
    if (count < 0) count = 0;
    const spawns = [];
    for (let i = 0; i < count; i++) {
      const pt = HSUtils.RandomPointOnRect(HSMap.GetBounds().x, HSMap.GetBounds().y, HSMap.GetBounds().w, HSMap.GetBounds().h);
      spawns.push(this.Spawn(HSWaveEnemy(wave, pt)));
    }
    if (wave % 10 === 0 && wave > 0) {
      // boss raid: the level milestone adds a heavy escort regardless of the roll
      for (let i = 0; i < 2; i++) {
        const pt = HSUtils.RandomPointOnRect(HSMap.GetBounds().x, HSMap.GetBounds().y, HSMap.GetBounds().w, HSMap.GetBounds().h);
        spawns.push(this.Spawn(new UnitAlienCruiser(pt)));
      }
    }
    if (spawns.length && this.OnWaveSpawned) this.OnWaveSpawned(wave, spawns); // announcement + spawn-edge markers
    return spawns;
  },

  AddWaveMarker(pos) {
    this.Effects.push({ type: "wave", x: pos.x, y: pos.y, endTime: this.Time + 3 }); // purple pulse where enemies enter
  },

  Spawn(unit) {
    unit.SpawnTime = this.Time; // visual-only: renderer plays a rise-in animation
    this.GameUnits.push(unit);
    return unit;
  },

  *GetAllGameUnits(pickUnpickable = false) {
    for (const u of this.GameUnits) {
      if (u == null) continue;
      if (!u.Pickable && !pickUnpickable) continue;
      yield u;
    }
  },
  GetAllGameUnitsArray(pickUnpickable = false) {
    const out = [];
    for (const u of this.GameUnits) {
      if (u == null) continue;
      if (!u.Pickable && !pickUnpickable) continue;
      out.push(u);
    }
    return out;
  },
  Pick(worldPos, pickUnpickable = false) {
    return this.GetAllGameUnitsArray(pickUnpickable).filter((u) => {
      const r = u.GetBoundingRect();
      return worldPos.x >= r.x && worldPos.x <= r.x + r.w && worldPos.y >= r.y && worldPos.y <= r.y + r.h;
    });
  },
  PickRect(rect, pickUnpickable = false) {
    return this.GetAllGameUnitsArray(pickUnpickable).filter((u) => {
      const r = u.GetBoundingRect();
      return rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y;
    });
  },
  PickInRangeArr(worldPos, range, pickUnpickable = false) {
    const out = [];
    const r2 = range * range;
    for (const u of this.GetAllGameUnitsArray(pickUnpickable)) {
      const dx = u.Position.x - worldPos.x, dy = u.Position.y - worldPos.y;
      if (dx * dx + dy * dy < r2) out.push(u);
    }
    return out;
  },
  PickInRange(worldPos, range, pickUnpickable = false) {
    return this.PickInRangeArr(worldPos, range, pickUnpickable);
  },

  PickNextAttackTarget(position, range, nearest) {
    // default pick flags (reference: no PickUnpickable) — unpickable energy packets must
    // NEVER be targets, or aliens chase them across the map instead of attacking the base
    const units = this.PickInRangeArr(position, range, false);
    for (let i = 0; i < units.length; i++) {
      if (units[i] instanceof GameUnitAlien || units[i] instanceof UnitMineral) units[i] = null;
    }
    if (nearest) {
      let best = null, bd = Infinity;
      for (const u of units) {
        if (u == null) continue;
        const d = V2.dist2(position, u.Position);
        if (d < bd) { bd = d; best = u; }
      }
      return best;
    }
    const valid = units.filter((u) => u != null);
    return HSUtils.RandomFrom(valid);
  },

  PickNextEnergyPacketTarget(curUnit, except1, except2) {
    let linkedConduit = null;
    const curConduit = curUnit instanceof UnitConduit ? curUnit : null;
    if (curConduit != null && curConduit.GetLinkedConduit != null) linkedConduit = curConduit.GetLinkedConduit;

    const units = this.PickInRangeArr(curUnit.Position, UnitConduit.ConnectRangePower, true);
    for (let i = 0; i < units.length; i++) {
      if (units[i] === except1 || units[i] === except2) { units[i] = null; continue; }
      if (units[i] instanceof UnitMineral) { units[i] = null; continue; }
      if (units[i] instanceof UnitConduit) continue;
      if (!units[i].CanAcceptEnergyPacket()) { units[i] = null; continue; }
      return units[i];
    }
    if (units.length === 0) return linkedConduit;
    const maxLen = HSUtils.Rearrange(units);
    if (maxLen <= 0) return linkedConduit;
    if (linkedConduit != null) return linkedConduit;
    return units[HSUtils.RandomInt(0, maxLen)];
  },

  TryConsumeResources(amt) {
    const newResources = this.Resources - amt;
    if (newResources >= 0) { this.Resources = newResources; return true; }
    return false;
  },
  AddResource(amt) { this.Resources += amt; },

  AddLightningEffect(worldPos) {
    // our renderer draws sparks at (worldPos) for 0.1s
    this.Effects.push({ type: "lightning", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.1 });
  },

  // gold fizzle where an energy packet is lost (dead-end conduit etc.)
  AddPuffEffect(worldPos) {
    this.Effects.push({ type: "puff", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.45 });
  },

  // floating "+1" style feedback text
  AddFloatText(worldPos, str) {
    this.Effects.push({ type: "float", x: worldPos.x, y: worldPos.y, str: String(str), endTime: this.Time + 0.9 });
  },

  // blue flash where a manual link was just established
  AddLinkEffect(worldPos) {
    this.Effects.push({ type: "link", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.4 });
  },

  // green flash + dust where a building was just placed
  AddPlaceEffect(worldPos) {
    this.Effects.push({ type: "place", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.5 });
  },

  // red sparks where a UFO hit struck a building
  AddHitEffect(worldPos) {
    this.Effects.push({ type: "hit", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.25 });
  },

  // explosion ring + debris where a unit died (UFOs mainly)
  AddBoomEffect(worldPos) {
    this.Effects.push({ type: "boom", x: worldPos.x, y: worldPos.y, endTime: this.Time + 0.6 });
  },

  ClearAll() {
    this.GameUnits = [];
    this.Effects = [];
  },
};
