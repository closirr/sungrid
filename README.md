# SUNGRID

**SUNGRID** is an isometric energy-grid tower defense. Sun atoms flow from your Power Plants through the Links you place, forming a glowing grid that feeds every building you own. Laser Towers can be chained into each other to grow stronger and reach farther — and if you push more energy through the grid than it can carry, it overheats, and burning links take half your base down with them.

[![Play on GitHub Pages](https://img.shields.io/badge/play-GitHub%20Pages-4de1ff)](https://closirr.github.io/sungrid/)
[![License: MIT](https://img.shields.io/badge/license-MIT-ffd94d)](https://github.com/closirr/sungrid)

## Features

**One resource: energy — and it is physical.** Solar Panels emit an energy packet every 2 seconds. Packets fly 96 px/s to whatever is in range: relays pass them along, construction sites eat them to build, lasers convert them into shots. Relays (Conduits) heat up — past 100 heat, packets flying through are lost in sparks.

**Free placement.** No build grid: buildings go anywhere on the 3392×3392 map as long as they don't overlap. Stretch your grid toward mineral fields by chaining Conduits (radius 96).

| Building | Upfront | Build packets | Role |
|---|---|---|---|
| **Conduit** | 5 | 5 | Relays energy packets. Heats up under load. Drag conduit→conduit to set a fallback route. |
| **Solar Panel** | 10 | 15 | Emits 1 packet / 2s into range 96. Your power source. |
| **Harvester** | 8 | 10 | Near minerals (radius 64): 1 packet → 1 mineral → +1 R$ every 5s. Runs dry with no minerals nearby (refunds 2). |
| **Laser** | 10 | 10 | Stores up to 60 charges (+15 per packet), 1 charge = 1 shot every 0.1s, 1 damage, range 64. |

**Laser chains.** Drag laser→laser: the feeder stops shooting and feeds the receiver. Every feeder adds +1 damage; range = 64 × (1 + 0.2 × (damage − 1)). Chains recurse — a feeder of a feeder counts twice. Feeders burn their own charge while the chain fires.

**Aliens.** Every 10 seconds a wave spawns: from wave 8 on, UFO count = (wave − 5) / 5 × 2. UFOs (50 HP, 5 damage/1s) fly to your nearest building and ram it, knocking it around. Kill them with lasers before they dismantle the base.

**Lose everything — game over.**

## How to play

1. Build **Power Plants** near the Core and spread **Energy Links** into a grid — every building must touch it to work.
2. Put **Mineral Harvesters** on mineral deposits — they pump energy straight into the grid so your surplus (and your pool) grows faster.
3. Build **Laser Towers** along the enemy lanes and chain them with **LINK** for damage and range.
4. Watch link heat — too much production or too few links, and your grid starts burning.
5. Call waves early for bonus energy (+2 per unused second), or use the time to build and upgrade.
6. Protect the Core. If it falls, everything falls.

## Controls

| Input | Action |
|---|---|
| Mouse | Pick buildings from the palette; click a tower for its panel (UPGRADE / LINK / SELL) |
| `1`–`6` | Select building (Power Plant … Sun Bomb) |
| `U` | Unlink all laser chains |
| `Space` | Toggle 1×/2× speed — or call the next wave early for bonus energy |
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
