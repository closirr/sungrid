/* SUNGRID — bootstrap mirroring Program.cs: lockstep loop at 1/60, world/screen draw states. */
"use strict";

const CFG = { W: 1280, H: 720 };

const App = {
  state: "title",   // title | howto | game | lose
  engine: HSEngine,
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
    window.addEventListener("blur", () => { if (this.state === "game") this.togglePause(); });
    this.engine.OnLoseCheck = () => this.checkLose();
    this.engine.OnSfx = (unit, sfx) => {
      if (sfx === "explosion_big") Snd.boom(true);
      else if (sfx === "explosion_small") Snd.boom(false);
      else if (sfx === "hit") Snd.noise(0.06, 0.05, 1600);
      else if (sfx === "energy_packet_explode") Snd.noise(0.05, 0.04, 2400);
    };
    this.last = performance.now();
    requestAnimationFrame(frame);
  },

  showScreen(name) {
    this.state = name;
    UI.showScreen(name);
  },

  newGame() {
    Snd.init(); Snd.resume(); Snd.click();
    HSMap.Load(this.engine, "test");
    this.engine.IsGameRunning = true;
    this.engine.PauseGame(false);
    this.engine.Camera = { target: { x: 0, y: 0 }, offset: { x: CFG.W / 2, y: CFG.H / 2 }, zoom: 2 };
    this.kills = 0;
    this.speed = 1;
    UI.el["btn-speed"].textContent = "1×";
    this.state = "game";
    UI.showScreen("game");
    UI.onGameStart(this.engine);
  },

  continueGame() {
    this.engine.PauseGame(false);
    this.state = "game";
    UI.showScreen("game");
    UI.onGameStart(this.engine);
  },

  checkLose() {
    if (this.state !== "game" || this.engine.Time < 5) return;
    this._loseT = (this._loseT || 0) + 1;
    if (this._loseT % 30 !== 0) return;
    const alive = this.engine.GetAllGameUnitsArray().filter((u) =>
      !u.Destroyed && (u instanceof UnitConduit || u instanceof UnitSolarPanel || u instanceof UnitHarvester || u instanceof UnitLaser || u instanceof UnitBuildingWIP)).length;
    if (alive === 0) {
      Snd.lose();
      UI.showLose(this.engine);
    }
  },

  quitToMenu() {
    this.engine.PauseGame(true); // PreserveCamera-style continue
    this.showScreen("title");
    // CONTINUE is offered only while a base still stands (a lost game has nothing to resume)
    const alive = this.engine.GetAllGameUnitsArray(true).filter((u) =>
      !u.Destroyed && (u instanceof UnitConduit || u instanceof UnitSolarPanel || u instanceof UnitHarvester || u instanceof UnitLaser || u instanceof UnitBuildingWIP)).length;
    UI.el["btn-continue"].classList.toggle("hidden", !this.engine.IsGameRunning || alive === 0);
  },

  togglePause() {
    if (this.state !== "game" && this.state !== "pause") return;
    if (this.state === "game") { this.engine.PauseGame(true); this.showScreen("pause"); }
    else { this.engine.PauseGame(false); this.showScreen("game"); }
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
  Renderer.canvas.style.width = CFG.W * scale + "px";
  Renderer.canvas.style.height = CFG.H * scale + "px";
  Renderer.cam.offset = { x: CFG.W / 2, y: CFG.H / 2 };
}

let lastT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000 || 0, 0.05);
  lastT = now;

  const engine = App.engine;
  for (let i = 0; i < App.speed; i++) engine.TickTimer(dt);
  engine.Lockstep(1 / 60, 1 / 10);

  const inGame = App.state === "game";
  if (inGame) UI.updateHUD(engine);
  Renderer.render(engine, inGame ? "game" : "menu");
}

/* ---------- test / tooling hooks (deterministic stepping) ---------- */
window.advanceTime = (ms) => {
  const engine = App.engine;
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i++) {
    engine._timerElapsed += 1 / 60;
    engine.Update(1 / 60, false);
    engine.SimulatedSteps++;
  }
  if (App.state === "game") UI.updateHUD(engine);
};

window.render_game_to_text = () => {
  const e = App.engine;
  if (App.state !== "game") return JSON.stringify({ mode: App.state, note: "no active game" });
  return JSON.stringify({
    mode: App.state,
    game: "harvesturr-port",
    time: +e.Time.toFixed(1),
    wave: e.CurWave,
    resources: e.Resources,
    kills: App.kills,
    buildings: e.GetAllGameUnitsArray().filter((u) => !u.Destroyed && ["conduit", "solarpanel", "harvester", "laser", "conduit_wip", "solarpanel_wip", "harvester_wip", "laser_wip"].includes(u.Name)).map((u) => ({
      name: u.Name, x: Math.round(u.Position.x), y: Math.round(u.Position.y),
      charges: u.EnergyCharges !== undefined ? u.EnergyCharges : undefined,
      heat: u.Heat !== undefined ? u.Heat : undefined,
      remaining: u.BuildCostRemaining !== undefined ? u.BuildCostRemaining : undefined,
      link: u.GetLinkedConduit ? "conduit" : (u.GetLinkedLaser ? "laser" : undefined),
    })),
    minerals: e.GetAllGameUnitsArray().filter((u) => u instanceof UnitMineral && !u.Destroyed).length,
    ufos: e.GetAllGameUnitsArray().filter((u) => u instanceof UnitAlienUfo && !u.Destroyed).length,
    packets: e.GetAllGameUnitsArray().filter((u) => u instanceof UnitEnergyPacket && !u.Destroyed).length,
    note: "free placement world, px coords around origin (0,0)",
  });
};

App.start();
window.SG = { App, UI, Save, Snd, HSEngine, HSMap, HSUtils, HS_TEX, UnitConduit, UnitSolarPanel, UnitHarvester, UnitLaser, UnitMineral, UnitBuildingWIP, UnitEnergyPacket, UnitAlienUfo, Renderer, CFG };
