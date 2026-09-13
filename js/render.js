/* SUNGRID — iso rendering: diamond tiles, extruded buildings, neon glow. All procedural. */
"use strict";

const Renderer = {
  canvas: null, ctx: null, staticLayer: null, staticLevelRef: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  },

  /* ---------- color helpers ---------- */
  shade(hex, f) {
    // f < 1 darkens, f > 1 lightens; hex like "#rrggbb"
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r * f), 0, 255);
    g = U.clamp(Math.round(g * f), 0, 255);
    b = U.clamp(Math.round(b * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  /* ---------- static terrain layer ---------- */
  buildStatic(game) {
    const { W, H } = CFG;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");

    // deep space backdrop
    const grad = g.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H / 2, W * 0.72);
    grad.addColorStop(0, "#0c1326");
    grad.addColorStop(1, "#070b16");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 110; i++) {
      g.fillStyle = `rgba(160,190,255,${U.rand(0.04, 0.2)})`;
      g.fillRect(U.rand(0, W), U.rand(0, H), 1.5, 1.5);
    }

    const { COLS, ROWS } = CFG;

    // floor diamonds, row by row (top → bottom, painter-safe for edges)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const terr = game.terr[U.idx(c, r)];
        if (terr === 1) continue;
        const p = ISO.px(c, r);
        const hsh = U.hash2(c, r);
        let base = 14 + hsh * 5;                    // lightness jitter
        if (terr >= 2) base += 6;                   // deposits sit on lighter soil
        g.fillStyle = `rgb(${(base * 0.9) | 0},${(base * 1.15) | 0},${(base * 2.1 + 14) | 0})`;
        ISO.diamond(g, p.x, p.y);
        g.fill();
        g.strokeStyle = "rgba(90,130,220,0.09)";
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // core pad
    {
      const p = ISO.px(game.core.c, game.core.r);
      g.save();
      g.strokeStyle = "rgba(77,225,255,0.5)";
      g.lineWidth = 2;
      ISO.diamond(g, p.x, p.y, ISO.TW * 0.92, ISO.TH * 0.92);
      g.stroke();
      g.strokeStyle = "rgba(77,225,255,0.22)";
      g.lineWidth = 1;
      ISO.ellipse(g, p.x, p.y, CFG.CORE_RANGE);
      g.stroke();
      g.restore();
    }

    // spawn gates
    for (const s of game.spawns) {
      const p = ISO.px(s.c, s.r);
      g.save();
      g.fillStyle = "rgba(255,60,60,0.14)";
      ISO.diamond(g, p.x, p.y, ISO.TW * 0.9, ISO.TH * 0.9);
      g.fill();
      g.strokeStyle = "rgba(255,80,80,0.6)";
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = "rgba(255,90,90,0.85)";
      g.font = "bold 13px Segoe UI, Arial";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("☠", p.x, p.y - 2);
      g.restore();
    }

    // rocks — extruded prisms, painter-sorted
    const solids = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const terr = game.terr[U.idx(c, r)];
        if (terr === 1) solids.push({ c, r, kind: "rock", h: 0.55 + U.hash2(c + 31, r + 17) * 0.5 });
        else if (terr >= 2) solids.push({ c, r, kind: "mineral", rich: terr === 3 });
      }
    }
    solids.sort((a, b) => (a.c + a.r) - (b.c + b.r));
    for (const s of solids) {
      const p = ISO.px(s.c, s.r);
      if (s.kind === "rock") {
        const hpx = s.h * ISO.LIFT;
        ISO.prism(g, p.x, p.y, 0.94, hpx, "#2a3654", "#1a2340", "#141b33", "#3d4f7c");
        // lit top edge
        g.strokeStyle = "rgba(120,150,220,0.35)";
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(p.x - ISO.TW * 0.47, p.y - hpx);
        g.lineTo(p.x, p.y - hpx + ISO.TH * 0.47);
        g.lineTo(p.x + ISO.TW * 0.47, p.y - hpx);
        g.stroke();
      } else {
        // mineral deposit: crystal cluster
        const col = s.rich ? "#ffb340" : "#59e8a8";
        const n = s.rich ? 3 : 2;
        g.save();
        for (let k = 0; k < n; k++) {
          const hsh = U.hash2(s.c * 3 + k, s.r * 7 - k);
          const ox = (hsh - 0.5) * 18, oy = (U.hash2(s.c + k, s.r * 3) - 0.5) * 9;
          const hh = (s.rich ? 22 : 16) + hsh * 8;
          const cxp = p.x + ox, cyp = p.y + oy;
          // crystal = two triangles (front lit, back dark)
          g.fillStyle = col;
          g.globalAlpha = 0.9;
          g.beginPath();
          g.moveTo(cxp, cyp - hh); g.lineTo(cxp + 7, cyp + 2); g.lineTo(cxp, cyp + 7);
          g.closePath(); g.fill();
          g.globalAlpha = 0.55;
          g.beginPath();
          g.moveTo(cxp, cyp - hh); g.lineTo(cxp - 7, cyp + 2); g.lineTo(cxp, cyp + 7);
          g.closePath(); g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = col; g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(cxp, cyp - hh); g.lineTo(cxp + 7, cyp + 2); g.lineTo(cxp, cyp + 7); g.lineTo(cxp - 7, cyp + 2);
          g.closePath(); g.stroke();
          // sparkle
          g.fillStyle = "#fff";
          g.globalAlpha = 0.7;
          g.fillRect(cxp - 1, cyp - hh + 3, 2, 2);
          g.globalAlpha = 1;
        }
        g.restore();
      }
    }

    this.staticLayer = cv;
  },

  /* ---------- main render ---------- */
  render(game, appState) {
    const ctx = this.ctx;
    const { W, H } = CFG;
    if (appState !== "game") { this.renderMenuBg(); return; }
    if (!game) return;
    if (this.staticLevelRef !== game) { this.buildStatic(game); this.staticLevelRef = game; }

    ctx.save();
    if (game.shake > 0) ctx.translate(U.rand(-game.shake, game.shake), U.rand(-game.shake, game.shake));

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
    ctx.fillStyle = "#070b16";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(70,110,200,0.10)";
    for (let i = 0; i < 14; i++) {
      const y = ((t * 26 + i * 52) % (H + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const x = ((t * 14 + i * 62) % (W + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // iso floor receding — sungrid signature backdrop
    ctx.save();
    ctx.globalAlpha = 0.16;
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
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      const a = t * 0.12 + i * 2.1;
      const x = W / 2 + Math.cos(a) * W * 0.42, y = H / 2 + Math.sin(a * 1.3) * H * 0.4;
      const col = ["77,225,255", "255,92,240", "255,217,77"][i];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 190);
      rg.addColorStop(0, `rgba(${col},0.10)`);
      rg.addColorStop(1, "rgba(0,0,0,0)");
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
    for (const n of game.netNodes) {
      const p = ISO.px(n.c, n.r);
      ctx.beginPath();
      ISO.ellipse(ctx, p.x, p.y, n.range);
      ctx.strokeStyle = "rgba(125,255,154,0.30)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(125,255,154,0.03)";
      ctx.fill();
    }
    ctx.restore();
  },

  /* phase 3 fills this with flowing sun atoms; for now draw thread lines between adjacent nodes */
  drawEnergyLinks(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(125,255,154,0.12)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < game.netNodes.length; i++) {
      for (let j = i + 1; j < game.netNodes.length; j++) {
        const a = game.netNodes[i], b = game.netNodes[j];
        if (U.dist(a.c, a.r, b.c, b.r) > Math.min(a.range, b.range) + 0.01) continue;
        const pa = ISO.px(a.c, a.r), pb = ISO.px(b.c, b.r);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
    }
    ctx.restore();
  },

  drawCore(game) {
    const ctx = this.ctx;
    const p = ISO.px(game.core.c, game.core.r);
    const t = game.time;
    const pct = game.coreHp / game.coreMax;
    const col = pct > 0.5 ? "#4de1ff" : pct > 0.25 ? "#ffd94d" : "#ff5c5c";
    ctx.save();
    ctx.translate(p.x, p.y);
    // base plinth
    ISO.prism(ctx, 0, 0, 0.8, 10, "#182440", "#111a30", "#0d1526", "#2a3a60");
    ctx.translate(0, -10);
    // glow
    ctx.globalCompositeOperation = "lighter";
    const rg = ctx.createRadialGradient(0, -8, 4, 0, -8, 46);
    rg.addColorStop(0, col + "55");
    rg.addColorStop(1, "rgba(0,0,0,0)");
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
    // heart
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 4);
    ctx.beginPath(); ctx.arc(0, -8, 5.5, 0, 7); ctx.fill();
    ctx.restore();
  },

  drawBuilding(game, b) {
    const ctx = this.ctx;
    const p = ISO.px(b.c, b.r);
    const col = b.def.color;
    const topCol = col;
    const leftCol = this.shade(col, 0.45);
    const rightCol = this.shade(col, 0.3);
    const built = b.built;
    const ease = built * built * (3 - 2 * built); // smoothstep rise
    const bob = built < 1 ? 0 : 0;

    ctx.save();
    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.68, ISO.TH * 0.68);
    ctx.fill();

    const H1 = ISO.LIFT;
    switch (b.key) {
      case "plant": {
        ISO.prism(ctx, p.x, p.y - 0, 0.74, 12 + ease * (0.55 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        if (built >= 1) {
          const pp = 0.5 + 0.5 * Math.sin(game.time * 3 + b.pulse);
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `rgba(255,255,255,${0.35 + pp * 0.45})`;
          ctx.beginPath(); ctx.arc(p.x, p.y - 12 - 0.55 * H1 - 4, 3.4 + pp * 1.6, 0, 7); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case "link": {
        ISO.prism(ctx, p.x, p.y, 0.42, 8 + ease * (0.95 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        if (built >= 1 && b.online !== false) {
          const pp = 0.5 + 0.5 * Math.sin(game.time * 2.6 + b.pulse);
          ctx.fillStyle = `rgba(230,255,238,${0.5 + pp * 0.5})`;
          ctx.beginPath(); ctx.arc(p.x, p.y - 8 - 0.95 * H1 - 3, 2.6 + pp, 0, 7); ctx.fill();
        }
        break;
      }
      case "harvester": {
        ISO.prism(ctx, p.x, p.y, 0.68, 10 + ease * (0.5 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        if (built >= 1) {
          // spinning drill ring
          ctx.save();
          ctx.translate(p.x, p.y - 10 - 0.5 * H1);
          ctx.scale(1, 0.5);
          ctx.rotate(game.time * 2.2);
          ctx.strokeStyle = "#fff2c2"; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.arc(0, 0, 9, 0.6, 3.6); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, 9, 3.8, 6.8); ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case "laser": {
        ISO.prism(ctx, p.x, p.y, 0.56, 10 + ease * (0.7 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        if (built >= 1) {
          // barrel pointing at face (screen-space angle)
          const bl = 15;
          ctx.strokeStyle = "#dff8ff";
          ctx.lineWidth = 3.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 10 - 0.7 * H1);
          ctx.lineTo(p.x + Math.cos(b.face) * bl, p.y - 10 - 0.7 * H1 + Math.sin(b.face) * bl * 0.6);
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(p.x, p.y - 10 - 0.7 * H1, 2.6, 0, 7); ctx.fill();
        }
        break;
      }
      case "missile": {
        ISO.prism(ctx, p.x, p.y, 0.64, 9 + ease * (0.5 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        if (built >= 1) {
          ctx.save();
          ctx.translate(p.x, p.y - 9 - 0.5 * H1);
          ctx.rotate(b.face * 0.2);
          ctx.fillStyle = "#ffd7a4";
          ctx.fillRect(-7, -4, 14, 8);
          ctx.fillStyle = col;
          ctx.fillRect(-5, -2.4, 10, 1.8);
          ctx.fillRect(-5, 0.6, 10, 1.8);
          ctx.restore();
        }
        break;
      }
      case "bomb": {
        const charged = b.charge >= 40;
        ISO.prism(ctx, p.x, p.y, 0.5, 5 + ease * (0.22 * H1), topCol, leftCol, rightCol, "rgba(255,255,255,0.25)");
        // dome
        ctx.save();
        ctx.fillStyle = charged ? "#ffb5f7" : this.shade(col, 0.7);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 5 - 0.22 * H1, 11, 8, 0, Math.PI, 0);
        ctx.fill();
        const blink = charged ? (Math.sin(game.time * 8) > 0 ? 1 : 0.15) : 0.3;
        ctx.fillStyle = `rgba(255,255,255,${blink})`;
        ctx.beginPath(); ctx.arc(p.x, p.y - 5 - 0.22 * H1 - 8, 2.4, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
    }

    // construction scaffold tint
    if (built < 1) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(10,14,26,0.6)";
      ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.7, ISO.TH * 0.7);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,217,77,0.8)";
      ctx.lineWidth = 1.4;
      ISO.diamond(ctx, p.x, p.y, ISO.TW * 0.7 * built, ISO.TH * 0.7 * built);
      ctx.stroke();
    }

    // hp bar when damaged
    if (built >= 1 && b.hp < b.maxHp) {
      const hpPct = b.hp / b.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(p.x - 15, p.y - 34, 30, 4);
      ctx.fillStyle = hpPct > 0.4 ? "#7dff9a" : "#ff6b57";
      ctx.fillRect(p.x - 15, p.y - 34, 30 * hpPct, 4);
    }
    ctx.restore();
  },

  drawEnemy(game, e) { /* phase 5 */ },

  drawLaserBeams(game) { /* phase 4 */ },

  drawShells(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const s of game.shells) {
      const p = s.pos();
      const sp = ISO.px(p.c, p.r, p.lift);
      ctx.fillStyle = "#ffd7a4";
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,154,77,0.35)";
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 9, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  },

  drawParticles(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
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
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  },

  drawOverlays(game) {
    const ctx = this.ctx;

    // hover tile highlight
    if (game.hover.c >= 0 && game.hover.r >= 0 &&
        game.hover.c < CFG.COLS && game.hover.r < CFG.ROWS) {
      const p = ISO.px(game.hover.c, game.hover.r);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.6;
      ISO.diamond(ctx, p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.restore();
    }

    // placement ghost
    if (game.placing && game.hover.c >= 0 && U.inBounds(game.hover.c, game.hover.r)) {
      const { c, r } = game.hover;
      const ok = game.canPlace(game.placing, c, r);
      const def = TOWERS[game.placing];
      const affordable = game.credits >= def.cost;
      const p = ISO.px(c, r);
      ctx.save();
      // range preview (grid ellipses)
      const t0 = def.tiers[0];
      if (game.placing === "plant" || game.placing === "link") {
        ctx.strokeStyle = "rgba(125,255,154,0.6)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "laser") {
        ctx.strokeStyle = def.color + "88";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "missile") {
        ctx.strokeStyle = def.color + "88";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "bomb") {
        ctx.strokeStyle = "rgba(255,92,240,0.6)";
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t0.aoe);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = ok && affordable ? def.color + "55" : "rgba(255,60,60,0.4)";
      ctx.strokeStyle = ok && affordable ? def.color : "#ff5c5c";
      ISO.diamond(ctx, p.x, p.y);
      ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }

    // selected building
    if (game.selected && !game.selected.dead) {
      const t = game.selected;
      const p = ISO.px(t.c, t.r);
      ctx.save();
      ctx.strokeStyle = "#ffd94d";
      ctx.lineWidth = 2;
      ISO.diamond(ctx, p.x, p.y);
      ctx.stroke();
      if (t.key === "laser") {
        ctx.strokeStyle = "rgba(77,225,255,0.5)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t.effRange);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t.key === "link") {
        const heatF = U.clamp(t.heat / CFG.HEAT_MAX, 0, 1);
        ctx.strokeStyle = `rgba(${heatF > 0.6 ? "255,110,90" : "125,255,154"},0.6)`;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ISO.ellipse(ctx, p.x, p.y, t.t.range);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // link mode (phase 4: laser→laser)
    if (game.linkFrom) {
      const from = game.linkFrom;
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
      for (const t of game.towerList) {
        if (t === from || t.key !== "laser" || !t.done) continue;
        if (U.dist(from.c, from.r, t.c, t.r) > LINK_RANGE) continue;
        const p = ISO.px(t.c, t.r);
        ctx.strokeStyle = `rgba(77,225,255,${0.3 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ISO.diamond(ctx, p.x, p.y);
        ctx.stroke();
      }
      if (game.hover.c >= 0 && U.inBounds(game.hover.c, game.hover.r)) {
        const hp = ISO.px(game.hover.c, game.hover.r);
        const fp = ISO.px(from.c, from.r);
        ctx.strokeStyle = "rgba(182,240,255,0.9)";
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
