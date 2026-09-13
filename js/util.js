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
  angleTo: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
  // cell center in px
  cx: (c) => (c + 0.5) * CELL,
  cy: (r) => (r + 0.5) * CELL,
  cellAt: (px) => Math.floor(px / CELL),
};
