# SUNGRID

**SUNGRID** is an isometric energy-grid tower defense. Sun atoms flow from your Power Plants through the Links you place, forming a glowing grid that feeds every building you own. Laser Towers can be chained into each other to grow stronger and reach farther — and if you push more energy through the grid than it can carry, it overheats, and burning links take half your base down with them.

[![Play on GitHub Pages](https://img.shields.io/badge/play-GitHub%20Pages-4de1ff)](https://closirr.github.io/sungrid/)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffd94d)](https://github.com/closirr/sungrid)

## Features

### Six buildings

| Building | Cost | Role |
|---|---|---|
| **Power Plant** | 100 cr | Generates energy and anchors the grid. More plants → more sun atoms. |
| **Energy Link** | 25 cr | Carries sun atoms between buildings and unlocks nearby ground for construction. Overloads if pushed past its capacity. |
| **Mineral Harvester** | 60 cr | Must sit on a mineral deposit. Digs credits — but constantly eats energy. |
| **Laser Tower** | 50 cr | Continuous beam. LINK lasers into each other to build chains. |
| **Missile Turret** | 80 cr | Fast splash shells for packs and small fry. Hungry for energy; cannot feed other lasers. |
| **Sun Bomb** | 30 cr | Charges with energy, then detonates: 300+ area damage on click or on enemy contact. |

### Laser chains

- Click a Laser, press **LINK**, aim it at another Laser: the feeder stops shooting on its own and pours its beam into the receiver.
- Every feeder gives the receiver **×1.5 damage** and **×1.25 range** (multiplicative) — chains of 5–10 become death beams.
- Chains need ~2 s to **ramp up** to full power; **U** unlinks everything at once.
- The classic trade-off: three separate lasers hit three targets, a chain hits one — much harder.

### Sun atoms, overload and burnout

- Energy is visible: glowing sun atoms stream from plants along your links, and their density follows the real flow.
- Every link has a capacity (20 e/s at tier 1). Excess flow heats it up — at heat 60 the atoms glow red, at heat 100 the link **burns out**: it explodes with area damage and everything downstream goes offline until you rebuild.
- **Energy is speed, not on/off:** a well-supplied building constructs, reloads and repairs faster; a starved one just slows to a crawl.

### Eight enemy types

Crawlers march straight at the Core, swarms come in packs of 5–8, tanks soak damage. Kamikaze drones dive into your biggest laser cluster and detonate. Teleporters hover just beyond turret range and blink closer — only chained lasers reach them. Sappers perch on a link and drain it dry, blacking out everything downstream. Rockets are tiny and fast — you need point defense. And every campaign ends with a boss that smashes your buildings in melee.

### Three modes

- **Campaign** — 12 handcrafted levels with star ratings (1–3) and progressive unlocks.
- **Wave Attack** — 10 waves against the clock; gold, silver and bronze medals for speed.
- **Endless** — escalating threat with no limit; your best wave is saved locally.

## How to play

1. Build **Power Plants** near the Core and spread **Energy Links** into a grid — every building must touch it to work.
2. Put **Mineral Harvesters** on mineral deposits; they fund everything else.
3. Build **Laser Towers** along the enemy lanes and chain them with **LINK** for damage and range.
4. Watch link heat — too much production or too few links, and your grid starts burning.
5. Call waves early for bonus credits (+2 per unused second), or use the time to build and upgrade.
6. Protect the Core. If it falls, everything falls.

## Controls

| Input | Action |
|---|---|
| Mouse | Pick buildings from the palette; click a tower for its panel (UPGRADE / LINK / SELL) |
| `1`–`6` | Select building (Power Plant … Sun Bomb) |
| `U` | Unlink all laser chains |
| `Space` | Toggle 1×/2× speed — or call the next wave early for bonus credits |
| `F` | Fullscreen |
| `S` | Sound on/off |
| `Esc` | Cancel placement / pause |

## Run locally

No build step, no dependencies — the game is plain vanilla JS. Serving over HTTP is the only requirement.

```sh
node tools/server.js [port]   # default port 8123
# open http://localhost:8123
```

(`npm install` is only needed for the Playwright-based dev probes, not to play.)

### Dev tools

| Tool | Purpose |
|---|---|
| `node tools/validate.js` | Validates all campaign maps + arena (spawns reachable, deposits present, row lengths) |
| `node tools/energtest.js` | Headless energy-network simulation tests |
| `node tools/balance.js` | Autoplay bot across all levels for balance runs |
| `tools/shots.js`, `tools/shot-*.js` | Browser probes / screenshots (require Playwright) |

## Tech notes

- Vanilla JavaScript + Canvas 2D with a custom isometric renderer (2:1 projection, painter's algorithm). No frameworks, no image assets — all art is drawn in code.
- Procedural WebAudio for all sound and music. No audio files.
- Deterministic test hooks for automation: `window.advanceTime(ms)` and `render_game_to_text()`.

## Credits

Mechanics inspired by *Harvest: Massive Encounter* by Oxeye Games. All code and art in SUNGRID are original.
