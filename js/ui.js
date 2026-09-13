/* SUNGRID — DOM UI: screens, HUD, palette, input */
"use strict";

const UI = {
  el: {},
  app: null,
  toastTimer: null,

  init(app) {
    this.app = app;
    const ids = ["hud", "chip-credits", "credits-num", "income-num", "chip-energy", "energy-num",
      "chip-wave", "wave-num", "wave-state",
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
    this.el["btn-call"].onclick = () => { Snd.click(); if (app.game && app.game.state === "build" && app.game.callWave) app.game.callWave(true); };
    this.el["btn-resume"].onclick = () => { app.togglePause(); };
    this.el["btn-restart"].onclick = () => { Snd.click(); app.startLevel(app.game.levelIdx); };
    this.el["btn-sound-pause"].onclick = () => { this.toggleSound(); };
    this.el["btn-quit"].onclick = () => { Snd.click(); app.quitToMenu(); };
    this.el["btn-next"].onclick = () => {
      Snd.click();
      const g = app.game;
      if (g.mode === "campaign" && g.levelIdx + 1 < LEVELS.length) app.startLevel(g.levelIdx + 1);
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
      const t = g && g.selected;
      if (!t || t.dead) return;
      if (t.key === "laser" && t.linkTo) {
        g.unlinkLaser(t);
        Snd.sell();
        this.refreshTowerPanel(g);
      } else if (t.key === "laser") {
        g.linkFrom = t;
        this.toast("Клікни по іншому лазеру в радіусі — він стане приймачем");
      } else if (t.key === "bomb" && t.charge >= BOMB_CHARGE) {
        g.detonateBomb(t);
        this.refreshTowerPanel(g);
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
    const waveOpen = Save.starsFor(4) > 0;   // L5 done
    const endlessOpen = Save.starsFor(7) > 0; // L8 done
    LEVELS.forEach((lvl, i) => {
      const btn = document.createElement("button");
      btn.className = "lvl" + (i < unlocked ? "" : " locked");
      const stars = Save.starsFor(i);
      btn.innerHTML = `<div class="num">${i + 1}</div><div class="st">${i < unlocked ? "★".repeat(stars) + "☆".repeat(3 - stars) : ""}</div>`;
      if (i < unlocked) btn.onclick = () => { Snd.click(); this.app.startLevel(i); };
      btn.title = lvl.name;
      grid.appendChild(btn);
    });
    const wb = Save.data.waveBest || { medal: 0, time: null };
    const waveBtn = document.createElement("button");
    waveBtn.className = "lvl endless" + (waveOpen ? "" : " locked");
    const medalStr = wb.medal ? ["", "BRONZE", "SILVER", "GOLD"][wb.medal] + (wb.time !== null ? " " + this.mmss(wb.time) : "") : "clear level 5";
    waveBtn.innerHTML = `<div class="num">WAVE ATTACK — 10 waves vs the clock</div><div class="st">${waveOpen ? medalStr : "🔒"}</div>`;
    if (waveOpen) waveBtn.onclick = () => { Snd.click(); this.app.startLevel(-1, "wave"); };
    grid.appendChild(waveBtn);
    const eb = document.createElement("button");
    eb.className = "lvl endless" + (endlessOpen ? "" : " locked");
    eb.innerHTML = `<div class="num">ENDLESS — survive forever</div><div class="st">${endlessOpen ? "best: wave " + Save.data.endlessBest : "🔒 clear level 8"}</div>`;
    if (endlessOpen) eb.onclick = () => { Snd.click(); this.app.startLevel(-1, "endless"); };
    grid.appendChild(eb);
    this.el["stars-total"].textContent = `★ ${Save.totalStars(LEVELS.length)} / ${LEVELS.length * 3}`;
  },

  mmss(t) {
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  },

  /* ---------- level start ---------- */
  onLevelStart(game) {
    this.showScreen("game");
    this.refreshPalette(game);
    this.refreshTowerPanel(game);
    this.el["btn-speed"].textContent = "1×";
    let tips;
    if (game.mode === "wave") {
      tips = ["10 waves on the clock — GOLD under 6:00, SILVER under 9:00.", "Call waves early for bonus credits."];
    } else if (game.mode === "endless") {
      tips = ["Endless siege — set a wave record. Threat grows forever."];
    } else {
      tips = (game.level.tutorial && game.level.tutorial.length) ? game.level.tutorial : (game.level.hint ? [game.level.hint] : []);
    }
    tips.forEach((msg, i) => setTimeout(() => this.toast(msg, 4200), i * 4300));
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
        const unlockedHere = g.mode !== "campaign" ? true : (g.levelIdx >= 0 ? def.unlock <= g.levelIdx : def.unlock <= 10);
        if (!unlockedHere) { Snd.error(); this.toast(`${def.name} unlocks on level ${def.unlock + 1}`); return; }
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
      const unlockedHere = game.mode !== "campaign" ? true : (game.levelIdx === -1 ? def.unlock <= 10 : def.unlock <= game.levelIdx);
      card.classList.toggle("locked", !unlockedHere);
      card.classList.toggle("selected", game.placing === key);
      card.classList.toggle("nopay", unlockedHere && game.credits < def.cost);
      card.querySelector(".pcost").textContent = unlockedHere ? def.cost : "L" + (def.unlock + 1);
    }
  },

  /* ---------- tower panel ---------- */
  refreshTowerPanel(game) {
    const panel = this.el["tower-panel"];
    const t = game && game.selected;
    if (!t || t.dead) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    this.el["tp-name"].textContent = `${t.def.name} ${t.tier >= 1 ? "T" + (t.tier + 1) : ""}`;
    let stats = t.def.statLine(t.t) + "\n";
    if (!t.done) stats += `Under construction… ${Math.round(t.built * 100)}%\n`;
    else stats += `Supply ${Math.round(t.supply * 100)}%\n`;
    if (t.key === "laser" && t.boost.n > 0) stats += `Feeders: ${t.boost.n} → ×${t.boost.mult.toFixed(2)} DPS, range ×${t.boost.rangeMult.toFixed(2)}\n`;
    if (t.key === "laser") stats += t.linkTo ? `Feeding → laser ${t.linkTo.c},${t.linkTo.r}` : "";
    if (t.key === "laser" && !t.linkTo && t.feeders.length === 0 && t.boost.n === 0) stats += "";
    if (t.key === "link") stats += `Heat ${Math.round(t.heat)}/${CFG.HEAT_MAX}`;
    if (t.key === "bomb") stats += `Charge ${Math.round(t.charge)}/${BOMB_CHARGE}`;
    if (t.key === "harvester") stats += this.app.game && this.app.game.terr[U.idx(t.c, t.r)] === 3 ? "Rich deposit: ×1.75 output" : "On mineral";
    this.el["tp-stats"].textContent = stats.trim();

    const up = this.el["tp-upgrade"];
    if (t.tier >= 2) { up.disabled = true; up.textContent = "MAX"; }
    else {
      const cost = t.def.upCost[t.tier];
      up.disabled = game.credits < cost;
      up.textContent = `UPGRADE ${cost}`;
    }
    const linkBtn = this.el["tp-link"];
    if (t.key === "laser") {
      linkBtn.classList.remove("hidden");
      linkBtn.textContent = t.linkTo ? "UNLINK" : "LINK";
    } else if (t.key === "bomb") {
      linkBtn.classList.toggle("hidden", t.charge < BOMB_CHARGE);
      linkBtn.textContent = "DETONATE";
    } else {
      linkBtn.classList.add("hidden");
    }
    this.el["tp-sell"].textContent = `SELL +${Math.round(t.invested * CFG.SELL_RATIO)}`;
  },

  /* ---------- HUD ---------- */
  updateHUD(game) {
    this.el["credits-num"].textContent = U.fmt(game.credits);
    this.el["income-num"].textContent = "+" + game.income().toFixed(1).replace(".0", "") + "/s";
    const es = game.energyStats();
    this.el["energy-num"].textContent = `${es.gen} / ${es.demand} e/s`;
    if (game.endless) {
      this.el["wave-num"].textContent = "WAVE " + game.wave;
    } else if (game.waveMode) {
      this.el["wave-num"].textContent = `WAVE ${Math.max(1, game.wave)}/10`;
    } else {
      this.el["wave-num"].textContent = `WAVE ${Math.max(1, game.wave)}/${game.level.waves}`;
    }
    if (game.state === "build" && game.callWave) {
      this.el["wave-state"].textContent = game.waveMode ? "build · " + this.mmss(game.runTime) : "build";
      this.el["wave-banner"].classList.remove("hidden");
      this.el["wave-banner-text"].textContent = `WAVE ${game.wave + 1} INCOMING`;
      this.el["wave-count"].textContent = Math.ceil(game.breakT);
    } else if (game.state === "wave") {
      this.el["wave-state"].textContent = "fight · " + this.mmss(game.runTime);
      this.el["wave-banner"].classList.add("hidden");
    } else {
      this.el["wave-state"].textContent = game.state;
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
    const p = ISO.pick(this.canvasPos(e).x, this.canvasPos(e).y);
    g.hover.c = p.c; g.hover.r = p.r;
  },

  onPointerDown(e) {
    if (e.button !== 0) return;
    const g = this.app.game;
    if (!g || this.app.state !== "game" || this.app.paused) return;
    const sp = this.canvasPos(e);
    const pick = ISO.pick(sp.x, sp.y);
    const c = pick.c, r = pick.r;
    if (!U.inBounds(c, r)) return;

    // linking a laser into a receiver?
    if (g.linkFrom) {
      const target = g.towers[U.idx(c, r)];
      if (target && g.linkLaser(g.linkFrom, target)) {
        Snd.boost();
        g.linkFrom = null;
        this.toast("Linked!");
      } else {
        Snd.error();
        this.toast("Invalid target — must be another Laser within range");
      }
      return;
    }

    // shift-click a feeding laser → unlink it
    if (e.shiftKey) {
      const tower = g.towers[U.idx(c, r)];
      if (tower && tower.key === "laser" && tower.linkTo) {
        g.unlinkLaser(tower);
        Snd.sell();
        this.refreshTowerPanel(g);
        return;
      }
    }

    // placing a building?
    if (g.placing) {
      g.place(g.placing, c, r);
      this.refreshPalette(g);
      return;
    }

    // select a tower
    const tower = g.towers[U.idx(c, r)];
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
    if (num >= 1 && num <= PALETTE_ORDER.length) {
      const key = PALETTE_ORDER[num - 1];
      const def = TOWERS[key];
      const unlockedHere = g.mode !== "campaign" ? true : (g.levelIdx === -1 ? def.unlock <= 10 : def.unlock <= g.levelIdx);
      if (unlockedHere) { g.placing = g.placing === key ? null : key; g.selected = null; this.refreshPalette(g); this.refreshTowerPanel(g); Snd.click(); }
      return;
    }
    switch (e.key) {
      case "Escape":
        if (g.placing || g.linkFrom) { g.placing = null; g.linkFrom = null; this.refreshPalette(g); }
        else app.togglePause();
        break;
      case "u": case "U":
        g.unlinkAll();
        break;
      case " ":
        e.preventDefault();
        if (g.state === "build" && g.callWave) g.callWave(true);
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
    if (game.waveMode) {
      const medal = ["", "BRONZE", "SILVER", "GOLD"][game.medal || 1];
      this.el["win-title"].textContent = "WAVE ATTACK — " + medal;
      this.el["win-stars"].innerHTML =
        `<span>${"★".repeat(game.medal || 1)}</span><span class="off">${"★".repeat(3 - (game.medal || 1))}</span>`;
      this.el["win-sub"].textContent = `All 10 waves cleared in ${this.mmss(game.runTime)}. Gold ≤ 6:00, silver ≤ 9:00.`;
      this.el["btn-next"].textContent = "LEVELS";
    } else {
      const stars = game.stars || 1;
      this.el["win-title"].textContent = "LEVEL COMPLETE";
      this.el["win-stars"].innerHTML =
        `<span>${"★".repeat(stars)}</span><span class="off">${"★".repeat(3 - stars)}</span>`;
      this.el["win-sub"].textContent = `Core integrity ${Math.round(game.coreHp / game.coreMax * 100)}% — ${game.kills} hostiles down.`;
      this.el["btn-next"].textContent = game.levelIdx + 1 >= LEVELS.length ? "LEVELS" : "NEXT LEVEL";
    }
    this.showScreen("win");
  },

  showLose(game) {
    this.el["lose-sub"].textContent = game.endless
      ? `You held for ${game.wave} waves. Best: ${Save.data.endlessBest}.`
      : game.waveMode
        ? `The grid fell on wave ${game.wave} of 10 at ${this.mmss(game.runTime)}.`
        : `The core fell on wave ${Math.max(1, game.wave)}.`;
    this.showScreen("lose");
  },
};
