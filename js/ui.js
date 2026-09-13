/* SUNGRID — DOM UI + input for the free-placement sim (Harvesturr logic, our skin) */
"use strict";

const UI = {
  el: {},
  app: null,
  activeTool: "picker",
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
      "screen-title", "btn-play", "btn-howto", "btn-sound-title",
      "screen-howto",
      "screen-pause", "btn-resume", "btn-restart", "btn-sound-pause", "btn-quit",
      "screen-lose", "lose-sub", "btn-retry", "btn-lose-menu"];
    for (const id of ids) this.el[id] = document.getElementById(id);

    this.el["btn-play"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); app.startGame(); };
    this.el["btn-howto"].onclick = () => { Snd.click(); app.showScreen("howto"); };
    this.el["btn-sound-title"].onclick = () => this.toggleSound();
    document.querySelectorAll(".back-btn").forEach((b) => { b.onclick = () => { Snd.click(); app.showScreen("title"); }; });
    this.el["btn-speed"].onclick = () => { app.toggleSpeed(); Snd.click(); };
    this.el["btn-pause"].onclick = () => { app.togglePause(); };
    this.el["btn-sound"].onclick = () => this.toggleSound();
    this.el["btn-full"].onclick = () => App.toggleFullscreen();
    this.el["btn-resume"].onclick = () => app.togglePause();
    this.el["btn-restart"].onclick = () => { Snd.click(); app.startGame(); };
    this.el["btn-sound-pause"].onclick = () => this.toggleSound();
    this.el["btn-quit"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-retry"].onclick = () => { Snd.click(); app.startGame(); };
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

  /* ---------- palette ---------- */
  buildPalette() {
    const pal = this.el.palette;
    pal.innerHTML = "";
    const tools = [
      { key: "picker", name: "Select / Link", cost: "" },
      { key: "conduit", name: "Conduit", cost: SIM_DEFS.conduit.cost },
      { key: "solar", name: "Solar Panel", cost: SIM_DEFS.solar.cost },
      { key: "harvester", name: "Harvester", cost: SIM_DEFS.harvester.cost },
      { key: "laser", name: "Laser", cost: SIM_DEFS.laser.cost },
    ];
    tools.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "pcard" + (t.key === "picker" ? " selected" : "");
      card.dataset.key = t.key;
      card.innerHTML = `
        <div class="pico" style="background:radial-gradient(circle at 50% 60%, ${t.key === "picker" ? "#b8860b" : "#3fa7d6"} 0 6px, transparent 7px)"></div>
        <div class="pname">${t.name}</div>
        <div class="pcost">${t.cost === "" ? "·" : t.cost}</div>
        <div class="pkey">[${i + 1}]</div>`;
      card.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        Snd.click();
        this.setTool(t.key);
      });
      pal.appendChild(card);
    });
  },

  setTool(key) {
    this.activeTool = key;
    this._dragLink = null;
    for (const card of this.el.palette.children) card.classList.toggle("selected", card.dataset.key === key);
  },

  /* ---------- level start ---------- */
  onGameStart(sim) {
    this.showScreen("game");
    this.buildPalette();
    this.setTool("picker");
    this.selectedUnit = null;
    this.hoverUnit = null;
    this.el["btn-speed"].textContent = "1×";
    this.toast("Drag conduit→conduit and laser→laser to link them. Defend your buildings!", 5000);
  },

  /* ---------- HUD ---------- */
  updateHUD(sim) {
    this.cameraTick();
    this.el["resources-num"].textContent = U.fmt(sim.resources);
    this.el["wave-num"].textContent = "WAVE " + sim.wave;
    const next = Math.max(0, Math.ceil(sim._nextWave - sim.time));
    this.el["wave-state"].textContent = "next in " + next + "s";
    this.refreshUnitPanel(sim);
  },

  refreshUnitPanel(sim) {
    const panel = this.el["unit-panel"];
    const u = this.selectedUnit;
    if (!u || u.dead) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const names = { conduit: "Conduit", solar: "Solar Panel", harvester: "Harvester", laser: "Laser", wip: "Under Construction", ufo: "UFO", mineral: "Minerals", packet: "Energy" };
    this.el["up-name"].textContent = names[u.kind] || u.kind;
    let stats = "";
    if (u.kind === "laser") stats = `Charges ${u.charges}/${u.maxCharges}\nDamage ${u._dmg} · Range ${Math.round(u._range)}\n${u.liveLink ? "Feeding → laser" : u.feedersCount ? "" : ""}`;
    else if (u.kind === "conduit") stats = `Heat ${u.heat}/${HS.CONDUIT_HEAT_MAX}`;
    else if (u.kind === "harvester") stats = `Charges ${u.charges}\n+1 R$ per ${u.updateInterval}s`;
    else if (u.kind === "solar") stats = `+1 packet / ${u.updateInterval}s`;
    else if (u.kind === "wip") stats = `Needs ${u.remaining} more energy packets`;
    else if (u.kind === "ufo") stats = `HP ${Math.round(u.hp)}/${u.maxHp} · Damage ${u.dmg}`;
    else if (u.kind === "mineral") stats = `${u.count} minerals left`;
    this.el["up-stats"].textContent = stats.trim();
  },

  /* ---------- input ---------- */
  canvasPos(e) {
    const rect = Renderer.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * CFG.W,
      y: (e.clientY - rect.top) / rect.height * CFG.H,
    };
  },

  pickUnit(e) {
    const sp = this.canvasPos(e);
    const w = Renderer.screenToWorld(sp.x, sp.y);
    this.mouseWorld = w;
    const sim = this.app.sim;
    let best = null;
    for (const u of sim.units) {
      if (u.dead || !u.pickable) continue;
      if (Utils2.pointInRect(w, u.bounding)) best = u;
    }
    return best;
  },

  onPointerMove(e) {
    if (this._panning) {
      Renderer.panBy(e.clientX - this._panLast.x, e.clientY - this._panLast.y);
      this._panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    const sim = this.app.sim;
    if (!sim) return;
    this.hoverUnit = this.pickUnit(e);
    if (this._dragLink) {
      this._dragLink.to = this.hoverUnit;
    }
  },

  onPointerDown(e) {
    if (e.button === 2) {
      this._panning = true;
      this._panLast = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 1) { Renderer.zoomTo(2); return; }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.sim || app.state !== "game" || app.paused) return;

    const u = this.pickUnit(e);
    const sim = app.sim;

    if (this.activeTool === "picker") {
      if (u) {
        // reference mechanic: clicking a UFO shoves it with a random ±256 impulse
        if (u.isAlien) {
          u.vx += Utils2.rand(-256, 256);
          u.vy += Utils2.rand(-256, 256);
        }
        this.selectedUnit = u;
        Snd.click();
        this._dragLink = { from: u, to: null };
      } else {
        this.selectedUnit = null;
      }
      return;
    }

    // builder tools
    if (SIM_DEFS[this.activeTool] && this.mouseWorld) {
      if (sim.placeBuilding(this.activeTool, this.mouseWorld.x, this.mouseWorld.y)) {
        Snd.place();
      } else {
        Snd.error();
        if (sim.resources < SIM_DEFS[this.activeTool].cost) this.toast("Not enough resources!");
      }
    }
  },

  onPointerUp(e) {
    if (e.button === 2) { this._panning = false; return; }
    if (e.button !== 0) return;
    const app = this.app;
    if (!app.sim) return;

    // finish drag-link (picker tool)
    if (this._dragLink) {
      const from = this._dragLink.from;
      const to = this.hoverUnit && this.hoverUnit !== from ? this.hoverUnit : null;
      if (from instanceof Conduit) {
        if (to instanceof Conduit && Utils2.dist(from, to) < HS.CONNECT_RANGE_POWER) { from.linkConduit(to); Snd.boost(); }
        else { from.linkConduit(null); Snd.click(); }
      } else if (from instanceof Laser) {
        if (to instanceof Laser && Utils2.dist(from, to) < (from.charges > 0 ? from._range : HS.LASER_SINGLE_RNG)) { from.linkLaser(to, app.sim); Snd.boost(); }
        else { from.linkLaser(null, app.sim); Snd.click(); }
      }
      this._dragLink = null;
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
    const toolKeys = ["picker", "conduit", "solar", "harvester", "laser"];
    if (num >= 1 && num <= toolKeys.length) { this.setTool(toolKeys[num - 1]); Snd.click(); return; }
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

  showLose(sim, kills) {
    this.el["lose-sub"].textContent = `All buildings destroyed. You survived ${Math.floor(sim.time)}s across ${sim.wave} waves with ${kills || 0} kills.`;
    this.app.showScreen("lose");
  },
};
