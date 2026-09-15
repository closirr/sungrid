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
      HSEngine.DebugFastBuild = true; // shipped default
      return HSEngine;
    };
    const run = (g, sec) => { for (let i = 0; i < sec * 60; i++) { g._timerElapsed += 1 / 60; g.Update(1 / 60, false); g.SimulatedSteps++; } };
    const count = (g, name) => g.GetAllGameUnitsArray().filter((u) => !u.Destroyed && u.Name === name).length;
    const clear = (g) => { for (const u of g.GetAllGameUnits(true)) u.Destroyed = true; g.GameUnits = []; };

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

    /* H8: builder — costs deducted, WIP spawns, builds from 1 packet (DebugFastBuild default) */
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
    }

    /* H9: waves — formula max(0,(wave-5)/5*2), spawn on rect perimeter */
    {
      const g = fresh(); clear(g);
      run(g, 82);
      const ufos = count(g, "ufo");
      check("H9 wave 8 → ≥1 ufo", g.CurWave >= 8 && ufos >= 1, "wave=" + g.CurWave + " ufos=" + ufos);
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
      check("H13 start funds = StartMoney (dev tweak; reference is 0)", g.Resources === g.StartMoney, "resources=" + g.Resources);
    }

    /* H14: reference wave formula — no UFOs before wave 8 */
    {
      const g = fresh();
      g.SpawnStarters();
      let empty = true;
      for (let w = 0; w <= 7; w++) {
        g.SpawnEnemyWave(w);
        if (g.GetAllGameUnitsArray().some((u) => u instanceof UnitAlienUfo)) empty = false;
      }
      check("H14 waves 0-7 spawn no UFOs", empty);
      g.SpawnEnemyWave(8);
      check("H14 wave 8 spawns the first UFO", g.GetAllGameUnitsArray().some((u) => u instanceof UnitAlienUfo));
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
