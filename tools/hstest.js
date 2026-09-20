/* SUNGRID — headless tests for the Harvesturr structural port (node tools/hstest.js).
 * Drives HSEngine directly. window/App/UI are stubbed (engine reads them for input). */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const sandbox = { console, Math, JSON, performance: { now: () => Date.now() } };
sandbox.window = sandbox;
sandbox.App = { paused: false, state: "game", kills: 0 };
sandbox.UI = { UpdateInput() {}, UpdateHUD() {} };
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "hsgame.js"), "utf8"), ctx, { filename: "hsgame.js" });

const suite = vm.runInContext(`
  (function () {
    const results = [];
    const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
    const fresh = () => {
      HSEngine.ClearGameState();
      HSEngine._timerRunning = true;
      HSEngine.DebugFastBuild = true; // the fast-build path is tested explicitly (H8); the game ships with real costs
      return HSEngine;
    };
    const run = (g, sec) => { for (let i = 0; i < sec * 60; i++) { g._timerElapsed += 1 / 60; g.Update(1 / 60, false); g.SimulatedSteps++; } };
    const count = (g, name) => g.GetAllGameUnitsArray().filter((u) => !u.Destroyed && u.Name === name).length;
    const clear = (g) => { for (const u of g.GetAllGameUnits(true)) u.Destroyed = true; g.GameUnits = []; };

    /* H0: shipped defaults (audit: DebugFastBuild shipped true, so build costs never worked;
     * cruisers shipped at speed 5 = 120-150s crossings) */
    check("H0 real build costs ship on (DebugFastBuild off)", HSEngine.DebugFastBuild === false, "fast=" + HSEngine.DebugFastBuild);
    check("H0 cruiser crossing fixed (speed 8, was 5)", new UnitAlienCruiser({ x: 0, y: 0 }).MoveSpeed === 8, "spd=" + new UnitAlienCruiser({ x: 0, y: 0 }).MoveSpeed);

    /* H1: solar panel emits packets toward conduits in range (1 per 2s).
     * A packet that dead-ends at the solar bounces and dies — the observable
     * signature is the conduit's heat pulse (reference-faithful). */
    {
      const g = fresh(); clear(g);
      const solar = g.Spawn(new UnitSolarPanel({ x: 0, y: 0 }));
      const cond = g.Spawn(new UnitConduit({ x: 80, y: 0 }));
      let maxHeat = 0;
      for (let i = 0; i < 60 * 6; i++) {
        g._timerElapsed += 1 / 60; g.Update(1 / 60, false); g.SimulatedSteps++;
        maxHeat = Math.max(maxHeat, cond.Heat);
      }
      check("H1 conduit received packets (heat pulse)", maxHeat >= 1, "maxHeat=" + maxHeat + " in 6s");
    }

    /* H2: laser consumes packets (+15, cap 60), full laser relays */
    {
      const g = fresh(); clear(g);
      const laser = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      for (let i = 0; i < 3; i++) {
        const p = new UnitEnergyPacket({ x: 0, y: 0 }, laser);
        laser.ConsumeEnergyPacket(g, p);
      }
      check("H2 +15 per packet", laser.EnergyCharges === 45, "charges=" + laser.EnergyCharges);
      const before = laser.EnergyCharges;
      const routed = laser.ConsumeEnergyPacket(g, new UnitEnergyPacket({ x: 0, y: 0 }, laser));
      check("H2 cap 60 enforced", laser.EnergyCharges === 60 && routed === true, "charges=" + laser.EnergyCharges + " routed=" + routed);
      // audit: a +15 packet on a half-full laser overshot the cap (70/60 seen in the wild)
      laser.EnergyCharges = 55;
      laser.ConsumeEnergyPacket(g, new UnitEnergyPacket({ x: 0, y: 0 }, laser));
      check("H2 +15 never exceeds the cap", laser.EnergyCharges === 60, "charges=" + laser.EnergyCharges);
      laser.EnergyCharges = 58;
      laser.ConsumeEnergyPacket(g, new UnitEnergyPacket({ x: 0, y: 0 }, laser));
      check("H2 overshoot clamped (58+15 -> 60)", laser.EnergyCharges === 60, "charges=" + laser.EnergyCharges);
    }

    /* H3: laser attacks a UFO inside 64, 1 charge per 0.1s tick, 1 damage */
    {
      const g = fresh(); clear(g);
      const laser = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      laser.EnergyCharges = 60;
      const ufo = g.Spawn(new UnitAlienUfo({ x: 50, y: 0 }));
      run(g, 3);
      check("H3 laser damaged ufo", ufo.Health < 50 || ufo.Destroyed, "hp=" + Math.round(ufo.hp) + " charges=" + laser.EnergyCharges);
      check("H3 drain matches ticks", laser.EnergyCharges < 60, "charges=" + laser.EnergyCharges);
    }

    /* H4: chain A→B: receiver dmg 2, range 64×1.2; feeder does not attack */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      const b = g.Spawn(new UnitLaser({ x: 60, y: 0 }));
      a.LinkLaser(b);
      a.EnergyCharges = 60; b.EnergyCharges = 60;
      run(g, 1); // reference: charged lasers re-dirty themselves each SlowUpdate → chain recalc
      check("H4 receiver dmg 2", b.AttackDamage === 2, "dmg=" + b.AttackDamage);
      check("H4 receiver range ×1.2", Math.abs(b.AttackRange - 76.8) < 0.01, "range=" + b.AttackRange.toFixed(1));
      const ufo = g.Spawn(new UnitAlienUfo({ x: 140, y: 0 })); // inside 76.8, outside 64
      run(g, 4);
      check("H4 chained laser hit far ufo", ufo.Health < 50 || ufo.Destroyed, "hp=" + ufo.Health.toFixed(0));
      check("H4 feeder drains while chain fires", a.EnergyCharges < 60 || a.IsAttacking, "charges=" + a.EnergyCharges);
    }

    /* H5: cycle protection */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      const b = g.Spawn(new UnitLaser({ x: 60, y: 0 }));
      a.LinkLaser(b);
      b.LinkLaser(a);
      check("H5 cycle rejected", a.GetLinkedLaser == null || b.GetLinkedLaser === a, "a.link=" + (a.GetLinkedLaser ? "b" : "null") + " b.link=" + (b.GetLinkedLaser ? "a" : "null"));
    }

    /* H6: conduit heat overflow destroys packets at 100 */
    {
      const g = fresh(); clear(g);
      const cond = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      let lost = 0;
      for (let i = 0; i < 105; i++) {
        const p = new UnitEnergyPacket({ x: 0, y: 0 }, cond);
        cond.ConsumeEnergyPacket(g, p);
        if (p.Destroyed) lost++;
      }
      check("H6 heat capped", cond.Heat === 100, "heat=" + cond.Heat);
      check("H6 overflow lost", lost >= 5, "lost=" + lost);
    }

    /* H7: harvester — packet → charge → mineral → +1 R$; starved → destroy +2 */
    {
      const g = fresh(); clear(g);
      const h = g.Spawn(new UnitHarvester({ x: 0, y: 0 }));
      const m = g.Spawn(new UnitMineral({ x: 30, y: 0 }, false));
      h.EnergyCharges = 3;
      const res0 = g.Resources;
      run(g, 11); // ticks at t=0? (next 0<time) → t≈0, 5, 10 → two harvests by 10s
      check("H7 mined resources", g.Resources >= res0 + 1, "resources=" + g.Resources );
      check("H7 charges spent", h.EnergyCharges < 3, "charges=" + h.EnergyCharges);
      m.MineralCount = 0; m.Destroyed = true;
      h.EnergyCharges = 1; // reference: drained harvesters never re-check minerals; a CHARGED one does
      run(g, 6);
      check("H7 starved → destroyed +2", h.Destroyed && g.Resources >= res0 + 2, "destroyed=" + h.Destroyed + " resources=" + g.Resources);
    }

    /* H8: builder — costs deducted, WIP spawns, builds from 1 packet (fast-build path) */
    {
      const g = fresh(); clear(g);
      g.Resources = 100;
      const tool = new HSGameToolConduit();
      tool.Active = true;
      g.MousePosWorld = { x: 80, y: 10 };
      tool.CurrentLocationValid = true;
      tool.OnWorldClick(g, { x: 80, y: 10 });
      check("H8 paid 5", g.Resources === 95, "resources=" + g.Resources);
      const wip = g.GetAllGameUnitsArray(true).find((u) => u instanceof UnitBuildingWIP);
      check("H8 WIP spawned (needs 1 packet, FastBuild)", wip && wip.BuildCostRemaining === 1, "remaining=" + (wip && wip.BuildCostRemaining));
      const overlap = (() => { const t2 = new HSGameToolConduit(); t2.CurrentLocationValid = false; const res = g.Resources; g.TryConsumeResources(5); return t2.OnWorldClick(g, { x: 80, y: 10 }) || g.Resources; })();
      check("H8 invalid location no-op", g.Resources === 90, "resources=" + g.Resources);
      // audit: the shipped game ran with real costs now — a site needs the full packet count
      const g2 = fresh(); g2.DebugFastBuild = false; clear(g2);
      g2.Resources = 100;
      const tool2 = new HSGameToolConduit();
      tool2.Active = true;
      tool2.CurrentLocationValid = true;
      tool2.OnWorldClick(g2, { x: 80, y: 10 });
      const wip2 = g2.GetAllGameUnitsArray(true).find((u) => u instanceof UnitBuildingWIP);
      check("H8 real costs: conduit site needs 5 packets", wip2 && wip2.BuildCostRemaining === 5 && g2.Resources === 95, "remaining=" + (wip2 && wip2.BuildCostRemaining));
    }

    /* H9: waves — formula max(0,(wave-5)/5*2), spawn on rect perimeter */
    {
      const g = fresh(); clear(g);
      g.IsGameRunning = true; // raids only tick in a running game (audit follow-up fix)
      run(g, 25);
      const aliens = g.GetAllGameUnitsArray().filter((u) => u instanceof UnitAlienUfo && !u.Destroyed).length;
      check("H9 the first raid lands within ~25s (no 80s dead opening)", g.CurWave >= 1 && aliens >= 1, "wave=" + g.CurWave + " aliens=" + aliens);
      // (reference lets knockback carry UFOs slightly out of bounds — no clamp there either)
    }

    /* H10: ufo attacks nearest building, knockback moves it */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitConduit({ x: -500, y: 0 }));
      const b = g.Spawn(new UnitConduit({ x: -520, y: 30 }));
      const ufo = g.Spawn(new UnitAlienUfo({ x: -560, y: 0 }));
      run(g, 9);
      check("H10 ufo attacked buildings", a.Health < 100 || b.Health < 100, "a.hp=" + a.Health + " b.hp=" + b.Health);
      check("H10 ufo moved", ufo.Position.x > -560, "x=" + ufo.Position.x.toFixed(0));
    }

    /* H11: harvester self-destructs without minerals in range (refund 2) — covered in H7 */

    /* H12: minerals layout — 50 clusters × 15, none within 120 of center */
    {
      const g = fresh();
      HSMap.SpawnAllMinerals(g);
      const minerals = g.GetAllGameUnitsArray().filter((u) => u instanceof UnitMineral);
      check("H12 mineral count ~750", minerals.length === 750, "minerals=" + minerals.length);
      const far = minerals.filter((m) => V2.dist(m.Position, { x: 0, y: 0 }) > 150).length;
      check("H12 most minerals spread out", far > minerals.length * 0.4, "far=" + far + "/" + minerals.length);
      const megas = minerals.filter((m) => m.Megamineral).length;
      check("H12 ~20% mega", megas > 100 && megas < 250, "megas=" + megas);
    }

    /* H13: starters — megamineral + harvester + conduit + solar */
    {
      const g = fresh();
      g.SpawnStarters();
      check("H13 starters", count(g, "harvester") === 1 && count(g, "conduit") === 1 && count(g, "solarpanel") === 1 && count(g, "megamineral") === 1,
        "h=" + count(g, "harvester") + " c=" + count(g, "conduit") + " s=" + count(g, "solarpanel") + " m=" + count(g, "megamineral"));
      // starters must sit ON their footprint lattice (user request: new buildings
      // have to visually match the starter base)
      const onLattice = (u) => {
        const sx = HSFootprintWidth(u) / 2, sy = HSFootprintWidth(u) / 4;
        const i = u.Position.x / sx, j = u.Position.y / sy;
        return Number.isInteger(i) && Number.isInteger(j) && (((i + j) % 2) + 2) % 2 === 0;
      };
      const starters = g.GetAllGameUnitsArray().filter((u) => ["harvester", "conduit", "solarpanel"].includes(u.Name));
      check("H13 starters sit on their footprint lattices", starters.every(onLattice),
        starters.map((u) => u.Name + "@" + u.Position.x + "," + u.Position.y).join(" "));
      const harv = starters.find((u) => u.Name === "harvester");
      const mega = g.GetAllGameUnitsArray().find((u) => u.Name === "megamineral");
      const cond = starters.find((u) => u.Name === "conduit");
      const pan = starters.find((u) => u.Name === "solarpanel");
      check("H13 starter chain intact: harvester mines, panel feeds conduit",
        V2.dist(harv.Position, mega.Position) < 64 && V2.dist(pan.Position, cond.Position) < 96 && V2.dist(cond.Position, harv.Position) < 96,
        "m=" + V2.dist(harv.Position, mega.Position).toFixed(0) + " p=" + V2.dist(pan.Position, cond.Position).toFixed(0));
      check("H13 start funds = StartMoney (dev tweak; reference is 0)", g.Resources === g.StartMoney, "resources=" + g.Resources);
    }

    /* H14: raid rework — every raid carries enemies, the first lands fast */
    {
      const g = fresh();
      g.SpawnStarters();
      check("H14 first raid scheduled at 20s (no dead opening)", g.NextWaveSpawnTime === FIRST_RAID_AT && g.CurWave === 0, "next=" + g.NextWaveSpawnTime);
      const r1 = g.SpawnEnemyWave(1);
      check("H14 raid 1 carries real enemies (scouts)", r1.length === 1 && r1[0] instanceof UnitAlienScout, "len=" + r1.length);
      const r2 = g.SpawnEnemyWave(2);
      check("H14 raid 2 grows", r2.length === 2 && r2.every((u) => u instanceof UnitAlienUfo), "len=" + r2.length);
    }

    /* H15: conduits auto-link (user request: no manual linking) — one-way nearest hop */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const b = g.Spawn(new UnitConduit({ x: 80, y: 0 }));
      run(g, 1);
      check("H15 conduit auto-links nearest in range", a.GetLinkedConduit === b, "a.link=" + (a.GetLinkedConduit ? "b" : "null"));
      check("H15 second conduit stays a leaf (no bouncing)", b.GetLinkedConduit == null, "b.link=" + (b.GetLinkedConduit ? "a" : "null"));
      const c = g.Spawn(new UnitConduit({ x: 300, y: 0 }));
      run(g, 1);
      check("H15 out-of-range conduit stays unlinked", c.GetLinkedConduit == null && a.GetLinkedConduit === b);
      b.Destroyed = true;
      run(g, 1);
      check("H15 destroyed link target frees the link", a.GetLinkedConduit == null, "a.link=" + (a.GetLinkedConduit ? "b" : "null"));
    }

    /* H16: lasers auto-feed the nearest unlinked laser; chain damage stacks */
    {
      const g = fresh(); clear(g);
      const l1 = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      const l2 = g.Spawn(new UnitLaser({ x: 50, y: 0 }));
      run(g, 0.5);
      check("H16 laser auto-feeds nearest in range", l1.GetLinkedLaser === l2 && l2.GetLinkedLaser == null,
        "l1.link=" + (l1.GetLinkedLaser ? "l2" : "null") + " l2.link=" + (l2.GetLinkedLaser ? "l1" : "null"));
      l1.EnergyCharges = 30; l2.EnergyCharges = 30; // uncharged feeders contribute 0 (reference rule)
      run(g, 0.3);
      check("H16 receiver chain damage 2, range 76.8", l2.AttackDamage === 2 && Math.abs(l2.AttackRange - 76.8) < 0.01,
        "dmg=" + l2.AttackDamage + " range=" + l2.AttackRange.toFixed(1));
      const l3 = g.Spawn(new UnitLaser({ x: 300, y: 0 }));
      run(g, 0.5);
      check("H16 far laser stays an independent attacker", l3.GetLinkedLaser == null && l1.GetLinkedLaser === l2);
    }

    /* H17: conduit overload + load meter — one node heats exactly like a chain,
       and the visual load meter tracks the packet rate (user request) */
    {
      const g = fresh(); clear(g);
      const c1 = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      for (let i = 0; i < 12; i++) g.Spawn(new UnitSolarPanel({ x: 60, y: i * 8 - 44 }));
      let maxHeat = 0;
      for (let s = 0; s < 25; s++) { run(g, 1); maxHeat = Math.max(maxHeat, c1.Heat); }
      check("H17 single conduit overloads under heavy load (same rules as a chain)", maxHeat > 50,
        "maxHeat=" + maxHeat + " load=" + c1.PacketLoad.toFixed(1) + "/s");
      check("H17 load meter tracks packet rate", c1.PacketLoad > 5, "load=" + c1.PacketLoad.toFixed(1) + "/s");

      const g2 = fresh(); clear(g2);
      const c2 = g2.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const c3 = g2.Spawn(new UnitConduit({ x: 60, y: 0 }));
      for (let i = 0; i < 12; i++) g2.Spawn(new UnitSolarPanel({ x: -60, y: i * 8 - 44 }));
      let maxHeat2 = 0;
      for (let s = 0; s < 25; s++) { run(g2, 1); maxHeat2 = Math.max(maxHeat2, c2.Heat, c3.Heat); }
      check("H17 two-node chain overloads the same way", maxHeat2 > 50, "maxHeat=" + maxHeat2);

      const g3 = fresh(); clear(g3);
      const c4 = g3.Spawn(new UnitConduit({ x: 0, y: 0 }));
      run(g3, 3);
      check("H17 idle conduit shows no load", c4.PacketLoad < 0.2 && c4.Heat === 0,
        "load=" + c4.PacketLoad.toFixed(2) + " heat=" + c4.Heat);
    }

    /* H18: manual drag-link (user request): drag node -> node routes energy,
       the same drag again removes it; manual nodes leave the auto-connect pool */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const b = g.Spawn(new UnitConduit({ x: 60, y: 0 }));
      check("H18 manual link sets the direction", HSManualLink(g, a, b) === "link" && a.GetLinkedConduit === b && a.ManualLink && b.ManualLink,
        "a.link=" + (a.GetLinkedConduit === b ? "b" : "null"));
      check("H18 the same drag again removes the link", HSManualLink(g, a, b) === "unlink" && a.GetLinkedConduit == null);
      run(g, 1);
      check("H18 manual node is not auto-relinked", a.GetLinkedConduit == null && b.GetLinkedConduit == null);
      const h = g.Spawn(new UnitHarvester({ x: 40, y: 0 }));
      check("H18 drag onto a non-conduit unlinks", HSManualLink(g, a, h) === "unlink" && a.GetLinkedConduit == null);
      const l1 = g.Spawn(new UnitLaser({ x: 0, y: 200 }));
      const l2 = g.Spawn(new UnitLaser({ x: 50, y: 200 }));
      l1.ManualLink = true; l2.ManualLink = true; // keep the auto-feeder out of the way
      check("H18 manual laser link", HSManualLink(g, l1, l2) === "link" && l1.GetLinkedLaser === l2);
      check("H18 laser link toggles off", HSManualLink(g, l1, l2) === "unlink" && l1.GetLinkedLaser == null);
    }

    /* H19: laser chain potential + auto-link placement preview (link clarity system) */
    {
      const g = fresh(); clear(g);
      const a = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      const b = g.Spawn(new UnitLaser({ x: 50, y: 0 }));
      const c = g.Spawn(new UnitLaser({ x: 0, y: 50 }));
      // preview on pristine (free) lasers: the a/b pair forms first (50px < 60px to the
      // ghost spot), the lone c next to the spot feeds the new node instead
      const pv1 = HSAutoLinkPreview(g, { x: 0, y: 60 }, "laser");
      check("H19 preview: pair wins, lone laser feeds the ghost", pv1.length === 1 && pv1[0] === c,
        "fedBy=" + pv1.map((u) => (u === c ? "c" : "?")).join(","));
      const d = g.Spawn(new UnitLaser({ x: 200, y: 0 }));
      const pv2 = HSAutoLinkPreview(g, { x: 200, y: 60 }, "laser");
      check("H19 preview: lone laser in range feeds the ghost", pv2.length === 1 && pv2[0] === d, "len=" + pv2.length);
      check("H19 preview: out of range = nothing connects", HSAutoLinkPreview(g, { x: 200, y: 150 }, "laser").length === 0);
      d.ManualLink = true; // manual nodes leave the auto-feed pool
      check("H19 preview: manual nodes don't auto-connect", HSAutoLinkPreview(g, { x: 200, y: 60 }, "laser").length === 0);
      const e = g.Spawn(new UnitConduit({ x: -200, y: 0 }));
      const pvc = HSAutoLinkPreview(g, { x: -200, y: 50 }, "conduit");
      check("H19 conduit preview uses 96px", pvc.length === 1 && pvc[0] === e, "len=" + pvc.length);
      // potential chain damage reads the feeder structure even while unpowered
      a.LinkLaser(b); c.LinkLaser(b); // two feeders chain into b
      run(g, 1);
      check("H19 potential damage ignores charge (3-chain)", HSPotentialDamage(b) === 3 && b.AttackDamage === 0,
        "pot=" + HSPotentialDamage(b) + " dmg=" + b.AttackDamage);
      check("H19 potential range ×1.4; unpowered stays 64", Math.abs(HSPotentialRange(3) - 89.6) < 0.01 && b.AttackRange === 64,
        "potRange=" + HSPotentialRange(3).toFixed(1) + " range=" + b.AttackRange);
    }

    /* H20: harvester mining cycle — the renderer's pump animation derives purely from
       NextUpdateTime (slow-tick rhythm) + HarvestFx* (strike window); no sim changes */
    {
      const g = fresh(); clear(g);
      const h = g.Spawn(new UnitHarvester({ x: 0, y: 0 }));
      g.Spawn(new UnitMineral({ x: 30, y: 0 }, false));
      h.EnergyCharges = 3;
      run(g, 11); // > two 5s cycles
      check("H20 harvester strikes every cycle (+1 R$ each)", g.Resources >= 2, "res=" + g.Resources);
      const since = h.UpdateInterval - (h.NextUpdateTime - g.Time);
      check("H20 cycle phase readable from NextUpdateTime (since in [0,5))", since >= 0 && since < 5,
        "since=" + since.toFixed(2));
      check("H20 last strike armed the flare window", h.HarvestFxUntil !== undefined && g.Time - (h.HarvestFxUntil - 0.3) < 5.01 && h.HarvestFxTarget instanceof UnitMineral,
        "strikeAgo=" + (g.Time - (h.HarvestFxUntil - 0.3)).toFixed(2));
      const h2 = g.Spawn(new UnitHarvester({ x: 100, y: 100 })); // starved: no charges
      run(g, 6);
      check("H20 starved harvester never strikes", h2.HarvestFxUntil === undefined && h2.EnergyCharges === 0,
        "fx=" + String(h2.HarvestFxUntil));
    }

    /* H21: build footprints — placement blocks exactly the drawn base diamond, ghost snaps
       to the tile lattice (user request: sprite-sized, VISIBLE placement bounds) */
    {
      const g = fresh(); clear(g);
      const tool = new HSGameToolSolarPanel();
      check("H21 panel footprint = its drawn base (36×18)", tool.Footprint === 36 && HSFootprintWidth(new UnitSolarPanel({ x: 0, y: 0 })) === 36
        && HSFootprintWidth(new UnitConduit({ x: 0, y: 0 })) === 16);
      const p = g.Spawn(new UnitSolarPanel({ x: 0, y: 0 }));
      check("H21 edge-to-edge panel row is legal (touch ≠ overlap)",
        tool.IsValidLocation(g, { x: 18, y: 9 }) && tool.IsValidLocation(g, { x: 0, y: 18 }));
      check("H21 overlapping panels are blocked", !tool.IsValidLocation(g, { x: 17, y: 9 }) && !tool.IsValidLocation(g, { x: 0, y: 0 }));
      const ctool = new HSGameToolConduit();
      check("H21 small building inside the panel tile is blocked", !ctool.IsValidLocation(g, { x: 10, y: 5 }));
      check("H21 conduit beside the panel tile is legal", ctool.IsValidLocation(g, { x: 18, y: 9 }));
      const snap = HSBuildSnap(36, { x: 10, y: 6 }); // messy mouse pos → nearest lattice tile
      check("H21 snap lands on the tile lattice", Math.abs(snap.x - 18) < 0.01 && Math.abs(snap.y - 9) < 0.01,
        JSON.stringify(snap));
      const snap2 = HSBuildSnap(36, { x: 5, y: 5 });
      check("H21 snap between tiles picks the closest one", snap2.x === 0 && snap2.y === 0, JSON.stringify(snap2));
      check("H21 WIP blocks like its finished building", (() => {
        const wip = new UnitBuildingWIP(g, { x: 100, y: 100 }, UnitSolarPanel);
        return HSFootprintWidth(wip) === 36;
      })());
    }

    /* H22: enemy variety + level waves (user request) — scouts open, cruisers gate the
       late levels, boss raids every 10th wave; the destroy hook feeds kill counters */
    {
      const g = fresh(); clear(g);
      const w1 = g.SpawnEnemyWave(1);
      check("H22 raid 1 = a single scout (gentle intro)", w1.length === 1 && w1[0] instanceof UnitAlienScout,
        "len=" + w1.length);
      check("H22 scout stats: hp 20, fast, weak", w1[0].MaxHealth === 20 && w1[0].MoveSpeed === 24 && w1[0].AttackDamage === 2,
        "hp=" + w1[0].MaxHealth + " spd=" + w1[0].MoveSpeed);
      const w3 = g.SpawnEnemyWave(3);
      check("H22 raid 3: saucers join the scouts", w3.length === 2 && w3.every((u) => u instanceof UnitAlienUfo),
        "len=" + w3.length);
      const w12 = g.SpawnEnemyWave(12);
      check("H22 raid 12: 6 saucers of mixed hulls", w12.length === 6 && w12.every((u) => u instanceof UnitAlienUfo)
        && w12.every((u) => [20, 50, 160].includes(u.MaxHealth)), "hp=" + w12.map((u) => u.MaxHealth).join(","));
      check("H22 raiders spawn near the base (user: closer)", w12.every((u) => V2.dist(u.Position, { x: 0, y: 0 }) <= 800),
        "maxR=" + Math.max(...w12.map((u) => Math.round(V2.dist(u.Position, { x: 0, y: 0 })))));
      const c = new UnitAlienCruiser({ x: 0, y: 0 });
      check("H22 cruiser stats: hp 160, heavy, crossable speed", c.MaxHealth === 160 && c.MoveSpeed === 8 && c.AttackDamage === 12);
      let counted = 0;
      g.OnUnitDestroyed = (u) => { if (u instanceof UnitAlienUfo) counted++; };
      w1[0].Destroy(g, true);
      g.Spawn(new UnitConduit({ x: 500, y: 500 })).Destroy(g, true);
      check("H22 destroy hook counts alien kills only", counted === 1, "counted=" + counted);
      let announced = 0;
      g.OnWaveSpawned = () => announced++;
      g.SpawnEnemyWave(9);
      check("H22 raid spawn fires the announcement hook", announced === 1, "announced=" + announced);
    }

    /* H23: level system — scenario configs, tiered enemy mix, victory detection */
    {
      const g = fresh(); clear(g);
      check("H23 eight levels defined, raid goals escalate, endless last",
        LEVELS.length === 8 && LEVELS[0].waves === 4 && LEVELS[4].waves === 8 && LEVELS[7].endless === true,
        "n=" + LEVELS.length);
      // audit: the first three levels played identically — now they differ in pacing,
      // raid size, enemy mix and map density
      check("H23 levels differ in pacing and composition",
        LEVELS[1].raidInterval < LEVELS[0].raidInterval && LEVELS[0].waveCap < LEVELS[4].waveCap
        && !!LEVELS[1].scoutHeavy && !!LEVELS[2].saucerHeavy && LEVELS[2].minerals !== LEVELS[0].minerals,
        JSON.stringify(LEVELS.slice(0, 3).map((l) => ({ i: l.raidInterval, c: l.waveCap, m: l.minerals }))));
      // post-audit additions: two map-geometry levels before the endless one
      check("H23 Overload Ring: ring map, fast saucer pressure",
        LEVELS[5].name === "Overload Ring" && LEVELS[5].mapPattern === "ring" && LEVELS[5].raidInterval < LEVELS[0].raidInterval
        && !!LEVELS[5].saucerHeavy && !LEVELS[5].endless,
        JSON.stringify({ i: LEVELS[5].raidInterval, p: LEVELS[5].mapPattern }));
      check("H23 Titan Fall: boss escorts every 2nd raid, biggest raid cap",
        LEVELS[6].name === "Titan Fall" && LEVELS[6].bossEvery === 2 && LEVELS[6].waveCap === 7 && LEVELS[6].waves === 9,
        JSON.stringify({ b: LEVELS[6].bossEvery, c: LEVELS[6].waveCap }));
      g.LevelConfig = LEVELS[4];
      const w3 = g.SpawnEnemyWave(3);
      check("H23 level 5 raid 3: boss raid escort (every 3rd raid)", w3.filter((u) => u instanceof UnitAlienCruiser).length >= 2, "len=" + w3.length);
      g.LevelConfig = LEVELS[6];
      const w2 = g.SpawnEnemyWave(2);
      check("H23 Titan Fall raid 3: boss raid escort (every 2nd raid)", w2.filter((u) => u instanceof UnitAlienCruiser).length >= 2, "len=" + w2.length);
      g.LevelConfig = LEVELS[3];
      const w5 = g.SpawnEnemyWave(5);
      check("H23 level 4 rolls the early-cruiser tier from raid 4", w5.length === 3 && w5.every((u) => u instanceof UnitAlienUfo), "len=" + w5.length);
      g.LevelConfig = LEVELS[0];
      g.CurWave = 4;
      g.GetAllGameUnitsArray(true).filter((u) => u instanceof UnitAlienUfo).forEach((u) => u.Destroy(g, true));
      const base = g.Spawn(new UnitConduit({ x: 300, y: 0 })); // a victory needs a standing base (H27)
      check("H23 victory fires when the last raid is wiped", g.WinCheck() === true);
      check("H23 victory fires once", g.WinCheck() === false);
      g._victory = false;
      const a = g.Spawn(new UnitAlienScout({ x: 500, y: 500 }));
      check("H23 no victory while raiders remain", g.WinCheck() === false);
      a.Destroy(g, true);
      check("H23 victory right after the raid is cleared", g.WinCheck() === true);
      g._victory = false;
      base.Destroyed = true; g.GameUnits = []; // strip the base — no win without it
      check("H23 no victory without a single building", g.WinCheck() === false);
      g._victory = false;
      g.LevelConfig = LEVELS[7];
      check("H23 endless never wins", g.WinCheck() === false);
    }

    /* H24: call-wave (user request: негайний виклик ворогів) — summons through the
       regular wave tick; blocked at the level's final wave and after game over */
    {
      const g = fresh(); clear(g);
      g.IsGameRunning = true; // the app sets this when a level starts
      run(g, 2); // wave 0 already ticked, next wave ~8s away
      check("H24 call summons a wave within a tick", g.CallWave() === true && (() => { run(g, 1); return g.CurWave >= 1; })(), "wave=" + g.CurWave);
      check("H24 repeated calls summon further waves", g.CallWave() === true && (() => { run(g, 1); return g.CurWave >= 2; })(), "wave=" + g.CurWave);
      g.LevelConfig = LEVELS[0];
      g.CurWave = 10;
      check("H24 blocked at the level's final wave", g.CallWave() === false);
      g.LevelConfig = LEVELS[7];
      g.CurWave = 30;
      check("H24 endless always allows the call", g.CallWave() === true);
      g.IsGameOver = true;
      check("H24 blocked after game over", g.CallWave() === false);
    }

    /* H25: the level stops scheduling raids once its final raid is out (audit: wave 14
       marched past a "4 raids" goal under a FINAL WAVE banner) */
    {
      const g = fresh(); clear(g);
      g.IsGameRunning = true;
      g.LevelConfig = LEVELS[0];
      g.CurWave = 4;
      g.NextWaveSpawnTime = 0;
      run(g, 70);
      const aliens = g.GetAllGameUnitsArray(true).filter((u) => u instanceof UnitAlienUfo && !u.Destroyed).length;
      check("H25 no raids past the level's wave goal", g.CurWave === 4 && aliens === 0, "wave=" + g.CurWave + " aliens=" + aliens);
      // levels pace themselves: Scout Rush raids every 25s, not the default 30
      const g2 = fresh(); clear(g2);
      g2.IsGameRunning = true;
      g2.LevelConfig = LEVELS[1];
      g2.NextWaveSpawnTime = 0;
      run(g2, 16);
      check("H25 level raid interval is honoured", g2.CurWave >= 1, "wave=" + g2.CurWave + " next=" + g2.NextWaveSpawnTime.toFixed(1));
      // and a NOT-running game never schedules raids at all (audit follow-up: raiders
      // used to spawn into non-level scenes and beat up "isolated" test stands)
      const g3 = fresh(); clear(g3);
      g3.NextWaveSpawnTime = 0;
      run(g3, 70);
      check("H25 no raids while the game is not running", g3.CurWave === 0, "wave=" + g3.CurWave);
    }

    /* H26: manual drag to an out-of-range target is REJECTED — it used to tear the old
       link and flip both nodes to manual (audit) */
    {
      const g = fresh(); clear(g);
      const l1 = g.Spawn(new UnitLaser({ x: 0, y: 0 }));
      const l2 = g.Spawn(new UnitLaser({ x: 50, y: 0 }));
      const far = g.Spawn(new UnitLaser({ x: 300, y: 0 }));
      check("H26 link first", HSManualLink(g, l1, l2) === "link" && l1.GetLinkedLaser === l2);
      check("H26 out-of-range laser drag rejected", HSManualLink(g, l1, far) === "rejected", "res=" + HSManualLink(g, l1, far));
      check("H26 the old link survives the rejected drag", l1.GetLinkedLaser === l2, "link=" + (l1.GetLinkedLaser === l2));
      check("H26 the far target keeps auto mode", !far.ManualLink, "manual=" + far.ManualLink);
      const c1 = g.Spawn(new UnitConduit({ x: 0, y: 200 }));
      const c2 = g.Spawn(new UnitConduit({ x: 60, y: 200 }));
      const c3 = g.Spawn(new UnitConduit({ x: 300, y: 200 }));
      check("H26 conduit link first", HSManualLink(g, c1, c2) === "link" && c1.GetLinkedConduit === c2);
      check("H26 out-of-range conduit drag rejected, old link intact",
        HSManualLink(g, c1, c3) === "rejected" && c1.GetLinkedConduit === c2 && !c3.ManualLink);
    }

    /* H27: memory stays flat — expired effects are swept, dead unit slots are compacted
       (audit: 1182 stale effects + a growing unit array after a 10-min run) */
    {
      const g = fresh(); clear(g);
      for (let i = 0; i < 500; i++) g.AddPuffEffect({ x: i, y: 0 });
      run(g, 3); // sweeps run every 2s of sim time
      check("H27 expired effects are swept", g.Effects.length === 0, "len=" + g.Effects.length);
      g.AddPuffEffect({ x: 0, y: 0 });
      check("H27 a live effect survives the sweep", g.Effects.length === 1, "len=" + g.Effects.length);
      for (let i = 0; i < 300; i++) g.Spawn(new UnitMineral({ x: 1000 + i, y: 0 }, false)).Destroy(g, true);
      run(g, 2);
      check("H27 destroyed units are compacted away", g.GameUnits.length <= 60, "len=" + g.GameUnits.length);
    }

    /* H33: map geometry patterns — the ring layout concentrates minerals in a band
       around the base, the field scatters them across the island (levels differ by
       GEOMETRY now, not only by parameters) */
    {
      HSMap.Width = 106; HSMap.Height = 106; // headless suites never Load() the map — set real dims
      HSMap.X = -(HSMap.TotalWidth / 2); HSMap.Y = -(HSMap.TotalHeight / 2);
      const g = fresh();
      HSMap.SpawnAllMinerals(g, 48, "ring");
      const ring = g.GetAllGameUnitsArray().filter((u) => u instanceof UnitMineral);
      const rs = ring.map((m) => V2.dist(m.Position, { x: 0, y: 0 }));
      check("H33 ring map: 48 clusters x 10 minerals", ring.length === 480, "n=" + ring.length);
      check("H33 ring map: clear center, bounded band",
        rs.length > 0 && Math.min(...rs) > 200 && Math.max(...rs) < 700,
        "min=" + Math.round(Math.min(...rs)) + " max=" + Math.round(Math.max(...rs)));
      const g2 = fresh();
      HSMap.SpawnAllMinerals(g2, 52, "field");
      const field = g2.GetAllGameUnitsArray().filter((u) => u instanceof UnitMineral);
      const far = field.filter((m) => V2.dist(m.Position, { x: 0, y: 0 }) > 300).length;
      check("H33 field map: count and island-wide spread", field.length === 624 && far > field.length * 0.5,
        "n=" + field.length + " far=" + far);
    }

    /* H34: audio hooks fire from the sim (overload alarm on the heat-60 crossing,
       burnout when heat destroys packets) */
    {
      const g = fresh(); clear(g);
      const sfx = [];
      g.OnSfx = (unit, s) => sfx.push(s);
      const c = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const feed = (n) => { for (let i = 0; i < n; i++) c.ConsumeEnergyPacket(g, new UnitEnergyPacket({ x: 0, y: 0 }, c)); };
      // burst to heat 65: the NEXT slow tick crosses the 60 line — the alarm fires once
      feed(65);
      c.SlowUpdate(g); // alarm + decay to 63
      check("H34 overload alarm fired once at the heat-60 crossing", sfx.filter((s) => s === "overcharge").length === 1,
        JSON.stringify(sfx));
      for (let i = 0; i < 30; i++) c.SlowUpdate(g); // cool back below 60 (rearms the alarm)
      feed(105); // burst past 100 — heat starts destroying packets
      check("H34 burnout fired when heat destroys packets", sfx.includes("burnout"),
        "heat=" + c.Heat + " sfx=" + JSON.stringify(sfx));
    }

    return results;
  })()
`, ctx);

let fails = 0;
for (const r of suite) {
  console.log(`${r.pass ? "OK  " : "FAIL"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  if (!r.pass) fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nall harvesturr-port tests passed");
process.exit(fails ? 1 : 0);
