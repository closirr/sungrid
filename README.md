# SUNGRID

**SUNGRID** is an isometric energy-grid tower defense. Sun atoms flow from your Solar Panels through the Conduits you place, forming a glowing grid that feeds every building you own. Laser Towers can be chained into each other to grow stronger and reach farther — and if you push more energy through the grid than it can carry, it overheats, and burning links take half your base down with them.

[![Play on GitHub Pages](https://img.shields.io/badge/play-GitHub%20Pages-4de1ff)](https://closirr.github.io/sungrid/)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffd94d)](https://github.com/closirr/sungrid)

## Features

**One resource: energy — and it is physical.** Solar Panels emit an energy packet every second. Packets fly 96 px/s to whatever is in range: relays pass them along, construction sites eat them to build, lasers convert them into shots. Relays (Conduits) heat up — past 100 heat, packets flying through are lost in sparks.

**Free placement.** No build grid: buildings go anywhere on the 3392×3392 map as long as they don't overlap. Stretch your grid toward mineral fields by chaining Conduits (radius 96).

| Building | Upfront | Build packets | Role |
|---|---|---|---|
| **Conduit** | 5 | 5 | Relays energy packets. Heats up under load. Drag conduit→conduit to set a fallback route. |
| **Solar Panel** | 10 | 15 | Emits 1 packet / 1s into range 96. Your power source. |
| **Harvester** | 8 | 10 | Near minerals (radius 64): 1 packet → 1 mineral → +1 R$ every 5s. Runs dry with no minerals nearby (refunds 2). |
| **Laser** | 10 | 10 | Stores up to 60 charges (+15 per packet), 1 charge = 1 shot every 0.1s, 1 damage, range 64. |

**Laser chains.** Drag laser→laser: the feeder stops shooting and feeds the receiver. Every feeder adds +1 damage; range = 64 × (1 + 0.2 × (damage − 1)). Chains recurse — a feeder of a feeder counts twice. Feeders burn their own charge while the chain fires.

**Aliens.** Raids land on a level's clock — 25–34 seconds between waves, the first one early. Raid size grows with the wave index up to the level's cap, and milestone raids bring heavy cruiser escorts. UFOs (50 HP, 5 damage/1s) fly to your nearest building and ram it, knocking it around. Kill them with lasers before they dismantle the base.

**Lose everything — game over.**

## How to play

1. Build **Solar Panels** and spread **Conduits** into a grid — every building must be in relay reach to work.
2. Put **Harvesters** on mineral deposits — they pump energy straight into the grid so your surplus (and your pool) grows faster.
3. Build **Laser Towers** along the enemy lanes and drag laser→laser to chain them for damage and range.
4. Watch link heat — too much production or too few links, and your grid starts burning.
5. Call waves early for bonus energy (+2 per unused second), or use the time to build.
6. There is no single Core to defend — the game is lost only when every building is gone.

## Controls

| Input | Action |
|---|---|
| Mouse | Pick buildings from the palette; drag conduit→conduit / laser→laser to link; click a building to inspect it and SELL it (+50% of its cost back) |
| `1`–`4` | Select building (Conduit, Harvester, Solar Panel, Laser) |
| `X` / `Delete` | Sell the selected building (+50% of its cost back) |
| WASD / Arrows | Pan the camera |
| `C` | Call the next wave early (+2 R$ per unused second) |
| `Space` | Toggle 1×/2× speed |
| `F` | Fullscreen |
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
| `node tools/hstest.js` | Headless engine tests (126 checks, no browser needed) |
| `node tools/browsertest.js` | Playwright UI checks against the real game (65 checks) |
| `node tools/qa-click.js` | Click-through QA of every screen and flow |
| `node tools/balance.js` | Autoplay bot across all levels for balance runs |
| `node tools/longplay.js` | Long-play soak: economy, manual re-routing, wave fights |
| `node tools/audit-*.js` | Targeted audits: energy network, performance, campaign scenarios |

## Tech notes

- Vanilla JavaScript + Canvas 2D with a custom isometric renderer (2:1 projection, painter's algorithm). No frameworks, no image assets — all art is drawn in code.
- Procedural WebAudio for all sound and music. No audio files.
- Deterministic test hooks for automation: `window.advanceTime(ms)` and `render_game_to_text()`.

## Credits

Mechanics inspired by *Harvest: Massive Encounter* by Oxeye Games. All code and art in SUNGRID are original.
