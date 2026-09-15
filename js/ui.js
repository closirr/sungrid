/* SUNGRID — DOM UI + input for the free-placement sim (Harvesturr logic, our skin) */
"use strict";

const UI = {
  el: {},
  app: null,
  mouseWorld: null,
  hoverUnit: null,
  selectedUnit: null,
  _dragLink: null,     // { from } while drag-linking with the picker
  _camKeys: new Set(),

  init(app) {
    this.app = app;
    const ids = ["hud", "chip-resources", "resources-num", "chip-wave", "wave-num", "wave-state",
      "btn-speed", "btn-pause", "btn-sound", "btn-full",
      "palette", "unit-panel", "up-name", "up-stats", "up-buttons",
      "toasts", "rotate-hint",
      "screen-title", "btn-play", "btn-continue", "btn-howto", "btn-sound-title",
      "screen-howto",
      "screen-pause", "btn-resume", "btn-restart", "btn-sound-pause", "btn-quit",
      "screen-lose", "lose-sub", "btn-retry", "btn-lose-menu"];
    for (const id of ids) this.el[id] = document.getElementById(id);

    this.el["btn-play"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); app.newGame(); };
    this.el["btn-continue"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); app.continueGame(); };
    this.el["btn-howto"].onclick = () => { Snd.click(); app.showScreen("howto"); };
    this.el["btn-sound-title"].onclick = () => this.toggleSound();
    document.querySelectorAll(".back-btn").forEach((b) => { b.onclick = () => { Snd.click(); app.showScreen("title"); }; });
    this.el["btn-speed"].onclick = () => { app.toggleSpeed(); Snd.click(); };
    this.el["btn-pause"].onclick = () => { app.togglePause(); };
    this.el["btn-sound"].onclick = () => this.toggleSound();
    this.el["btn-full"].onclick = () => App.toggleFullscreen();
    this.el["btn-resume"].onclick = () => app.togglePause();
    this.el["btn-restart"].onclick = () => { Snd.click(); app.newGame(); };
    this.el["btn-sound-pause"].onclick = () => this.toggleSound();
    this.el["btn-quit"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-retry"].onclick = () => { Snd.click(); app.newGame(); };
    this.el["btn-lose-menu"].onclick = () => { Snd.click(); app.quitToMenu(); };

    const canvas = document.getElementById("game");
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.canvasPos(e);
      Renderer.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) => this._camKeys.delete(e.key));

    const unlock = () => { Snd.init(); Snd.resume(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("resize", () => this.checkOrientation());
    this.checkOrientation();
  },

  /* ---------- screens ---------- */
  showScreen(name) {
    const app = this.app;
    const overlays = ["screen-title", "screen-howto", "screen-pause", "screen-lose"];
    for (const id of overlays) this.el[id].classList.add("hidden");
    this.el.hud.classList.add("hidden");
    app.paused = false;

    if (name === "title") this.el["screen-title"].classList.remove("hidden");
    else if (name === "howto") this.el["screen-howto"].classList.remove("hidden");
    else if (name === "game") this.el.hud.classList.remove("hidden");
    else if (name === "pause") { this.el.hud.classList.remove("hidden"); this.el["screen-pause"].classList.remove("hidden"); app.paused = true; }
    else if (name === "lose") { this.el.hud.classList.remove("hidden"); this.el["screen-lose"].classList.remove("hidden"); }
  },

  /* ---------- palette (InGameState tool panel mirror) ---------- */
  buildTools(engine) {
    this.GameTools = [
      new HSGameToolPicker(),
      new HSGameToolConduit(),
      new HSGameToolHarvester(),
      new HSGameToolSolarPanel(),
      new HSGameToolLaser(),
    ];
    const costs = { "Select / Link": "·", Conduit: 5, Harvester: 8, "Solar Panel": 10, Laser: 10 };
    const pal = this.el.palette;
    pal.innerHTML = "";
    this.GameTools.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "pcard";
      card.dataset.idx = String(i);
      card.innerHTML = `
        <div class="pico" style="background:radial-gradient(circle at 50% 60%, ${t instanceof HSGameToolPicker ? "#b8860b" : "#3fa7d6"} 0 6px, transparent 7px)"></div>
        <div class="pname">${t.Name}</div>
        <div class="pcost">${costs[t.Name]}</div>
        <div class="pkey">[${i + 1}]</div>`;
      card.addEventListener("click", (e) => { e.stopPropagation(); Snd.click(); this.SelectTool(t); });
      pal.appendChild(card);
    });
    this.SelectTool(this.GameTools[0]);
  },

  SelectTool(t) {
    if (this.activeToolObj === t) return;
    for (const g of this.GameTools) g.Active = false;
    t.Active = true;
    t.OnSelected();
    this.activeToolObj = t;
    for (const card of this.el.palette.children) card.classList.toggle("selected", card.dataset.idx === String(this.GameTools.indexOf(t)));
  },

  /* ---------- per-tick tool input (engine calls this on every Update) ---------- */
  UpdateInput(engine, dt) {
    if (this.activeToolObj) this.activeToolObj.Update(engine, dt);
  },

  /* ---------- level start ---------- */
  onGameStart(engine) {
    this.showScreen("game");
    this.buildTools(engine);
    this.selectedUnit = null;
    this.hoverUnit = null;
    this.el["btn-speed"].textContent = "1×";
    this.toast("Drag conduit→conduit and laser→laser to link them. Defend your buildings!", 5000);
  },

  /* ---------- HUD ---------- */
  updateHUD(engine) {
    this.cameraTick();
    this.el["resources-num"].textContent = U.fmt(engine.Resources);
    this.el["wave-num"].textContent = "WAVE " + engine.CurWave;
    const next = Math.max(0, Math.ceil(engine.NextWaveSpawnTime - engine.Time));
    this.el["wave-state"].textContent = "next in " + next + "s";
    this.refreshUnitPanel(engine);
  },

  refreshUnitPanel(engine) {
    const panel = this.el["unit-panel"];
    const u = this.selectedUnit;
    if (!u || u.Destroyed) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const names = {
      conduit: "Conduit", solarpanel: "Solar Panel", harvester: "Harvester", laser: "Laser",
      conduit_wip: "Under Construction", solarpanel_wip: "Under Construction",
      harvester_wip: "Under Construction", laser_wip: "Under Construction",
      ufo: "UFO", mineral: "Minerals", megamineral: "Minerals",
    };
    this.el["up-name"].textContent = names[u.Name] || u.Name;
    let stats = "";
    if (u.Name === "laser") stats = `Charges ${u.EnergyCharges}/${u.MaxEnergyCharges}\nDamage ${u.AttackDamage} · Range ${Math.round(u.AttackRange)}` + (u.GetLinkedLaser ? "\nFeeding → laser" : "");
    else if (u.Name === "conduit") stats = `Heat ${u.Heat}/100`;
    else if (u.Name === "harvester") stats = `Charges ${u.EnergyCharges}\n+1 R$ per mineral`;
    else if (u.Name === "solarpanel") stats = "+1 packet / 2s";
    else if (u.Name.endsWith("_wip")) stats = `Needs ${u.BuildCostRemaining} more energy packets`;
    else if (u.Name === "ufo") stats = `HP ${Math.round(u.Health)}/${u.MaxHealth}`;
    else if (u.Name === "mineral" || u.Name === "megamineral") stats = `${u.MineralCount} minerals left`;
    this.el["up-stats"].textContent = stats.trim();
  },

  /* ---------- input ---------- */
  canvasPos(e) { return this.canvasPosFromClient(e.clientX, e.clientY); },
  canvasPosFromClient(cx, cy) {
    const rect = Renderer.canvas.getBoundingClientRect();
    return {
      x: (cx - rect.left) / rect.width * CFG.W,
      y: (cy - rect.top) / rect.height * CFG.H,
    };
  },

  pickUnit(e) {
    const sp = this.canvasPos(e);
    const w = Renderer.screenToWorld(sp.x, sp.y);
    this.mouseWorld = w;
    const engine = this.app.engine;
    if (!engine) return null;
    let best = null;
    for (const u of engine.GetAllGameUnitsArray(false)) { // Pickable filter inside; packets excluded
      if (u.Destroyed) continue;
      const r = u.GetBoundingRect();
      if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) best = u; // last match wins
    }
    return best;
  },

  onPointerMove(e) {
    if (this._panning) {
      Renderer.panBy(e.clientX - this._panLast.x, e.clientY - this._panLast.y);
      this._panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const engine = this.app.engine;
    if (!engine) return;
    this.updateMouse(engine, e); // track world mouse pos like the reference's per-frame GameEngine.Update
    this.hoverUnit = this.pickUnit(e);
    if (this._dragLink) {
      this._dragLink.to = this.hoverUnit;
    }
  },

  updateMouse(engine, e) {
    const sp = this.canvasPos(e);
    this.lastMouse = { x: e.clientX, y: e.clientY };
    engine.MousePosScreen = sp;
    engine.MousePosWorld = Renderer.screenToWorld(sp.x, sp.y);
    this.mouseWorld = engine.MousePosWorld;
  },

  onPointerDown(e) {
    if (e.button === 2) { this._panning = true; this._panLast = { x: e.clientX, y: e.clientY }; return; }
    if (e.button === 1) { Renderer.zoomTo(2); return; }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.engine || app.state !== "game" || app.paused) return;
    const engine = app.engine;
    this.updateMouse(engine, e);
    // refresh tool validity for the exact click point before the press (event-driven port of
    // the reference order: GameEngine.Update -> tool.Update -> OnWorldClick)
    if (this.activeToolObj && this.activeToolObj.Update) this.activeToolObj.Update(engine, 0);
    if (this.activeToolObj === this.GameTools[0]) this.selectedUnit = this.hoverUnit; // picker selects
    if (HSMap.IsInBounds(engine.MousePosWorld) && this.activeToolObj) {
      this.activeToolObj.OnWorldMousePress(engine, engine.MousePosWorld, true);
    }
  },

  onPointerUp(e) {
    if (e.button === 2) { this._panning = false; return; }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.engine || app.state !== "game" || app.paused) return;
    const engine = app.engine;
    this.updateMouse(engine, e);
    if (HSMap.IsInBounds(engine.MousePosWorld) && this.activeToolObj) {
      this.activeToolObj.OnWorldMousePress(engine, engine.MousePosWorld, false);
    }
  },

  onKey(e) {
    const app = this.app;
    if (app.state !== "game") {
      if (e.key === "Escape" && app.state === "pause") app.togglePause();
      return;
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(e.key)) {
      e.preventDefault();
      const map = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
      this._camKeys.add(map[e.key]);
      return;
    }
    if (e.key === "Escape") { app.togglePause(); return; }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= (this.GameTools || []).length) {
      const t = this.GameTools[num - 1];
      if (t) { this.SelectTool(t); Snd.click(); return; }
    }
    if (e.key === " ") {
      e.preventDefault();
      app.toggleSpeed();
    }
  },

  cameraTick() {
    if (!this._camKeys.size) return;
    const step = 12;
    if (this._camKeys.has("up")) Renderer.panBy(0, -step);
    if (this._camKeys.has("down")) Renderer.panBy(0, step);
    if (this._camKeys.has("left")) Renderer.panBy(-step, 0);
    if (this._camKeys.has("right")) Renderer.panBy(step, 0);
  },

  toggleSound() {
    Save.data.sound = !Save.data.sound;
    Save.save();
    Snd.setMuted(!Save.data.sound);
    const label = "SOUND: " + (Save.data.sound ? "ON" : "OFF");
    this.el["btn-sound-title"].textContent = label;
    this.el["btn-sound-pause"].textContent = label;
    this.el["btn-sound"].textContent = Save.data.sound ? "♪" : "✕";
    Snd.click();
  },

  toggleSpeedLabel(speed) {
    this.el["btn-speed"].textContent = speed === 1 ? "1×" : "2×";
  },

  toast(msg, ms = 2600) {
    const box = this.el.toasts;
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = msg;
    box.appendChild(div);
    setTimeout(() => div.remove(), ms);
    while (box.children.length > 3) box.firstChild.remove();
  },

  checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const inGame = this.app && this.app.state === "game";
    this.el["rotate-hint"].classList.toggle("hidden", !(portrait && inGame));
  },

  showLose(engine) {
    this.el["lose-sub"].textContent = `All buildings destroyed. You survived ${Math.floor(engine.Time)}s across ${engine.CurWave} waves.`;
    this.app.showScreen("lose");
  },
};
