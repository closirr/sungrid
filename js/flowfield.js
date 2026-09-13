/* SUNGRID — flow field pathfinding (BFS from core, 8-dir with corner safety) */
"use strict";

class FlowField {
  constructor() {
    this.dist = new Int16Array(CFG.COLS * CFG.ROWS);
  }

  /* walkable(cellIdx) -> boolean; core cell = {c,r} */
  compute(core, walkable) {
    const { COLS, ROWS } = CFG;
    this.dist.fill(-1);
    const q = [];
    const ci = core.r * COLS + core.c;
    if (!walkable(ci)) return;
    this.dist[ci] = 0;
    q.push(ci);
    for (let head = 0; head < q.length; head++) {
      const idx = q[head];
      const d = this.dist[idx];
      const c = idx % COLS, r = (idx / COLS) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          const nIdx = nr * COLS + nc;
          if (this.dist[nIdx] !== -1 || !walkable(nIdx)) continue;
          // no corner cutting: diagonal move requires both orthogonals open
          if (dc && dr) {
            if (!walkable(r * COLS + nc) || !walkable(nr * COLS + c)) continue;
          }
          this.dist[nIdx] = d + 1;
          q.push(nIdx);
        }
      }
    }
  }

  at(c, r) {
    if (c < 0 || r < 0 || c >= CFG.COLS || r >= CFG.ROWS) return -1;
    return this.dist[r * CFG.COLS + c];
  }
}
