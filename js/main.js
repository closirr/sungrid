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
    this.engine.OnUnitDestroyed = (u) => {
      if (u instanceof UnitBuildingWIP && u._finishing) return; // construction COMPLETED — not a loss (audit: it broke the star rating)
      if (u instanceof UnitAlienUfo) this.kills++; // the HUD kill counter finally counts
      if (IsBuildingUnit(u)) this.buildingsLost++; // star rating
    };
    this.engine.OnWaveSpawned = (wave, spawns) => {
      if (this.state !== "game") return;
      const cfg = this.engine.LevelConfig;
      const cruisers = spawns.filter((s) => s instanceof UnitAlienCruiser).length;
      const isBoss = cfg && cfg.bossEvery > 0 && wave > 0 && wave % cfg.bossEvery === 0;
      const note = isBoss ? "BOSS RAID — heavy cruisers!"
        : cruisers ? "HEAVY CRUISERS INBOUND"
        : spawns.every((s) => s instanceof UnitAlienScout) ? "SCOUTS INBOUND" : "HOSTILES INBOUND";
      Snd.horn(); // raid horn (audio wiring)
      UI.announceWave(wave + 1, note); // 1-based like the HUD (audit: banner said 2, HUD said 3)
      UI.hintRaid(); // progressive tutorial: the raid step
      for (const s of spawns) this.engine.AddWaveMarker(s.Position); // purple pulses on the spawn edge
    };
    this.engine.OnSfx = (unit, sfx) => {
      if (sfx === "explosion_big") Snd.boom(true);
      else if (sfx === "explosion_small") Snd.boom(false);
      else if (sfx === "hit") Snd.noise(0.06, 0.05, 1600);
      else if (sfx === "energy_packet_explode") Snd.noise(0.05, 0.04, 2400);
      else if (sfx === "overcharge") Snd.overcharge(); // conduit crossed into the hot zone (self-throttled)
      else if (sfx === "burnout") Snd.burnout(); // overload is destroying packets (self-throttled)
    };
    this.last = performance.now();
    requestAnimationFrame(frame);
  },

  showScreen(name) {
    this.state = name;
    UI.showScreen(name);
  },

  newGame() { this.startLevel(0); },

  startLevel(idx) {
    const lvl = LEVELS[idx];
    if (!lvl) return;
    Snd.init(); Snd.resume(); Snd.click();
    this.currentLevel = idx;
    this.engine.IsGameOver = false;
    HSMap.Load(this.engine, "test", lvl); // per-level mineral density
    // ClearGameState resets LevelConfig — set it AFTER
    this.engine.LevelConfig = lvl;
    if (lvl.firstRaidAt) this.engine.NextWaveSpawnTime = lvl.firstRaidAt;
    this.engine.IsGameRunning = true;
    this.engine.PauseGame(false);
    // reset the camera the renderer ACTUALLY reads (audit: startLevel reset a decoy
    // engine.Camera object, so restart kept the drifted position/zoom)
    Renderer.cam = { target: { x: 0, y: 0 }, offset: { x: CFG.W / 2, y: CFG.H / 2 }, zoom: 2 };
    UI._camKeys.clear(); // a key held in a menu must not pan the new game
    this.kills = 0;
    this.buildingsLost = 0;
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
    // defeat FIRST: with no base standing there is nothing to win — the old order let
    // "no enemies + no buildings" fire the victory check (audit)
    const alive = this.engine.GetAllGameUnitsArray().filter((u) => !u.Destroyed && IsBuildingUnit(u)).length;
    if (alive === 0) {
      this.engine.IsGameOver = true;
      this.engine.PauseGame(true); // freeze the sim on the outcome screen (audit: time kept flowing)
      Snd.lose();
      const lvl = LEVELS[this.currentLevel || 0];
      if (lvl && lvl.endless) Save.setEndlessBest(this.engine.CurWave); // the record survives defeat
      UI.showLose(this.engine);
      this.state = "lose";
      return;
    }
    if (this.engine.WinCheck()) this.win();
  },

  win() {
    const idx = this.currentLevel || 0;
    const lvl = LEVELS[idx];
    const stars = this.buildingsLost === 0 ? 3 : this.buildingsLost <= 2 ? 2 : 1;
    Save.completeLevel(idx, stars, LEVELS.length);
    if (lvl.endless) Save.setEndlessBest(this.engine.CurWave);
    this.engine.PauseGame(true); // freeze the sim behind the victory screen (audit: waves kept coming)
    Snd.win ? Snd.win() : Snd.click();
    this.state = "win";
    UI.showWin(this.engine, {
      level: lvl, idx, stars, kills: this.kills, buildingsLost: this.buildingsLost,
      hasNext: idx + 1 < LEVELS.length && !lvl.endless,
    });
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
  // Native-resolution rendering (mirror of the reference: window is resizable,
  // camera offset = screen/2). No more 1280x720 buffer stretched over 1080p+.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  CFG.W = w;
  CFG.H = h;
  Renderer.canvas.style.width = w + "px";
  Renderer.canvas.style.height = h + "px";
  Renderer.canvas.width = Math.round(w * dpr);
  Renderer.canvas.height = Math.round(h * dpr);
  Renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Renderer.cam.offset = { x: w / 2, y: h / 2 };
  if (window.UI && UI.checkOrientation) UI.checkOrientation();
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
    ufos: e.GetAllGameUnitsArray().filter((u) => u instanceof UnitAlienUfo && !u.Destroyed).map((u) => ({
      name: u.Name, x: Math.round(u.Position.x), y: Math.round(u.Position.y), hp: Math.round(u.Health),
    })),
    packets: e.GetAllGameUnitsArray().filter((u) => u instanceof UnitEnergyPacket && !u.Destroyed).length,
    note: "free placement world, px coords around origin (0,0)",
  });
};

// top-level `const` bindings are not window properties; the engine (hsgame.js) calls
// UI.UpdateInput / reads App.paused through window — publish them BEFORE the game starts.
window.App = App;
window.UI = UI;
App.start();
window.SG = { App, UI, Save, Snd, HSEngine, HSMap, HSUtils, HS_TEX, LEVELS, UnitConduit, UnitSolarPanel, UnitHarvester, UnitLaser, UnitMineral, UnitBuildingWIP, UnitEnergyPacket, UnitAlienUfo, UnitAlienScout, UnitAlienCruiser, Renderer, CFG, HSManualLink, HSPotentialDamage, HSPotentialRange, HSAutoLinkPreview, HSGameToolConduit, HSGameToolHarvester, HSGameToolSolarPanel, HSGameToolLaser, HSFootprintWidth, HSBuildSnap, HSFootprintsOverlap, HSWaveEnemy };
