/* SUNGRID — isometric math: projection, picking, painter sort, iso primitives */
"use strict";

const ISO = {
  TW: 64, TH: 32,          // 2:1 tile
  LIFT: 24,                // px per height unit "h"

  /* world-space origin: the map is drawn onto a full-map static canvas,
   * its horizontal center is (COLS+ROWS)*TW/4 and tiles start 110px down */
  OX() { return (CFG.COLS + CFG.ROWS) * (this.TW / 4); },
  OY() { return 110; },

  /* grid (c, r, h) → screen px of the tile CENTER at height h */
  px(c, r, h = 0) {
    return {
      x: (c - r) * (this.TW / 2) + this.OX(),
      y: (c + r) * (this.TH / 2) + this.OY() - h * this.LIFT,
    };
  },

  /* screen px → grid cell (base height) */
  pick(sx, sy) {
    const dx = sx - this.OX(), dy = sy - this.OY();
    return {
      c: Math.floor((dx / (this.TW / 2) + dy / (this.TH / 2)) / 2),
      r: Math.floor((dy / (this.TH / 2) - dx / (this.TW / 2)) / 2),
    };
  },

  /* screen-space direction vector of a grid-space vector */
  dir(dc, dr) {
    return { x: (dc - dr) * (this.TW / 2), y: (dc + dr) * (this.TH / 2) };
  },

  /* painter's algorithm sort key */
  key(c, r, h = 0) { return c + r + h; },

  /* a grid-space circle of radius R draws as an axis-aligned 2:1 ellipse */
  ellipse(ctx, cx, cy, R) {
    ctx.ellipse(cx, cy, R * (this.TW / 2) * Math.SQRT2, R * (this.TH / 2) * Math.SQRT2, 0, 0, Math.PI * 2);
  },

  /* flat tile diamond centered at (cx, cy) */
  diamond(ctx, cx, cy, w = this.TW, h = this.TH) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
  },

  /*
   * Extruded iso box sitting on the tile centered at (cx, cy).
   * s   — footprint scale 0..1 (fraction of the tile)
   * hPx — height in px (use h*ISO.LIFT for "floors")
   * top/left/right — fill colors (light hits from the upper-left convention)
   */
  prism(ctx, cx, cy, s, hPx, top, left, right, stroke) {
    const wx = (this.TW / 2) * s, wy = (this.TH / 2) * s;
    const yT = cy - hPx;
    // right face (S→E)
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(cx, yT + wy); ctx.lineTo(cx + wx, yT);
    ctx.lineTo(cx + wx, cy); ctx.lineTo(cx, cy + wy);
    ctx.closePath(); ctx.fill();
    // left face (W→S)
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(cx - wx, yT); ctx.lineTo(cx, yT + wy);
    ctx.lineTo(cx, cy + wy); ctx.lineTo(cx - wx, cy);
    ctx.closePath(); ctx.fill();
    // top
    ctx.fillStyle = top;
    this.diamond(ctx, cx, yT, this.TW * s, this.TH * s);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - wx, yT); ctx.lineTo(cx, yT + wy); ctx.lineTo(cx + wx, yT);
      ctx.moveTo(cx - wx, yT); ctx.lineTo(cx - wx, cy); ctx.lineTo(cx, cy + wy);
      ctx.lineTo(cx + wx, cy); ctx.lineTo(cx + wx, yT);
      ctx.moveTo(cx, yT + wy); ctx.lineTo(cx, cy + wy);
      ctx.stroke();
    }
  },
};
