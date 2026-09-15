/* SUNGRID — renderer for the Harvesturr structural port.
 * Light warm theme, tiny units at true scale (16–32 px), camera zoom 0.5–3,
 * detail bars (48×8, screen space) only at zoom ≥ 2 — mirroring the reference. */
"use strict";

const Renderer = {
  canvas: null, ctx: null,
  cam: { target: { x: 0, y: 0 }, offset: { x: 640, y: 360 }, zoom: 2 },

  PAL: {
    bg: "#d5d1bd",
    floorA: "#d8d2ac", floorB: "#d1cba4", grid: "rgba(120,110,70,0.14)",
    body: "#f6f2e6", bodyL: "#e2dbc8", bodyR: "#d2cbb8",
    edge: "rgba(90,84,60,0.55)",
    link: "rgba(190,150,30,0.75)",
    laser: "rgba(200,60,45,0.95)",
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

    // packets (tiny glowing dots)
    for (const u of engine.GameUnits) {
      if (!(u instanceof UnitEnergyPacket) || u.Destroyed) continue;
      ctx.fillStyle = "rgba(232,160,30,0.35)";
      ctx.beginPath(); ctx.arc(u.Position.x, u.Position.y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8a01e";
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
    // bars last, in screen space (reference DrawBar converts world→screen)
    for (const b of bars) {
      const sp = this.worldToScreen(b.x, b.y);
      const w = 48, h = 8, pad = 2;
      ctx.fillStyle = "rgba(60,54,36,0.85)";
      ctx.fillRect(sp.x - w / 2 - pad, sp.y - pad, w + pad * 2, h + pad * 2);
      ctx.fillStyle = b.color;
      ctx.fillRect(sp.x - w / 2, sp.y, w * U.clamp(b.amt, 0, 1), h);
    }
  },

  drawGround() {
    const TL = 64, TH = 32;
    const half = HSMap.TotalWidth / 2;
    const w0 = this.screenToWorld(0, 0), w1 = this.screenToWorld(CFG.W, CFG.H);
    const a0 = Math.floor((w0.x - w0.y) / TL) - 1, a1 = Math.ceil((w1.x - w1.y) / TL) + 1;
    const b0 = Math.floor((w0.x + w0.y) / TH / 2) - 1, b1 = Math.ceil((w1.x + w1.y) / TH / 2) + 1;
    const ctx = this.ctx;
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
    ctx.strokeStyle = "rgba(90,80,50,0.4)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-half, -half, half * 2, half * 2);
    ctx.lineWidth = 1;
  },

  drawUnitWorld(ctx, engine, u, bars) {
    const x = u.Position.x, y = u.Position.y;
    const detail = engine.DrawZoomDetails;

    if (u instanceof UnitMineral) {
      const col = u.Megamineral ? this.PAL.mineralRich || "#e0a032" : "#2fa88a";
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y - 10); ctx.lineTo(x + 6, y + 2); ctx.lineTo(x, y + 6);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y - 10); ctx.lineTo(x - 6, y + 2); ctx.lineTo(x, y + 6);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (u instanceof UnitAlienUfo) {
      ctx.save();
      ctx.translate(x, y - 6);
      ctx.rotate(u.Rotation * 0.05);
      ctx.fillStyle = u.Health < u.MaxHealth ? this.mix("#c8453f", "#ffffff", 0.3) : "#c8453f";
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(60,30,26,0.6)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#8a2a24";
      ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.fill();
      ctx.restore();
      if (detail && u.Health < u.MaxHealth) bars.push({ x, y: y - 26, amt: u.Health / u.MaxHealth, color: "#c8453f" });
      return;
    }

    if (u instanceof UnitBuildingWIP) {
      ctx.fillStyle = "rgba(70,62,40,0.25)";
      this.diamond(ctx, x, y, 46, 24);
      ctx.fill();
      this.prism(ctx, x, y, 0.72, 6, "#e8e2d0", this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.6)");
      const prog = 1 - u.BuildCostRemaining / u.MaxBuildCost;
      ctx.strokeStyle = "rgba(150,120,40,0.9)";
      ctx.lineWidth = 1.5;
      this.diamond(ctx, x, y, 52, 26);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,196,64,1)";
      this.diamond(ctx, x, y, Math.max(2, 52 * prog), Math.max(1, 26 * prog));
      ctx.stroke();
      return;
    }

    // buildings: white prisms with colored tops (grayed when unpowered/idle)
    const tints = { laser: "#d88484", conduit: "#7ecf96", solarpanel: "#7fc4e8", harvester: "#ecc06a" };
    const cc = tints[u.Name];
    if (!cc) return;
    const gray = u.DrawColorTint === "gray";
    const top = gray ? "#b3ad9c" : this.mix(this.PAL.body, cc, 0.6);
    const hPx = { laser: 26, conduit: 14, solarpanel: 10, harvester: 10 }[u.Name];
    this.prism(ctx, x, y, u.TexWidth, u.TexWidth / 2, hPx, top, this.PAL.bodyL, this.PAL.bodyR, this.PAL.edge);

  },

  drawUnitGUI(ctx, engine, u, bars) {
    const detail = engine.DrawZoomDetails;
    const x = u.Position.x, y = u.Position.y;

    if (u instanceof UnitConduit) {
      if (u.IsMouseHover) {
        ctx.strokeStyle = "rgba(190,150,30,0.6)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
        for (const o of engine.GetAllGameUnitsArray()) {
          if (o instanceof UnitConduit && o !== u && V2.dist(u.Position, o.Position) < UnitConduit.ConnectRangePower) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
          }
        }
      }
      const link = u.GetLinkedConduit;
      if (link) {
        if (detail) this.dashedLine(ctx, { x, y }, { x: link.Position.x, y: link.Position.y }, 6, "rgba(190,150,30,0.6)", engine.Time * 60);
        else { ctx.strokeStyle = "rgba(190,150,30,0.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(link.Position.x, link.Position.y); ctx.stroke(); }
      }
      if (detail && u.Heat > 5) bars.push({ x, y: y - 22, amt: u.Heat / 100, color: u.Heat > 60 ? "#c8453f" : "#e0a032" });
      return;
    }

    if (u instanceof UnitLaser) {
      const range = u.GetAttackRange;
      if (u.IsMouseHover || engine.DebugDrawLaserRange) {
        ctx.strokeStyle = "rgba(200,60,45,0.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, y, range, 0, 7); ctx.stroke();
      }
      if (u.Target != null && u.EnergyCharges > 0) {
        ctx.strokeStyle = "rgba(200,60,45,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(u.Target.Position.x, u.Target.Position.y); ctx.stroke();
      }
      const link = u.GetLinkedLaser;
      if (link) {
        if (link.IsAttacking) {
          ctx.strokeStyle = "rgba(200,60,45,0.95)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(link.Position.x, link.Position.y - 10); ctx.stroke();
        } else if (detail) {
          this.dashedLine(ctx, { x, y: y - 10 }, { x: link.Position.x, y: link.Position.y - 10 }, 6, "rgba(200,60,45,0.5)", engine.Time * 60);
        }
      }
      if (detail) bars.push({ x, y: y - 30, amt: u.EnergyCharges / u.MaxEnergyCharges, color: "#e0a032" });
      return;
    }

    if (u instanceof UnitHarvester && u.IsMouseHover) {
      ctx.strokeStyle = "rgba(60,140,90,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, UnitHarvester.ConnectRangeHarvest, 0, 7); ctx.stroke();
      for (const o of engine.GetAllGameUnitsArray()) {
        if (o instanceof UnitMineral && V2.dist(u.Position, o.Position) < UnitHarvester.ConnectRangeHarvest) {
          ctx.strokeStyle = "rgba(60,140,90,0.3)";
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
          ctx.strokeStyle = "rgba(60,140,90,0.5)";
        }
      }
      return;
    }

    if (u instanceof UnitSolarPanel && u.IsMouseHover) {
      ctx.strokeStyle = "rgba(190,150,30,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
    }
  },

  drawGhost(ctx, engine) {
    const tool = UI.activeToolObj;
    if (!tool || !tool.Active || !UI.mouseWorld) return;

    if (tool instanceof HSGameToolBuilder && tool.ToolGhost) {
      const [tw, th] = tool.ToolGhost;
      const ok = tool.CurrentLocationValid;
      // range circles per tool type
      if (tool instanceof HSGameToolConduit || tool instanceof HSGameToolSolarPanel) {
        ctx.strokeStyle = "rgba(190,150,30,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(UI.mouseWorld.x, UI.mouseWorld.y, UnitConduit.ConnectRangePower, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        for (const o of engine.GetAllGameUnitsArray()) {
          if (o instanceof UnitConduit && V2.dist(UI.mouseWorld, o.Position) < UnitConduit.ConnectRangePower) {
            ctx.beginPath(); ctx.moveTo(UI.mouseWorld.x, UI.mouseWorld.y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
          }
        }
      }
      if (tool instanceof HSGameToolHarvester) {
        ctx.strokeStyle = "rgba(60,140,90,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(UI.mouseWorld.x, UI.mouseWorld.y, UnitHarvester.ConnectRangeHarvest, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        for (const o of engine.GetAllGameUnitsArray()) {
          if (o instanceof UnitMineral && V2.dist(UI.mouseWorld, o.Position) < UnitHarvester.ConnectRangeHarvest) {
            ctx.beginPath(); ctx.moveTo(UI.mouseWorld.x, UI.mouseWorld.y); ctx.lineTo(o.Position.x, o.Position.y); ctx.stroke();
          }
        }
      }
      if (tool instanceof HSGameToolLaser) {
        ctx.strokeStyle = "rgba(200,60,45,0.5)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5 / this.cam.zoom;
        ctx.beginPath(); ctx.arc(UI.mouseWorld.x, UI.mouseWorld.y, UnitLaser.SINGLE_LASER_RNG, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      const ok2 = ok && engine.Resources >= tool.BuildCost;
      ctx.fillStyle = ok2 ? "rgba(120,180,90,0.4)" : "rgba(217,83,79,0.45)";
      ctx.strokeStyle = ok2 ? "#3f9e5f" : "#c8453f";
      ctx.lineWidth = 1.5;
      this.diamond(ctx, UI.mouseWorld.x, UI.mouseWorld.y, tw * 1.6, th * 1.6);
      ctx.fill(); ctx.stroke();
      // price tag under the ghost (screen-constant size)
      ctx.save();
      ctx.translate(UI.mouseWorld.x, UI.mouseWorld.y + th + 14);
      ctx.scale(1 / this.cam.zoom, 1 / this.cam.zoom);
      ctx.font = "700 12px Segoe UI, Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = ok2 ? "#2f7a4d" : "#c8453f";
      ctx.fillText(tool.BuildCost + " R$", 0, 0);
      ctx.restore();
    }
    if (tool instanceof HSGameToolPicker && tool.InMouseClick && tool.MouseClickPos) {
      ctx.strokeStyle = "rgba(50,200,100,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tool.MouseClickPos.x, tool.MouseClickPos.y); ctx.lineTo(UI.mouseWorld.x, UI.mouseWorld.y); ctx.stroke();
    }
  },

  drawEffectsWorld(ctx, engine) {
    for (const fx of engine.Effects) {
      if (!fx || fx.endTime <= engine.Time) continue;
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
