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

  // solid arrowhead at the end of a link — feed direction readable at a glance
  arrowHead(ctx, a, b, color, size = 6) {
    const len = V2.dist(a, b);
    if (len < 14) return;
    const d = V2.normalize(V2.sub(b, a));
    const px = b.x - d.x * 9, py = b.y - d.y * 9; // stop short of the sprite
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px + d.x * size, py + d.y * size);
    ctx.lineTo(px - d.y * size * 0.62, py + d.x * size * 0.62);
    ctx.lineTo(px + d.y * size * 0.62, py - d.x * size * 0.62);
    ctx.closePath(); ctx.fill();
  },

  // screen-constant label chip for link previews (drag + placement + hover)
  chip(ctx, x, y, text, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / this.cam.zoom, 1 / this.cam.zoom);
    ctx.font = "800 11px Segoe UI, Arial";
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = "rgba(20,24,30,0.85)";
    ctx.fillRect(-w / 2, -9, w, 18);
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.strokeRect(-w / 2, -9, w, 18);
    ctx.fillStyle = color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0.5);
    ctx.restore();
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
    // iso lattice: x = (a-b)*TL/2, y = (a+b)*TH/2  ->  a = x/TL + y/TH, b = y/TH - x/TL
    // (b's x-term is negative of a's — flipping that sign drew a warped floor that
    //  missed whole screen regions, so the void "crept toward the centre" when zooming)
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [sx, sy] of [[0, 0], [CFG.W, 0], [0, CFG.H], [CFG.W, CFG.H]]) {
      const w = this.screenToWorld(sx, sy);
      const a = w.x / TL + w.y / TH, b = w.y / TH - w.x / TL;
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

  // Harvester: tracked machine with a boom arm + spinning drill running a visible
  // 5s mining cycle — ride out to the mineral, strike (+1), retract
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
    // aim at the fx mineral while striking, else the nearest mineral in range
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
    // mining cycle (user request: visible добыча): the drill rides the boom out to the
    // mineral face while the 5s slow-tick approaches, strikes on the tick (+1 pop, gold
    // flare at the face), then retracts. Renderer-only math off NextUpdateTime/HarvestFx*
    // — the simulation is untouched.
    const mntX = x, mntY = y - 9; // boom mount on the body
    const interval = o.UpdateInterval || 5, FLARE = 0.3;
    const since = engine && o.NextUpdateTime !== undefined ? Math.max(0, interval - (o.NextUpdateTime - engine.Time)) : 0;
    const flaring = o.HarvestFxUntil !== undefined && time < o.HarvestFxUntil;
    const active = !gray && o.EnergyCharges > 0 && target != null;
    let p = 0; // 0 = parked at the body, 1 = drill at the mineral face
    if (flaring) p = Math.max(0, (o.HarvestFxUntil - time) / FLARE);
    else if (active) p = U.clamp((since - FLARE) / (interval - FLARE), 0, 1);
    const pe = p * p * (3 - 2 * p); // smoothstep: slow out of the bay, fast at the face
    let fx = x + Math.cos(aim) * 11, fy = y - 9 + Math.sin(aim) * 6; // parked reach
    if (target) {
      const dd = V2.dist(target.Position, { x, y }) || 1;
      const face = { x: target.Position.x - ((target.Position.x - x) / dd) * 4, y: target.Position.y - ((target.Position.y - y) / dd) * 4 };
      fx = mntX + (face.x - mntX) * pe;
      fy = mntY + (face.y - mntY) * pe;
      // mining beam: strengthens while closing in, flares gold at the strike
      if (!gray && o.EnergyCharges !== undefined) {
        ctx.strokeStyle = flaring ? `rgba(224,164,35,${0.7 + 0.25 * Math.sin(time * 40)})` : `rgba(224,164,35,${0.22 + 0.4 * pe})`;
        ctx.lineWidth = flaring ? 1.8 : 1 + pe;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(face.x, face.y); ctx.stroke();
        if (flaring) {
          // gold sparks at the mineral face
          ctx.fillStyle = this.PAL.moneyL;
          for (let i = 0; i < 3; i++) {
            const a = time * 14 + i * 2.1;
            ctx.beginPath(); ctx.arc(target.Position.x + Math.cos(a) * 4, target.Position.y + Math.sin(a) * 3, 1.1, 0, 7); ctx.fill();
          }
        }
      }
    }
    // boom + spinning drill head riding it (spins up on approach)
    ctx.strokeStyle = this.PAL.slate; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(mntX, mntY); ctx.lineTo(fx, fy); ctx.stroke();
    const spin = gray ? 0 : (time || 0) * (6 + 18 * pe);
    ctx.strokeStyle = "#c9c1ab"; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(fx - Math.cos(a) * 3, fy - Math.sin(a) * 3);
      ctx.lineTo(fx + Math.cos(a) * 3, fy + Math.sin(a) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = gray ? "#8d8779" : this.PAL.money;
    ctx.beginPath(); ctx.arc(fx, fy, 1.6, 0, 7); ctx.fill();
    // cycle progress bar: fills as the strike approaches, drains on the pop
    if ((engine ? engine.DrawZoomDetails : true) && (active || flaring)) {
      ctx.fillStyle = "rgba(20,24,30,0.55)";
      ctx.fillRect(x - 8, y - 25, 16, 3);
      ctx.fillStyle = this.PAL.money;
      ctx.fillRect(x - 8, y - 25, 16 * pe, 3);
    }
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
    const fp = HSFootprintWidth(u), fpH = fp / 2; // pad = the real placement tile
    this.contactShadow(ctx, x, y, tex[0] * 0.55, tex[0] * 0.26);
    // hologram of the finished building — solidifies as construction progresses
    const prog0 = 1 - u.BuildCostRemaining / u.MaxBuildCost;
    ctx.save();
    ctx.globalAlpha = 0.14 + 0.4 * prog0 + 0.05 * Math.sin(time * 5);
    this.drawSilhouette(ctx, u.BaseBuildingType.UNIT_NAME, x, y, { engine, Heat: 0, EnergyCharges: 10, MaxEnergyCharges: 60, AimAngle: -0.5, DrawColorTint: null }, time);
    ctx.restore();
    // cyan hologram tint
    ctx.fillStyle = "rgba(122,208,255,0.16)";
    this.diamond(ctx, x, y, fp * 1.7, fp * 0.85); ctx.fill();
    // dashed footprint frame
    ctx.strokeStyle = "rgba(240,245,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    this.diamond(ctx, x, y, fp, fpH); ctx.stroke();
    ctx.setLineDash([]);
    // progress: growing gold diamond
    const prog = 1 - u.BuildCostRemaining / u.MaxBuildCost;
    ctx.strokeStyle = this.PAL.moneyL;
    ctx.lineWidth = 1.6;
    this.diamond(ctx, x, y, Math.max(2, fp * prog), Math.max(1, fpH * prog));
    ctx.stroke();
    // starved site: no packet has EVER arrived (or the supply died) — say so instead of
    // letting it sit silently forever (user request: "чи нормально будівництво працює?")
    const lastFeed = u.LastPacketTime != null ? u.LastPacketTime : (u.SpawnTime || 0);
    if (engine.Time - lastFeed > 5) this.chip(ctx, x, y - 44, "NO POWER", this.PAL.warn);
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

  // Enemy saucers: the reference UFO plus two hulls (user request: different enemies) —
  // small green-domed scouts, the standard cyan saucer, and near-black amber-domed cruisers
  drawUfo(ctx, x, y, u, engine, time, bars) {
    const scout = u instanceof UnitAlienScout, cruiser = u instanceof UnitAlienCruiser;
    const s = scout ? 0.72 : cruiser ? 1.55 : 1;
    const bob = Math.sin(time * 3 + x * 0.05) * 2 * s;
    const cy = y - 13 * s + bob;
    this.contactShadow(ctx, x, y, 10 * s, 3.5 * s);
    // under-glow
    ctx.fillStyle = "rgba(176,74,216,0.3)";
    ctx.beginPath(); ctx.ellipse(x, cy + 5 * s, 11 * s, 3.5 * s, 0, 0, 7); ctx.fill();
    // hull
    ctx.fillStyle = scout ? "#4a5262" : cruiser ? "#2a2f3c" : "#3a4150";
    ctx.beginPath(); ctx.ellipse(x, cy, 15 * s, 6 * s, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = cruiser ? "rgba(240,140,30,0.9)" : this.PAL.alien; ctx.lineWidth = 2; ctx.stroke();
    // hull top highlight
    ctx.fillStyle = scout ? "#5c6577" : cruiser ? "#3b4150" : "#4d5566";
    ctx.beginPath(); ctx.ellipse(x, cy - 1.5 * s, 12 * s, 3.5 * s, 0, Math.PI, 0); ctx.fill();
    // dome
    ctx.fillStyle = scout ? "rgba(150,255,170,0.85)" : cruiser ? "rgba(255,170,90,0.85)" : "rgba(140,225,255,0.85)";
    ctx.beginPath(); ctx.arc(x, cy - 4 * s, 5 * s, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; ctx.stroke();
    // running lights (cruiser: extra pair, spaced wider)
    ctx.fillStyle = scout ? "#ffd24a" : "#ff5040";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.arc(x + i * 8 * s, cy + 2 * s, 1.3 * s, 0, 7); ctx.fill();
    }
    if (cruiser) {
      for (const i of [-0.5, 0.5]) {
        ctx.beginPath(); ctx.arc(x + i * 16 * s, cy + 2 * s, 1.6 * s, 0, 7); ctx.fill();
      }
    }
    // damage flash
    if (u.HitFlashUntil !== undefined && time < u.HitFlashUntil) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath(); ctx.ellipse(x, cy, 15 * s, 6 * s, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,80,64,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, cy, 17 * s, 8 * s, 0, 0, 7); ctx.stroke();
    }
    // hp bar: once damaged, or on hover (cruiser's sits above its taller hull)
    if (u.Health < u.MaxHealth || u.IsMouseHover) {
      bars.push({ x, y: y - 30 - (cruiser ? 14 : 0), amt: u.Health / u.MaxHealth, color: this.PAL.bad });
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
      // suppressed while a drag-link is in progress — the drag block draws the source range
      // radius states (user spec): idle = dash only; hover = loud; while BUILDING all
      // radii light up so coverage is visible where you're about to place
      const cw = u.IsMouseHover && !UI._dragLink;
      const bmode = UI.activeToolObj instanceof HSGameToolBuilder;
      if (cw || bmode) {
        const hot = cw && !bmode;
        ctx.fillStyle = `rgba(63,169,245,${hot ? 0.24 : 0.16})`;
        ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(63,169,245,${hot ? 0.95 : 0.8})`;
        ctx.lineWidth = (hot ? 3 : 2.2) / Renderer.cam.zoom;
      } else {
        ctx.strokeStyle = "rgba(63,169,245,0.5)";
        ctx.setLineDash([9 / Renderer.cam.zoom, 6 / Renderer.cam.zoom]);
        ctx.lineWidth = 1.5 / Renderer.cam.zoom;
      }
      ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      if (cw) {
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
      // load/heat bar (user request): visible at ANY zoom once the node is actually
      // loaded — from ~5 pkt/s of packets ("5 зарядів") or any accumulated heat, which
      // means packets are already being lost. blue = relay, orange = heavy, red = hot.
      // The bars render screen-space (DrawScreen), so zoom never hides them again.
      const load = u.PacketLoad || 0;
      if (load >= 5 || u.Heat > 0) {
        const fill = Math.max(Math.min(1, Math.max(load / 10, u.Heat / 100)), u.Heat > 0 ? 0.06 : 0);
        const col = u.Heat > 60 ? this.PAL.bad : fill > 0.7 ? this.PAL.warn : this.PAL.energy;
        bars.push({ x, y: y - 22, amt: fill, color: col });
      }
      return;
    }

    if (u instanceof UnitLaser) {
      // hover/select lights up the chain; off during a drag — the drag block draws
      // its own line + result chip, and two overlapping chips would be unreadable
      const hov = (u.IsMouseHover || UI.selectedUnit === u) && !UI._dragLink;
      // attack range on hover (suppressed during a drag-link — the drag block draws the source range)
      if ((u.IsMouseHover && !UI._dragLink) || engine.DebugDrawLaserRange) {
        ctx.fillStyle = "rgba(224,69,60,0.16)";
        ctx.beginPath(); ctx.arc(x, y, u.AttackRange, 0, 7); ctx.fill();
        ctx.strokeStyle = "rgba(224,69,60,0.95)";
        ctx.lineWidth = 3 / Renderer.cam.zoom;
        ctx.beginPath(); ctx.arc(x, y, u.AttackRange, 0, 7); ctx.stroke();
      } else if (UI.activeToolObj instanceof HSGameToolBuilder) {
        // building mode: laser ranges outline-only (their fill would shout over planning)
        ctx.strokeStyle = "rgba(224,69,60,0.5)";
        ctx.setLineDash([9 / Renderer.cam.zoom, 6 / Renderer.cam.zoom]);
        ctx.lineWidth = 1.5 / Renderer.cam.zoom;
        ctx.beginPath(); ctx.arc(x, y, u.AttackRange, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
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
        } else {
          // feed lines visible at ANY zoom (user request: "щоб були видимі лінії") —
          // they are the only way to read who feeds whom before the fight starts
          this.dashedLine(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, 6, hov ? "rgba(200,235,255,0.9)" : "rgba(63,169,245,0.55)", time * 60);
          this.flowArrows(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, "rgba(63,169,245,0.8)", time);
        }
        if (hov) this.arrowHead(ctx, { x, y: y - 14 }, { x: link.Position.x, y: link.Position.y - 14 }, "rgba(200,235,255,0.95)", 5.5);
      }
      // incoming feeders light up with direction arrows; the floating chain chip is
      // hover-only — a selected unit's numbers live in the unit panel, and chips
      // from a selected + hovered pair of nearby towers would overlap
      if (hov) {
        for (const f of u.GetLinkedLasers(engine)) {
          ctx.strokeStyle = "rgba(200,235,255,0.85)"; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(f.Position.x, f.Position.y - 14); ctx.lineTo(x, y - 14); ctx.stroke();
          this.arrowHead(ctx, { x: f.Position.x, y: f.Position.y - 14 }, { x, y: y - 14 }, "rgba(200,235,255,0.95)", 5.5);
        }
      }
      if (u.IsMouseHover && !UI._dragLink && detail) {
        const pot = HSPotentialDamage(u);
        this.chip(ctx, x, y - 46, (u.EnergyCharges <= 0 ? "UNPOWERED · " : "") + `CHAIN ${pot} DMG · RNG ${Math.round(HSPotentialRange(pot))}`, this.PAL.laser);
      }
      // charge bar at any zoom — tower readiness must read from afar (empty = grey
      // tint already says "starving", no bar needed)
      if (u.EnergyCharges > 0) bars.push({ x, y: y - 30, amt: u.EnergyCharges / u.MaxEnergyCharges, color: this.PAL.energy });
      return;
    }

    if (u instanceof UnitHarvester) {
      // coverage is always visible: dashed harvest radius + faint links to its minerals
      // radius states: idle = dash only; hover = loud; building = all radii on
      const hov = u.IsMouseHover;
      const hbmode = UI.activeToolObj instanceof HSGameToolBuilder;
      if (hov || hbmode) {
        const hot = hov && !hbmode;
        ctx.fillStyle = `rgba(70,196,110,${hot ? 0.3 : 0.24})`;
        ctx.beginPath(); ctx.arc(x, y, UnitHarvester.ConnectRangeHarvest, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(70,196,110,${hot ? 1 : 0.85})`;
        ctx.lineWidth = (hot ? 3 : 2.4) / Renderer.cam.zoom;
      } else {
        ctx.strokeStyle = "rgba(70,196,110,0.55)";
        ctx.setLineDash([9 / Renderer.cam.zoom, 6 / Renderer.cam.zoom]);
        ctx.lineWidth = 1.5 / Renderer.cam.zoom;
      }
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

    if (u instanceof UnitSolarPanel) {
      // panels: dashed outline only — never a fill (user spec), brighter while building
      const pw = u.IsMouseHover && !UI._dragLink;
      const pbmode = UI.activeToolObj instanceof HSGameToolBuilder;
      ctx.strokeStyle = `rgba(63,169,245,${pw ? 0.9 : pbmode ? 0.7 : 0.5})`;
      ctx.setLineDash([9 / Renderer.cam.zoom, 6 / Renderer.cam.zoom]);
      ctx.lineWidth = ((pw || pbmode) ? 2 : 1.4) / Renderer.cam.zoom;
      ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
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
    const time = engine.Time;

    /* manual drag-link (select mode): press node, drag onto another node, release.
       green = will link, dashed orange = will remove, red = target out of range */
    const dl = UI._dragLink;
    if (dl && dl.from && !dl.from.Destroyed) {
      const from = dl.from;
      const isConduit = from instanceof UnitConduit;
      const rng = isConduit ? UnitConduit.ConnectRangePower : from.AttackRange;
      const to = dl.to && dl.to !== from && (isConduit ? dl.to instanceof UnitConduit : dl.to instanceof UnitLaser) ? dl.to : null;
      const inRange = to != null && V2.dist(from.Position, to.Position) < rng;
      const linked = to != null && (isConduit ? from.GetLinkedConduit === to : from.GetLinkedLaser === to);
      // the dragged node's connect range
      ctx.strokeStyle = "rgba(63,169,245,0.5)";
      ctx.setLineDash([6, 6]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(from.Position.x, from.Position.y, rng, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      // drag line to the cursor
      const mx = UI.mouseWorld ? UI.mouseWorld.x : from.Position.x;
      const my = UI.mouseWorld ? UI.mouseWorld.y : from.Position.y;
      ctx.lineWidth = 2;
      if (inRange) {
        ctx.strokeStyle = linked ? this.PAL.warn : this.PAL.ok;
        if (linked) ctx.setLineDash([7, 5]);
      } else {
        ctx.strokeStyle = "rgba(224,69,60,0.75)";
        ctx.setLineDash([4, 4]);
      }
      ctx.beginPath(); ctx.moveTo(from.Position.x, from.Position.y); ctx.lineTo(mx, my); ctx.stroke();
      ctx.setLineDash([]);
      // links are directional (from routes/feeds to the target) — say so with an arrow
      if (to) this.arrowHead(ctx, from.Position, to.Position, inRange ? (linked ? this.PAL.warn : this.PAL.ok) : "rgba(224,69,60,0.75)", 7);
      // pulsing marker + result chip on the hovered node
      if (to) {
        const r = (6 + Math.sin(time * 8) * 1.5) * 2;
        ctx.strokeStyle = inRange ? (linked ? this.PAL.warn : this.PAL.ok) : this.PAL.bad;
        ctx.lineWidth = 1.6;
        this.diamond(ctx, to.Position.x, to.Position.y, r, r / 2); ctx.stroke();
        if (!inRange) this.chip(ctx, to.Position.x, to.Position.y - 54, "TOO FAR", this.PAL.bad);
        else if (linked) this.chip(ctx, to.Position.x, to.Position.y - 54, "REMOVE LINK", this.PAL.warn);
        else if (isConduit) this.chip(ctx, to.Position.x, to.Position.y - 54, "ROUTE ENERGY", this.PAL.energy);
        else this.chip(ctx, to.Position.x, to.Position.y - 54, "FEED +" + HSPotentialDamage(from) + " DMG", this.PAL.ok);
      }
    }

    const tool = UI.activeToolObj;
    if (!tool || !tool.Active || !UI.mouseWorld) return;
    const mx = UI.mouseWorld.x, my = UI.mouseWorld.y;

    if (tool instanceof HSGameToolBuilder && tool.ToolGhost) {
      const st = this.ghostStatus(engine, tool);
      if (!st) return;
      // the ghost sits on the footprint lattice (HSBuildSnap in the tool) — what you see
      // is exactly the tile you'll occupy
      const fp = HSFootprintWidth(tool), fpH = fp / 2;
      const gx = tool.GhostPos ? tool.GhostPos.x : mx, gy = tool.GhostPos ? tool.GhostPos.y : my;
      // build lattice (user request: normal grid — your tile vs the neighbours' tiles):
      // the ghost type's tiling diamonds around the cursor
      ctx.lineWidth = 1;
      for (let i = -5; i <= 5; i++) {
        for (let j = -5; j <= 5; j++) {
          if ((((i + j) % 2) + 2) % 2 !== 0 || (i === 0 && j === 0)) continue;
          const ring = Math.abs(i) + Math.abs(j);
          if (ring > 6) continue;
          ctx.strokeStyle = `rgba(44,51,61,${ring <= 2 ? 0.32 : 0.13})`;
          this.diamond(ctx, gx + i * fp / 2, gy + j * fp / 4, fp, fpH); ctx.stroke();
        }
      }
      // existing buildings' footprints nearby; the one blocking placement glows red
      for (const u of engine.GetAllGameUnitsArray()) {
        if (u == null || u.Destroyed || u instanceof UnitEnergyPacket) continue;
        const uw = HSFootprintWidth(u);
        const dMetric = Math.abs(u.Position.x - gx) + 2 * Math.abs(u.Position.y - gy);
        if (dMetric > fp + uw + 80) continue;
        const hits = !st.valid && HSFootprintsOverlap({ x: gx, y: gy }, fp, u.Position, uw);
        if (hits) { ctx.fillStyle = "rgba(224,69,60,0.18)"; this.diamond(ctx, u.Position.x, u.Position.y, uw, uw / 2); ctx.fill(); }
        ctx.strokeStyle = hits ? this.PAL.bad : "rgba(44,51,61,0.35)";
        ctx.lineWidth = hits ? 2 : 1;
        this.diamond(ctx, u.Position.x, u.Position.y, uw, uw / 2); ctx.stroke();
      }
      // range discs (user request ×10: "не видно радіусів") — color-filled area +
      // a bold dashed ring, screen-constant so the zoom can't shrink it into nothing
      const rangeDisc = (rgb, r) => {
        // SOLID border + strong fill: dashes read as "broken" and vanished on sand
        const pulse = 0.85 + 0.15 * Math.sin(time * 6);
        ctx.fillStyle = `rgba(${rgb},0.26)`;
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},${pulse})`;
        ctx.lineWidth = 3.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7); ctx.stroke();
      };
      if (tool instanceof HSGameToolConduit || tool instanceof HSGameToolSolarPanel) {
        rangeDisc("63,169,245", UnitConduit.ConnectRangePower);
        if (tool instanceof HSGameToolSolarPanel) {
          // panels keep no links — packets go to any conduit in range
          ctx.strokeStyle = "rgba(63,169,245,0.8)";
          ctx.lineWidth = 1.5 / this.cam.zoom;
          for (const o of engine.GetAllGameUnitsArray()) {
            if (o instanceof UnitConduit && V2.dist({ x: gx, y: gy }, o.Position) < UnitConduit.ConnectRangePower) {
              ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
            }
          }
        }
      }
      if (tool instanceof HSGameToolHarvester) {
        rangeDisc("70,196,110", UnitHarvester.ConnectRangeHarvest);
        // mineable minerals inside the coverage get a gold marker — what you'll actually mine
        ctx.fillStyle = "rgba(255,210,74,0.9)";
        for (const m of engine.GetAllGameUnitsArray()) {
          if (!(m instanceof UnitMineral) || m.Destroyed) continue;
          if (V2.dist({ x: gx, y: gy }, m.Position) < UnitHarvester.ConnectRangeHarvest) {
            this.diamond(ctx, m.Position.x, m.Position.y, 10, 5); ctx.fill();
          }
        }
      }
      if (tool instanceof HSGameToolLaser) {
        rangeDisc("224,69,60", UnitLaser.SINGLE_LASER_RNG);
      }
      // truthful auto-link preview: exactly the links that will form on placement.
      // Auto rule = each free node links to its NEAREST free node in range and the
      // new node links last, so only arrows INTO the ghost ever materialize —
      // no lines here means "build this and it stays unconnected".
      if (st.valid && (tool instanceof HSGameToolConduit || tool instanceof HSGameToolLaser)) {
        const isLaser = tool instanceof HSGameToolLaser;
        const col = isLaser ? "rgba(255,156,148,0.85)" : "rgba(63,169,245,0.8)";
        const fedBy = HSAutoLinkPreview(engine, { x: gx, y: gy }, isLaser ? "laser" : "conduit");
        for (const f of fedBy) {
          this.dashedLine(ctx, f.Position, { x: gx, y: gy }, 6, col, time * 60);
          this.arrowHead(ctx, f.Position, { x: gx, y: gy }, col, 5.5);
        }
        if (isLaser && fedBy.length) {
          const pot = 1 + fedBy.reduce((s, f) => s + HSPotentialDamage(f), 0);
          this.chip(ctx, gx, gy - 46, `CHAIN ${pot} DMG · RNG ${Math.round(HSPotentialRange(pot))}`, this.PAL.laser);
        }
      }
      // state colours: green=placeable, orange=can't afford, red=blocked
      const colFill = st.state === "ok" ? "rgba(70,196,110,0.35)" : st.state === "poor" ? "rgba(240,140,30,0.35)" : "rgba(224,69,60,0.4)";
      const colLine = st.state === "ok" ? this.PAL.ok : st.state === "poor" ? this.PAL.warn : this.PAL.bad;
      // ground pad: the REAL footprint tile (drawn base diamond) under the building's feet —
      // the boundary you see is the boundary that blocks
      const hw = fp / 2, hh = fp / 4;
      ctx.fillStyle = st.state === "ok" ? "rgba(70,196,110,0.12)" : st.state === "poor" ? "rgba(240,140,30,0.12)" : "rgba(224,69,60,0.15)";
      this.diamond(ctx, gx, gy, fp * 1.7, fp * 0.85); ctx.fill();
      ctx.fillStyle = colFill;
      this.diamond(ctx, gx, gy, fp, fpH); ctx.fill();
      // translucent silhouette of the real building standing on the pad
      ctx.save();
      ctx.globalAlpha = 0.55;
      this.drawSilhouette(ctx, this.ghostName(tool), gx, gy, { engine, Heat: 0, EnergyCharges: 10, MaxEnergyCharges: 60, AimAngle: -0.5, DrawColorTint: null, Position: { x: gx, y: gy } }, time);
      ctx.restore();
      ctx.strokeStyle = colLine;
      ctx.lineWidth = 1.5;
      this.diamond(ctx, gx, gy, fp, fpH); ctx.stroke();
      // corner brackets hugging the pad edges (scaled — small pads get small ticks)
      const N = { x: gx, y: gy - hh }, E = { x: gx + hw, y: gy }, S = { x: gx, y: gy + hh }, W = { x: gx - hw, y: gy };
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
      ctx.translate(gx, gy);
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
      if (fx.type === "wave") {
        // purple pulse on the spawn edge where a wave is entering + chevron pointing at the base
        const age = Math.min(1, 1 - (fx.endTime - engine.Time) / 3);
        ctx.strokeStyle = `rgba(176,74,216,${(1 - age) * 0.8})`;
        ctx.lineWidth = 2.5 - age * 1.5;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, 10 + age * 26, 0, 7); ctx.stroke();
        const dx = -fx.x, dy = -fx.y, d = Math.hypot(dx, dy) || 1;
        ctx.save();
        ctx.translate(fx.x + (dx / d) * 16, fx.y + (dy / d) * 16);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = `rgba(176,74,216,${(1 - age) * 0.9})`;
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
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
