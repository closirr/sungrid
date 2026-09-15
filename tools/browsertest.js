/* SUNGRID — headless browser functional test (Playwright).
 * Boots the static server, drives the REAL UI with real pointer events,
 * asserts HUD / placement / construction / pause / state text, screenshots.
 * Usage:  node tools/browsertest.js [--port 8131]
 * Replaces the old functest.js / shots.js which targeted the removed Sim API.
 * Note: games start with dev funds (HSEngine.StartMoney, user test request —
 * reference 1:1 is 0 R$); the unaffordable step zeroes funds to exercise that path.
 */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

/* keep in sync with StartMoney in js/hsgame.js */
const SG_MONEY = 200;

const root = path.resolve(__dirname, "..");
const pi = process.argv.indexOf("--port");
const PORT = parseInt(pi >= 0 ? process.argv[pi + 1] : "8131", 10) || 8131;
const OUT = path.join(root, "output", "web-game");
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  console.log((ok ? "OK   " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

function waitServer(url, tries) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(url, (res) => { res.resume(); resolve(); }).on("error", () => {
        if (n <= 0) reject(new Error("server did not start on " + url));
        else setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries || 40);
  });
}

(async () => {
  const { chromium } = require("playwright");
  const server = spawn(process.execPath, [path.join(__dirname, "server.js"), String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  const base = "http://localhost:" + PORT + "/";
  let browser = null;

  try {
    await waitServer(base, 40);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

    await page.goto(base + "?test=1", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);

    /* A. boot */
    const boot = await page.evaluate(() => ({ state: SG.App.state, hasEngine: !!SG.App.engine }));
    check("A boot: title screen, engine present", boot.state === "title" && boot.hasEngine, JSON.stringify(boot));

    /* B. start a new game (dev tweak: StartMoney funds; reference 1:1 is 0 R$) */
    await page.click("#btn-play");
    await page.waitForTimeout(450);
    const started = await page.evaluate(() => {
      const e = SG.App.engine;
      const arr = e.GetAllGameUnitsArray(true);
      const names = ["conduit", "solarpanel", "harvester", "conduit_wip", "solarpanel_wip", "harvester_wip", "laser_wip", "laser"];
      return {
        state: SG.App.state, res: e.Resources, wave: e.CurWave,
        resText: document.getElementById("resources-num").textContent,
        waveText: document.getElementById("wave-num").textContent,
        hudVisible: !document.getElementById("hud").classList.contains("hidden"),
        starters: arr.filter((u) => !u.Destroyed && names.indexOf(u.Name) >= 0).length,
        minerals: arr.filter((u) => u instanceof SG.UnitMineral && !u.Destroyed).length,
      };
    });
    check("B new game: state=game, HUD visible, 3 starter buildings", started.state === "game" && started.hudVisible && started.starters >= 3 && started.minerals >= 700, JSON.stringify(started));
    check("B HUD shows StartMoney / WAVE n", started.resText === String(SG_MONEY) && /WAVE \d+/.test(started.waveText), JSON.stringify({ resText: started.resText, waveText: started.waveText }));

    /* C. palette */
    const palN = await page.evaluate(() => document.querySelectorAll("#palette .pcard").length);
    await page.click('#palette .pcard[data-idx="1"]');
    const toolSel = await page.evaluate(() => ({ name: SG.UI.activeToolObj && SG.UI.activeToolObj.Name, sel: document.querySelector('#palette .pcard[data-idx="1"]').classList.contains("selected") }));
    check("C palette: 5 tools, Conduit selectable", palN === 5 && toolSel.name === "Conduit" && toolSel.sel, JSON.stringify({ palN, ...toolSel }));

    /* C2. native-resolution canvas: buffer matches window size (no fixed 1280x720 stretch) */
    const cinfo = await page.evaluate(() => {
      const c = SG.Renderer.canvas;
      return { bufW: c.width, bufH: c.height, cssW: c.clientWidth, cssH: c.clientHeight, cfgW: SG.CFG.W };
    });
    check("C2 canvas renders at native window resolution", cinfo.bufW === cinfo.cssW && cinfo.cfgW === cinfo.cssW && cinfo.cssW >= 1280, JSON.stringify(cinfo));

    /* C3. first-steps hint panel shows on the first new game */
    const hintVis = await page.evaluate(() => !document.getElementById("hint-panel").classList.contains("hidden"));
    check("C3 first-steps hint visible on first game", hintVis);
    await page.click("#btn-hint-ok");
    const hintGone = await page.evaluate(() => document.getElementById("hint-panel").classList.contains("hidden"));
    check("C3 hint dismissible", hintGone);

    /* C4. wave HUD is honest before the first UFO wave (reference: first UFOs at wave 8) */
    const waveState = await page.evaluate(() => document.getElementById("wave-state").textContent);
    check("C4 wave state explains no early UFOs", /wave 8/.test(waveState), waveState);

    /* D. unaffordable click (0 R$) -> visible feedback, nothing placed.
     * Fresh games start with dev funds (StartMoney) — zero them for this check. */
    await page.evaluate(() => { SG.App.engine.Resources = 0; });
    await page.waitForTimeout(250); // let a HUD frame mark .nopay cards
    const noPay = await page.evaluate(() => {
      const engine = SG.App.engine;
      const tool = SG.UI.GameTools[1];
      const cands = [[60, 0], [76, 0], [60, 16], [60, -16], [76, 16], [76, -16], [44, 16], [44, -16], [60, 32], [60, -32]];
      let pt = null;
      for (const c of cands) { if (tool.IsValidLocation(engine, { x: c[0], y: c[1] })) { pt = { x: c[0], y: c[1] }; break; } }
      if (!pt) return { ok: false };
      const sp = SG.Renderer.worldToScreen(pt.x, pt.y);
      const r = SG.Renderer.canvas.getBoundingClientRect();
      const nopayCards = [...document.querySelectorAll("#palette .pcard")].filter((c) => c.classList.contains("nopay")).length;
      return { ok: true, pt, cx: r.left + sp.x, cy: r.top + sp.y, res: engine.Resources, nopayCards };
    });
    check("D found a free placement point", noPay.ok, JSON.stringify(noPay));
    check("D palette cards marked unaffordable at 0 R$", noPay.ok && noPay.nopayCards === 4, "nopayCards=" + noPay.nopayCards);

    if (noPay.ok) {
      await page.mouse.move(noPay.cx, noPay.cy);
      await page.waitForTimeout(120);
      const ghost = await page.evaluate(() => SG.UI.GameTools[1].CurrentLocationValid);
      check("D ghost valid at free point (engine ticks tool.Update via window.UI)", ghost === true, "valid=" + ghost);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => ({
        toast: document.getElementById("toasts").textContent,
        res: SG.App.engine.Resources,
        wip: SG.App.engine.GetAllGameUnitsArray(true).filter((u) => /wip/i.test(u.Name)).length,
      }));
      check("D unaffordable click shows 'Not enough R$' toast", /Not enough R\$/.test(after.toast), after.toast.slice(0, 80));
      check("D unaffordable click places nothing", after.res === 0 && after.wip === 0, JSON.stringify(after));
    }

    /* D2. funded placement: real pointer click places a Conduit (funds granted) */
    const placement = await page.evaluate(() => {
      const engine = SG.App.engine;
      engine.Resources = 50; // test scaffolding
      const tool = SG.UI.GameTools[1];
      const cands = [[60, 0], [76, 0], [60, 16], [60, -16], [76, 16], [76, -16], [44, 16], [44, -16], [60, 32], [60, -32], [90, 0], [100, 0], [100, 16], [100, -16]];
      let pt = null;
      for (const c of cands) { if (tool.IsValidLocation(engine, { x: c[0], y: c[1] })) { pt = { x: c[0], y: c[1] }; break; } }
      if (!pt) { outer: for (let x = -16; x <= 110; x += 16) for (let y = -48; y <= 70; y += 16) if (tool.IsValidLocation(engine, { x, y })) { pt = { x, y }; break outer; } }
      if (!pt) return { ok: false, reason: "no free placement point found" };
      const sp = SG.Renderer.worldToScreen(pt.x, pt.y);
      const r = SG.Renderer.canvas.getBoundingClientRect();
      return { ok: true, pt, cx: r.left + sp.x, cy: r.top + sp.y, resBefore: engine.Resources };
    });
    check("D2 found a free placement point (funded)", placement.ok, JSON.stringify(placement));

    if (placement.ok) {
      await page.mouse.move(placement.cx, placement.cy);
      await page.waitForTimeout(90);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(150);
      const placed = await page.evaluate((pt) => {
        const engine = SG.App.engine;
        const near = engine.GetAllGameUnitsArray(true).filter((u) => Math.abs(u.Position.x - pt.x) < 24 && Math.abs(u.Position.y - pt.y) < 24);
        return { res: engine.Resources, names: near.map((u) => u.Name) };
      }, placement.pt);
      check("D click placed a site, resources -5", placed.res === placement.resBefore - 5, "before=" + placement.resBefore + " after=" + placed.res);
      check("D conduit(_wip) exists at the point", placed.names.indexOf("conduit_wip") >= 0 || placed.names.indexOf("conduit") >= 0, JSON.stringify(placed.names));
    }

    /* E. construction is driven by delivered energy packets (DebugFastBuild -> 1 packet) */
    await page.evaluate(() => window.advanceTime(9000));
    await page.waitForTimeout(250);
    const built = await page.evaluate((pt) => {
      const engine = SG.App.engine;
      const near = engine.GetAllGameUnitsArray(true).filter((u) => Math.abs(u.Position.x - pt.x) < 24 && Math.abs(u.Position.y - pt.y) < 24);
      return { names: near.map((u) => u.Name), packets: engine.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitEnergyPacket).length };
    }, placement.pt || { x: 60, y: 0 });
    check("E build finished by packet delivery (conduit present)", built.names.indexOf("conduit") >= 0, JSON.stringify(built));

    /* F. build-mode cancellation (Esc / right-click), then pause / resume via Escape */
    const escCancel = await page.evaluate(() => {
      window.SG.UI.SelectTool(window.SG.UI.GameTools[1]); // Conduit active
      return window.SG.UI.activeToolObj.Name;
    });
    await page.keyboard.press("Escape");
    const escCancelled = await page.evaluate(() => SG.UI.activeToolObj === SG.UI.GameTools[0]);
    check("F Esc cancels active build tool", escCancel === "Conduit" && escCancelled);

    await page.click('#palette .pcard[data-idx="1"]');
    await page.mouse.click(400, 300, { button: "right" }); // right-click without drag
    const rmbCancelled = await page.evaluate(() => SG.UI.activeToolObj === SG.UI.GameTools[0]);
    check("F right-click cancels active build tool", rmbCancelled);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const paused = await page.evaluate(() => ({ state: SG.App.state, vis: !document.getElementById("screen-pause").classList.contains("hidden") }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const resumed = await page.evaluate(() => ({ state: SG.App.state }));
    check("F Escape pauses then resumes", paused.state === "pause" && paused.vis && resumed.state === "game", JSON.stringify({ paused, resumed }));

    /* G. render_game_to_text reflects state */
    const text = await page.evaluate(() => window.render_game_to_text());
    let parsed = null; try { parsed = JSON.parse(text); } catch (e) {}
    check("G render_game_to_text: mode/buildings/minerals", !!(parsed && parsed.mode === "game" && Array.isArray(parsed.buildings) && parsed.buildings.length >= 1 && parsed.minerals > 0),
      parsed ? ("buildings=" + parsed.buildings.length + " minerals=" + parsed.minerals + " packets=" + parsed.packets) : String(text).slice(0, 120));

    /* J. placement ghost has three unambiguous states */
    const ghost3 = await page.evaluate(() => {
      const engine = SG.App.engine, R = SG.Renderer, UI = SG.UI;
      const tool = UI.GameTools[2]; // Harvester
      UI.SelectTool(tool);
      let pt = null;
      outer: for (let x = -200; x <= 200; x += 16) for (let y = -200; y <= 200; y += 16) {
        if (tool.IsValidLocation(engine, { x, y })) { pt = { x, y }; break outer; }
      }
      if (!pt) return { found: false };
      engine.MousePosWorld = pt; tool.Update(engine, 0);
      const ok = R.ghostStatus(engine, tool);
      engine.Resources = 3; const poor = R.ghostStatus(engine, tool);
      engine.Resources = 200;
      engine.MousePosWorld = { x: 30, y: 0 }; tool.Update(engine, 0); // starter conduit footprint
      const blocked = R.ghostStatus(engine, tool);
      UI.SelectTool(UI.GameTools[0]);
      return { found: true, ok: ok.state, poor: poor.state, blocked: blocked.state };
    });
    check("J ghost: free + affordable = ok", ghost3.found && ghost3.ok === "ok", JSON.stringify(ghost3));
    check("J ghost: valid but broke = poor", ghost3.poor === "poor");
    check("J ghost: overlapping = blocked", ghost3.blocked === "blocked");

    /* K. drag-link preview mirrors the link outcome, with reasons */
    const link = await page.evaluate(() => {
      const engine = SG.App.engine, R = SG.Renderer, UI = SG.UI;
      UI.SelectTool(UI.GameTools[0]);
      const tool = UI.GameTools[0];
      const A = engine.GetAllGameUnitsArray().find((u) => u instanceof SG.UnitConduit); // starter conduit
      const B = engine.Spawn(new SG.UnitConduit({ x: A.Position.x + 80, y: A.Position.y })); // test scaffold
      const M = engine.Spawn(new SG.UnitMineral({ x: A.Position.x + 40, y: A.Position.y - 40 })); // non-linkable
      tool.MouseClickPos = { x: A.Position.x, y: A.Position.y }; tool.InMouseClick = true;
      UI.mouseWorld = { x: A.Position.x + 300, y: A.Position.y };
      const far = R.linkPreview(engine);
      UI.mouseWorld = { x: B.Position.x, y: B.Position.y };
      const good = R.linkPreview(engine);
      UI.mouseWorld = { x: M.Position.x, y: M.Position.y };
      const invalid = R.linkPreview(engine);
      tool.OnMouseDrag(engine, { x: A.Position.x, y: A.Position.y }, { x: B.Position.x, y: B.Position.y });
      const linked = A.GetLinkedConduit === B;
      UI.mouseWorld = { x: B.Position.x, y: B.Position.y };
      const already = R.linkPreview(engine);
      tool.InMouseClick = false;
      return { far: far.reason, good: good.state, invalid: invalid.reason, linked, already: already.reason, fx: engine.Effects.filter((e) => e.type === "link").length };
    });
    check("K link preview: TOO FAR reason", link.far === "TOO FAR", JSON.stringify(link));
    check("K link preview: in-range = ok", link.good === "ok");
    check("K link preview: INVALID TARGET on minerals", link.invalid === "INVALID TARGET");
    check("K release actually links the conduits", link.linked === true);
    check("K link success fired link effects", link.fx >= 2);
    check("K link preview: ALREADY CONNECTED", link.already === "ALREADY CONNECTED");

    /* L. UFO reads as an enemy: hit flash, hp in the dump, boom on death */
    const ufoT = await page.evaluate(() => {
      const engine = SG.App.engine;
      const u = engine.Spawn(new SG.UnitAlienUfo({ x: 500, y: -500 }));
      const t0 = engine.Time;
      u.ReceiveDamage(engine, null, 10);
      const flashed = u.HitFlashUntil > t0;
      const txt = JSON.parse(window.render_game_to_text());
      const inDump = txt.ufos.some((o) => o.hp === 40);
      u.Destroy(engine, true);
      const boomFx = engine.Effects.some((e) => e.type === "boom");
      return { hp: u.Health, flashed, inDump, boomFx, dead: u.Destroyed };
    });
    check("L ufo takes damage + sets hit flash", ufoT.hp === 40 && ufoT.flashed, JSON.stringify(ufoT));
    check("L text dump lists ufo hp", ufoT.inDump);
    check("L ufo death leaves a boom effect", ufoT.boomFx && ufoT.dead);

    /* M. quit to menu → new game is a completely clean slate */
    await page.evaluate(() => SG.App.quitToMenu());
    await page.waitForTimeout(120);
    await page.click("#btn-play");
    await page.waitForTimeout(350);
    const fresh = await page.evaluate(() => {
      const e = SG.App.engine;
      return {
        res: e.Resources, time: +e.Time.toFixed(1), wave: e.CurWave,
        starters: e.GetAllGameUnitsArray().filter((u) => ["conduit", "solarpanel", "harvester"].includes(u.Name)).length,
        extra: e.GetAllGameUnitsArray().filter((u) => ["laser", "conduit_wip", "laser_wip", "harvester_wip", "solarpanel_wip"].includes(u.Name)).length,
        ufos: e.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitAlienUfo).length,
        effects: e.Effects.length,
      };
    });
    check("M restart: fresh base, 200 R$, no leftovers", fresh.res === 200 && fresh.time < 2 && fresh.starters === 3 && fresh.extra === 0 && fresh.ufos === 0 && fresh.effects === 0 && fresh.wave >= 0, JSON.stringify(fresh));

    /* N. hotkeys: 1-5 pick tools, Space toggles speed */
    await page.keyboard.press("3");
    const k3 = await page.evaluate(() => SG.UI.activeToolObj.Name);
    await page.keyboard.press("1");
    const k1 = await page.evaluate(() => SG.UI.activeToolObj === SG.UI.GameTools[0]);
    await page.keyboard.press("Space");
    const sp2 = await page.evaluate(() => ({ s: SG.App.speed, label: document.getElementById("btn-speed").textContent }));
    await page.keyboard.press("Space");
    check("N key 3 = Harvester, key 1 = picker", k3 === "Harvester" && k1 === true, k3);
    check("N Space toggles 2× speed", sp2.s === 2 && sp2.label === "2×", JSON.stringify(sp2));

    /* S. visual snapshots for the review pass (toasts cleared so they don't occlude) */
    await page.evaluate(() => { document.getElementById("toasts").innerHTML = ""; SG.Renderer.cam.target = { x: 20, y: 0 }; SG.Renderer.zoomTo(2.6); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "snap-base.png") });

    const gp = await page.evaluate(() => {
      const engine = SG.App.engine, R = SG.Renderer, UI = SG.UI;
      const tool = UI.GameTools[3]; // Solar Panel ghost (wide silhouette)
      UI.SelectTool(tool);
      let pt = null;
      outer2: for (let x = -160; x <= 160; x += 8) for (let y = -160; y <= 160; y += 8) {
        if (tool.IsValidLocation(engine, { x, y })) { pt = { x, y }; break outer2; }
      }
      engine.MousePosWorld = pt; tool.Update(engine, 0);
      const sp = R.worldToScreen(pt.x, pt.y);
      return { sx: sp.x, sy: sp.y };
    });
    await page.mouse.move(gp.sx, gp.sy);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "snap-ghost-ok.png") });

    await page.evaluate(() => { SG.App.engine.Resources = 3; });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, "snap-ghost-poor.png") });
    await page.evaluate(() => { SG.App.engine.Resources = 200; });

    const bp = await page.evaluate(() => { const sp = SG.Renderer.worldToScreen(30, 0); return { sx: sp.x, sy: sp.y }; });
    await page.mouse.move(bp.sx, bp.sy);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(OUT, "snap-ghost-blocked.png") });
    await page.keyboard.press("Escape"); // back to picker

    const lp = await page.evaluate(() => { const sp = SG.Renderer.worldToScreen(30, 0); return { sx: sp.x, sy: sp.y }; });
    await page.mouse.move(lp.sx, lp.sy);
    await page.mouse.down();
    await page.mouse.move(lp.sx + 260, lp.sy, { steps: 8 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "snap-link-too-far.png") });
    await page.mouse.up();

    const up = await page.evaluate(() => {
      const engine = SG.App.engine;
      const u = engine.Spawn(new SG.UnitAlienUfo({ x: 20, y: -40 }));
      u.ReceiveDamage(engine, null, 20);
      const sp = SG.Renderer.worldToScreen(20, -40);
      return { sx: sp.x, sy: sp.y };
    });
    await page.mouse.move(20, 320);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "snap-ufo.png") });
    await page.evaluate(() => {
      const engine = SG.App.engine;
      engine.GetAllGameUnitsArray(true).filter((u) => u instanceof SG.UnitAlienUfo).forEach((u) => u.Destroy(engine, true));
      engine.Effects.length = 0;
    });

    await page.screenshot({ path: path.join(OUT, "browsertest.png"), fullPage: true });

    /* I. canvas actually renders varied content (deterministic pixel-histogram proxy for visual review) */
    const pix = await page.evaluate(() => {
      const cv = SG.Renderer.canvas;
      const off = document.createElement("canvas"); off.width = 160; off.height = 90;
      const octx = off.getContext("2d");
      octx.drawImage(cv, 0, 0, 160, 90);
      const d = octx.getImageData(0, 0, 160, 90).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
      return { distinct: set.size, w: cv.width, h: cv.height };
    });
    check("I canvas renders varied content (>=12 colour buckets)", pix.distinct >= 12, JSON.stringify(pix));

    /* H. no console/page errors during the whole run */
    check("H no console/page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
  } catch (e) {
    check("EXCEPTION", false, e && e.message ? e.message : String(e));
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
    try { server.kill(); } catch (e) {}
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + (failed.length ? failed.length + " CHECK(S) FAILED of " + checks.length : "ALL BROWSER CHECKS PASSED (" + checks.length + " checks)"));
  process.exit(failed.length ? 1 : 0);
})();
