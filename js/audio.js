/* SUNGRID — procedural WebAudio sfx (no external assets) */
"use strict";
const Snd = {
  ctx: null, master: null, laserOsc: null, laserGain: null, atomsGain: null, enabled: true,
  _ocT: 0, // last overcharge ring time (throttle)

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // continuous laser hum, silent until beams are active
      this.laserGain = this.ctx.createGain();
      this.laserGain.gain.value = 0;
      const o = this.ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = 92;
      const o2 = this.ctx.createOscillator();
      o2.type = "sine"; o2.frequency.value = 184;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 500;
      o.connect(f); o2.connect(f); f.connect(this.laserGain);
      this.laserGain.connect(this.master);
      o.start(); o2.start();
      this.laserOsc = o;
      // separate energy-flow hum (atoms), silent until Snd.atoms(level) — does not touch laserGain
      this.atomsGain = this.ctx.createGain();
      this.atomsGain.gain.value = 0;
      const a1 = this.ctx.createOscillator();
      a1.type = "sine"; a1.frequency.value = 55;
      const a2 = this.ctx.createOscillator();
      a2.type = "sine"; a2.frequency.value = 110.6; // slight detune -> slow shimmer
      const af = this.ctx.createBiquadFilter();
      af.type = "lowpass"; af.frequency.value = 260;
      a1.connect(af); a2.connect(af); af.connect(this.atomsGain);
      this.atomsGain.connect(this.master);
      a1.start(); a2.start();
    } catch (e) { this.ctx = null; }
  },

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },

  // intensity 0..1 — how many lasers are firing
  laser(intensity) {
    if (!this.ctx || !this.laserGain) return;
    const target = this.enabled ? intensity * 0.075 : 0;
    this.laserGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  },

  // level 0..1 — very quiet background hum of energy flowing through links
  atoms(level) {
    if (!this.ctx || !this.atomsGain) return;
    const target = this.enabled ? Math.min(1, Math.max(0, level || 0)) * 0.03 : 0;
    this.atomsGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  },

  // internal: tone scheduled at absolute ctx time
  _toneAt(freq, dur, type, vol, when, slide) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), when + dur);
    g.gain.setValueAtTime(vol || 0.12, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.master);
    o.start(when); o.stop(when + dur + 0.02);
  },

  // internal: shaped noise burst scheduled at absolute ctx time (filter freq sweeps f0->f1)
  _noiseAt(dur, vol, ftype, f0, f1, when) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = ftype;
    f.frequency.setValueAtTime(f0, when);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), when + dur);
    const g = this.ctx.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(when);
  },

  tone(freq, dur, type, vol, slide) {
    if (!this.ctx || !this.enabled) return;
    this._toneAt(freq, dur, type, vol, this.ctx.currentTime, slide);
  },

  noise(dur, vol, freq) {
    if (!this.ctx || !this.enabled) return;
    this._noiseAt(dur, vol || 0.2, "lowpass", freq || 900, 0, this.ctx.currentTime);
  },

  // overheating link: alarmed metallic ring — high sine ping + inharmonic bell overtone (throttled to 1.2s)
  overcharge() {
    if (!this.ctx || !this.enabled) return;
    const now = Date.now();
    if (now - this._ocT < 1200) return;
    this._ocT = now;
    const t = this.ctx.currentTime;
    this._toneAt(1320, 0.45, "sine", 0.22, t);        // main strike, fast decay
    this._toneAt(3420, 0.25, "sine", 0.06, t);        // light inharmonic bell overtone
    this._toneAt(880, 0.3, "triangle", 0.04, t);      // alarm body
  },

  // link burnout: deep low boom + saw-spark crackle cascading down + dying muffled sizzle
  burnout() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._noiseAt(0.5, 0.3, "lowpass", 300, 0, t);    // heavy burnout thump
    [1900, 1400, 950, 620].forEach((f, i) =>          // electric crackle, pitch falls
      this._toneAt(f, 0.05, "sawtooth", 0.07, t + i * 0.045, f * 0.4));
    this._noiseAt(0.45, 0.06, "highpass", 2400, 0, t + 0.06); // fading "pshh"
  },

  // missile launch: short bandpass hiss sweeping down + quiet tone body
  missile() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._noiseAt(0.28, 0.14, "bandpass", 2600, 500, t);
    this._toneAt(720, 0.18, "sine", 0.05, t, 180);
  },

  // single electric discharge: bright saw crack + highpass spark dust (sapper / small fx)
  zap() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._toneAt(2400, 0.07, "sawtooth", 0.09, t, 300);
    this._noiseAt(0.08, 0.07, "highpass", 3000, 0, t);
  },

  click()   { this.tone(660, 0.05, "square", 0.06); },
  place()   { this.tone(300, 0.09, "triangle", 0.14, 420); this.tone(150, 0.12, "sine", 0.1); },
  sell()    { this.tone(420, 0.1, "triangle", 0.1, 220); },
  upgrade() { this.tone(440, 0.08, "square", 0.09); setTimeout(() => this.tone(660, 0.1, "square", 0.09), 70); setTimeout(() => this.tone(880, 0.12, "square", 0.09), 140); },
  boost()   { this.tone(520, 0.16, "sine", 0.12, 1040); },
  error()   { this.tone(160, 0.12, "sawtooth", 0.1, 110); },
  boom(big) { this.noise(big ? 0.5 : 0.22, big ? 0.34 : 0.2, big ? 500 : 1000); },
  coreHit() { this.noise(0.35, 0.3, 320); this.tone(90, 0.3, "sawtooth", 0.22, 50); },
  horn()    { this.tone(196, 0.22, "sawtooth", 0.1); setTimeout(() => this.tone(147, 0.3, "sawtooth", 0.11), 180); },
  win()     { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.13), i * 130)); },
  lose()    { [392, 311, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, "sawtooth", 0.12), i * 160)); },
};
