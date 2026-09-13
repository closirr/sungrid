/* SUNGRID — bootstrap, game loop, states, test hooks */
"use strict";

const App = {
  state: "title",     // title | howto | select | game | pause | win | lose
  game: null,
  paused: false,
  testMode: /[?&]test=1/.test(location.search),

  start() {
    Save.load();
    Snd.setMuted(!Save.data.sound);
    Renderer.init(document.getElementById("game"));
    UI.init(this);
    UI.buildPalette();
    UI.el["btn-sound"].textContent = Save.data.sound ? "♪" : "✕";
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

  startLevel(idx) {
    this.game = new Game(idx);
    this.game.onWin = () => { UI.updateHUD(this.game); UI.showWin(this.game); };
    this.game.onLose = () => { UI.updateHUD(this.game); UI.showLose(this.game); };
    this.state = "game";
    UI.onLevelStart(this.game);
    UI.updateHUD(this.game);
  },

  quitToMenu() {
    this.game = null;
    Snd.laser(0);
    this.showScreen("title");
  },

  togglePause() {
    if (!this.game || (this.state !== "game" && this.state !== "pause")) return;
    if (this.state === "game") this.showScreen("pause");
    else { this.state = "game"; UI.showScreen("game"); }
  },

  toggleSpeed() {
    if (!this.game) return;
    this.game.speed = this.game.speed === 1 ? 2 : 1;
    UI.toggleSpeedLabel(this.game.speed);
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

  const inGameScene = App.state === "game" || App.state === "pause" || App.state === "win" || App.state === "lose";
  if (App.state === "game" && App.game && !App.paused && !App.testMode) {
    for (let i = 0; i < App.game.speed; i++) App.game.update(dt);
    UI.updateHUD(App.game);
  }
  Renderer.render(App.game, inGameScene ? "game" : "menu");
}

/* ---------- test / tooling hooks (deterministic stepping) ---------- */
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  if (App.game && (App.state === "game") && !App.paused) {
    for (let i = 0; i < steps; i++) {
      for (let s = 0; s < App.game.speed; s++) App.game.update(1 / 60);
    }
    UI.updateHUD(App.game);
  }
  Renderer.render(App.game, App.state === "title" || App.state === "select" || App.state === "howto" ? "menu" : "game");
};

window.render_game_to_text = () => {
  const g = App.game;
  if (!g) return JSON.stringify({ mode: App.state, note: "no active game" });
  const es = g.energyStats();
  return JSON.stringify({
    mode: App.state,
    level: g.level.name,
    levelIdx: g.levelIdx,
    phase: g.state,
    wave: g.wave,
    wavesTotal: g.level.waves,
    credits: Math.floor(g.credits),
    income: +g.income().toFixed(1),
    energyGen: es.gen,
    energyDemand: es.demand,
    coreHp: g.coreHp,
    coreMax: g.coreMax,
    speed: g.speed,
    placing: g.placing,
    linking: !!g.linkFrom,
    hover: g.hover.c >= 0 ? { c: g.hover.c, r: g.hover.r } : null,
    selected: g.selected ? { type: g.selected.key, c: g.selected.c, r: g.selected.r, tier: g.selected.tier, built: +g.selected.built.toFixed(2), supply: +g.selected.supply.toFixed(2) } : null,
    buildings: g.towerList.map((t) => ({
      type: t.key, c: t.c, r: t.r, tier: t.tier,
      hp: Math.round(t.hp),
      built: +t.built.toFixed(2),
      supply: +t.supply.toFixed(2),
      heat: Math.round(t.heat),
      feedTo: t.key === "laser" && t.linkTo ? t.linkTo.c + "," + t.linkTo.r : undefined,
      feeders: t.key === "laser" && t.feeders.length ? t.feeders.length : undefined,
    })),
    enemyCount: g.enemies.length,
    kills: g.kills,
    flowEdges: g.flowEdges.map((e) => ({ a: e.a.c + "," + e.a.r, b: e.b.c + "," + e.b.r, flow: +e.flow.toFixed(1), heat: Math.round(e.heat) })),
    note: "coords are grid cells (0..19 x, 0..19 y), origin top-left, iso projection",
  });
};

App.start();
window.SG = { App, UI, Save, Snd, TOWERS, ENEMIES, LEVELS, ENDLESS, Game, CFG, ISO, Bot };

// deep link for tests/sharing: ?level=N starts a level immediately
(() => {
  const qp = new URLSearchParams(location.search);
  if (qp.has("level")) {
    const n = parseInt(qp.get("level"), 10);
    App.startLevel(Number.isFinite(n) ? n : 0);
  }
})();
