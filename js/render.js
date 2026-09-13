/* SUNGRID — iso rendering, LIGHT theme: warm sand terrain, white buildings with
 * colored tops, gold sun atoms. Camera: pan (right-drag / arrows), zoom (wheel). */
"use strict";

const Renderer = {
  canvas: null, ctx: null, staticLayer: null, staticLevelRef: null,
  cam: { x: 0, y: 0, z: 1 },   // world-space top-left offset + zoom

  /* Harvest-flavoured light palette */
  PAL: {
    skyTop: "#e9e6d6", skyBottom: "#d5d1bd",
    floorA: "#d8d2ac", floorB: "#cec7a0", grid: "rgba(120,110,70,0.18)",
    rockTop: "#b9b096", rockL: "#a39a80", rockR: "#948b73", rockEdge: "#7e7660",
    mineral: "#2fa88a", mineralRich: "#e0a032",
    spawn: "rgba(217,83,79,0.16)", spawnEdge: "rgba(200,60,56,0.65)",
    core: "#3fa7d6",
    body: "#f6f2e6", bodyL: "#e4ddca", bodyR: "#d4cdb9",
    atom: "255,196,64", atomHot: "232,90,60",
    beam: "255,96,140",
  },

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  },

  /* ---------- color helpers ---------- */
  shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
    const g = U.clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
    const b = U.clamp(Math.round((n & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  /* ---------- camera ---------- */
  worldSize() {
    return {
      w: (CFG.COLS + CFG.ROWS) * (ISO.TW / 2),
      h: (CFG.COLS + CFG.ROWS) * (ISO.TH / 2) + 150, // headroom for tall buildings
    };
  },

  fitZoom() {
    const s = this.worldSize();
    return Math.min(CFG.W / (s.w + 60), CFG.H / (s.h + 90));
  },

  clampCam() {
    const s = this.worldSize();
    this.cam.z = U.clamp(this.cam.z, this.fitZoom() * 0.95, 1.8);
    this.cam.x = U.clamp(this.cam.x, -50, Math.max(-50, s.w - CFG.W / this.cam.z + 50));
    this.cam.y = U.clamp(this.cam.y, -100, Math.max(-100, s.h - CFG.H / this.cam.z + 70));
  },

  centerOn(c, r) {
    this.cam.z = this.fitZoom();
    const p = ISO.px(c, r);
    this.cam.x = p.x - CFG.W / (2 * this.cam.z);
    this.cam.y = p.y - CFG.H / (2.2 * this.cam.z);
    this.clampCam();
  },

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.cam.z = U.clamp(this.cam.z * factor, this.fitZoom() * 0.95, 1.8);
    this.cam.x = before.x - sx / this.cam.z;
    this.cam.y = before.y - sy / this.cam.z;
    this.clampCam();
  },

  panBy(dx, dy) {
    this.cam.x += dx / this.cam.z;
    this.cam.y += dy / this.cam.z;
    this.clampCam();
  },

  screenToWorld(sx, sy) {
    return { x: sx / this.cam.z + this.cam.x, y: sy / this.cam.z + this.cam.y };
  },

  worldToScreen(wx, wy) {
    return { x: (wx - this.cam.x) * this.cam.z, y: (wy - this.cam.y) * this.cam.z };
  },

  /* ---------- static terrain layer (world-space, full map) ---------- */
  buildStatic(game) {
    const s = this.worldSize();
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(s.w);
    cv.height = Math.ceil(s.h);
    const g = cv.getContext("2d");
    const P = this.PAL;
    const oy = 0; // static canvas top == world y -100 ≈ handled by +110 offset below

    // warm parchment backdrop
    const grad = g.createLinearGradient(0, 0, 0, cv.height);
    grad.addColorStop(0, P.skyTop);
    grad.addColorStop(1, P.skyBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, cv.width, cv.height);
    // faint dust specks (darker on light ground)
    for (let i = 0; i < 240; i++) {
      g.fillStyle = `rgba(90,84,60,${U.rand(0.04, 0.14)})`;
      g.fillRect(U.rand(0, cv.width), U.rand(0, cv.height), 1.6, 1.6);
    }

    const OY = 110; // vertical offset inside the static canvas
    const { COLS, ROWS } = CFG;

    // floor diamonds
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const terr = game.terr[U.idx(c, r)];
        if (terr === 1) continue;
        const wx = (c - r) * (ISO.TW / 2) + cv.width / 2;
        const wy = (c + r) * (ISO.TH / 2) + OY;
        const hsh = U.hash2(c, r);
        g.fillStyle = (c + r) % 2 === 0 ? P.floorA : P.floorB;
        if (terr >= 2) g.fillStyle = hsh > 0.5 ? "#d9d3ae" : "#d0c9a2";
        ISO.diamond(g, wx, wy);
        g.fill();
        g.strokeStyle = P.grid;
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // core pad
    {
      const wx = (game.core.c - game.core.r) * (ISO.TW / 2) + cv.width / 2;
      const wy = (game.core.c + game.core.r) * (ISO.TH / 2) + OY;
      g.save();
      g.strokeStyle = "rgba(63,167,214,0.55)";
      g.lineWidth = 2;
      ISO.diamond(g, wx, wy, ISO.TW * 0.94, ISO.TH * 0.94);
      g.stroke();
      g.strokeStyle = "rgba(63,167,214,0.25)";
      g.lineWidth = 1.2;
      ISO.ellipse(g, wx, wy, CFG.CORE_RANGE);
      g.stroke();
      g.restore();
    }

    // spawn gates
    for (const sp of game.spawns) {
      const wx = (sp.c - sp.r) * (ISO.TW / 2) + cv.width / 2;
      const wy = (sp.c + sp.r) * (ISO.TH / 2) + OY;
      g.save();
      g.fillStyle = P.spawn;
      ISO.diamond(g, wx, wy, ISO.TW * 0.9, ISO.TH * 0.9);
      g.fill();
      g.strokeStyle = P.spawnEdge;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = "rgba(160,45,42,0.9)";
      g.font = "bold 13px Segoe UI, Arial";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("☠", wx, wy - 2);
      g.restore();
    }

    // solids: rocks + minerals, painter-sorted
    const solids = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const terr = game.terr[U.idx(c, r)];
        if (terr === 1) solids.push({ c, r, kind: "rock", h: 0.55 + U.hash2(c + 31, r + 17) * 0.5 });
        else if (terr >= 2) solids.push({ c, r, kind: "mineral", rich: terr === 3 });
      }
    }
    solids.sort((a, b) => (a.c + a.r) - (b.c + b.r));
    for (const so of solids) {
      const wx = (so.c - so.r) * (ISO.TW / 2) + cv.width / 2;
      const wy = (so.c + so.r) * (ISO.TH / 2) + OY;
      if (so.kind === "rock") {
        const hpx = so.h * ISO.LIFT;
        ISO.prism(g, wx, wy, 0.94, hpx, P.rockTop, P.rockL, P.rockR, P.rockEdge);
      } else {
        const col = so.rich ? P.mineralRich : P.mineral;
        const nCr = so.rich ? 3 : 2;
        for (let k = 0; k < nCr; k++) {
          const hsh = U.hash2(so.c * 3 + k, so.r * 7 - k);
          const ox = (hsh - 0.5) * 18, oy = (U.hash2(so.c + k, so.r * 3) - 0.5) * 9;
          const hh = (so.rich ? 22 : 16) + hsh * 8;
          const cx = wx + ox, cy = wy + oy;
          g.fillStyle = col;
          g.globalAlpha = 0.92;
          g.beginPath();
          g.moveTo(cx, cy - hh); g.lineTo(cx + 7, cy + 2); g.lineTo(cx, cy + 7);
          g.closePath(); g.fill();
          g.globalAlpha = 0.55;
          g.beginPath();
          g.moveTo(cx, cy - hh); g.lineTo(cx - 7, cy + 2); g.lineTo(cx, cy + 7);
          g.closePath(); g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = col; g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(cx, cy - hh); g.lineTo(cx + 7, cy + 2); g.lineTo(cx, cy + 7); g.lineTo(cx - 7, cy + 2);
          g.closePath(); g.stroke();
        }
      }
    }

    this._staticOY = OY;
    this.staticLayer = cv;
  },

  /* world-space project used by dynamic drawing (adds the static canvas offset) */
  wpx(c, r, h = 0) {
    const wx = (c - r) * (ISO.TW / 2) + this._staticCanvasHalfW();
    const wy = (c + r) * (ISO.TH / 2) + this._staticOY - h * ISO.LIFT;
    return { x: wx, y: wy };
  },
  _staticCanvasHalfW() {
    return this.staticLayer ? this.staticLayer.width / 2 : CFG.W / 2;
  },

  /* ---------- main render ---------- */
  render(game, appState) {
    const ctx = this.ctx;
    const { W, H } = CFG;
    if (appState !== "game") { this.renderMenuBg(); return; }
    if (!game) return;
    if (this.staticLevelRef !== game) { this.buildStatic(game); this.centerOn(game.core.c, game.core.r); this.staticLevelRef = game; }

    const z = this.cam.z;
    ctx.save();
    if (game.shake > 0) ctx.translate(U.rand(-game.shake, game.shake), U.rand(-game.shake, game.shake));
    ctx.translate(-this.cam.x * z, -this.cam.y * z);
    ctx.scale(z, z);

    ctx.drawImage(this.staticLayer, 0, 0);
    this.drawNetworkRanges(game);
    this.drawEnergyLinks(game);

    // painter-sorted dynamic entities
    const drawables = [];
    drawables.push({ k: ISO.key(game.core.c, game.core.r, 0.5), fn: () => this.drawCore(game) });
    for (const t of game.towerList) drawables.push({ k: ISO.key(t.c, t.r, 0.5), fn: () => this.drawBuilding(game, t) });
    for (const e of game.enemies) drawables.push({ k: ISO.key(e.gc, e.gr, 0.6), fn: () => this.drawEnemy(game, e) });
    drawables.sort((a, b) => a.k - b.k);
    for (const d of drawables) d.fn();

    this.drawShells(game);
    this.drawLaserBeams(game);
    this.drawParticles(game);
    this.drawFloaters(game);
    this.drawOverlays(game);

    ctx.restore();
  },

  renderMenuBg() {
    const ctx = this.ctx;
    const { W, H } = CFG;
    const t = performance.now() / 1000;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#efece0");
    grad.addColorStop(1, "#ddd8c6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(120,110,70,0.12)";
    for (let i = 0; i < 14; i++) {
      const y = ((t * 26 + i * 52) % (H + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.save();
    ctx.globalAlpha = 0.14;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 46, H * 0.34);
      ctx.lineTo(W / 2 + i * 150, H + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(W / 2 - i * 46, H * 0.34);
      ctx.lineTo(W / 2 + i * 150, H + 40);
      ctx.stroke();
    }
    ctx.restore();
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

  /* ---------- pieces ---------- */
  drawNetworkRanges(game) {
    const show = game.placing && game.placing !== "bomb";
    if (!show) return;
    const ctx = this.ctx;
    ctx.save();
    for (const nd of game.netNodes) {
      const p = this.wpx(nd.c, nd.r);
      ctx.beginPath();
      ISO.ellipse(ctx, p.x, p.y, nd.range);
      ctx.strokeStyle = "rgba(60,140,90,0.4)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5 / this.cam.z;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(60,140,90,0.04)";
      ctx.fill();
    }
    ctx.restore();
  },

  /* sun atoms flowing along the grid */
  drawEnergyLinks(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const e of game.flowEdges) {
      const pa = this.wpx(e.a.c, e.a.r, 0.35);
      const pb = this.wpx(e.b.c, e.b.r, 0.35);
      ctx.strokeStyle = "rgba(150,120,40,0.22)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      const n = U.clamp(Math.round(e.flow / CFG.ATOMS_PER) + 1, 1, 7);
      const hot = U.clamp(e.heat / CFG.HEAT_MAX, 0, 1);
      const col = hot > 0.6 ? this.PAL.atomHot : this.PAL.atom;
      const phase = (game.time * (1.6 + hot * 1.6)) % 1;
      const jitter = hot > 0.6 ? Math.sin(game.time * 30) * 1.2 : 0;
      for (let i = 0; i < n; i++) {
        const k = ((i + phase) % n) / n;
        const px = U.lerp(pa.x, pb.x, k) + jitter;
        const py = U.lerp(pa.y, pb.y, k) + jitter * 0.5;
        const rr = 2.8 + (i % 2) * 0.7;
        ctx.fillStyle = `rgba(${col},0.95)`;
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(px - 0.8, py - 0.8, rr * 0.4, 0, 7); ctx.fill();
      }
      if (hot >= CFG.HEAT_BURN / CFG.HEAT_MAX) {
        for (const node of [e.a, e.b]) {
          const np = this.wpx(node.c, node.r);
          const pulse = 0.5 + 0.5 * Math.sin(game.time * 9);
          ctx.strokeStyle = `rgba(200,50,45,${0.3 + pulse * 0.5})`;
          ctx.lineWidth = 2;
          ISO.diamond(ctx, np.x, np.y, ISO.TW * 0.8, ISO.TH * 0.8);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  },

  drawCore(game) {
    const ctx = this.ctx;
    const p = this.wpx(game.core.c, game.core.r);
    const t = game.time;
    const pct = game.coreHp / game.coreMax;
    const col = pct > 0.5 ? "#3fa7d6" : pct > 0.25 ? "#e0a032" : "#d9534f";
    ctx.save();
    ctx.translate(p.x, p.y);
    ISO.prism(ctx, 0, 0, 0.8, 10, this.PAL.body, this.PAL.bodyL, this.PAL.bodyR, "rgba(90,84,60,0.5)");
    ctx.translate(0, -10);
    // glow
    ctx.globalCompositeOperation = "multiply";
    const rg = ctx.createRadialGradient(0, -8, 4, 0, -8, 46);
    rg.addColorStop(0, col + "66");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(-46, -54, 92, 92);
    ctx.globalCompositeOperation = "source-over";
    // rotating iso hex reactor
    ctx.save();
    ctx.translate(0, -8);
    ctx.scale(1, 0.55);
    ctx.rotate(t * 0.6);
    ctx.strokeStyle = col; ctx.lineWidth = 3.4;
    hexPath(ctx, 0, 0, 22);
    ctx.stroke();
    ctx.rotate(-t * 1.5);
    ctx.strokeStyle = col + "aa"; ctx.lineWidth = 2.2;
    hexPath(ctx, 0, 0, 14);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 4);
    ctx.beginPath(); ctx.arc(0, -8, 5.5, 0, 7); ctx.fill();
    ctx.restore();
  },

  drawBuilding(game, b) {
    const ctx = this.ctx;
    const p = this.wpx(b.c, b.r);
    const col = b.def.color;
    const topCol = this.mix(this.PAL.body, col, 0.45);
    const leftCol = this.shade(this.PAL.bodyL, 0.92);
    const rightCol = this.shade(this.PAL.bodyR, 0.86);
    const built = b.built;
    const ease = built * built * (3 - 2 * built);
    const H1 = ISO.LIFT;

    ctx.save();
    ctx.fillStyle = "rgba(70,62,40,0.28)";
    ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.68, ISO.TH * 0.68);
    ctx.fill();

    switch (b.key) {
      case "plant": {
        ISO.prism(ctx, p.x, p.y, 0.74, 12 + ease * (0.55 * H1), topCol, leftCol, rightCol, "rgba(90,84,60,0.5)");
        if (built >= 1) {
          const pp = 0.5 + 0.5 * Math.sin(game.time * 3 + b.pulse);
          ctx.save();
          ctx.fillStyle = `rgba(255,255,255,${0.5 + pp * 0.5})`;
          ctx.strokeStyle = col; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(p.x, p.y - 12 - 0.55 * H1 - 4, 3.4 + pp * 1.6, 0, 7); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "link": {
        const sapCol = b._sapped ? "#8a7fb0" : col;
        ISO.prism(ctx, p.x, p.y, 0.42, 8 + ease * (0.95 * H1), this.mix(this.PAL.body, sapCol, 0.5), leftCol, rightCol, "rgba(90,84,60,0.5)");
        if (built >= 1) {
          const pp = 0.5 + 0.5 * Math.sin(game.time * 2.6 + b.pulse);
          ctx.fillStyle = b._sapped ? "rgba(120,110,160,0.9)" : `rgba(60,140,90,${0.6 + pp * 0.4})`;
          ctx.beginPath(); ctx.arc(p.x, p.y - 8 - 0.95 * H1 - 3, 2.6 + pp, 0, 7); ctx.fill();
        }
        break;
      }
      case "harvester": {
        ISO.prism(ctx, p.x, p.y, 0.68, 10 + ease * (0.5 * H1), topCol, leftCol, rightCol, "rgba(90,84,60,0.5)");
        if (built >= 1) {
          ctx.save();
          ctx.translate(p.x, p.y - 10 - 0.5 * H1);
          ctx.scale(1, 0.5);
          ctx.rotate(game.time * 2.2);
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.arc(0, 0, 9, 0.6, 3.6); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 9, 3.8, 6.8); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "laser": {
        ISO.prism(ctx, p.x, p.y, 0.56, 10 + ease * (0.7 * H1), topCol, leftCol, rightCol, "rgba(90,84,60,0.5)");
        if (built >= 1) {
          const bl = 15;
          ctx.strokeStyle = "#5a5240";
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 10 - 0.7 * H1);
          ctx.lineTo(p.x + Math.cos(b.face) * bl, p.y - 10 - 0.7 * H1 + Math.sin(b.face) * bl * 0.6);
          ctx.stroke();
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.2;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(p.x, p.y - 10 - 0.7 * H1, 2.6, 0, 7); ctx.fill();
        }
        break;
      }
      case "missile": {
        ISO.prism(ctx, p.x, p.y, 0.64, 9 + ease * (0.5 * H1), topCol, leftCol, rightCol, "rgba(90,84,60,0.5)");
        if (built >= 1) {
          ctx.save();
          ctx.translate(p.x, p.y - 9 - 0.5 * H1);
          ctx.rotate(b.face * 0.2);
          ctx.fillStyle = "#fff";
          ctx.fillRect(-7, -4, 14, 8);
          ctx.fillStyle = col;
          ctx.fillRect(-5, -2.4, 10, 1.8);
          ctx.fillRect(-5, 0.6, 10, 1.8);
          ctx.restore();
        }
        break;
      }
      case "bomb": {
        const charged = b.charge >= BOMB_CHARGE;
        ISO.prism(ctx, p.x, p.y, 0.5, 5 + ease * (0.22 * H1), topCol, leftCol, rightCol, "rgba(90,84,60,0.5)");
        ctx.save();
        ctx.fillStyle = charged ? this.mix("#ffffff", col, 0.55) : this.shade(col, 0.75);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 5 - 0.22 * H1, 11, 8, 0, Math.PI, 0);
        ctx.fill();
        const blink = charged ? (Math.sin(game.time * 8) > 0 ? 1 : 0.15) : 0.3;
        ctx.fillStyle = `rgba(90,60,20,${blink})`;
        ctx.beginPath(); ctx.arc(p.x, p.y - 5 - 0.22 * H1 - 8, 2.4, 0, 7); ctx.fill();
        if (!charged) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y - 5 - 0.22 * H1, 14, -Math.PI / 2, -Math.PI / 2 + (b.charge / BOMB_CHARGE) * Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
    }

    // construction site: gold ring that fills as atoms arrive
    if (built < 1) {
      ctx.strokeStyle = "rgba(150,120,40,0.8)";
      ctx.lineWidth = 2;
      ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.72, ISO.TH * 0.72);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,196,64,0.95)";
      ctx.lineWidth = 2.4;
      ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.72 * built + 2, ISO.TH * 0.72 * built + 1);
      ctx.stroke();
    }

    if (built >= 1 && b.hp < b.maxHp) {
      const hpPct = b.hp / b.maxHp;
      ctx.fillStyle = "rgba(60,54,36,0.7)";
      ctx.fillRect(p.x - 15, p.y - 34, 30, 4);
      ctx.fillStyle = hpPct > 0.4 ? "#3f9e5f" : "#c8453f";
      ctx.fillRect(p.x - 15, p.y - 34, 30 * hpPct, 4);
    }
    ctx.restore();
  },

  mix(a, b, k) {
    // blend two hex colors
    const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
    const r = Math.round((((na >> 16) & 255) * (1 - k)) + (((nb >> 16) & 255) * k));
    const g = Math.round((((na >> 8) & 255) * (1 - k)) + (((nb >> 8) & 255) * k));
    const bl = Math.round(((na & 255) * (1 - k)) + ((nb & 255) * k));
    return `rgb(${r},${g},${bl})`;
  },

  drawEnemy(game, e) {
    const ctx = this.ctx;
    const p = this.wpx(e.gc, e.gr, 0.25);
    const R = e.size * ISO.TW * 0.5;
    ctx.save();
    ctx.fillStyle = "rgba(70,62,40,0.3)";
    ISO.diamond(ctx, p.x, p.y, R * 2.2, R * 1.1);
    ctx.fill();
    ctx.translate(p.x, p.y);
    const col = e.flash > 0 ? "#ffffff" : e.def.color;
    const wob = Math.sin(game.time * 9 + e.wob) * 0.1;

    if (e.slowF > 0) {
      ctx.fillStyle = "rgba(80,140,190,0.25)";
      ctx.beginPath(); ctx.arc(0, 0, R + 5, 0, 7); ctx.fill();
    }

    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(40,34,20,0.5)";
    ctx.lineWidth = 2;
    switch (e.key) {
      case "crawler":
        ctx.rotate((e.face || 0) + wob);
        ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.75, 0, 0, 7); ctx.fill(); ctx.stroke();
        break;
      case "swarm":
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
        break;
      case "tank":
        ctx.rotate(wob * 0.4);
        roundRect(ctx, -R, -R * 0.8, R * 2, R * 1.6, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(40,34,20,0.3)";
        roundRect(ctx, -R + 4, -3, R * 2 - 8, 6, 3); ctx.fill();
        break;
      case "kamikaze":
        ctx.rotate(e.face || 0);
        ctx.beginPath(); ctx.moveTo(R * 1.3, 0); ctx.lineTo(-R, -R * 0.8); ctx.lineTo(-R * 0.4, 0); ctx.lineTo(-R, R * 0.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case "teleporter":
        ctx.rotate(wob * 0.6);
        diamond(ctx, 0, 0, R * 1.2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        diamond(ctx, 0, 0, R * 0.6); ctx.stroke();
        break;
      case "sapper":
        ctx.rotate(Math.PI);
        ctx.beginPath(); ctx.moveTo(0, -R * 1.2); ctx.lineTo(R * 0.8, R * 0.6); ctx.lineTo(-R * 0.8, R * 0.6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case "rocket":
        ctx.rotate(e.face || 0);
        ctx.beginPath(); ctx.moveTo(R * 1.6, 0); ctx.lineTo(-R, -R * 0.7); ctx.lineTo(-R, R * 0.7);
        ctx.closePath(); ctx.fill();
        break;
      case "boss": {
        ctx.rotate(wob * 0.3);
        ctx.fillStyle = "#8a2a24";
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath(); ctx.moveTo(R - 3, -6); ctx.lineTo(R + 11, 0); ctx.lineTo(R - 3, 6);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffd94d";
        ctx.beginPath(); ctx.arc(0, 0, R * 0.4, 0, 7); ctx.fill();
        break;
      }
      default:
        ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    }

    if (e.key !== "rocket" && e.key !== "swarm") {
      ctx.fillStyle = "#241f12";
      const a = e.face || 0;
      const ex = Math.cos(a) * R * 0.3, ey = Math.sin(a) * R * 0.18;
      ctx.beginPath(); ctx.arc(ex - 4, ey, Math.max(1.6, R * 0.16), 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + 4, ey, Math.max(1.6, R * 0.16), 0, 7); ctx.fill();
    }

    if (e.hp < e.maxHp) {
      const pct = Math.max(0, e.hp / e.maxHp);
      const w = Math.max(20, R * 2.2);
      ctx.fillStyle = "rgba(40,34,20,0.7)";
      ctx.fillRect(-w / 2, -R - 12, w, 4);
      ctx.fillStyle = pct > 0.5 ? "#3f9e5f" : pct > 0.25 ? "#e0a032" : "#c8453f";
      ctx.fillRect(-w / 2, -R - 12, w * pct, 4);
    }
    ctx.restore();
    if (e.flash > 0) e.flash -= 1 / 60;
  },

  /* laser beams — saturated pink/red on light ground (additive washes out) */
  drawLaserBeams(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const t of game.towerList) {
      if (t.key !== "laser" || t.dead || !t.done) continue;
      const tp = this.wpx(t.c, t.r, 0.7);

      if (t.linkTo && !t.linkTo.dead) {
        const rp = this.wpx(t.linkTo.c, t.linkTo.r, 0.7);
        const a = 0.3 + t.ramp * 0.5 + t.beamHeat * 0.2;
        ctx.strokeStyle = `rgba(232,90,120,${a * 0.35})`;
        ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
        ctx.strokeStyle = `rgba(214,48,90,${a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
        ctx.fillStyle = `rgba(214,48,90,${0.5 + t.ramp * 0.5})`;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 2.5 + t.ramp * 1.5, 0, 7); ctx.fill();
        continue;
      }

      if (t.target && !t.target.dead && t.beamHeat > 0.05) {
        const ep = this.wpx(t.target.gc, t.target.gr, 0.4);
        const n = t.boost.n;
        const ramp = t.boost.n ? t.ramp : 1;
        const w = (2.2 + Math.min(6, n * 1.4)) * (0.4 + 0.6 * ramp) + t.beamHeat * 1.5;
        const col = n >= 4 ? "176,32,196" : n > 0 ? "210,60,120" : "214,72,48";
        ctx.strokeStyle = `rgba(${col},${(0.16 + t.beamHeat * 0.14) * Math.max(0.3, ramp)})`;
        ctx.lineWidth = w * 3;
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
        ctx.strokeStyle = `rgba(${col},${0.75 * Math.max(0.3, ramp)})`;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.95 * (n >= 2 ? 1 : 0.75) * Math.max(0.4, ramp)})`;
        ctx.lineWidth = Math.max(1, w * (n >= 2 ? 0.45 : 0.35));
        ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(ep.x, ep.y); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 3 + t.beamHeat * 2.5, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(${col},0.6)`;
        ctx.beginPath(); ctx.arc(ep.x, ep.y, 4 + Math.sin(game.time * 22) * 1.4, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  },

  drawShells(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const s of game.shells) {
      const p = s.pos();
      const sp = this.wpx(p.c, p.r, p.lift);
      ctx.fillStyle = "#5a4a28";
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8963c";
      ctx.beginPath(); ctx.arc(sp.x - 1, sp.y - 1, 2.6, 0, 7); ctx.fill();
    }
    ctx.restore();
  },

  drawParticles(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  },

  drawFloaters(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "bold 13px Segoe UI, Arial";
    ctx.textAlign = "center";
    for (const f of game.floaters) {
      ctx.globalAlpha = Math.min(1, f.life / f.maxLife + 0.2);
      ctx.fillStyle = "#4a4230";
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  },

  drawOverlays(game) {
    const ctx = this.ctx;

    if (game.hover.c >= 0 && game.hover.r >= 0 && U.inBounds(game.hover.c, game.hover.r)) {
      const p = this.wpx(game.hover.c, game.hover.r);
      ctx.save();
      ctx.strokeStyle = "rgba(50,44,26,0.6)";
      ctx.lineWidth = 1.6;
      ISO.diamond(ctx, p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fill();
      ctx.restore();
    }

    if (game.placing && game.hover.c >= 0 && U.inBounds(game.hover.c, game.hover.r)) {
      const { c, r } = game.hover;
      const ok = game.canPlace(game.placing, c, r);
      const def = TOWERS[game.placing];
      const affordable = game.energy >= def.cost;
      const p = this.wpx(c, r);
      ctx.save();
      const t0 = def.tiers[0];
      if (game.placing === "plant" || game.placing === "link") {
        ctx.strokeStyle = "rgba(60,140,90,0.65)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "laser" || game.placing === "missile") {
        ctx.strokeStyle = def.color;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "bomb") {
        ctx.strokeStyle = "rgba(196,80,160,0.7)";
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.aoe);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = ok && affordable ? "rgba(120,180,90,0.4)" : "rgba(217,83,79,0.45)";
      ctx.strokeStyle = ok && affordable ? "#3f9e5f" : "#c8453f";
      ISO.diamond(ctx, p.x, p.y);
      ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }

    if (game.selected && !game.selected.dead) {
      const t = game.selected;
      const p = this.wpx(t.c, t.r);
      ctx.save();
      ctx.strokeStyle = "#b8860b";
      ctx.lineWidth = 2;
      ISO.diamond(ctx, p.x, p.y);
      ctx.stroke();
      if (t.key === "laser") {
        ctx.strokeStyle = "rgba(56,150,180,0.55)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t.effRange);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t.key === "link") {
        const heatF = U.clamp(t.heat / CFG.HEAT_MAX, 0, 1);
        ctx.strokeStyle = `rgba(${heatF > 0.6 ? "200,60,50" : "60,140,90"},0.6)`;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t.t.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    if (game.linkFrom) {
      const from = game.linkFrom;
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
      for (const t of game.towerList) {
        if (t === from || t.key !== "laser" || !t.done) continue;
        if (U.dist(from.c, from.r, t.c, t.r) > LINK_RANGE) continue;
        const p = this.wpx(t.c, t.r);
        ctx.strokeStyle = `rgba(214,72,48,${0.35 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ISO.diamond(ctx, p.x, p.y);
        ctx.stroke();
      }
      if (game.hover.c >= 0 && U.inBounds(game.hover.c, game.hover.r)) {
        const hp = this.wpx(game.hover.c, game.hover.r);
        const fp = this.wpx(from.c, from.r);
        ctx.strokeStyle = "rgba(160,60,40,0.9)";
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(fp.x, fp.y - 14); ctx.lineTo(hp.x, hp.y - 14); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  },
};

/* ---------- shared path helpers ---------- */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function hexPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}
function diamond(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
  g.closePath();
}
