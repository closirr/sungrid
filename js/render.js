/* SUNGRID — rendering for the free-placement simulation (Harvesturr logic).
 * Light warm theme. World = continuous px; camera pan/zoom; y-sorted painter. */
"use strict";

const Renderer = {
  canvas: null, ctx: null,
  cam: { x: 0, y: 0, z: 2 },   // screen-space camera target (center) + zoom

  PAL: {
    skyTop: "#e9e6d6", skyBottom: "#d5d1bd",
    floorA: "#d8d2ac", floorB: "#d1cba4", grid: "rgba(120,110,70,0.16)",
    rockTop: "#b9b096", rockL: "#a39a80", rockR: "#948b73",
    mineral: "#2fa88a", mineralRich: "#e0a032",
    spawn: "rgba(217,83,79,0.16)",
    core: "#3fa7d6",
    body: "#f6f2e6", bodyL: "#e4ddca", bodyR: "#d4cdb9",
    atom: "#e8a01e", atomGlow: "rgba(232,160,30,0.35)",
    packetLost: "rgba(200,60,45,0.9)",
  },

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { x: 0, y: 0, z: 2 };
  },

  shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
    const g = U.clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
    const b = U.clamp(Math.round((n & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  mix(a, b, k) {
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const r = Math.round((((na >> 16) & 255) * (1 - k)) + (((nb >> 16) & 255) * k));
    const g = Math.round((((na >> 8) & 255) * (1 - k)) + (((nb >> 8) & 255) * k));
    const bl = Math.round(((na & 255) * (1 - k)) + ((nb & 255) * k));
    return `rgb(${r},${g},${bl})`;
  },

  clampCam() {
    this.cam.z = U.clamp(this.cam.z, 0.5, 3);
    const half = HS.MAP_HALF + 200;
    this.cam.x = U.clamp(this.cam.x, -half, half);
    this.cam.y = U.clamp(this.cam.y, -half, half);
  },

  /* screen px → world px (world origin = map center) */
  screenToWorld(sx, sy) {
    return { x: (sx - CFG.W / 2) / this.cam.z + this.cam.x, y: (sy - CFG.H / 2) / this.cam.z + this.cam.y };
  },

  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.z + CFG.W / 2, y: (wy - this.cam.y) * this.cam.z + CFG.H / 2 };
  },

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.cam.z = U.clamp(this.cam.z * factor, 0.5, 3);
    this.cam.x = before.x - (sx - CFG.W / 2) / this.cam.z;
    this.cam.y = before.y - (sy - CFG.H / 2) / this.cam.z;
    this.clampCam();
  },

  panBy(dx, dy) {
    this.cam.x += dx / this.cam.z;
    this.cam.y += dy / this.cam.z;
    this.clampCam();
  },

  zoomTo(z) { this.cam.z = U.clamp(z, 0.5, 3); },

  diamond(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x, y + h / 2);
    ctx.lineTo(x - w / 2, y);
    ctx.closePath();
  },

  prism(ctx, x, y, s, hPx, top, left, right, stroke) {
    const wx = (ISO.TW / 2) * s, wy = (ISO.TH / 2) * s;
    const yT = y - hPx;
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(x, yT + wy); ctx.lineTo(x + wx, yT);
    ctx.lineTo(x + wx, y); ctx.lineTo(x, y + wy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(x - wx, yT); ctx.lineTo(x, yT + wy);
    ctx.lineTo(x, y + wy); ctx.lineTo(x - wx, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = top;
    this.diamond(ctx, x, yT, ISO.TW * s, ISO.TH * s);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - wx, yT); ctx.lineTo(x, yT + wy); ctx.lineTo(x + wx, yT);
      ctx.moveTo(x - wx, yT); ctx.lineTo(x - wx, y); ctx.lineTo(x, y + wy);
      ctx.lineTo(x + wx, y); ctx.lineTo(x + wx, yT);
      ctx.moveTo(x, yT + wy); ctx.lineTo(x, y + wy);
      ctx.stroke();
    }
  },

  dashedLine(ctx, a, b, seg, color, offset) {
    const d = Utils2.normalize({ x: b.x - a.x, y: b.y - a.y });
    const len = Utils2.dist(a, b);
    let t = ((offset || 0) % (seg * 2) + seg * 2) % (seg * 2);
    let px = a.x + d.x * t, py = a.y + d.y * t;
    let drawn = t;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    while (drawn + seg < len) {
      px += d.x * seg; py += d.y * seg;
      ctx.lineTo(px, py);
      px += d.x * seg; py += d.y * seg;
      ctx.moveTo(px, py);
      drawn += seg * 2;
    }
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  },

  /* ---------- main render ---------- */
  render(sim, appState) {
    const ctx = this.ctx;
    const { W, H } = CFG;
    if (appState !== "game" || !sim) { this.renderMenuBg(); return; }
    const z = this.cam.z;

    ctx.fillStyle = "#d5d1bd";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawGround(ctx, sim);
    this.drawPlacementRanges(ctx, sim);

    // painter order: world y (entities are free-floating)
    const sorted = sim.units.slice().sort((a, b) => a.y - b.y);
    for (const u of sorted) this.drawUnit(ctx, sim, u);

    this.drawPackets(ctx, sim);
    this.drawUnitOverlays(ctx, sim);
    this.drawEffects(ctx, sim);

    ctx.restore();
  },

  /* decorative checker diamond ground, culled to the view */
  drawGround(ctx, sim) {
    const z = this.cam.z;
    const half = HS.MAP_HALF;
    const TL = 64, TH = 32; // ground tile 64×32 (2:1)
    const w0 = this.screenToWorld(0, 0), w1 = this.screenToWorld(CFG.W, CFG.H);
    const c0 = Math.floor((w0.x - w0.y) / TL) - 1, c1 = Math.ceil((w1.x - w1.y) / TL) + 1;
    const r0 = Math.floor((w0.x + w0.y) / TH / 2) - 1, r1 = Math.ceil((w1.x + w1.y) / TH / 2) + 1;
    ctx.lineWidth = 1;
    for (let a = c0; a <= c1; a++) {
      for (let b = r0; b <= r1; b++) {
        const x = (a - b) * (TL / 2), y = (a + b) * (TH / 2);
        if (x < -half - TL || x > half + TL || y < -half - TH || y > half + TH) continue;
        ctx.fillStyle = (a + b) % 2 === 0 ? this.PAL.floorA : this.PAL.floorB;
        this.diamond(ctx, x, y, TL, TH);
        ctx.fill();
        ctx.strokeStyle = this.PAL.grid;
        ctx.stroke();
      }
    }
    // map edge
    ctx.strokeStyle = "rgba(90,80,50,0.4)";
    ctx.lineWidth = 3 / z;
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.lineWidth = 1;
  },

  /* ghost + range circles for the active build tool */
  drawPlacementRanges(ctx, sim) {
    const tool = UI.activeTool;
    if (!tool || tool === "picker") return;
    const m = UI.mouseWorld;
    if (!m) return;
    const ranges = { conduit: [HS.CONNECT_RANGE_POWER, "rgba(180,150,30,0.5)"], solar: [HS.CONNECT_RANGE_POWER, "rgba(180,150,30,0.5)"], harvester: [HS.HARVEST_RANGE, "rgba(60,140,90,0.5)"], laser: [HS.LASER_SINGLE_RNG, "rgba(200,60,45,0.5)"] };
    const rg = ranges[tool];
    if (rg) {
      ctx.strokeStyle = rg[1];
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5 / this.cam.z;
      ctx.beginPath(); ctx.arc(m.x, m.y, rg[0], 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    const def = SIM_DEFS[tool];
    if (def && UI.mouseWorld) {
      const ok = sim.canPlace(m.x, m.y, def.size) && sim.resources >= def.cost;
      ctx.fillStyle = ok ? "rgba(120,180,90,0.35)" : "rgba(217,83,79,0.4)";
      this.diamond(ctx, m.x, m.y, def.size.w * 1.5, def.size.h * 1.5);
      ctx.fill();
      ctx.strokeStyle = ok ? "#3f9e5f" : "#c8453f";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  },

  unitColors(u) {
    const c = {
      solar: { top: "#7fc4e8", glow: "#3fa7d6" },
      conduit: { top: "#7ecf96", glow: "#3f9e5f" },
      harvester: { top: "#ecc06a", glow: "#c8860b" },
      laser: { top: "#d88484", glow: "#c8453f" },
      wip: { top: "#e8e2d0", glow: "#b8a860" },
      mineral: { top: this.PAL.mineral, glow: this.PAL.mineral },
      packet: { top: this.PAL.atom, glow: this.PAL.atom },
      ufo: { top: "#c8453f", glow: "#8a2a24" },
    }[u.kind] || { top: "#e8e2d0", glow: "#9a9276" };
    return c;
  },

  drawUnit(ctx, sim, u) {
    const c = this.unitColors(u);
    const detail = this.cam.z >= 2;
    switch (u.kind) {
      case "mineral": {
        const col = u.mega ? this.PAL.mineralRich : this.PAL.mineral;
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y - 16); ctx.lineTo(u.x + 8, u.y + 2); ctx.lineTo(u.x, u.y + 7);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(u.x, u.y - 16); ctx.lineTo(u.x - 8, u.y + 2); ctx.lineTo(u.x, u.y + 7);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        if (detail && u.mega) {
          ctx.fillStyle = "#4a4432";
          ctx.font = "10px Segoe UI";
          ctx.textAlign = "center";
          ctx.fillText(u.count, u.x, u.y - 20);
        }
        break;
      }
      case "conduit": {
        const heatK = U.clamp(u.heat / HS.CONDUIT_HEAT_MAX, 0, 1);
        // reference: conduit color lerps white → red with heat
        const body = this.mix(this.PAL.body, "#e8603a", heatK * 0.8);
        // relay link to linked conduit
        const link = u.liveLink;
        if (link) {
          ctx.strokeStyle = "rgba(190,150,30,0.5)";
          ctx.lineWidth = 1.5;
          if (detail) this.dashedLine(ctx, { x: u.x, y: u.y }, { x: link.x, y: link.y }, 6, "rgba(190,150,30,0.6)", sim.time * 60);
          else { ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(link.x, link.y); ctx.stroke(); }
        }
        this.prism(ctx, u.x, u.y, 0.42, 26, this.mix(body, c.top, 0.3), this.mix(this.PAL.bodyL, "#e8603a", heatK * 0.5), this.mix(this.PAL.bodyR, "#c8453f", heatK * 0.6), "rgba(90,84,60,0.5)");
        if (detail && u.heat > 5) this.bar(ctx, u.x, u.y - 30, heatK, heatK > 0.6 ? "#c8453f" : "#e0a032");
        break;
      }
      case "solar": {
        this.prism(ctx, u.x, u.y, 0.74, 14, this.mix(this.PAL.body, c.top, 0.6), this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.5)");
        break;
      }
      case "harvester": {
        const idle = u.charges <= 0 && (sim.time - u._lastUse) > u.updateInterval;
        this.prism(ctx, u.x, u.y, 0.68, 12, this.mix(this.PAL.body, idle ? "#9a9276" : c.top, idle ? 0.25 : 0.6), this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.5)");
        break;
      }
      case "laser": {
        const powered = u.charges > 0;
        const body = powered ? this.mix(this.PAL.body, c.top, 0.55) : "#b3ad9c";
        // beam to target
        if (u.target && u.charges > 0 && !u.liveLink) {
          ctx.strokeStyle = "rgba(200,60,45,0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(u.x, u.y - 12); ctx.lineTo(u.target.x, u.target.y); ctx.stroke();
        }
        this.prism(ctx, u.x, u.y, 0.56, 16, body, this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.5)");
        if (detail) this.bar(ctx, u.x, u.y - 32, u.charges / u.maxCharges, "#e0a032");
        // feeder link line
        const link = u.liveLink;
        if (link) {
          ctx.strokeStyle = u.isAttacking ? "rgba(200,60,45,0.9)" : "rgba(200,60,45,0.45)";
          ctx.lineWidth = u.isAttacking ? 2 : 1.2;
          ctx.beginPath(); ctx.moveTo(u.x, u.y - 10); ctx.lineTo(link.x, link.y - 10); ctx.stroke();
        }
        break;
      }
      case "wip": {
        this.prism(ctx, u.x, u.y, 0.7, 8, "#e8e2d0", this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.6)");
        const prog = 1 - u.remaining / u.makeReal.cost;
        ctx.strokeStyle = "rgba(150,120,40,0.9)";
        ctx.lineWidth = 2;
        this.diamond(ctx, u.x, u.y, 56, 28);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,196,64,1)";
        this.diamond(ctx, u.x, u.y, 56 * prog, 28 * prog);
        ctx.stroke();
        break;
      }
      case "ufo": {
        ctx.save();
        ctx.translate(u.x, u.y - 8);
        ctx.rotate(u.spin * 0.1);
        ctx.fillStyle = u.hp < u.maxHp ? this.mix("#c8453f", "#ffffff", 0.3) : "#c8453f";
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(60,30,26,0.6)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#8a2a24";
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (detail && u.hp < u.maxHp) this.bar(ctx, u.x, u.y - 30, u.hp / u.maxHp, "#c8453f");
        break;
      }
    }

    // hp bar for damaged buildings
    if (detail && u.maxHp && u.kind !== "ufo" && u.kind !== "mineral" && u.kind !== "packet" && u.hp < u.maxHp) {
      this.bar(ctx, u.x, u.y - 34, u.hp / u.maxHp, "#3f9e5f");
    }
  },

  bar(ctx, x, y, k, color) {
    ctx.fillStyle = "rgba(60,54,36,0.75)";
    ctx.fillRect(x - 16, y, 32, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - 16, y, 32 * U.clamp(k, 0, 1), 4);
  },

  drawPackets(ctx, sim) {
    for (const u of sim.units) {
      if (!(u instanceof EnergyPacket) || u.dead) continue;
      ctx.fillStyle = this.PAL.atomGlow;
      ctx.beginPath(); ctx.arc(u.x, u.y, 7, 0, 7); ctx.fill();
      ctx.fillStyle = this.PAL.atom;
      ctx.beginPath(); ctx.arc(u.x, u.y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.arc(u.x - 1, u.y - 1, 1.6, 0, 7); ctx.fill();
    }
  },

  drawUnitOverlays(ctx, sim) {
    const detail = this.cam.z >= 2;
    // hover link lines
    if (UI.hoverUnit && !UI.hoverUnit.dead) {
      const u = UI.hoverUnit;
      if (u instanceof Conduit || u instanceof SolarPanel || u instanceof Laser) {
        const rr = u instanceof Laser ? (u.charges > 0 ? u._range : HS.LASER_SINGLE_RNG) : HS.CONNECT_RANGE_POWER;
        ctx.strokeStyle = u instanceof Laser ? "rgba(200,60,45,0.5)" : "rgba(180,150,30,0.5)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(u.x, u.y, rr, 0, Math.PI * 2); ctx.stroke();
        for (const o of sim.units) {
          if (o.dead || o === u) continue;
          const linked = (u instanceof Conduit && u.linkedConduit === o) ||
                         (u instanceof Laser && u.linkedLaser === o) ||
                         ((o instanceof Laser || o instanceof Conduit) && u instanceof Conduit && o.linkedConduit === u);
          if (u.canLinkEnergy && Utils2.dist(u, o) < (rr || 0) && ((u instanceof Conduit && o instanceof Conduit) || (u instanceof Laser && o instanceof Laser))) {
            ctx.strokeStyle = "rgba(180,150,30,0.35)";
            ctx.beginPath(); ctx.moveTo(u.x, u.y); ctx.lineTo(o.x, o.y); ctx.stroke();
          }
        }
      }
    }
    // selected unit outline
    if (UI.selectedUnit && !UI.selectedUnit.dead) {
      const u = UI.selectedUnit;
      ctx.strokeStyle = "#b8860b";
      ctx.lineWidth = 1.6;
      this.diamond(ctx, u.x, u.y, 52, 30);
      ctx.stroke();
    }
  },

  drawEffects(ctx, sim) {
    // lightning sparks for lost packets
    for (const fx of sim.fx) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 1.5;
      for (let arm = 0; arm < 3; arm++) {
        let px = fx.x, py = fx.y;
        for (let i = 0; i < 3; i++) {
          const nx = px + U.rand(-6, 6), ny = py + U.rand(-6, 6);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
          px = nx; py = ny;
        }
      }
    }
  },

  renderMenuBg() {
    const ctx = this.ctx;
    const { W, H } = CFG;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#efece0");
    grad.addColorStop(1, "#ddd8c6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    const t = performance.now() / 1000;
    ctx.strokeStyle = "rgba(120,110,70,0.12)";
    for (let i = 0; i < 14; i++) {
      const y = ((t * 26 + i * 52) % (H + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 3; i++) {
      const a = t * 0.12 + i * 2.1;
      const x = W / 2 + Math.cos(a) * W * 0.42, y = H / 2 + Math.sin(a * 1.3) * H * 0.4;
      const col = ["143,196,229", "233,164,102", "126,190,140"][i];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 190);
      rg.addColorStop(0, `rgba(${col},0.22)`);
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(x - 190, y - 190, 380, 380);
    }
    ctx.restore();
  },
};
