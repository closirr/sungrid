/* SUNGRID — save/progress (localStorage) */
"use strict";
const Save = {
  KEY: "sungrid-save-v1",
  data: { unlocked: 1, stars: {}, endlessBest: 0, waveBest: { medal: 0, time: null }, sound: true, seenHowto: false, hintsSeen: false },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const d = JSON.parse(raw);
        Object.assign(this.data, d);
      }
    } catch (e) { /* corrupted save — keep defaults */ }
    // normalize (audit: a corrupted field like `stars: null` threw in starsFor and
    // blanked the whole title level grid)
    if (!this.data.stars || typeof this.data.stars !== "object") this.data.stars = {};
    if (!Number.isFinite(this.data.unlocked)) this.data.unlocked = 1;
    if (!Number.isFinite(this.data.endlessBest)) this.data.endlessBest = 0;
    if (typeof this.data.sound !== "boolean") this.data.sound = true;
    if (typeof this.data.hintsSeen !== "boolean") this.data.hintsSeen = false;
    return this.data;
  },

  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* private mode */ }
  },

  starsFor(levelIdx) { return this.data.stars[levelIdx] || 0; },

  completeLevel(levelIdx, stars, totalLevels) {
    const prev = this.starsFor(levelIdx);
    if (stars > prev) { this.data.stars[levelIdx] = stars; }
    const next = levelIdx + 2; // levelIdx is 0-based; unlocked counts levels available
    if (levelIdx + 1 < totalLevels && this.data.unlocked < next) {
      this.data.unlocked = next;
    }
    this.save();
  },

  setEndlessBest(w) {
    if (w > this.data.endlessBest) { this.data.endlessBest = w; this.save(); }
  },

  setWaveBest(medal, time) {
    const wb = this.data.waveBest || (this.data.waveBest = { medal: 0, time: null });
    if (medal > wb.medal || (medal === wb.medal && (wb.time === null || time < wb.time))) {
      wb.medal = medal;
      wb.time = time;
      this.save();
    }
  },

  totalStars(totalLevels) {
    let s = 0;
    for (let i = 0; i < totalLevels; i++) s += this.starsFor(i);
    return s;
  },
};
