/* SUNGRID — utils */
"use strict";
const U = {
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
  dist2: (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; },
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  fmt: (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)),
  angleTo: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - y1),
  inBounds: (c, r) => c >= 0 && r >= 0 && c < CFG.COLS && r < CFG.ROWS,
  idx: (c, r) => r * CFG.COLS + c,
  /* deterministic per-tile pseudo-random 0..1 (for static terrain variation) */
  hash2: (c, r) => {
    let h = (c * 73856093) ^ (r * 19349663);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  },
};
