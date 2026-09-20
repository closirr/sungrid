/* AUDIT energy-network suite: big chains, chain breaks, self-limiting pile-ups,
 * recovery via auto-link bridging, manual cycles, delivery priorities and a
 * destruction storm. Headless — drives HSEngine directly (same harness as hstest).
 * node tools/audit-energynet.js */
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
    const fresh = () => { HSEngine.ClearGameState(); HSEngine._timerRunning = true; return HSEngine; };
    const run = (g, sec) => { for (let i = 0; i < sec * 60; i++) { g._timerElapsed += 1 / 60; g.Update(1 / 60, false); g.SimulatedSteps++; } };
    const clear = (g) => { for (const u of g.GetAllGameUnits(true)) u.Destroyed = true; g.GameUnits = []; };
    const packets = (g) => g.GetAllGameUnitsArray(true).filter((u) => u instanceof UnitEnergyPacket && !u.Destroyed).length;
    const chain = (g, n, gap) => { // panel + n relays (optional gap index, 1-based) + laser at the far end
      g.Spawn(new UnitSolarPanel({ x: 0, y: 0 }));
      const nodes = [];
      for (let i = 1; i <= n; i++) if (i !== gap) nodes.push(g.Spawn(new UnitConduit({ x: i * 80, y: 0 })));
      const laser = g.Spawn(new UnitLaser({ x: (n + 1) * 80, y: 0 }));
      return { nodes, laser };
    };

    /* N1: packets cross a 30-relay chain and charge a laser at the far end */
    {
      const g = fresh(); clear(g);
      const { laser } = chain(g, 30);
      run(g, 90);
      check("N1 packets cross a 30-node chain (far laser charged)", laser.EnergyCharges > 0, "charges=" + laser.EnergyCharges);
      // pipeline fill: ~31 hops in flight + margin — NOT a pile-up
      check("N1 in-flight packets match pipeline fill (no pile-up)", packets(g) < 80, "packets=" + packets(g));
    }

    /* N2: cutting the middle strands upstream packets — they pile at the gap but the
       heat rule self-limits them, and nothing crosses to the far end */
    {
      const g = fresh(); clear(g);
      const { nodes, laser } = chain(g, 20);
      run(g, 30);
      check("N2 chain flows before the break", laser.EnergyCharges > 0, "charges=" + laser.EnergyCharges);
      const mid = nodes[10]; // c11 (x=880); the link c11→c12 dies
      mid.Destroy(g, true);
      run(g, 10); // flush in-flight packets past the gap
      const frozen = laser.EnergyCharges;
      run(g, 60);
      check("N2 nothing crosses the gap afterwards", laser.EnergyCharges === frozen, "charges=" + frozen + "->" + laser.EnergyCharges);
      check("N2 stranded packets self-limit (heat burns them)", packets(g) < 60, "packets=" + packets(g));
    }

    /* N3: the same break heals itself — bridging relays re-link automatically */
    {
      const g = fresh(); clear(g);
      const { nodes, laser } = chain(g, 20);
      run(g, 30);
      nodes[10].Destroy(g, true); // break c11→c12
      run(g, 5);
      laser.EnergyCharges = 0; // drain the sink so restored delivery is measurable
      const b1 = g.Spawn(new UnitConduit({ x: 920, y: 30 })); // 50px from c11, 80px from b2
      const b2 = g.Spawn(new UnitConduit({ x: 1000, y: 30 })); // 50px from c13
      run(g, 45);
      const linked = b1.GetLinkedConduit === b2 && laser.EnergyCharges > 0;
      check("N3 bridge relays auto-link and restore delivery", linked,
        "b1->" + (b1.GetLinkedConduit === b2 ? "b2" : "null") + " charges=" + laser.EnergyCharges);
    }

    /* N4: a manual conduit CYCLE — packets circulate without multiplying forever */
    {
      const g = fresh(); clear(g);
      const c1 = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const c2 = g.Spawn(new UnitConduit({ x: 80, y: 0 }));
      const c3 = g.Spawn(new UnitConduit({ x: 40, y: 70 }));
      check("N4 cycle links accepted", HSManualLink(g, c1, c2) === "link" && HSManualLink(g, c2, c3) === "link" && HSManualLink(g, c3, c1) === "link");
      g.Spawn(new UnitSolarPanel({ x: -80, y: 0 })); // feeds c1 only
      run(g, 90);
      check("N4 cycle stays intact under manual control", c1.GetLinkedConduit === c2 && c2.GetLinkedConduit === c3 && c3.GetLinkedConduit === c1,
        "c1->" + (c1.GetLinkedConduit === c2 ? "c2" : String(c1.GetLinkedConduit && c1.GetLinkedConduit.Name)) +
        " c2->" + (c2.GetLinkedConduit === c3 ? "c3" : String(c2.GetLinkedConduit && c2.GetLinkedConduit.Name)) +
        " c3->" + (c3.GetLinkedConduit === c1 ? "c1" : String(c3.GetLinkedConduit && c3.GetLinkedConduit.Name)));
      check("N4 circulation self-limits (no runaway packets)", packets(g) < 60, "packets=" + packets(g));
    }

    /* N5: delivery priority — live consumers beat relays; a full consumer defers to the relay */
    {
      const g = fresh(); clear(g);
      const relay = g.Spawn(new UnitConduit({ x: 0, y: 0 }));
      const c2 = g.Spawn(new UnitConduit({ x: 0, y: 80 }));
      const laser = g.Spawn(new UnitLaser({ x: 80, y: 0 }));
      run(g, 0.5); // let relay auto-link to c2
      const p = new UnitEnergyPacket(relay.Position, relay);
      g.Spawn(p);
      p.Position = { x: relay.Position.x, y: relay.Position.y }; // arrive instantly
      for (let i = 0; i < 5 && !p.Destroyed && p.Target === relay; i++) p.Update(g, 1 / 60);
      check("N5 consumer beats relay (packet routes to the laser, not the neighbouring conduit)", p.Target === laser,
        "target=" + (p.Target && p.Target.Name));
      run(g, 3); // fly there and deliver
      check("N5 the laser actually received the packet", laser.EnergyCharges === 15, "charges=" + laser.EnergyCharges);
      run(g, 1); // deliver it
      laser.EnergyCharges = 60; // full — must stop accepting
      const p2 = new UnitEnergyPacket(relay.Position, relay);
      g.Spawn(p2);
      p2.Position = { x: relay.Position.x, y: relay.Position.y };
      for (let i = 0; i < 5 && !p2.Destroyed && p2.Target === relay; i++) p2.Update(g, 1 / 60);
      check("N5 full laser is skipped (packet defers to the relay)", p2.Target === relay.GetLinkedConduit,
        "target=" + (p2.Target && p2.Target.Name) + " link=" + (relay.GetLinkedConduit && relay.GetLinkedConduit.Name));
    }

    /* N6: destruction storm — 15 of 40 relays die while packets fly; no crash, bounded arrays */
    {
      const g = fresh(); clear(g);
      const nodes = [];
      g.Spawn(new UnitSolarPanel({ x: 0, y: 0 }));
      for (let i = 0; i < 8; i++) g.Spawn(new UnitSolarPanel({ x: -80, y: i * 22 - 77 }));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) nodes.push(g.Spawn(new UnitConduit({ x: c * 80, y: r * 60 })));
      for (let i = 0; i < 6; i++) g.Spawn(new UnitLaser({ x: 720 + (i % 3) * 40, y: Math.floor(i / 3) * 60 }));
      run(g, 20);
      for (let k = 0; k < 15; k++) nodes[Math.floor(Math.random() * nodes.length)].Destroy(g, true);
      run(g, 30);
      check("N6 storm: no runaway packets", packets(g) < 150, "packets=" + packets(g));
      check("N6 storm: effects swept", g.Effects.length < 100, "effects=" + g.Effects.length);
      check("N6 storm: unit slots compacted", g.GameUnits.length < 400, "units=" + g.GameUnits.length);
    }

    return results;
  })()
`, ctx);

let fails = 0;
for (const r of suite) {
  console.log(`${r.pass ? "OK  " : "FAIL"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  if (!r.pass) fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nall energy-network checks passed");
process.exit(fails ? 1 : 0);
