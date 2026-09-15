/* SUNGRID — renderer for the Harvesturr structural port.
 * Contrast colour system: blue=energy, yellow=money/minerals, green=working/valid,
 * orange=overheat/no-energy, red=enemy/damage/forbidden, white=neutral UI,
 * graphite outlines. Buildings are distinct vector silhouettes (no identical cubes),
 * ghost placement has 3 unambiguous states, link drags preview with reasons. */
"use strict";

const Renderer = {
  canvas: null, ctx: null,
  cam: { target: { x: 0, y: 0 }, offset: { x: 640, y: 360 }, zoom: 2 },

  PAL: {
    bg: "#8a846c",                                   // darker backdrop — the island pops
    floorA: "#b4ad8b", floorB: "#aaa27e", grid: "rgba(60,54,34,0.17)",
    body: "#f7f3e8", bodyL: "#e0d8c4", bodyR: "#cfc7b2",
    edge: "rgba(42,48,58,0.8)",                      // graphite outlines
    slate: "#2c333d",
    energy: "#3fa9f5", energyGlow: "rgba(63,169,245,0.45)",
    money: "#e0a423", moneyL: "#ffd24a",
    ok: "#46c46e", warn: "#f08c1e", bad: "#e0453c",
    alien: "#b04ad8",                                // purple enemy outline
    link: "rgba(63,169,245,0.75)",                   // energy links are blue now
    laser: "rgba(224,69,60,0.95)",
    shadow: "rgba(40,44,30,0.30)",
  },

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { target: { x: 0, y: 0 }, offset: { x: CFG.W / 2, y: CFG.H / 2 }, zoom: 2 };
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

  diamond(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w / 2, y);
    ctx.lineTo(x, y + h / 2); ctx.lineTo(x - w / 2, y);
    ctx.closePath();
  },

  prism(ctx, x, y, w, h, hPx, top, left, right, stroke) {
    const wx = w / 2, wy = h / 2, yT = y - hPx;
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(x, yT + wy); ctx.lineTo(x + wx, yT); ctx.lineTo(x + wx, y); ctx.lineTo(x, y + wy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(x - wx, yT); ctx.lineTo(x, yT + wy); ctx.lineTo(x, y + wy); ctx.lineTo(x - wx, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = top;
    this.diamond(ctx, x, yT, w, h);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - wx, yT); ctx.lineTo(x, yT + wy); ctx.lineTo(x + wx, yT);
      ctx.moveTo(x - wx, yT); ctx.lineTo(x - wx, y); ctx.lineTo(x, y + wy); ctx.lineTo(x + wx, y); ctx.lineTo(x + wx, yT);
      ctx.moveTo(x, yT + wy); ctx.lineTo(x, y + wy);
      ctx.stroke();
    }
  },

  dashedLine(ctx, a, b, seg, color, offset) {
    const d = V2.normalize(V2.sub(b, a));
    const len = V2.dist(a, b);
    let t = ((offset || 0) % (seg * 2) + seg * 2) % (seg * 2);
    let px = a.x + d.x * t, py = a.y + d.y * t, drawn = t;
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

  contactShadow(ctx, x, y, rx, ry) {
    ctx.fillStyle = this.PAL.shadow;
    ctx.beginPath(); ctx.ellipse(x, y + 1, rx, ry, 0, 0, 7); ctx.fill();
  },

  // marching chevrons showing energy flow direction along a link
  flowArrows(ctx, a, b, color, time) {
    const len = V2.dist(a, b);
    if (len < 18) return;
    const d = V2.normalize(V2.sub(b, a));
    const n = Math.max(1, Math.floor(len / 44));
    const sp = len / n;
    const off = ((time || 0) * 26) % sp;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    const s = 3.2;
    for (let i = 0; i <= n; i++) {
      const t = off + i * sp;
      if (t < 8 || t > len - 8) continue;
      const px = a.x + d.x * t, py = a.y + d.y * t;
      ctx.beginPath();
      ctx.moveTo(px - d.x * s - d.y * s * 0.7, py - d.y * s + d.x * s * 0.7);
      ctx.lineTo(px, py);
      ctx.lineTo(px - d.x * s + d.y * s * 0.7, py - d.y * s - d.x * s * 0.7);
      ctx.stroke();
    }
  },

  /* Camera2D mirror: screen = (world − target) × zoom + offset */
  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.target.x) * this.cam.zoom + this.cam.offset.x, y: (wy - this.cam.target.y) * this.cam.zoom + this.cam.offset.y };
  },
  screenToWorld(sx, sy) {
    return { x: (sx - this.cam.offset.x) / this.cam.zoom + this.cam.target.x, y: (sy - this.cam.offset.y) / this.cam.zoom + this.cam.target.y };
  },
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = U.clamp(this.cam.zoom * factor, 0.5, 3);
    this.cam.target.x = before.x - (sx - this.cam.offset.x) / this.cam.zoom;
    this.cam.target.y = before.y - (sy - this.cam.offset.y) / this.cam.zoom;
  },
  zoomTo(z) { this.cam.zoom = U.clamp(z, 0.5, 3); },
  panBy(dx, dy) {
    this.cam.target.x += dx / this.cam.zoom;
    this.cam.target.y += dy / this.cam.zoom;
  },

  /* ---------- main render (mirrors Program.cs draw flow) ---------- */
  render(engine, appState) {
    const ctx = this.ctx;
    const { W, H } = CFG;
    // clear every frame — the floor only paints diamonds, without this old frames smear
    ctx.fillStyle = this.PAL.bg;
    ctx.fillRect(0, 0, W, H);
    if (appState !== "game") { this.renderMenuBg(); return; }

    ctx.save();
    ctx.translate(this.cam.offset.x, this.cam.offset.y);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.target.x, -this.cam.target.y);
    const bars = this.DrawWorld(ctx, engine);
    ctx.restore();
    this.DrawScreen(ctx, engine, bars);
  },

  DrawWorld(ctx, engine) {
    this.drawGround();

    const bars = []; // DrawGUI bars: screen-space like reference DrawBar

    // units in GameUnits array order (mirrors reference — no y sort)
    for (const u of engine.GameUnits) {
      if (u == null) continue;
      if (u instanceof UnitEnergyPacket) continue; // packets drawn after, like DrawWorld order in reference
      this.drawUnitWorld(ctx, engine, u, bars);
    }

    // packets: blue glowing energy dots (blue = energy in the colour system)
    for (const u of engine.GameUnits) {
      if (!(u instanceof UnitEnergyPacket) || u.Destroyed) continue;
      ctx.fillStyle = "rgba(63,169,245,0.35)";
      ctx.beginPath(); ctx.arc(u.Position.x, u.Position.y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = this.PAL.energy;
      ctx.beginPath(); ctx.arc(u.Position.x, u.Position.y, 3, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath(); ctx.arc(u.Position.x - 0.8, u.Position.y - 0.8, 1.2, 0, 7); ctx.fill();
    }

    // DrawGUI overlays (link lines, ranges) — world space, drawn after units like reference DrawGUI
    for (const u of engine.GameUnits) {
      if (u == null || u.Destroyed) continue;
      this.drawUnitGUI(ctx, engine, u, bars);
    }

    this.drawGhost(ctx, engine);
    this.drawEffectsWorld(ctx, engine);
    return bars;
  },

  DrawScreen(ctx, engine, bars) {
    // bars last, in screen space (reference DrawBar converts world→screen); clamped to the viewport
    for (const b of bars) {
      const sp = this.worldToScreen(b.x, b.y);
      const w = 48, h = 8, pad = 2;
      const by = Math.max(sp.y, 14);
      ctx.fillStyle = "rgba(30,34,42,0.85)";
      ctx.fillRect(sp.x - w / 2 - pad, by - pad, w + pad * 2, h + pad * 2);
      ctx.fillStyle = b.color;
      ctx.fillRect(sp.x - w / 2, by, w * U.clamp(b.amt, 0, 1), h);
    }
  },

  drawGround() {
    const TL = 64, TH = 32;
    const half = HSMap.TotalWidth / 2;
    // iso lattice: x = (a-b)*TL/2, y = (a+b)*TH/2  ->  a = x/TL + y/TH, b = x/TL - y/TH;
    // extremes sit at DIFFERENT screen corners, so sample all four
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [sx, sy] of [[0, 0], [CFG.W, 0], [0, CFG.H], [CFG.W, CFG.H]]) {
      const w = this.screenToWorld(sx, sy);
      const a = w.x / TL + w.y / TH, b = w.x / TL - w.y / TH;
      if (a < aMin) aMin = a;
      if (a > aMax) aMax = a;
      if (b < bMin) bMin = b;
      if (b > bMax) bMax = b;
    }
    const a0 = Math.floor(aMin) - 1, a1 = Math.ceil(aMax) + 1;
    const b0 = Math.floor(bMin) - 1, b1 = Math.ceil(bMax) + 1;
    const ctx = this.ctx;
    ctx.save();
    // clip to the map island so edge diamonds never leave ragged void strips inside the map
    ctx.beginPath();
    ctx.rect(-half, -half, half * 2, half * 2);
    ctx.clip();
    ctx.lineWidth = 1;
    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) {
        const x = (a - b) * (TL / 2), y = (a + b) * (TH / 2);
        if (x < -half - TL || x > half + TL || y < -half - TH || y > half + TH) continue;
        ctx.fillStyle = (a + b) % 2 === 0 ? this.PAL.floorA : this.PAL.floorB;
        this.diamond(ctx, x, y, TL, TH);
        ctx.fill();
        ctx.strokeStyle = this.PAL.grid;
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(44,51,61,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.lineWidth = 1;
  },

  /* ================= building silhouettes =================
   * Every type is its own vector shape so it reads by silhouette alone.
   * o: { engine, u-like fields } — real units and ghosts/icons share these. */

  // Solar Panel: wide tilted panel with bright blue cells on a small frame
  drawSolarPanel(ctx, x, y, o) {
    this.contactShadow(ctx, x, y, 20, 9);
    // legs
    ctx.strokeStyle = this.PAL.slate; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 11); ctx.lineTo(x - 8, y - 1);
    ctx.moveTo(x + 8, y - 11); ctx.lineTo(x + 8, y - 1);
    ctx.stroke();
    // underside (thickness)
    ctx.fillStyle = "#20303e";
    this.diamond(ctx, x, y - 11, 36, 18); ctx.fill();
    // panel surface at y-14 — bilinear grid of blue cells over the iso diamond
    const N = { x: x, y: y - 23 }, E = { x: x + 18, y: y - 14 }, S = { x: x, y: y - 5 }, W = { x: x - 18, y: y - 14 };
    const P = (u, v) => ({ x: N.x + u * (E.x - N.x) + v * (W.x - N.x), y: N.y + u * (E.y - N.y) + v * (W.y - N.y) });
    const COLS = 4, ROWS = 2;
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const u0 = i / COLS, u1 = (i + 1) / COLS, v0 = j / ROWS, v1 = (j + 1) / ROWS;
        const a = P(u0, v0), b = P(u1, v0), c = P(u1, v1), d = P(u0, v1);
        ctx.fillStyle = (i + j) % 2 === 0 ? "#3f9fe8" : "#2f7fc4";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.closePath(); ctx.fill();
      }
    }
    // frame + light accent from top-left
    ctx.strokeStyle = "#173045"; ctx.lineWidth = 1.4;
    this.diamond(ctx, x, y - 14, 36, 18); ctx.stroke();
    ctx.strokeStyle = "rgba(210,238,255,0.9)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(W.x, W.y); ctx.lineTo(N.x, N.y); ctx.lineTo(E.x, E.y); ctx.stroke();
    // glint stripe
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(P(0.15, 0.1).x, P(0.15, 0.1).y); ctx.lineTo(P(0.45, 0.35).x, P(0.45, 0.35).y); ctx.stroke();
  },

  // Conduit: small energy node — pedestal pillar with a glowing ring that heats up
  drawConduit(ctx, x, y, o, time) {
    const heat = o.Heat || 0;
    this.contactShadow(ctx, x, y, 11, 4.5);
    this.prism(ctx, x, y, 14, 7, 4, "#e8e2d2", this.PAL.bodyL, this.PAL.bodyR, this.PAL.edge);
    this.prism(ctx, x, y - 4, 8, 4, 8, "#f2eee2", "#d6cfba", "#c4bca6", this.PAL.edge);
    const topY = y - 12;
    // ring colour: blue → orange → red as heat rises (reference lerp idea)
    let ring = this.PAL.energy;
    if (heat > 0) ring = heat <= 50 ? this.mix("#3fa9f5", "#f08c1e", heat / 50) : this.mix("#f08c1e", "#e0453c", (heat - 50) / 50);
    ctx.strokeStyle = ring; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, topY, 8, 4, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = heat > 60 ? "rgba(224,69,60,0.35)" : this.PAL.energyGlow; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(x, topY, 8, 4, 0, 0, 7); ctx.stroke();
    // pulsing core — beats while the node relays packets (heat > 0)
    const pulse = 1.4 + 0.9 * Math.sin((time || 0) * 6 + x * 0.7);
    ctx.fillStyle = heat > 0 ? "#eaf6ff" : "rgba(234,246,255,0.55)";
    ctx.beginPath(); ctx.arc(x, topY, Math.max(0.8, pulse), 0, 7); ctx.fill();
    // antenna tip
    ctx.strokeStyle = this.PAL.slate; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, topY - 4); ctx.lineTo(x, topY - 9); ctx.stroke();
    ctx.fillStyle = ring;
    ctx.beginPath(); ctx.arc(x, topY - 10, 1.4, 0, 7); ctx.fill();
  },

  // Harvester: tracked machine with a boom arm + spinning drill aimed at minerals
  drawHarvester(ctx, x, y, o, time) {
    const engine = o.engine;
    const gray = o.DrawColorTint === "gray";
    this.contactShadow(ctx, x, y, 13, 5.5);
    // tracks
    this.prism(ctx, x, y, 16, 8, 3, "#5a5344", "#474034", "#3b352b", this.PAL.edge);
    // body (yellow = money association, gray when out of energy)
    this.prism(ctx, x, y - 3, 12, 6, 7, gray ? "#b3ad9c" : "#e8c468", gray ? "#9d9788" : "#cfa94e", gray ? "#8d8779" : "#b08f3e", this.PAL.edge);
    // cab
    this.prism(ctx, x - 2, y - 10, 6, 3, 4, gray ? "#c9c4b5" : "#f2d98c", "#c9c4b5", "#b1ab9c", this.PAL.edge);
    // energy pip: green = fed, hollow orange = NEEDS ENERGY
    if (o.EnergyCharges !== undefined) {
      const fed = o.EnergyCharges > 0;
      ctx.fillStyle = fed ? this.PAL.ok : "rgba(240,140,30,0.25)";
      this.diamond(ctx, x + 5, y - 16, 5, 3.2); ctx.fill();
      ctx.strokeStyle = fed ? "#2f8a4d" : this.PAL.warn; ctx.lineWidth = 1;
      this.diamond(ctx, x + 5, y - 16, 5, 3.2); ctx.stroke();
    }
    // aim at the fx mineral while mining, else the nearest mineral in range
    let aim = -2.4, target = null;
    if (engine) {
      target = (o.HarvestFxUntil !== undefined && time < o.HarvestFxUntil && o.HarvestFxTarget && !o.HarvestFxTarget.Destroyed)
        ? o.HarvestFxTarget : null;
      if (!target) {
        let best = 1e9;
        for (const m of engine.GetAllGameUnitsArray()) {
          if (!(m instanceof UnitMineral) || m.Destroyed) continue;
          const d = V2.dist(o.Position || { x, y }, m.Position);
          if (d < UnitHarvester.ConnectRangeHarvest && d < best) { best = d; target = m; }
        }
      }
      if (target) aim = Math.atan2(target.Position.y - y, target.Position.x - x);
    }
    const ax = x + Math.cos(aim) * 11, ay = y - 9 + Math.sin(aim) * 6;
    ctx.strokeStyle = this.PAL.slate; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(ax, ay); ctx.stroke();
    // mining beam: persistent while fed (faint), flaring gold at each conversion
    const fxActive = o.HarvestFxUntil !== undefined && time < o.HarvestFxUntil && target;
    if (target && !gray && o.EnergyCharges !== undefined) {
      ctx.strokeStyle = fxActive ? `rgba(224,164,35,${0.7 + 0.25 * Math.sin(time * 40)})` : "rgba(224,164,35,0.45)";
      ctx.lineWidth = fxActive ? 1.8 : 1.2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(target.Position.x, target.Position.y); ctx.stroke();
      if (fxActive) {
        // gold sparks at the mineral face
        ctx.fillStyle = this.PAL.moneyL;
        for (let i = 0; i < 3; i++) {
          const a = time * 14 + i * 2.1;
          ctx.beginPath(); ctx.arc(target.Position.x + Math.cos(a) * 4, target.Position.y + Math.sin(a) * 3, 1.1, 0, 7); ctx.fill();
        }
      }
    }
    // spinning drill
    const spin = gray ? 0 : (time || 0) * 12;
    ctx.strokeStyle = "#c9c1ab"; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(ax - Math.cos(a) * 3, ay - Math.sin(a) * 3);
      ctx.lineTo(ax + Math.cos(a) * 3, ay + Math.sin(a) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = gray ? "#8d8779" : this.PAL.money;
    ctx.beginPath(); ctx.arc(ax, ay, 1.6, 0, 7); ctx.fill();
    // NO ENERGY marker (orange = no energy in the colour system)
    if (gray) {
      ctx.fillStyle = this.PAL.warn;
      this.diamond(ctx, x, y - 24, 6, 4); ctx.fill();
    }
  },

  // Laser: tall turret with a rotating barrel; charge dot blue, empty = orange
  drawLaser(ctx, x, y, o, time) {
    const gray = o.DrawColorTint === "gray";
    const charges = o.EnergyCharges || 0;
    this.contactShadow(ctx, x, y, 12, 5);
    this.prism(ctx, x, y, 14, 7, 4, gray ? "#d9d4c5" : "#eee9da", this.PAL.bodyL, this.PAL.bodyR, this.PAL.edge);
    this.prism(ctx, x, y - 4, 7, 3.5, 11, gray ? "#e4dfd2" : "#f4f0e4", "#d6cfba", "#c4bca6", this.PAL.edge);
    const headY = y - 18;
    if (o.IsAttacking) {
      const g = ctx.createRadialGradient(x, headY, 0, x, headY, 12);
      g.addColorStop(0, "rgba(224,69,60,0.4)"); g.addColorStop(1, "rgba(224,69,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, headY, 12, 0, 7); ctx.fill();
    }
    // barrel toward aim
    const aim = o.AimAngle !== undefined ? o.AimAngle : -0.5;
    const bx = x + Math.cos(aim) * 10, by = headY + Math.sin(aim) * 6;
    ctx.strokeStyle = "#556070"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, headY); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = this.PAL.edge; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, headY); ctx.lineTo(bx, by); ctx.stroke();
    // head
    ctx.fillStyle = this.PAL.slate;
    ctx.beginPath(); ctx.arc(x, headY, 3.4, 0, 7); ctx.fill();
    ctx.strokeStyle = this.PAL.edge; ctx.lineWidth = 1; ctx.stroke();
    // charge dot: blue = fed, orange = NO ENERGY
    ctx.fillStyle = charges > 0 ? this.PAL.energy : this.PAL.warn;
    ctx.beginPath(); ctx.arc(x, headY - 5.5, 1.8, 0, 7); ctx.fill();
  },

  // Construction site: dashed footprint + translucent hologram of the final building
  drawWIP(ctx, x, y, u, engine, time, bars) {
    const tex = HS_TEX[u.BaseBuildingType.UNIT_NAME] || [16, 8];
    this.contactShadow(ctx, x, y, tex[0] * 0.55, tex[0] * 0.26);
    // hologram of the finished building — solidifies as construction progresses
    const prog0 = 1 - u.BuildCostRemaining / u.MaxBuildCost;
    ctx.save();
    ctx.globalAlpha = 0.14 + 0.4 * prog0 + 0.05 * Math.sin(time * 5);
    this.drawSilhouette(ctx, u.BaseBuildingType.UNIT_NAME, x, y, { engine, Heat: 0, EnergyCharges: 10, MaxEnergyCharges: 60, AimAngle: -0.5, DrawColorTint: null }, time);
    ctx.restore();
    // cyan hologram tint
    ctx.fillStyle = "rgba(122,208,255,0.16)";
    this.diamond(ctx, x, y, tex[0] * 1.7, tex[0] * 0.85); ctx.fill();
    // dashed footprint frame
    ctx.strokeStyle = "rgba(240,245,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    this.diamond(ctx, x, y, tex[0] * 1.5, tex[0] * 0.75); ctx.stroke();
    ctx.setLineDash([]);
    // progress: growing gold diamond
    const prog = 1 - u.BuildCostRemaining / u.MaxBuildCost;
    ctx.strokeStyle = this.PAL.moneyL;
    ctx.lineWidth = 1.6;
    this.diamond(ctx, x, y, Math.max(2, tex[0] * 1.5 * prog), Math.max(1, tex[0] * 0.75 * prog));
    ctx.stroke();
    if (engine.DrawZoomDetails) bars.push({ x, y: y - 26, amt: prog, color: this.PAL.money });
  },

  // Minerals: gold crystal clusters (yellow = money/minerals), mega = bigger + brighter
  drawMineral(ctx, x, y, u) {
    const mega = u.Megamineral;
    const s = mega ? 1.6 : 1;
    this.contactShadow(ctx, x, y, 7 * s, 3 * s);
    const col = mega ? "#ffc21e" : "#d9a927";
    const hi = mega ? "#ffe9a8" : "#f2d478";
    // three spikes
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 11 * s); ctx.lineTo(x + 6 * s, y + 2); ctx.lineTo(x, y + 5 * s);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = this.shade(mega ? "#ffc21e" : "#d9a927", 0.72);
    ctx.beginPath();
    ctx.moveTo(x - 5 * s, y - 5 * s); ctx.lineTo(x + 1 * s, y + 2); ctx.lineTo(x - 6 * s, y + 4 * s);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x + 7 * s, y - 4 * s); ctx.lineTo(x + 10 * s, y + 2); ctx.lineTo(x + 4 * s, y + 4 * s);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // glint
    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.moveTo(x, y - 11 * s); ctx.lineTo(x + 2 * s, y - 6 * s); ctx.lineTo(x, y - 3 * s);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(42,48,58,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 11 * s); ctx.lineTo(x + 6 * s, y + 2); ctx.lineTo(x, y + 5 * s); ctx.lineTo(x - 5 * s, y - 5 * s);
    ctx.closePath(); ctx.stroke();
  },

  // UFO: unmistakable hostile saucer — dark hull, purple outline, cyan dome, red lights
  drawUfo(ctx, x, y, u, engine, time, bars) {
    const bob = Math.sin(time * 3 + x * 0.05) * 2;
    const cy = y - 13 + bob;
    this.contactShadow(ctx, x, y, 10, 3.5);
    // under-glow
    ctx.fillStyle = "rgba(176,74,216,0.3)";
    ctx.beginPath(); ctx.ellipse(x, cy + 5, 11, 3.5, 0, 0, 7); ctx.fill();
    // hull
    ctx.fillStyle = "#3a4150";
    ctx.beginPath(); ctx.ellipse(x, cy, 15, 6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = this.PAL.alien; ctx.lineWidth = 2; ctx.stroke();
    // hull top highlight
    ctx.fillStyle = "#4d5566";
    ctx.beginPath(); ctx.ellipse(x, cy - 1.5, 12, 3.5, 0, Math.PI, 0); ctx.fill();
    // dome
    ctx.fillStyle = "rgba(140,225,255,0.85)";
    ctx.beginPath(); ctx.arc(x, cy - 4, 5, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; ctx.stroke();
    // red running lights
    ctx.fillStyle = "#ff5040";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(x + i * 8, cy + 2, 1.3, 0, 7); ctx.fill();
    }
    // damage flash
    if (u.HitFlashUntil !== undefined && time < u.HitFlashUntil) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.ellipse(x, cy, 15, 6, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,80,64,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, cy, 17, 8, 0, 0, 7); ctx.stroke();
    }
    // hp bar: once damaged, or on hover
    if (u.Health < u.MaxHealth || u.IsMouseHover) {
      bars.push({ x, y: y - 30, amt: u.Health / u.MaxHealth, color: this.PAL.bad });
    }
  },

  drawSilhouette(ctx, name, x, y, o, time) {
    if (name === "solarpanel") this.drawSolarPanel(ctx, x, y, o);
    else if (name === "conduit") this.drawConduit(ctx, x, y, o, time);
    else if (name === "harvester") this.drawHarvester(ctx, x, y, o, time);
    else if (name === "laser") this.drawLaser(ctx, x, y, o, time);
  },

  drawUnitWorld(ctx, engine, u, bars) {
    const x = u.Position.x, y = u.Position.y;
    const time = engine.Time;

    if (u instanceof UnitMineral) { this.drawMineral(ctx, x, y, u); return; }
    if (u instanceof UnitAlienUfo) { this.drawUfo(ctx, x, y, u, engine, time, bars); return; }
    if (u instanceof UnitBuildingWIP) { this.drawWIP(ctx, x, y, u, engine, time, bars); return; }
    // rise-in: everything spawned by the engine lands softly instead of popping in
    let rise = 0, scale = 1;
    if (u.SpawnTime !== undefined) {
      const age = time - u.SpawnTime;
      if (age >= 0 && age < 0.35) { const k = 1 - age / 0.35; rise = -12 * k * k; scale = 1 - 0.12 * k; }
    }
    if (rise !== 0 || scale !== 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.translate(-x, -y + rise);
      this.drawSilhouette(ctx, u.Name, x, y, u, time);
      ctx.restore();
    } else {
      this.drawSilhouette(ctx, u.Name, x, y, u, time);
    }
  },

  drawUnitGUI(ctx, engine, u, bars) {
    const detail = engine.DrawZoomDetails;
    const x = u.Position.x, y = u.Position.y;
    const time = engine.Time;

    if (u instanceof UnitConduit) {
      // hovered node shows its link radius + candidate conduits (blue = energy)
      if (u.IsMouseHover) {
        ctx.strokeStyle = "rgba(63,169,245,0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
        for (const o of engine.GetAllGameUnitsArray()) {
          if (o instanceof UnitConduit && o !== u && V2.dist(u.Position, o.Position) < UnitConduit.ConnectRangePower) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
            const r = 5 + Math.sin(time * 6) * 1.5;
            ctx.fillStyle = "rgba(63,169,245,0.7)";
            this.diamond(ctx, o.Position.x, o.Position.y, r, r / 2); ctx.fill();
          }
        }
      }
      const link = u.GetLinkedConduit;
      if (link) {
        if (detail) {
          this.dashedLine(ctx, { x, y }, { x: link.Position.x, y: link.Position.y }, 6, "rgba(63,169,245,0.7)", time * 60);
          this.flowArrows(ctx, { x, y }, { x: link.Position.x, y: link.Position.y }, "rgba(63,169,245,0.85)", time);
        } else { ctx.strokeStyle = "rgba(63,169,245,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(link.Position.x, link.Position.y); ctx.stroke(); }
      }
      if (detail && u.Heat > 5) bars.push({ x, y: y - 22, amt: u.Heat / 100, color: u.Heat > 60 ? this.PAL.bad : this.PAL.warn });
      return;
    }

    if (u instanceof UnitLaser) {
      const range = u.GetAttackRange;
      if (u.IsMouseHover || engine.DebugDrawLaserRange) {
        ctx.strokeStyle = "rgba(224,69,60,0.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, range, 0, 7); ctx.stroke();
      }
      if (u.Target != null && u.EnergyCharges > 0) {
        // attack beam from the barrel tip
        const aim = Math.atan2(u.Target.Position.y - y, u.Target.Position.x - x);
        u.AimAngle = aim; // visual-only: barrel keeps its last direction
        ctx.strokeStyle = this.PAL.laser;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(aim) * 10, y - 18 + Math.sin(aim) * 6); ctx.lineTo(u.Target.Position.x, u.Target.Position.y); ctx.stroke();
      }
      const link = u.GetLinkedLaser;
      if (link) {
        if (link.IsAttacking) {
          ctx.strokeStyle = "rgba(63,169,245,0.95)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y - 14); ctx.lineTo(link.Position.x, link.Position.y - 14); ctx.stroke();
          this.flowArrows(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, "rgba(200,235,255,0.9)", time);
        } else if (detail) {
          this.dashedLine(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, 6, "rgba(63,169,245,0.55)", time * 60);
          this.flowArrows(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, "rgba(63,169,245,0.8)", time);
        }
      }
      if (detail) bars.push({ x, y: y - 30, amt: u.EnergyCharges / u.MaxEnergyCharges, color: this.PAL.energy });
      return;
    }

    if (u instanceof UnitHarvester) {
      // coverage is always visible: dashed harvest radius + faint links to its minerals
      const hov = u.IsMouseHover;
      ctx.strokeStyle = `rgba(70,196,110,${hov ? 0.65 : 0.4})`;
      ctx.lineWidth = hov ? 1.4 : 1.1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(x, y, UnitHarvester.ConnectRangeHarvest, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(224,164,35,${hov ? 0.5 : 0.3})`;
      for (const o of engine.GetAllGameUnitsArray()) {
        if (o instanceof UnitMineral && V2.dist(u.Position, o.Position) < UnitHarvester.ConnectRangeHarvest) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
        }
      }
      return;
    }

    if (u instanceof UnitSolarPanel && u.IsMouseHover) {
      ctx.strokeStyle = "rgba(63,169,245,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
    }
  },

  /* ---------- placement ghost: 3 unambiguous states ---------- */
  ghostStatus(engine, tool) {
    if (!tool || !tool.Active || !(tool instanceof HSGameToolBuilder) || !tool.ToolGhost) return null;
    const valid = !!tool.CurrentLocationValid;
    const afford = engine.Resources >= tool.BuildCost;
    return { state: !valid ? "blocked" : (afford ? "ok" : "poor"), valid, afford };
  },

  drawGhost(ctx, engine) {
    const tool = UI.activeToolObj;
    if (!tool || !tool.Active || !UI.mouseWorld) return;
    const time = engine.Time;
    const mx = UI.mouseWorld.x, my = UI.mouseWorld.y;

    if (tool instanceof HSGameToolBuilder && tool.ToolGhost) {
      const [tw, th] = tool.ToolGhost;
      const st = this.ghostStatus(engine, tool);
      if (!st) return;
      // range circles per tool type
      if (tool instanceof HSGameToolConduit || tool instanceof HSGameToolSolarPanel) {
        ctx.strokeStyle = "rgba(63,169,245,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(mx, my, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        for (const o of engine.GetAllGameUnitsArray()) {
          if (o instanceof UnitConduit && V2.dist(UI.mouseWorld, o.Position) < UnitConduit.ConnectRangePower) {
            ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
          }
        }
      }
      if (tool instanceof HSGameToolHarvester) {
        ctx.strokeStyle = "rgba(70,196,110,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(mx, my, UnitHarvester.ConnectRangeHarvest, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (tool instanceof HSGameToolLaser) {
        ctx.strokeStyle = "rgba(224,69,60,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(mx, my, UnitLaser.SINGLE_LASER_RNG, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      // state colours: green=placeable, orange=can't afford, red=blocked
      const colFill = st.state === "ok" ? "rgba(70,196,110,0.35)" : st.state === "poor" ? "rgba(240,140,30,0.35)" : "rgba(224,69,60,0.4)";
      const colLine = st.state === "ok" ? this.PAL.ok : st.state === "poor" ? this.PAL.warn : this.PAL.bad;
      // ground pad: flat iso diamond (tw × tw/2) under the building's feet — same pad the
      // construction site draws, so the sprite stands ON the marker and nothing hangs below
      const hw = tw / 2, hh = tw / 4;
      ctx.fillStyle = st.state === "ok" ? "rgba(70,196,110,0.12)" : st.state === "poor" ? "rgba(240,140,30,0.12)" : "rgba(224,69,60,0.15)";
      this.diamond(ctx, mx, my, tw * 1.7, tw * 0.85); ctx.fill();
      ctx.fillStyle = colFill;
      this.diamond(ctx, mx, my, tw, hh); ctx.fill();
      // translucent silhouette of the real building standing on the pad
      ctx.save();
      ctx.globalAlpha = 0.55;
      this.drawSilhouette(ctx, this.ghostName(tool), mx, my, { engine, Heat: 0, EnergyCharges: 10, MaxEnergyCharges: 60, AimAngle: -0.5, DrawColorTint: null, Position: UI.mouseWorld }, time);
      ctx.restore();
      ctx.strokeStyle = colLine;
      ctx.lineWidth = 1.5;
      this.diamond(ctx, mx, my, tw, hh); ctx.stroke();
      // corner brackets hugging the pad edges (scaled — small pads get small ticks)
      const N = { x: mx, y: my - hh }, E = { x: mx + hw, y: my }, S = { x: mx, y: my + hh }, W = { x: mx - hw, y: my };
      const tick = (c, a, b) => {
        const e = V2.dist(a, b), t0 = e * 0.15, t1 = e * 0.45;
        for (const n of [a, b]) {
          const d = V2.normalize({ x: n.x - c.x, y: n.y - c.y });
          ctx.beginPath();
          ctx.moveTo(c.x + d.x * t0, c.y + d.y * t0);
          ctx.lineTo(c.x + d.x * t1, c.y + d.y * t1);
          ctx.stroke();
        }
      };
      ctx.lineWidth = 2;
      tick(N, E, W); tick(E, S, N); tick(S, W, E); tick(W, N, S);
      ctx.lineWidth = 1.5;
      // screen-constant overlays: price tag, prohibition symbol, state word
      ctx.save();
      ctx.translate(mx, my);
      ctx.scale(1 / this.cam.zoom, 1 / this.cam.zoom);
      ctx.textAlign = "center";
      ctx.font = "700 12px Segoe UI, Arial";
      ctx.fillStyle = st.state === "ok" ? "#2f8a4d" : st.state === "poor" ? "#b26a10" : this.PAL.bad;
      ctx.fillText("-" + tool.BuildCost + " R$", 0, hh + 16);
      if (st.state !== "ok") {
        ctx.font = "800 9px Segoe UI, Arial";
        ctx.fillText(st.state === "poor" ? "NO FUNDS" : "BLOCKED", 0, hh + 28);
      }
      if (st.state === "blocked") {
        // prohibition symbol above the ghost, punched out on a white disc
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.beginPath(); ctx.arc(0, -56, 17, 0, 7); ctx.fill();
        ctx.strokeStyle = this.PAL.bad; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(0, -56, 12, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8.5, -64.5); ctx.lineTo(8.5, -47.5); ctx.stroke();
      }
      ctx.restore();
    }
  },

  ghostName(tool) {
    if (tool instanceof HSGameToolConduit) return "conduit";
    if (tool instanceof HSGameToolHarvester) return "harvester";
    if (tool instanceof HSGameToolSolarPanel) return "solarpanel";
    if (tool instanceof HSGameToolLaser) return "laser";
    return null;
  },

  drawEffectsWorld(ctx, engine) {
    for (const fx of engine.Effects) {
      if (!fx || fx.endTime <= engine.Time) continue;
      if (fx.type === "puff") {
        // blue energy fizzle where a packet is lost
        const age = 1 - (fx.endTime - engine.Time) / 0.45;
        ctx.strokeStyle = `rgba(63,169,245,${(1 - age) * 0.9})`;
        ctx.lineWidth = 2 - age;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + age * 10, 0, 7); ctx.stroke();
        continue;
      }
      if (fx.type === "float") {
        const age = 1 - (fx.endTime - engine.Time) / 0.9;
        ctx.save();
        ctx.translate(fx.x, fx.y - age * 16);
        ctx.scale(1 / this.cam.zoom, 1 / this.cam.zoom);
        ctx.font = "800 13px Segoe UI, Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(184,134,11,${1 - age})`;
        ctx.fillText(fx.str, 0, 0);
        ctx.restore();
        continue;
      }
      if (fx.type === "link") {
        const age = 1 - (fx.endTime - engine.Time) / 0.4;
        ctx.strokeStyle = `rgba(63,169,245,${(1 - age) * 0.9})`;
        ctx.lineWidth = 2.5 - age * 1.5;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 3 + age * 14, 0, 7); ctx.stroke();
        continue;
      }
      if (fx.type === "place") {
        const age = 1 - (fx.endTime - engine.Time) / 0.5;
        ctx.strokeStyle = `rgba(70,196,110,${(1 - age) * 0.9})`;
        ctx.lineWidth = 2.5 - age * 1.5;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + age * 16, 0, 7); ctx.stroke();
        // light column + dust
        ctx.fillStyle = `rgba(240,255,244,${(1 - age) * 0.35})`;
        ctx.fillRect(fx.x - 2, fx.y - 26 * (1 - age) - 4, 4, 26 * (1 - age) + 4);
        ctx.fillStyle = `rgba(120,90,50,${(1 - age) * 0.7})`;
        for (let i = 0; i < 5; i++) {
          const a = i * 1.26 + 0.6;
          ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * (6 + age * 16), fx.y + Math.sin(a) * (3 + age * 8), 1.6, 0, 7); ctx.fill();
        }
        continue;
      }
      if (fx.type === "hit") {
        const age = 1 - (fx.endTime - engine.Time) / 0.25;
        ctx.strokeStyle = `rgba(224,69,60,${1 - age})`;
        ctx.lineWidth = 1.4;
        for (let arm = 0; arm < 3; arm++) {
          let px = fx.x, py = fx.y;
          for (let i = 0; i < 2; i++) {
            const nx = px + U.rand(-7, 7), ny = py + U.rand(-5, 5);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
            px = nx; py = ny;
          }
        }
        continue;
      }
      if (fx.type === "boom") {
        const age = 1 - (fx.endTime - engine.Time) / 0.6;
        ctx.fillStyle = `rgba(240,140,30,${(1 - age) * 0.5})`;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + age * 18, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(224,69,60,${(1 - age) * 0.9})`;
        ctx.lineWidth = 2.5 - age * 1.5;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 4 + age * 22, 0, 7); ctx.stroke();
        // debris
        ctx.fillStyle = `rgba(60,50,40,${1 - age})`;
        for (let i = 0; i < 6; i++) {
          const a = i * 1.047 + 0.3;
          ctx.beginPath(); ctx.arc(fx.x + Math.cos(a) * age * 24, fx.y + Math.sin(a) * age * 14 - age * age * 8, 1.8, 0, 7); ctx.fill();
        }
        continue;
      }
      // packet-death sparks / lightning (default)
      ctx.strokeStyle = "#7ac8e8";
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

  /* ---------- palette icons: render the real silhouettes to data URLs ---------- */
  renderIcon(name) {
    const c = document.createElement("canvas");
    c.width = 44; c.height = 44;
    const g = c.getContext("2d");
    const scale = { solarpanel: 1.05, conduit: 1.5, harvester: 1.4, laser: 1.3 }[name] || 1.2;
    g.translate(22, 36);
    g.scale(scale, scale);
    g.strokeStyle = this.PAL.edge;
    this.drawSilhouette(g, name, 0, 0, { Heat: 0, EnergyCharges: 40, MaxEnergyCharges: 60, AimAngle: -0.5, DrawColorTint: null, Position: { x: 0, y: 0 } }, 1.2);
    return c.toDataURL();
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
