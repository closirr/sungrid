/* SUNGRID — bootstrap, game loop, states, test hooks (free-placement sim) */
"use strict";

const App = {
  state: "title",     // title | howto | game | pause | lose
  sim: null,
  paused: false,
  testMode: /[?&]test=1/.test(location.search),
  speed: 1,
  kills: 0,

  start() {
    Save.load();
    Snd.setMuted(!Save.data.sound);
    Renderer.init(document.getElementById("game"));
    UI.init(this);
    this.showScreen("title");
    window.addEventListener("resize", fitCanvas);
    fitCanvas();
    window.addEventListener("blur", () => {
      if (this.state === "game") this.togglePause();
    });
    this.last = performance.now();
    requestAnimationFrame(frame);
  },

  showScreen(name) {
    this.state = name;
    UI.showScreen(name);
  },

  startGame() {
    this.sim = new Sim();
    this.sim.onEvent = (type, payload) => this.onSimEvent(type, payload);
    this.speed = 1;
    this.kills = 0;
    UI.el["btn-speed"].textContent = "1×";
    UI.selectedUnit = null;
    Renderer.cam = { x: 0, y: 0, z: 2 };
    this.state = "game";
    UI.showScreen("game");
    UI.onGameStart(this.sim);
  },

  onSimEvent(type, payload) {
    if (!this.sim) return;
    if (type === "wave" && payload.count > 0) {
      UI.toast(`WAVE ${payload.wave} — ${payload.count} UFO${payload.count > 1 ? "s" : ""} incoming!`);
      Snd.horn();
    }
    if (type === "ufo_killed") { this.kills++; Snd.noise(0.1, 0.08, 1200); }
    // lose: every building (and WIP) gone
    const alive = this.sim.units.filter((u) => !u.dead &&
      (u instanceof Conduit || u instanceof SolarPanel || u instanceof Harvester || u instanceof Laser || u instanceof BuildingWIP)).length;
    if (alive === 0 && this.state === "game" && this.sim.time > 3) {
      Snd.lose();
      UI.showLose(this.sim, this.kills);
    }
  },

  quitToMenu() {
    this.sim = null;
    this.showScreen("title");
  },

  togglePause() {
    if (!this.sim || (this.state !== "game" && this.state !== "pause")) return;
    if (this.state === "game") this.showScreen("pause");
    else { this.state = "game"; UI.showScreen("game"); }
  },

  toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    UI.toggleSpeedLabel(this.speed);
  },

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.getElementById("app").requestFullscreen) {
      document.getElementById("app").requestFullscreen();
    }
  },
};

function fitCanvas() {
  const scale = Math.min(window.innerWidth / CFG.W, window.innerHeight / CFG.H);
  const cv = Renderer.canvas;
  cv.style.width = CFG.W * scale + "px";
  cv.style.height = CFG.H * scale + "px";
}

let lastT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000 || 0, 0.05);
  lastT = now;

  const inGame = App.state === "game" || App.state === "pause" || App.state === "lose";
  if (App.state === "game" && App.sim && !App.paused && !App.testMode) {
    for (let i = 0; i < App.speed; i++) App.sim.update(dt);
    UI.updateHUD(App.sim);
  }
  Renderer.render(App.sim, inGame ? "game" : "menu");
}

/* ---------- test / tooling hooks (deterministic stepping) ---------- */
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  if (App.sim && App.state === "game" && !App.paused) {
    for (let i = 0; i < steps; i++) App.sim.update(1 / 60);
    UI.updateHUD(App.sim);
  }
};

window.render_game_to_text = () => {
  const s = App.sim;
  if (!s) return JSON.stringify({ mode: App.state, note: "no active game" });
  return JSON.stringify({
    mode: App.state,
    game: "survival",
    time: +s.time.toFixed(1),
    wave: s.wave,
    resources: s.resources,
    kills: App.kills,
    buildings: s.units.filter((u) => !u.dead && ["conduit", "solar", "harvester", "laser", "wip"].includes(u.kind)).map((u) => ({
      kind: u.kind, x: Math.round(u.x), y: Math.round(u.y),
      charges: u.charges !== undefined ? u.charges : undefined,
      heat: u.heat !== undefined ? Math.round(u.heat) : undefined,
      remaining: u.remaining !== undefined ? u.remaining : undefined,
      linked: u.linkedConduit ? "conduit" : (u.linkedLaser ? "laser" : undefined),
    })),
    units: s.units.filter((u) => !u.dead && (u.isAlien || u instanceof Mineral)).length,
    packets: s.units.filter((u) => u instanceof EnergyPacket && !u.dead).length,
    note: "free placement world, px coords around origin (0,0)",
  });
};

App.start();
window.SG = { App, UI, Save, Snd, SIM_DEFS, HS, Sim, Renderer, ISO, CFG };
