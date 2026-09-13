/* SUNGRID — DOM UI: screens, HUD, palette, input */
"use strict";

const UI = {
  el: {},
  app: null,
  toastTimer: null,

  init(app) {
    this.app = app;
    const ids = ["hud", "chip-energy", "energy-num", "income-num", "chip-wave", "wave-num", "wave-state",
      "corebar-fill", "btn-speed", "btn-pause", "btn-sound", "btn-full",
      "wave-banner", "wave-banner-text", "wave-count", "btn-call",
      "palette", "tower-panel", "tp-name", "tp-stats", "tp-upgrade", "tp-link", "tp-sell",
      "toasts", "rotate-hint",
      "screen-title", "btn-play", "btn-howto", "btn-sound-title",
      "screen-howto", "screen-select", "levels-grid", "stars-total",
      "screen-pause", "btn-resume", "btn-restart", "btn-sound-pause", "btn-quit",
      "screen-win", "win-title", "win-stars", "win-sub", "btn-next", "btn-replay", "btn-win-menu",
      "screen-lose", "lose-sub", "btn-retry", "btn-lose-menu"];
    for (const id of ids) this.el[id] = document.getElementById(id);

    // ---- buttons ----
    this.el["btn-play"].onclick = () => { Snd.init(); Snd.resume(); Snd.click(); this.buildLevelGrid(); app.showScreen("select"); };
    this.el["btn-howto"].onclick = () => { Snd.click(); app.showScreen("howto"); };
    this.el["btn-sound-title"].onclick = () => { this.toggleSound(); };
    document.querySelectorAll(".back-btn").forEach((b) => { b.onclick = () => { Snd.click(); app.showScreen("title"); }; });
    this.el["btn-speed"].onclick = () => { app.toggleSpeed(); Snd.click(); };
    this.el["btn-pause"].onclick = () => { app.togglePause(); };
    this.el["btn-sound"].onclick = () => { this.toggleSound(); };
    this.el["btn-full"].onclick = () => { App.toggleFullscreen(); };
    this.el["btn-call"].onclick = () => { Snd.click(); if (app.game && app.game.state === "build") app.game.callWave(true); };
    this.el["btn-resume"].onclick = () => { app.togglePause(); };
    this.el["btn-restart"].onclick = () => { Snd.click(); app.startLevel(app.game.levelIdx); };
    this.el["btn-sound-pause"].onclick = () => { this.toggleSound(); };
    this.el["btn-quit"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-next"].onclick = () => {
      Snd.click();
      const next = app.game.levelIdx + 1;
      if (next < LEVELS.length) app.startLevel(next);
      else { this.buildLevelGrid(); app.showScreen("select"); }
    };
    this.el["btn-replay"].onclick = () => { Snd.click(); app.startLevel(app.game.levelIdx); };
    this.el["btn-win-menu"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-retry"].onclick = () => { Snd.click(); app.startLevel(app.game.levelIdx); };
    this.el["btn-lose-menu"].onclick = () => { Snd.click(); app.quitToMenu(); };

    this.el["tp-upgrade"].onclick = () => { const g = app.game; if (g && g.selected) g.upgrade(g.selected); };
    this.el["tp-sell"].onclick = () => { const g = app.game; if (g && g.selected) { g.sell(g.selected); this.refreshTowerPanel(g); } };
    this.el["tp-link"].onclick = () => {
      const g = app.game;
      if (g && g.selected && g.selected.key === "prism") {
        g.linkFrom = g.selected;
        this.toast("Click a Laser or Prism within range to link");
      }
    };

    // ---- canvas input ----
    const canvas = document.getElementById("game");
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const g = app.game;
      if (g) { g.placing = null; g.linkFrom = null; this.refreshPalette(g); this.refreshTowerPanel(g); }
    });

    // ---- keyboard ----
    window.addEventListener("keydown", (e) => this.onKey(e));

    // ---- audio unlock on first interaction ----
    const unlock = () => { Snd.init(); Snd.resume(); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    // ---- rotate hint ----
    window.addEventListener("resize", () => this.checkOrientation());
    this.checkOrientation();
  },

  /* ---------- screens ---------- */
  showScreen(name) {
    const app = this.app;
    const overlays = ["screen-title", "screen-howto", "screen-select", "screen-pause", "screen-win", "screen-lose"];
    for (const id of overlays) this.el[id].classList.add("hidden");
    this.el.hud.classList.add("hidden");
    app.paused = false;

    if (name === "title") this.el["screen-title"].classList.remove("hidden");
    else if (name === "howto") this.el["screen-howto"].classList.remove("hidden");
    else if (name === "select") { this.buildLevelGrid(); this.el["screen-select"].classList.remove("hidden"); }
    else if (name === "game") this.el.hud.classList.remove("hidden");
    else if (name === "pause") { this.el.hud.classList.remove("hidden"); this.el["screen-pause"].classList.remove("hidden"); app.paused = true; }
    else if (name === "win") { this.el.hud.classList.remove("hidden"); this.el["screen-win"].classList.remove("hidden"); }
    else if (name === "lose") { this.el.hud.classList.remove("hidden"); this.el["screen-lose"].classList.remove("hidden"); }
  },

  buildLevelGrid() {
    const grid = this.el["levels-grid"];
    grid.innerHTML = "";
    const unlocked = Save.data.unlocked;
    LEVELS.forEach((lvl, i) => {
      const btn = document.createElement("button");
      btn.className = "lvl" + (i < unlocked ? "" : " locked");
      const stars = Save.starsFor(i);
      btn.innerHTML = `<div class="num">${i + 1}</div><div class="st">${i < unlocked ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</div>`;
      if (i < unlocked) btn.onclick = () => { Snd.click(); this.app.startLevel(i); };
      btn.title = lvl.name;
      grid.appendChild(btn);
    });
    const eb = document.createElement("button");
    eb.className = "lvl endless" + (Save.data.unlocked > 10 ? "" : " locked");
    eb.innerHTML = `<div class="num">ENDLESS ARENA${Save.data.unlocked > 10 ? " — best: wave " + Save.data.endlessBest : " (reach level 11)"}</div>`;
    if (Save.data.unlocked > 10) eb.onclick = () => { Snd.click(); this.app.startLevel(-1); };
    grid.appendChild(eb);
    this.el["stars-total"].textContent = `★ ${Save.totalStars(LEVELS.length)} / ${LEVELS.length * 3}`;
  },

  /* ---------- level start ---------- */
  onLevelStart(game) {
    this.showScreen("game");
    this.refreshPalette(game);
    this.refreshTowerPanel(game);
    this.el["btn-speed"].textContent = "1×";
    // tutorial hints
    const li = game.levelIdx;
    if (li === 0) {
      this.toast("Build 2–3 Laser Turrets near the Core", 4000);
      setTimeout(() => this.toast("Monsters pour out of the red gates — don't let them touch the Core!", 4500), 4300);
    } else if (li === 1) {
      this.toast("Place Extractors on the green crystals to earn energy", 4500);
    } else if (li === 2) {
      this.toast("NEW — Prism: it beams into a Laser and multiplies its damage!", 5000);
      setTimeout(() => this.toast("Select a Prism and press LINK to choose its target", 4500), 5200);
    } else if (li === 3) {
      this.toast("NEW — Pylon: extends your power network to far crystals", 5000);
    } else if (game.level.hint) {
      this.toast(game.level.hint, 4500);
    }
  },

  /* ---------- palette ---------- */
  buildPalette() {
    const pal = this.el.palette;
    pal.innerHTML = "";
    for (const key of PALETTE_ORDER) {
      const def = TOWERS[key];
      const card = document.createElement("div");
      card.className = "pcard";
      card.dataset.key = key;
      card.innerHTML = `
        <div class="pico" style="background:radial-gradient(circle at 50% 60%, ${def.color} 0 6px, transparent 7px)"></div>
        <div class="pname">${def.name}</div>
        <div class="pcost">${def.cost}</div>
        <div class="pkey">[${def.hotkey}]</div>`;
      card.title = def.desc;
      card.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const g = this.app.game;
        if (!g) return;
        if (g.levelIdx >= 0 && def.unlock > g.levelIdx) { Snd.error(); this.toast(`${def.name} unlocks on level ${def.unlock + 1}`); return; }
        if (g.levelIdx === -1 && def.unlock > 10) { Snd.error(); return; }
        Snd.click();
        g.linkFrom = null;
        g.placing = g.placing === key ? null : key;
        g.selected = null;
        this.refreshPalette(g);
        this.refreshTowerPanel(g);
      });
      pal.appendChild(card);
    }
  },

  refreshPalette(game) {
    for (const card of this.el.palette.children) {
      const key = card.dataset.key;
      const def = TOWERS[key];
      const unlockedHere = game.levelIdx === -1 ? def.unlock <= 10 : def.unlock <= game.levelIdx;
      card.classList.toggle("locked", !unlockedHere);
      card.classList.toggle("selected", game.placing === key);
      card.classList.toggle("nopay", unlockedHere && game.energy < def.cost);
      card.querySelector(".pcost").textContent = unlockedHere ? def.cost : "L" + (def.unlock + 1);
    }
  },

  /* ---------- tower panel ---------- */
  refreshTowerPanel(game) {
    const panel = this.el["tower-panel"];
    const t = game && game.selected;
    if (!t || t.dead) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const stars = "·".repeat(t.tier) + "•".repeat(2 - t.tier);
    this.el["tp-name"].textContent = `${t.def.name} ${t.tier >= 1 ? "T" + (t.tier + 1) : ""}`;
    let stats = t.def.statLine(t.t) + "\n";
    if (t.key === "laser" && t.boost.n > 0) stats += `Prisms: ${t.boost.n}/4 → ×${t.boost.mult.toFixed(1)} damage\n`;
    if (t.key === "laser" && t.pierce) stats += "PIERCE MODE ACTIVE\n";
    if (t.key === "prism") stats += t.linkTo ? `Linked → ${t.linkTo.def.name} ${t.linkTo.c},${t.linkTo.r}` : "Not linked — press LINK";
    if (t.key === "extractor") stats += t.rich ? "Rich crystal: double output" : "On crystal";
    this.el["tp-stats"].textContent = stats.trim();

    const up = this.el["tp-upgrade"];
    if (t.tier >= 2) { up.disabled = true; up.textContent = "MAX"; }
    else {
      const cost = t.def.upCost[t.tier];
      up.disabled = game.energy < cost;
      up.textContent = `UPGRADE ${cost}`;
    }
    this.el["tp-link"].classList.toggle("hidden", t.key !== "prism");
    this.el["tp-sell"].textContent = `SELL +${Math.round(t.invested * 0.7)}`;
  },

  /* ---------- HUD ---------- */
  updateHUD(game) {
    this.el["energy-num"].textContent = U.fmt(game.energy);
    this.el["income-num"].textContent = "+" + game.income().toFixed(1).replace(".0", "") + "/s";
    if (game.endless) {
      this.el["wave-num"].textContent = "WAVE " + game.wave;
    } else {
      this.el["wave-num"].textContent = `WAVE ${Math.max(1, game.wave)}/${game.level.waves}`;
    }
    if (game.state === "build") {
      this.el["wave-state"].textContent = "build";
      this.el["wave-banner"].classList.remove("hidden");
      this.el["wave-banner-text"].textContent = `WAVE ${game.wave + 1} INCOMING`;
      this.el["wave-count"].textContent = Math.ceil(game.breakT);
    } else {
      this.el["wave-state"].textContent = game.state === "wave" ? "fight!" : game.state;
      this.el["wave-banner"].classList.add("hidden");
    }
    const pct = game.coreHp / game.coreMax;
    this.el["corebar-fill"].style.width = (pct * 100).toFixed(1) + "%";
    this.el["corebar-fill"].style.background = pct > 0.5 ? "linear-gradient(90deg,#37e0a0,#4de1ff)" : pct > 0.25 ? "linear-gradient(90deg,#e0c337,#ffd94d)" : "linear-gradient(90deg,#e05c37,#ff6b57)";

    this.refreshPalette(game);
    this.refreshTowerPanel(game);
  },

  /* ---------- input ---------- */
  canvasPos(e) {
    const rect = Renderer.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * CFG.W,
      y: (e.clientY - rect.top) / rect.height * CFG.H,
    };
  },

  onPointerMove(e) {
    const g = this.app.game;
    if (!g) return;
    const p = this.canvasPos(e);
    g.hover.c = U.cellAt(p.x); g.hover.r = U.cellAt(p.y);
  },

  onPointerDown(e) {
    if (e.button !== 0) return;
    const g = this.app.game;
    if (!g || this.app.state !== "game" || this.app.paused) return;
    const p = this.canvasPos(e);
    const c = U.cellAt(p.x), r = U.cellAt(p.y);
    if (c < 0 || r < 0 || c >= CFG.COLS || r >= CFG.ROWS) return;

    // linking a prism?
    if (g.linkFrom) {
      const target = g.towers[r * CFG.COLS + c];
      if (target && g.linkPrism(g.linkFrom, target)) {
        Snd.boost();
        g.linkFrom = null;
        this.toast("Linked!");
      } else {
        Snd.error();
        this.toast("Invalid link target — must be a Laser/Prism within range");
      }
      return;
    }

    // placing a building?
    if (g.placing) {
      const t = g.place(g.placing, c, r);
      if (t && !e.shiftKey) { /* keep placing mode for walls; drop for others? keep mode */ }
      this.refreshPalette(g);
      return;
    }

    // select a tower
    const tower = g.towers[r * CFG.COLS + c];
    g.selected = tower || null;
    this.refreshTowerPanel(g);
    if (tower) Snd.click();
  },

  onKey(e) {
    const app = this.app;
    if (app.state !== "game") {
      if (e.key === "Escape" && app.state === "pause") app.togglePause();
      return;
    }
    const g = app.game;
    if (!g) return;
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 7) {
      const key = PALETTE_ORDER[num - 1];
      const def = TOWERS[key];
      const unlockedHere = g.levelIdx === -1 ? def.unlock <= 10 : def.unlock <= g.levelIdx;
      if (unlockedHere) { g.placing = g.placing === key ? null : key; g.selected = null; this.refreshPalette(g); this.refreshTowerPanel(g); Snd.click(); }
      return;
    }
    switch (e.key) {
      case "Escape":
        if (g.placing || g.linkFrom) { g.placing = null; g.linkFrom = null; this.refreshPalette(g); }
        else app.togglePause();
        break;
      case " ":
        e.preventDefault();
        if (g.state === "build") g.callWave(true);
        else app.toggleSpeed();
        break;
      case "f": case "F":
        App.toggleFullscreen();
        break;
      case "s": case "S":
        this.toggleSound();
        break;
    }
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

  showWin(game) {
    const stars = game.stars || 1;
    this.el["win-title"].textContent = game.endless ? "ARENA OVER" : "LEVEL COMPLETE";
    this.el["win-stars"].innerHTML = game.endless ? "" :
      `<span>${"★".repeat(stars)}</span><span class="off">${"★".repeat(3 - stars)}</span>`;
    this.el["win-sub"].textContent = game.endless
      ? `You survived ${game.wave} waves. Best: ${Save.data.endlessBest}.`
      : `Core integrity ${Math.round(game.coreHp / game.coreMax * 100)}% — ${game.kills} monsters slain.`;
    this.el["btn-next"].textContent = game.endless || game.levelIdx + 1 >= LEVELS.length ? "LEVELS" : "NEXT LEVEL";
    this.showScreen("win");
  },

  showLose(game) {
    this.el["lose-sub"].textContent = game.endless
      ? `You survived ${game.wave} waves. Best: ${Save.data.endlessBest}.`
      : `The swarm broke through on wave ${Math.max(1, game.wave)}.`;
    this.showScreen("lose");
  },
};
