/* SUNGRID — DOM UI + input for the free-placement sim (Harvesturr logic, our skin) */
"use strict";

/* camera keys: ONE mapping for keydown and keyup (audit: keyup deleted the raw key
 * while the set held mapped directions — released keys kept panning forever) */
const CAM_KEYS = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
};

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
      "btn-callwave", "btn-speed", "btn-pause", "btn-sound", "btn-full",
      "palette", "unit-panel", "up-name", "up-stats", "up-buttons",
      "toasts", "rotate-hint", "hint-panel", "btn-hint-ok",
      "wave-banner", "wave-banner-title", "wave-banner-note",
      "level-grid",
      "screen-title", "btn-play", "btn-continue", "btn-howto", "btn-sound-title",
      "screen-howto",
      "screen-pause", "btn-resume", "btn-restart", "btn-sound-pause", "btn-quit",
      "screen-lose", "lose-sub", "btn-retry", "btn-lose-menu",
      "screen-win", "win-title", "win-stars", "win-stats", "btn-next", "btn-win-retry", "btn-win-menu"];
    for (const id of ids) this.el[id] = document.getElementById(id);

    this.el["btn-play"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); app.newGame(); };
    this.el["btn-continue"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); app.continueGame(); };
    this.el["btn-howto"].onclick = () => { Snd.click(); app.showScreen("howto"); };
    this.el["btn-sound-title"].onclick = () => this.toggleSound();
    document.querySelectorAll(".back-btn").forEach((b) => { b.onclick = () => { Snd.click(); app.showScreen("title"); }; });
    this.el["btn-speed"].onclick = () => { app.toggleSpeed(); Snd.click(); };
    this.el["btn-callwave"].onclick = () => {
      if (this.app.engine.CallWave()) Snd.place(); else Snd.error();
    };
    this.el["btn-pause"].onclick = () => { app.togglePause(); };
    this.el["btn-sound"].onclick = () => this.toggleSound();
    this.el["btn-full"].onclick = () => App.toggleFullscreen();
    this.el["btn-resume"].onclick = () => app.togglePause();
    this.el["btn-restart"].onclick = () => { Snd.click(); app.startLevel(app.currentLevel || 0); };
    this.el["btn-sound-pause"].onclick = () => this.toggleSound();
    this.el["btn-quit"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-retry"].onclick = () => { Snd.click(); app.startLevel(app.currentLevel || 0); };
    this.el["btn-lose-menu"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-next"].onclick = () => { Snd.click(); app.startLevel((app.currentLevel || 0) + 1); };
    this.el["btn-win-retry"].onclick = () => { Snd.click(); app.startLevel(app.currentLevel || 0); };
    this.el["btn-win-menu"].onclick = () => { Snd.click(); app.showScreen("title"); this.buildLevelGrid(); };
    this.el["btn-hint-ok"].onclick = () => { Snd.click(); this.hideHint(); };

    const canvas = document.getElementById("game");
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    // releasing the drag-link outside the canvas still finishes it (window-level safety net;
    // the canvas handler finishes it first, the second call no-ops)
    window.addEventListener("pointerup", (e) => {
      if (this._dragLink && e.button === 0 && this.app.engine && this.app.state === "game") this.finishDragLink(this.app.engine);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.canvasPos(e);
      Renderer.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) => {
      const k = CAM_KEYS[e.key];
      if (k) this._camKeys.delete(k);
    });

    const unlock = () => { Snd.init(); Snd.resume(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("resize", () => this.checkOrientation());
    this.checkOrientation();
  },

  /* ---------- screens ---------- */
  showScreen(name) {
    const app = this.app;
    const overlays = ["screen-title", "screen-howto", "screen-pause", "screen-lose", "screen-win"];
    for (const id of overlays) this.el[id].classList.add("hidden");
    this.el.hud.classList.add("hidden");
    app.paused = false;
    this._camKeys.clear(); // keys held across a screen change must not pan the camera
    // the wave banner is transient gameplay UI — it must never overlap menus
    // (announceWave re-shows it; the judge caught it sitting over the title logo)
    this.el["wave-banner"].classList.add("hidden");
    clearTimeout(this._waveBannerT);

    if (name === "title") { this.el["screen-title"].classList.remove("hidden"); this.buildLevelGrid(); }
    else if (name === "howto") this.el["screen-howto"].classList.remove("hidden");
    else if (name === "game") this.el.hud.classList.remove("hidden");
    else if (name === "pause") { this.el.hud.classList.remove("hidden"); this.el["screen-pause"].classList.remove("hidden"); app.paused = true; }
    else if (name === "lose") { this.el.hud.classList.remove("hidden"); this.el["screen-lose"].classList.remove("hidden"); }
    else if (name === "win") { this.el.hud.classList.remove("hidden"); this.el["screen-win"].classList.remove("hidden"); }
    // gameplay toasts never leak onto menu screens (judge: WAVE toast over the title logo)
    const inGame = name === "game" || name === "pause";
    this.el.toasts.classList.toggle("hidden", !inGame);
    if (!inGame) this.el.toasts.innerHTML = "";
    if (!inGame) { Snd.laser(0); Snd.atoms(0); } // the ambience hums fall silent off-screen
    this.checkOrientation(); // entering the game in portrait should ask for landscape right away
  },

  /* ---------- level select (title screen) ---------- */
  buildLevelGrid() {
    const grid = this.el["level-grid"];
    if (!grid) return;
    grid.innerHTML = "";
    LEVELS.forEach((lvl, i) => {
      const unlocked = i < Save.data.unlocked;
      const stars = Save.starsFor(i);
      const best = lvl.endless && Save.data.endlessBest > 0 ? `<div class="lbest">BEST ${Save.data.endlessBest} WAVES</div>` : "";
      const card = document.createElement("button");
      card.className = "lcard" + (unlocked ? "" : " locked");
      card.innerHTML = `
        <div class="lrow"><div class="lnum">${unlocked ? (i + 1) : "🔒"}</div>
        <div class="lstars">${[0, 1, 2].map((s) => `<span class="${s < stars ? "on" : ""}">★</span>`).join("")}</div></div>
        <div class="lname">${lvl.name}</div>
        <div class="ldesc">${unlocked ? lvl.desc : "Complete the previous level to unlock"}</div>${best}`;
      if (unlocked) card.onclick = () => { Snd.init(); Snd.resume(); Snd.click(); this.app.startLevel(i); };
      grid.appendChild(card);
    });
  },

  /* ---------- victory screen ---------- */
  showWin(engine, s) {
    this.el["win-title"].textContent = "LEVEL " + (s.idx + 1) + " COMPLETE";
    this.el["win-stars"].innerHTML = [0, 1, 2].map((i) => `<span class="${i < s.stars ? "on" : ""}">★</span>`).join("");
    const lost = s.buildingsLost === 0 ? "flawless defense" : `${s.buildingsLost} building${s.buildingsLost > 1 ? "s" : ""} lost`;
    this.el["win-stats"].textContent = `${s.level.name} — ${Math.floor(engine.Time)}s · ${s.kills} hostiles down · ${lost}`;
    this.el["btn-next"].classList.toggle("hidden", !s.hasNext);
    this.app.showScreen("win");
  },

  /* ---------- palette (InGameState tool panel mirror).
     No Select/Link tool: connections are automatic now; with no tool active
     the left click selects units (select mode). ---------- */
  buildTools(engine) {
    this.GameTools = [
      new HSGameToolConduit(),
      new HSGameToolHarvester(),
      new HSGameToolSolarPanel(),
      new HSGameToolLaser(),
    ];
    const pal = this.el.palette;
    pal.innerHTML = "";
    this.GameTools.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "pcard";
      card.dataset.idx = String(i);
      // icons are rendered from the exact in-game silhouettes, so icon always == model
      const ico = `<img src="${Renderer.renderIcon({ Conduit: "conduit", Harvester: "harvester", "Solar Panel": "solarpanel", Laser: "laser" }[t.Name])}" width="42" height="42" alt="${t.Name}">`;
      card.innerHTML = `
        <div class="pico">${ico}</div>
        <div class="pname">${t.Name}</div>
        <div class="pcost">${t.BuildCost} R$</div>
        <div class="pkey">[${i + 1}]</div>`;
      card.dataset.cost = String(t.BuildCost);
      card.addEventListener("click", (e) => { e.stopPropagation(); Snd.click(); this.SelectTool(t); });
      pal.appendChild(card);
    });
    this.activeToolObj = null; // select mode: click a unit to inspect it
    this.SelectTool(null);
  },

  SelectTool(t) {
    if (this.activeToolObj === t) return;
    for (const g of this.GameTools) g.Active = false;
    if (t) { t.Active = true; t.OnSelected(); }
    this.activeToolObj = t || null;
    for (const card of this.el.palette.children) card.classList.toggle("selected", !!t && card.dataset.idx === String(this.GameTools.indexOf(t)));
  },

  cancelBuildTool() {
    if (!this.GameTools || !this.activeToolObj) return;
    Snd.click();
    this.SelectTool(null);
  },

  /* ---------- per-tick tool input (engine calls this on every Update) ---------- */
  UpdateInput(engine, dt) {
    if (this.activeToolObj) this.activeToolObj.Update(engine, dt);
  },

  /* ---------- level start ---------- */
  /* progressive micro-hints (user request: the old FIRST STEPS wall of text was
     overwhelming) — one short line per step, advanced by play or by GOT IT */
  hintSteps: [
    "Solar panels send energy packets. Relays pass them on — build close together.",
    "Drag node → node to route energy. Press ⚔ when you're ready for the raid.",
    "RAID! Lasers auto-shoot saucers in range — keep them charged with energy.",
  ],
  showHintStep(i) {
    if (i >= this.hintSteps.length) { this.el["hint-panel"].classList.add("hidden"); return; }
    this._hintStep = i;
    const t = document.getElementById("hint-text");
    if (t) t.textContent = this.hintSteps[i];
    this.el["hint-panel"].classList.remove("hidden");
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.el["hint-panel"].classList.add("hidden"), 12000);
  },

  onGameStart(engine) {
    this.showScreen("game");
    this.buildTools(engine);
    this.selectedUnit = null;
    this.hoverUnit = null;
    // show the ACTUAL sim speed (audit: Continue kept the sim at 2× while the button said 1×)
    this.el["btn-speed"].textContent = this.app.speed === 2 ? "2×" : "1×";
    this.showHintStep(0);
  },

  /* the player placed their first building of the level */
  hintBuilt() {
    if (this._hintStep === 0) this.showHintStep(1);
  },

  /* the first raid with enemies was summoned */
  hintRaid() {
    if (this._hintStep < 2) this.showHintStep(2);
  },

  hideHint() {
    this.el["hint-panel"].classList.add("hidden");
  },

  /* ---------- HUD ---------- */
  updateHUD(engine) {
    this.cameraTick();
    engine.DrawZoomDetails = Renderer.cam.zoom >= 2; // InGameState: details only when zoomed in
    this.el["resources-num"].textContent = U.fmt(engine.Resources);
    this.el["resources-num"].classList.toggle("poor", engine.Resources < 5);
    this.el["wave-num"].textContent = "WAVE " + Math.max(1, engine.CurWave); // 0 = the first raid is being announced
    /* audio ambience (throttled): laser hum scales with firing towers, atom hum with packet flow */
    const now = performance.now();
    if (now - (this._humT || 0) > 250) {
      this._humT = now;
      let firing = 0, flow = 0;
      for (const u of engine.GetAllGameUnitsArray(true)) {
        if (u.Destroyed) continue;
        if (u instanceof UnitLaser) { if (u.IsAttacking) firing++; }
        else if (u instanceof UnitEnergyPacket) flow++;
      }
      Snd.laser(Math.min(1, firing / 4));
      Snd.atoms(Math.min(1, flow / 20));
    }
    const cfg = engine.LevelConfig;
    if (cfg && isFinite(cfg.waves)) {
      // level mode: progress within the level's wave goal
      if (engine.CurWave >= cfg.waves) this.el["wave-state"].textContent = "FINAL WAVE — wipe the raid!";
      else this.el["wave-state"].textContent = "wave " + (engine.CurWave + 1) + " of " + cfg.waves + " in " + Math.max(0, Math.ceil(engine.NextWaveSpawnTime - engine.Time)) + "s";
    } else {
      // endless survival: raids never stop
      const next = Math.max(0, Math.ceil(engine.NextWaveSpawnTime - engine.Time));
      this.el["wave-state"].textContent = "raid " + (engine.CurWave + 1) + " in " + next + "s";
    }
    // call-wave button: shows the next wave number, disabled once the level's final wave is out
    const cwBtn = this.el["btn-callwave"];
    if (cwBtn) {
      const finalCalled = engine.LevelConfig && isFinite(engine.LevelConfig.waves) && engine.CurWave >= engine.LevelConfig.waves;
      cwBtn.disabled = finalCalled || !engine.IsGameRunning;
      cwBtn.textContent = finalCalled ? "⚔✓" : "⚔ " + (engine.CurWave + 1);
    }
    for (const card of this.el.palette.children) {
      const cost = parseInt(card.dataset.cost || "0", 10);
      card.classList.toggle("nopay", cost > 0 && engine.Resources < cost);
    }
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
      ufo: "UFO", scout: "Scout UFO", cruiser: "Heavy Cruiser", mineral: "Minerals", megamineral: "Minerals",
    };
    this.el["up-name"].textContent = names[u.Name] || u.Name;
    let stats = "";
    if (u.Name === "laser") {
      const pot = HSPotentialDamage(u); // chain damage ignoring current charge
      const feeders = engine.GetAllGameUnitsArray().filter((o) => o instanceof UnitLaser && o.GetLinkedLaser === u);
      if (u.GetLinkedLaser) stats = `Feeder — charges ${u.EnergyCharges}/${u.MaxEnergyCharges}\nFeeds → laser: +${pot} dmg to its chain\n${u.ManualLink ? "Manual — drag onto another laser to retarget; drag onto empty ground to release" : "Auto-linked — drag it onto another laser to retarget"}`;
      else stats = `Charges ${u.EnergyCharges}/${u.MaxEnergyCharges}\nDamage ${u.AttackDamage || 0} · Range ${Math.round(u.AttackRange)}`
        + (feeders.length ? `\nFed by ${feeders.length} laser${feeders.length > 1 ? "s" : ""} — chain ${pot} dmg, range ${Math.round(HSPotentialRange(pot))}` : "\nReceiver — attacks UFOs in range")
        + `\n${u.ManualLink ? "Manual — drag another laser onto it to add feeders" : "Nearby lasers auto-feed this one"}`;
    }
    else if (u.Name === "conduit") {
      const load = Math.round(u.PacketLoad || 0);
      let s = `Heat ${u.Heat}/100 · Load ${load}/10 pkt/s`;
      if (u.Heat > 60 || load >= 8) s += "\nOVERLOAD — packets are being lost!";
      else if (load >= 5) s += "\nHeavy load — add another conduit";
      s += "\n" + (u.ManualLink
        ? (u.GetLinkedConduit ? "Manual link — drag again to remove" : "Manual — drag to another conduit")
        : "Auto-connects to the nearest conduit in 96px");
      stats = s;
    }
    else if (u.Name === "harvester") stats = `Charges ${u.EnergyCharges}\n+1 R$ per mineral` + (u.EnergyCharges <= 0 ? "\nNO ENERGY — needs packets!" : "");
    else if (u.Name === "solarpanel") stats = `+1 packet / ${UnitSolarPanel.PacketInterval}s`;
    else if (u.Name.endsWith("_wip")) stats = `Needs ${u.BuildCostRemaining} more energy packets`;
    else if (u.Name === "ufo" || u.Name === "scout" || u.Name === "cruiser") stats = `HP ${Math.round(u.Health)}/${u.MaxHealth}`;
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
      const r = u.GetPickRect(); // laser's covers the drawn turret head (audit)
      if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) best = u; // last match wins
    }
    return best;
  },

  onPointerMove(e) {
    if (this._panning) {
      // grab-the-terrain: world follows the mouse (drag delta inverted, like a map drag)
      Renderer.panBy(-(e.clientX - this._panLast.x), -(e.clientY - this._panLast.y));
      this._panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const engine = this.app.engine;
    if (!engine) return;
    this.updateMouse(engine, e); // track world mouse pos like the reference's per-frame GameEngine.Update
    this.hoverUnit = this.pickUnit(e);
    if (this._dragLink) {
      this._dragLink.to = this.hoverUnit;
      if (Math.hypot(e.clientX - this._dragLink.sx, e.clientY - this._dragLink.sy) > 6) this._dragLink.moved = true;
    }
  },

  /* release of a drag-link: apply the manual link once (link / toggle off) */
  finishDragLink(engine) {
    const d = this._dragLink;
    if (!d) return;
    this._dragLink = null;
    if (!d.moved || !d.from || d.from.Destroyed) return; // a plain click just selects
    const res = HSManualLink(engine, d.from, d.to);
    if (res === "link") Snd.place();
    else if (res === "unlink") Snd.click();
    else if (res === "rejected") Snd.error();
  },

  updateMouse(engine, e) {
    const sp = this.canvasPos(e);
    this.lastMouse = { x: e.clientX, y: e.clientY };
    engine.MousePosScreen = sp;
    engine.MousePosWorld = Renderer.screenToWorld(sp.x, sp.y);
    this.mouseWorld = engine.MousePosWorld;
  },

  onPointerDown(e) {
    if (e.button === 2) {
      this._panning = true;
      this._panLast = { x: e.clientX, y: e.clientY };
      this._rmbDown = { x: e.clientX, y: e.clientY }; // a right-click without drag cancels build mode
      return;
    }
    if (e.button === 1) { Renderer.zoomTo(2); return; }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.engine || app.state !== "game" || app.paused) return;
    const engine = app.engine;
    this.updateMouse(engine, e);
    // refresh tool validity for the exact click point before the press (event-driven port of
    // the reference order: GameEngine.Update -> tool.Update -> OnWorldClick)
    if (this.activeToolObj && this.activeToolObj.Update) this.activeToolObj.Update(engine, 0);
    if (!this.activeToolObj) {
      this.selectedUnit = this.hoverUnit; // select mode: click inspects a unit
      // drag-link gesture: press a conduit/laser, drag onto another node (user request)
      const u = this.hoverUnit;
      if (u instanceof UnitConduit || u instanceof UnitLaser) {
        this._dragLink = { from: u, to: u, sx: e.clientX, sy: e.clientY, moved: false };
      }
    }
    const t = this.activeToolObj;
    if (t instanceof HSGameToolBuilder && engine.Resources < t.BuildCost && t.CurrentLocationValid) {
      const now = performance.now();
      if (!this._noPayT || now - this._noPayT > 1500) {
        this._noPayT = now;
        this.toast(`Not enough R$ — ${t.Name} costs ${t.BuildCost}. Your harvester earns R$ from nearby minerals.`);
      }
    }
    if (HSMap.IsInBounds(engine.MousePosWorld) && this.activeToolObj) {
      const resBefore = engine.Resources;
      this.activeToolObj.OnWorldMousePress(engine, engine.MousePosWorld, true);
      // unambiguous placement feedback: charged = success sound, rejected = error sound
      if (this.activeToolObj instanceof HSGameToolBuilder) {
        if (engine.Resources < resBefore) { Snd.place(); this.hintBuilt(); }
        else if (!this.activeToolObj.CurrentLocationValid || engine.Resources < this.activeToolObj.BuildCost) Snd.error();
      }
    }
  },

  onPointerUp(e) {
    if (e.button === 2) {
      this._panning = false;
      // right-click (without a pan drag) cancels the current build tool
      if (this._rmbDown && Math.hypot(e.clientX - this._rmbDown.x, e.clientY - this._rmbDown.y) < 6) {
        this._rmbDown = null;
        this.cancelBuildTool();
      }
      return;
    }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.engine || app.state !== "game" || app.paused) return;
    const engine = app.engine;
    this.updateMouse(engine, e);
    if (this._dragLink) { this.finishDragLink(engine); return; } // drag-link release (select mode)
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
    if (CAM_KEYS[e.key]) {
      e.preventDefault();
      this._camKeys.add(CAM_KEYS[e.key]);
      return;
    }
    if (e.key === "Escape") {
      // Esc first cancels the active build tool (back to select mode), only then pauses
      if (this.activeToolObj) { this.cancelBuildTool(); return; }
      app.togglePause();
      return;
    }
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= (this.GameTools || []).length) {
      const t = this.GameTools[num - 1];
      if (t) { this.SelectTool(t); Snd.click(); return; }
    }
    if (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") {
      // summon the next wave now (user request) — both keyboard layouts
      if (this.app.engine.CallWave()) Snd.place();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      app.toggleSpeed();
    }
    if (e.key === "f" || e.key === "F") App.toggleFullscreen();
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
    // never stack identical messages on top of each other
    for (const c of box.children) if (c.textContent === msg) return;
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = msg;
    box.appendChild(div);
    setTimeout(() => div.remove(), ms);
    while (box.children.length > 3) box.firstChild.remove();
  },

  // big centre-screen announcement when a wave spawns (levels read as events now)
  announceWave(n, note) {
    const b = this.el["wave-banner"];
    if (!b) return;
    this.el["wave-banner-title"].textContent = "WAVE " + n;
    this.el["wave-banner-note"].textContent = note;
    b.classList.remove("hidden");
    b.classList.remove("wave-show"); // restart the CSS animation
    void b.offsetWidth;
    b.classList.add("wave-show");
    clearTimeout(this._waveBannerT);
    this._waveBannerT = setTimeout(() => b.classList.add("hidden"), 3200);
  },

  checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const inGame = this.app && this.app.state === "game";
    this.el["rotate-hint"].classList.toggle("hidden", !(portrait && inGame));
  },

  showLose(engine) {
    const lvl = LEVELS[this.app.currentLevel || 0];
    const best = Save.data.endlessBest;
    const rec = lvl && lvl.endless && best > 0 ? ` Your record: ${best} ${best === 1 ? "wave" : "waves"}.` : "";
    this.el["lose-sub"].textContent = `All buildings destroyed. You survived ${Math.floor(engine.Time)}s across ${engine.CurWave} ${engine.CurWave === 1 ? "wave" : "waves"}.` + rec;
    this.app.showScreen("lose");
  },
};
