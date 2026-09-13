/* SUNGRID — procedural WebAudio sfx (no external assets) */
"use strict";
const Snd = {
  ctx: null, master: null, laserOsc: null, laserGain: null, enabled: true,

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

  tone(freq, dur, type, vol, slide) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol, freq) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = freq || 900;
    const g = this.ctx.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
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
