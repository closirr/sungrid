/* SUNGRID — rendering: neon vector look, all procedural */
"use strict";

const Renderer = {
  canvas: null, ctx: null, staticLayer: null, staticLevelRef: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  },

  /* ---------- static terrain layer ---------- */
  buildStatic(game) {
    const { W, H, CELL } = CFG;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const { COLS, ROWS } = CFG;

    // deep space floor
    const grad = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.7);
    grad.addColorStop(0, "#0d1428");
    grad.addColorStop(1, "#070b16");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // faint stars
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(160,190,255,${U.rand(0.05, 0.22)})`;
      g.fillRect(U.rand(0, W), U.rand(0, H), 1.5, 1.5);
    }

    // grid
    g.strokeStyle = "rgba(90,130,220,0.07)";
    g.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(c * CELL, 0); g.lineTo(c * CELL, H); g.stroke(); }
    for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(0, r * CELL); g.lineTo(W, r * CELL); g.stroke(); }

    // terrain cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = game.terr[r * COLS + c];
        const x = c * CELL, y = r * CELL;
        if (t === 1) { // rock
          g.fillStyle = "#141c33";
          g.strokeStyle = "#26355c";
          roundRect(g, x + 2, y + 2, CELL - 4, CELL - 4, 8);
          g.fill(); g.stroke();
          g.fillStyle = "rgba(80,105,170,0.25)";
          g.beginPath();
          g.arc(x + CELL * U.rand(0.3, 0.7), y + CELL * U.rand(0.3, 0.6), 7, 0, 7);
          g.fill();
        } else if (t === 2 || t === 3) { // crystal / rich
          const rich = t === 3;
          const cx = U.cx(c), cy = U.cy(r);
          const col = rich ? "#ffb340" : "#59e8a8";
          g.save();
          g.globalAlpha = 0.9;
          for (let k = 0; k < (rich ? 3 : 2); k++) {
            const ox = rich ? U.rand(-9, 9) : 0, oy = rich ? U.rand(-7, 7) : 0;
            const h = rich ? U.rand(13, 18) : 14;
            g.fillStyle = col;
            g.globalAlpha = 0.28;
            g.beginPath();
            g.moveTo(cx + ox, cy + oy - h); g.lineTo(cx + ox + 8, cy + oy + 6);
            g.lineTo(cx + ox, cy + oy + 12); g.lineTo(cx + ox - 8, cy + oy + 6);
            g.closePath(); g.fill();
            g.globalAlpha = 0.95;
            g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
            g.globalAlpha = 0.9;
          }
          g.restore();
        }
      }
    }

    // spawn gates
    for (const s of game.spawns) {
      const x = s.c * CELL, y = s.r * CELL;
      g.fillStyle = "rgba(255,60,60,0.10)";
      g.fillRect(x, y, CELL, CELL);
      g.strokeStyle = "rgba(255,80,80,0.55)";
      g.lineWidth = 2;
      g.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
      g.fillStyle = "rgba(255,90,90,0.8)";
      g.font = "bold 15px Segoe UI, Arial";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("☠", U.cx(s.c), U.cy(s.r));
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
    this.drawNetwork(game);
    this.drawSpawnArrows(game);
    this.drawCore(game);
    this.drawPrismBeams(game);
    for (const t of game.towerList) this.drawTower(game, t);
    for (const e of game.enemies) this.drawEnemy(game, e);
    this.drawLaserBeams(game);
    this.drawShells(game);
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
    // drifting grid horizon
    ctx.strokeStyle = "rgba(70,110,200,0.10)";
    for (let i = 0; i < 14; i++) {
      const y = ((t * 26 + i * 52) % (H + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const x = ((t * 14 + i * 62) % (W + 60)) - 30;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // ambient beams
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
  drawNetwork(game) {
    const ctx = this.ctx;
    const show = game.placing && game.placing !== "wall";
    if (!show) return;
    ctx.save();
    for (const n of game.netNodes) {
      ctx.beginPath();
      ctx.arc(U.cx(n.c), U.cy(n.r), n.range * CELL, 0, 7);
      ctx.strokeStyle = "rgba(125,255,154,0.28)";
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(125,255,154,0.035)";
      ctx.fill();
    }
    ctx.restore();
  },

  drawSpawnArrows(game) {
    if (game.state !== "build" || game.wave >= game.level.waves) return;
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 5);
    ctx.save();
    ctx.globalAlpha = 0.35 + pulse * 0.4;
    ctx.fillStyle = "#ff5c5c";
    for (const s of game.spawns) {
      const x = U.cx(s.c), y = U.cy(s.r);
      const a = U.angleTo(x, y, game.core.x, game.core.y);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(14 + pulse * 5, 0); ctx.lineTo(-2, -8); ctx.lineTo(-2, 8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  drawCore(game) {
    const ctx = this.ctx;
    const { x, y } = game.core;
    const t = game.time;
    const pct = game.coreHp / game.coreMax;
    const col = pct > 0.5 ? "#4de1ff" : pct > 0.25 ? "#ffd94d" : "#ff5c5c";
    ctx.save();
    ctx.translate(x, y);
    // glow
    ctx.globalCompositeOperation = "lighter";
    const rg = ctx.createRadialGradient(0, 0, 4, 0, 0, 44);
    rg.addColorStop(0, col + "55");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(-44, -44, 88, 88);
    ctx.globalCompositeOperation = "source-over";
    // rotating hex reactor
    ctx.rotate(t * 0.6);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    hexPath(ctx, 0, 0, 17);
    ctx.stroke();
    ctx.rotate(-t * 1.5);
    ctx.strokeStyle = col + "aa"; ctx.lineWidth = 2;
    hexPath(ctx, 0, 0, 11);
    ctx.stroke();
    ctx.rotate(t * 1.5); // restore base rotation
    // bright heart
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 4);
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.fill();
    ctx.restore();
  },

  drawTower(game, t) {
    const ctx = this.ctx;
    const x = t.x, y = t.y;
    ctx.save();
    // base plate
    ctx.fillStyle = "rgba(18,28,54,0.95)";
    ctx.strokeStyle = "rgba(70,95,160,0.8)";
    roundRect(ctx, x - 19, y - 19, 38, 38, 7);
    ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
    // tier pips
    for (let i = 0; i <= t.tier; i++) {
      ctx.fillStyle = "#ffd94d";
      ctx.fillRect(x - 15 + i * 7, y + 12, 5, 3);
    }

    switch (t.key) {
      case "laser": {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t.target ? t.face : t.pulse * 0.3);
        ctx.fillStyle = "#173a5c";
        roundRect(ctx, -6, -6, 12, 12, 3); ctx.fill();
        ctx.fillStyle = "#4de1ff";
        ctx.fillRect(2, -2.5, 14, 5);
        ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, 7); ctx.fill();
        ctx.fillStyle = "#dff8ff";
        ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case "prism": {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t.pulse * 0.8);
        const glow = t.active ? 1 : 0.35;
        ctx.globalAlpha = 0.25 * glow;
        ctx.fillStyle = "#ff5cf0";
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = t.active ? "#ff5cf0" : "#7c4d86";
        diamond(ctx, 0, 0, 10);
        ctx.fill();
        ctx.fillStyle = "#ffd7fb";
        diamond(ctx, 0, 0, 4.5);
        ctx.fill();
        ctx.restore();
        break;
      }
      case "extractor": {
        ctx.save();
        ctx.translate(x, y);
        const p = 0.5 + 0.5 * Math.sin(t.pulse * 3);
        ctx.strokeStyle = t.rich ? "#ffb340" : "#ffd94d";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-9, 9); ctx.lineTo(0, -9 - p * 3); ctx.lineTo(9, 9); ctx.stroke();
        ctx.fillStyle = t.rich ? "#ffb340" : "#ffd94d";
        ctx.beginPath(); ctx.arc(0, -9 - p * 3, 3.4 + p, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case "pylon": {
        ctx.save();
        ctx.translate(x, y);
        const p = 0.5 + 0.5 * Math.sin(t.pulse * 2.4);
        ctx.strokeStyle = t.active !== false ? "#7dff9a" : "#3d6b4a";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(0, -2); ctx.lineTo(8, 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -12); ctx.stroke();
        ctx.fillStyle = "#7dff9a";
        ctx.globalAlpha = 0.5 + p * 0.5;
        ctx.beginPath(); ctx.arc(0, -13, 3.6, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case "wall": {
        ctx.save();
        ctx.translate(x, y);
        const hpPct = t.hp / t.maxHp;
        ctx.fillStyle = "#2b3450";
        roundRect(ctx, -16, -16, 32, 32, 4); ctx.fill();
        ctx.strokeStyle = "#55688f"; ctx.lineWidth = 2; ctx.stroke();
        // cracks by damage
        if (hpPct < 0.66) {
          ctx.strokeStyle = "#12172a"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-10, -12); ctx.lineTo(-2, 0); ctx.lineTo(-8, 10); ctx.stroke();
        }
        if (hpPct < 0.33) {
          ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(3, 2); ctx.lineTo(11, 12); ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "frost": {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t.pulse * 0.5);
        ctx.strokeStyle = "#8fd0ff"; ctx.lineWidth = 2.4;
        for (let i = 0; i < 3; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(6, -4); ctx.lineTo(11, 0); ctx.lineTo(6, 4); ctx.stroke();
        }
        ctx.fillStyle = "#dff2ff";
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case "mortar": {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t.face);
        ctx.fillStyle = "#4a2f16";
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill();
        ctx.fillStyle = "#ff9a4d";
        roundRect(ctx, 0, -4, 16, 8, 3); ctx.fill();
        ctx.fillStyle = "#ffd7a4";
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
    }

    // hp bar when damaged
    if (t.hp < t.maxHp) {
      const hpPct = t.hp / t.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 15, y - 26, 30, 4);
      ctx.fillStyle = hpPct > 0.4 ? "#7dff9a" : "#ff6b57";
      ctx.fillRect(x - 15, y - 26, 30 * hpPct, 4);
    }
    ctx.restore();
  },

  drawPrismBeams(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const t of game.towerList) {
      if (t.key !== "prism" || !t.linkTo || t.linkTo.dead) continue;
      const active = t.active;
      const x1 = t.x, y1 = t.y, x2 = t.linkTo.x, y2 = t.linkTo.y;
      const col = active ? "255,92,240" : "120,77,134";
      ctx.strokeStyle = `rgba(${col},${active ? 0.5 : 0.25})`;
      ctx.lineWidth = active ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // flowing energy dots
      if (active) {
        const d = U.dist(x1, y1, x2, y2);
        const n = Math.max(2, Math.floor(d / 26));
        const phase = (game.time * 2.4) % 1;
        ctx.fillStyle = "rgba(255,182,248,0.9)";
        for (let i = 0; i < n; i++) {
          const k = ((i + phase) % n) / n;
          const px = U.lerp(x1, x2, k), py = U.lerp(y1, y2, k);
          ctx.beginPath(); ctx.arc(px, py, 2.4, 0, 7); ctx.fill();
        }
      }
    }
    ctx.restore();
  },

  drawLaserBeams(game) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const t of game.towerList) {
      if (t.key !== "laser" || !t.target || t.target.dead || t.beamHeat <= 0.05) continue;
      const pierce = t.pierce;
      const range = t.effRange * CELL;
      const x1 = t.x, y1 = t.y;
      let x2 = t.target.x, y2 = t.target.y;
      if (pierce) { x2 = x1 + Math.cos(t.face) * range; y2 = y1 + Math.sin(t.face) * range; }
      const boost = t.boost;
      // boosted lasers shift cyan → white-hot → magenta superbeam
      const w = 2 + Math.min(6, boost.n * 1.4) + t.beamHeat * 2;
      const col = pierce ? "255,120,255" : boost.n > 0 ? "150,220,255" : "77,225,255";
      // outer glow
      ctx.strokeStyle = `rgba(${col},${0.16 + t.beamHeat * 0.12})`;
      ctx.lineWidth = w * 3.2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // mid
      ctx.strokeStyle = `rgba(${col},0.55)`;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // hot core
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // muzzle flash
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(x1, y1, 3 + t.beamHeat * 2.5, 0, 7); ctx.fill();
      if (!pierce) {
        ctx.fillStyle = `rgba(${col},0.5)`;
        ctx.beginPath(); ctx.arc(x2, y2, 4 + Math.sin(game.time * 22) * 1.4, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  },

  drawEnemy(game, e) {
    const ctx = this.ctx;
    const { x, y } = e;
    ctx.save();
    ctx.translate(x, y);
    const wob = Math.sin(game.time * 9 + e.wob) * 0.08;

    if (e.slowF > 0) {
      ctx.fillStyle = "rgba(140,210,255,0.22)";
      ctx.beginPath(); ctx.arc(0, 0, e.r + 5, 0, 7); ctx.fill();
    }

    const col = e.flash > 0 ? "#ffffff" : e.def.color;
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2;

    switch (e.key) {
      case "crawler":
        ctx.rotate((e.face || 0) + wob);
        ctx.beginPath(); ctx.ellipse(0, 0, e.r, e.r * 0.8, 0, 0, 7); ctx.fill(); ctx.stroke();
        break;
      case "runner":
        ctx.rotate(e.face || 0);
        ctx.beginPath(); ctx.moveTo(e.r, 0); ctx.lineTo(-e.r * 0.8, -e.r * 0.7);
        ctx.lineTo(-e.r * 0.4, 0); ctx.lineTo(-e.r * 0.8, e.r * 0.7);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case "swarmling":
        ctx.rotate(wob * 3);
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
        break;
      case "brute":
        ctx.rotate(wob);
        roundRect(ctx, -e.r, -e.r * 0.85, e.r * 2, e.r * 1.7, 6); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        roundRect(ctx, -e.r + 4, -4, e.r * 2 - 8, 8, 3); ctx.fill();
        break;
      case "shell":
        ctx.rotate(wob * 0.5);
        hexPath(ctx, 0, 0, e.r);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        hexPath(ctx, 0, 0, e.r * 0.55);
        ctx.stroke();
        break;
      case "destroyer":
        ctx.rotate(wob * 0.4);
        // spikes
        ctx.fillStyle = "#7a1f1f";
        for (let i = 0; i < 8; i++) {
          ctx.rotate(Math.PI / 4);
          ctx.beginPath(); ctx.moveTo(e.r - 3, -5); ctx.lineTo(e.r + 10, 0); ctx.lineTo(e.r - 3, 5);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffd94d";
        ctx.beginPath(); ctx.arc(0, 0, e.r * 0.4, 0, 7); ctx.fill();
        break;
    }

    // eyes
    if (e.key !== "destroyer") {
      ctx.fillStyle = "#0a0e1a";
      const a = e.face || 0;
      const ex = Math.cos(a) * e.r * 0.35, ey = Math.sin(a) * e.r * 0.35;
      ctx.beginPath(); ctx.arc(ex - Math.sin(a) * 4, ey + Math.cos(a) * 4, 2.2, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(ex + Math.sin(a) * 4, ey - Math.cos(a) * 4, 2.2, 0, 7); ctx.fill();
    }

    // hp bar
    if (e.hp < e.maxHp) {
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(-14, -e.r - 11, 28, 4);
      ctx.fillStyle = pct > 0.5 ? "#7dff9a" : pct > 0.25 ? "#ffd94d" : "#ff6b57";
      ctx.fillRect(-14, -e.r - 11, 28 * pct, 4);
    }
    ctx.restore();
    if (e.flash > 0) e.flash -= 1 / 60;
  },

  drawShells(game) {
    const ctx = this.ctx;
    ctx.save();
    for (const s of game.shells) {
      const p = s.pos();
      ctx.fillStyle = "#ffd7a4";
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,154,77,0.35)";
      ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, 7); ctx.fill();
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
    // placement ghost
    if (game.placing && game.hover.c >= 0) {
      const { c, r } = game.hover;
      const ok = game.canPlace(game.placing, c, r);
      const def = TOWERS[game.placing];
      const affordable = game.energy >= def.cost;
      const x = U.cx(c), y = U.cy(r);
      ctx.save();
      ctx.globalAlpha = 0.85;
      // range / network preview
      const t0 = def.tiers[0];
      if (game.placing === "laser" || game.placing === "mortar" || game.placing === "frost") {
        ctx.strokeStyle = def.color + "88";
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(x, y, (t0.range || 2) * CELL, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "pylon") {
        ctx.strokeStyle = "rgba(125,255,154,0.6)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(x, y, t0.range * CELL, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (game.placing === "prism") {
        ctx.strokeStyle = "rgba(255,92,240,0.6)";
        ctx.beginPath(); ctx.arc(x, y, LINK_RANGE * CELL, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = ok && affordable ? def.color + "55" : "rgba(255,60,60,0.4)";
      ctx.strokeStyle = ok && affordable ? def.color : "#ff5c5c";
      roundRect(ctx, c * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6, 7);
      ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }

    // selected tower
    if (game.selected && !game.selected.dead) {
      const t = game.selected;
      ctx.save();
      ctx.strokeStyle = "#ffd94d";
      ctx.lineWidth = 2;
      roundRect(ctx, t.c * CELL + 2, t.r * CELL + 2, CELL - 4, CELL - 4, 7);
      ctx.stroke();
      if (t.key === "laser") {
        ctx.strokeStyle = "rgba(77,225,255,0.5)";
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(t.x, t.y, t.effRange * CELL, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (t.key === "prism" && t.linkTo) {
        ctx.strokeStyle = "rgba(255,92,240,0.8)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.linkTo.x, t.linkTo.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // link mode
    if (game.linkFrom) {
      const from = game.linkFrom;
      ctx.save();
      // pulse valid targets
      const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
      for (const t of game.towerList) {
        if (t === from || (t.key !== "laser" && t.key !== "prism")) continue;
        if (U.dist(from.c, from.r, t.c, t.r) > LINK_RANGE) continue;
        ctx.strokeStyle = `rgba(255,92,240,${0.3 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        roundRect(ctx, t.c * CELL + 3, t.r * CELL + 3, CELL - 6, CELL - 6, 7);
        ctx.stroke();
      }
      if (game.hover.c >= 0) {
        ctx.strokeStyle = "rgba(255,182,248,0.9)";
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(U.cx(game.hover.c), U.cy(game.hover.r));
        ctx.stroke();
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
