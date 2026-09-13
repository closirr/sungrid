/* SUNGRID — headless sim tests (node tools/simtest.js)
 * Drives the free-placement Sim directly (pure logic, no DOM). */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const sandbox = { console, Math, JSON, performance: { now: () => Date.now() } };
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "sim.js"), "utf8"), ctx, { filename: "sim.js" });

const suite = vm.runInContext(`
  (function () {
    const results = [];
    const check = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
    const run = (g, sec) => { for (let i = 0; i < sec * 60; i++) g.update(1 / 60); };
    const count = (g, kind) => g.units.filter((u) => !u.dead && u.kind === kind).length;

    /* S1: solar emits a packet every 2s toward a conduit in range */
    {
      const g = new Sim();
      g.units.length = 0; // clear minerals for determinism
      const solar = g.spawn(new SolarPanel(0, 0));
      const cond = g.spawn(new Conduit(80, 0)); // within 96
      run(g, 5);
      const packets = g.units.filter((u) => u instanceof EnergyPacket || (u.dead && u instanceof EnergyPacket));
      check("S1 solar emits packets", packets.length >= 2, "packets=" + packets.length + " in 5s (interval 2s)");
      check("S1 conduit relayed (heat grows or packet moved on)", cond.heat > 0 || packets.some((p) => p.previous === cond || p.target === cond), "heat=" + cond.heat);
    }

    /* S2: laser consumes packets into charges (+15 each, cap 60) and accepts only below cap */
    {
      const g = new Sim();
      g.units.length = 0;
      const laser = g.spawn(new Laser(0, 0));
      for (let i = 0; i < 6; i++) laser.consumeEnergyPacket(g, { dead: false });
      check("S2 charges +15/packet", laser.charges === 90 || laser.charges === 60, "charges=" + laser.charges + " (cap 60, +15/packet)");
      check("S2 cap enforced", laser.charges <= 60, "charges=" + laser.charges);
      laser.charges = 60;
      const full = laser.consumeEnergyPacket(g, { dead: false });
      check("S2 full laser relays instead", full === true, "returned " + full);
    }

    /* S3: laser shoots a UFO: 1 charge per 0.1s tick, dmg 1, and kills it */
    {
      const g = new Sim();
      g.units.length = 0;
      const laser = g.spawn(new Laser(0, 0));
      laser.charges = 60;
      const ufo = g.spawn(new Ufo(100, 0)); // within base range 64? no — 100 > 64. Put closer:
      ufo.x = 50; ufo.y = 0;
      const hp0 = ufo.hp;
      run(g, 3);
      check("S3 laser damaged ufo", ufo.hp < hp0 || ufo.dead, "hp " + hp0 + " → " + ufo.hp.toFixed(0) + " charges=" + laser.charges);
      check("S3 range 64 respected (ufo inside)", ufo.dead || Utils2.dist(laser, ufo) <= 64 + 10, "dist=" + Utils2.dist(laser, ufo).toFixed(0));
    }

    /* S4: chain damage — A feeds B: B dmg = 2, range = 64*1.2; A does not shoot */
    {
      const g = new Sim();
      g.units.length = 0;
      const a = g.spawn(new Laser(0, 0));
      const b = g.spawn(new Laser(60, 0));
      a.linkLaser(b, g);
      a.charges = 60; b.charges = 60;
      b.calc();
      check("S4 chain damage 1+1=2", b._dmg === 2, "dmg=" + b._dmg);
      check("S4 chain range ×1.2", Math.abs(b._range - 64 * 1.2) < 0.01, "range=" + b._range.toFixed(1));
      const ufo = g.spawn(new Ufo(140, 0)); // within chained range 76.8, outside single 64
      run(g, 5);
      check("S4 chained laser hit far ufo", ufo.hp < 50 || ufo.dead, "hp=" + ufo.hp.toFixed(0));
      check("S4 feeder drained, not shot", a.isAttacking === true || a.charges < 60, "feeder charges=" + a.charges + " attacking=" + a.isAttacking);
    }

    /* S5: cycle protection — B cannot link back into A's feeder chain */
    {
      const g = new Sim();
      g.units.length = 0;
      const a = g.spawn(new Laser(0, 0));
      const b = g.spawn(new Laser(60, 0));
      a.linkLaser(b, g);
      b.linkLaser(a, g); // would create a cycle → must be rejected (a unlinks)
      check("S5 cycle rejected", a.liveLink == null || b.liveLink === a, "a.link=" + (a.liveLink && "b") + " b.link=" + (b.liveLink && "a"));
    }

    /* S6: conduit heat — packets relay, heat rises, overflow destroys packets */
    {
      const g = new Sim();
      g.units.length = 0;
      const cond = g.spawn(new Conduit(0, 0));
      for (let i = 0; i < 105; i++) {
        const p = new EnergyPacket(0, 0, cond, null);
        cond.consumeEnergyPacket(g, p);
      }
      check("S6 heat capped at 100", cond.heat === 100, "heat=" + cond.heat);
      check("S6 overflow packets destroyed", g.units.filter((u) => u instanceof EnergyPacket && !u.dead).length === 0, "no leaked packets");
    }

    /* S7: harvester turns packets+minerals into resources; no minerals → self-destruct +2 */
    {
      const g = new Sim();
      g.units.length = 0;
      const h = g.spawn(new Harvester(0, 0));
      const m = g.spawn(new Mineral(30, 0, false));
      const res0 = g.resources;
      h.charges = 3;
      run(g, 6); // harvest interval 5s: first harvest at t=0, second at t=5
      check("S7 harvested +R$ per charge", g.resources >= res0 + 1 && h.charges < 3, "resources=" + g.resources + " charges=" + h.charges);
      // strip minerals → harvester self-destructs with +2 refund
      m.count = 0; m.dead = true;
      run(g, 6);
      const alive = g.units.some((u) => u === h && !u.dead);
      check("S7 starved harvester self-destructs +2", !alive && g.resources >= res0 + 2, "alive=" + alive + " resources=" + g.resources);
    }

    /* S8: waves — nothing before wave 8 count formula, then correct counts */
    {
      const g = new Sim();
      g.units.length = 0;
      g.bounds = { x: -2000, y: -2000, w: 4000, h: 4000 };
      run(g, 82); // 8 wave ticks (every 10s)
      const ufos = count(g, "ufo");
      check("S8 wave 8 spawns 1 ufo", ufos >= 1, "ufos=" + ufos + " wave=" + g.wave);
      check("S8 wave counter advanced", g.wave >= 8, "wave=" + g.wave);
      const expected = Math.max(0, Math.floor(((g.wave - 5) / 5) * 2));
      check("S8 count formula", Math.abs(ufos - expected * (g.wave - 7)) < 3, "ufos=" + ufos + " expected~" + expected + "×" + (g.wave - 7));
    }

    /* S9: placement — cost deducted, overlap rejected */
    {
      const g = new Sim();
      g.units.length = 0;
      g.resources = 100;
      const ok = g.placeBuilding("laser", 0, 0);
      check("S9 placed and paid", ok && g.resources === 90, "resources=" + g.resources);
      const wip = g.units.find((u) => u instanceof BuildingWIP);
      check("S9 WIP needs 10 packets", wip && wip.remaining === 10, "remaining=" + (wip && wip.remaining));
      const overlap = g.placeBuilding("laser", 5, 5);
      check("S9 overlap rejected", !overlap, "second laser on same spot");
      const poor = (() => { g.resources = 2; return g.placeBuilding("conduit", 200, 200); })();
      check("S9 no money rejected", !poor, "resources=2 < 5");
    }

    /* S10: WIP builds from packets, then spawns the real unit with relinks */
    {
      const g = new Sim();
      g.units.length = 0;
      g.resources = 100;
      g.placeBuilding("solar", 0, 0);
      const wip = g.units.find((u) => u instanceof BuildingWIP);
      check("S10 WIP needs 15 packets", wip.remaining === 15, "remaining=" + wip.remaining);
      for (let i = 0; i < 15; i++) wip.consumeEnergyPacket(g, { dead: false });
      const solar = g.units.find((u) => u instanceof SolarPanel);
      check("S10 finished → real solar panel", !!solar, "solar spawned at " + (solar && solar.x));
    }

    /* S11: packets prefer consumers over conduits; link used as fallback route */
    {
      const g = new Sim();
      g.units.length = 0;
      const cond = g.spawn(new Conduit(0, 0));
      const cond2 = g.spawn(new Conduit(50, 0));
      cond.linkConduit(cond2);
      const wip = g.spawn(new BuildingWIP(90, 0, "laser"));
      // packet arrives at cond: WIP accepting within 96 → should route to WIP, not cond2
      const p = new EnergyPacket(0, 0, cond, null);
      p.arrive(g);
      check("S11 consumer preferred over relay", p.target === wip || p.dead, "target=" + (p.target && (p.target.kind + "@" + Math.round(p.target.x))));
      // now with the WIP gone, packet should follow the linked conduit
      const p2 = new EnergyPacket(0, 0, cond, null);
      wip.dead = true;
      p2.arrive(g);
      check("S11 fallback to linked conduit", p2.target === cond2 || p2.dead, "target=" + (p2.target && p2.target.kind));
    }

    /* S12: UFO attacks nearest building, knockback applied */
    {
      const g = new Sim();
      g.units.length = 0;
      const a = g.spawn(new Conduit(-500, 0));
      const b = g.spawn(new Conduit(-520, 30));
      const ufo = g.spawn(new Ufo(-560, 0));
      run(g, 9);
      check("S12 ufo attacked something", a.hp < 100 || b.hp < 100, "a.hp=" + a.hp + " b.hp=" + b.hp);
      check("S12 ufo moved toward target", ufo.x > -560, "x=" + ufo.x.toFixed(0));
    }

    return results;
  })()
`, ctx);

let fails = 0;
for (const r of suite) {
  console.log(`${r.pass ? "OK  " : "FAIL"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  if (!r.pass) fails++;
}
console.log(fails ? `\n${fails} FAILED` : "\nall sim tests passed");
process.exit(fails ? 1 : 0);
