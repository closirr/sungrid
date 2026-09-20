# SUNGRID — progress

Original prompt: Прочитай C:\Users\closirr\.zcode\workspace\default\laserlink\HANDOFF-SUNGRID.md повністю і виконуй описаний там план гри SUNGRID (фази 1–9, коміти після кожної фази). Сабагентів використовуй активно за розділом 7 — максимум 2 одночасно. Публікація — тільки GitHub Pages, без сторонніх платформ.

Головний документ: HANDOFF-SUNGRID.md у workspace laserlink (розділи 0–9).
Робоча папка: D:\Projects\games\sungrid (сесія відкрита тут; handoff згадував старий шлях у workspace — поточна директорія пріоритетна).
Референс-код: C:\Users\closirr\.zcode\workspace\default\laserlink\

## Ключові рішення

- Карта **20×20** (рекомендація handoff розд. 5 — вміщується в canvas без камери).
- Canvas 1280×720, iso 2:1 (tile 64×32).
- Глобальний неймспейс тестів: `window.SG` (було `window.LL`).
- Save key: `sungrid-save-v1`.

## Журнал

### Фаза 1 — Init (виконано)
- Скопійовано скелет з laserlink: index.html, css/style.css, усі js/*, tools/{server,pgclient,trace,validate,balance,functest,shots}.js, .gitignore.
- Пропущено itch-*/cg-* тулзи (публікація тільки GitHub Pages) і DESIGN.md (документ laserlink).
- Перейменовано: заголовки, title/logo/tagline, `window.LL`→`window.SG`, save key `sungrid-save-v1`, package.json (sungrid, playwright 1.60.0).
- Створено git-репо, `gh repo create sungrid --public`, перший пуш.
- Сервер: порт 8124 (на 8123 висить старий сервер laserlink від попередньої сесії — не чіпати).

### Фаза 2 — Iso-рушій (виконано, головна сесія)
- НОВИЙ `js/iso.js`: проєкція (TW 64 / TH 32, OX 640 / OY 58, LIFT 24), пікінг, painter-key, еліпс радіуса (коло в сітці = еліпс ×32√2/×16√2), ромб, екструдований призм.
- `js/data.js` переписано: CFG (20×20, 1280×720, кредити/енергія розділені), 6 будівель (plant/link/harvester/laser/missile/bomb) з тирами, 8 ворогів (фаза 5), wavePoints = 10×threat^1.2, fallback TEST_MAP 20×20; LEVELS/ENDLESS беруться з window.MAPS коли maps.js підключено.
- `js/game.js` переписано (фаза 2 скоуп): карта (. # M W S K), мережа = flood core+plants+links, canPlace (в тому числі «ворог на тайлі» — урок 4), кредити, будівництво built 0..1 (4с→2с від supply), harvester дохід, стаби linkLaser/unlinkAll/callWave.
- `js/entities.js`: Tower (built/supply/heat/chain-поля), Shell у grid-просторі, Particle/Floater у px.
- `js/render.js` повністю iso: статичний шар (підлога-ромби з хеш-шумом, скелі-призми, кристали M/W, ворота, п'єдестал ядра), painter-сортування динаміки, будівлі-призми з прогресом будівництва, ghost + еліпси радіусів, hover.
- `js/ui.js`: ISO.pick замість cellAt, палітра 6 будівель, HUD credits/energy-gen-demand, панель (supply/heat), Shift+клік = розлінк, U = unlink all (стаби).
- `js/main.js`: render_game_to_text під sungrid (credits/energyGen/Demand/buildings з built/supply/heat/hover), window.SG з ISO.
- `index.html`: canvas 1280×720, script order + iso.js, HUD-чіпи credits/energy, howto-копія sungrid.
- Приймання: пікінг клік (672,362)→тайл (10,9) ✓, лінк ставиться й будується ✓, скріншот iso-карти валідний ✓, 0 помилок консолі ✓.

### Фаза 3 — Енергомережа (виконано; сабагенти A+B злиті)
- Модель потоку (game.js `energyTick`, тік 0.1с): релеї = ядро+plants+links; BFS ВІД ЯДРА (єдиний корінь); споживачі тягнуть по найкоротшому шляху (hops-first), виділення НЕ капиться по лінку — перевищення = нагрів. Надлишок генерації циркулює деревом (перевиробництво теж перевантажує).
- Нагрів: load = max(потік до батька, сума потоків дітей) — транзит не рахується двічі; heat += over×K_HEAT×ETICK, охолодження K_COOL. heat≥60 → червоні атоми + дзвін + тост; heat≥100 → burnout: вибух, 60 шкоди сусіднім будівлям, downstream стає безживним островом.
- Атоми-кульки (render.js drawEnergyLinks): кількість ∝ потоку (ATOMS_PER 5 e/s), колір gold→orange→red по heat, пульс-ромби на гарячих лінках; споживчі ребра (атоми залітають у будівлю).
- supplyRatio: згладжування attack 8/s / release 2.5/s; впливає на швидкість будівництва (4с→2с) і дохід харвестера.
- Сабагент A: js/maps.js (12 кампанійних + арена, валідатор 13/13, туторіали укр.) + tools/validate.js (20×20, BFS без зрізання кутів). Інтегровано: script maps.js ПЕРЕД data.js, LEVELS/ENDLESS підхоплюють MAPS.
- Сабагент B: js/audio.js — збережено весь API, додано Snd.overcharge (дзвін, тротлінг 1.2с), Snd.burnout, Snd.missile, Snd.zap, Snd.atoms(level).
- Тести: tools/energtest.js (vm-стенд, 16 OK — gen/brownout/burnout/island/deposit/online); tools/shot-energy.js і tools/shot-overload.js (браузерні проби: атоми течуть, heat 8→100 за ~7с, burnout + червоні ромби + тости, 0 помилок консолі).
- БАГ-ФІКС: `_inNet` не скидався між recomputeNetwork → вежа випадала з netNodes (успадковано з laserlink). Фікс: скидання прапорця на кожному фладі.

### Фаза 4 — Будівлі і лазер-ланцюги (виконано, головна сесія)
- Лазер-ланцюги (USP): linkLaser/unlinkLaser/unlinkAll; ×1.5^n DPS і ×1.25^n дальності на приймач (ланцюг A→B→C = 2 фідери на C), cap MAX_FEEDERS 8, захист від циклів (хід по linkTo), ramp 0→100% за RAMP_TIME 2с; фідер не стріляє сам.
- UI: кнопка LINK/UNLINK контекстна; Shift+клік по фідеру = розлінк; U = unlink all; бомба — DETONATE у панелі при повному заряді.
- Бій: таргетинг по flow (найближчі до ядра), DPS × (0.3+0.7×supply); missile — перезарядка × (0.4+0.6×supply), снаряди з AOE-шкодою; бомба — заряд 40 е (8 e/s × supply), детонація від контакту ворога/кнопки, 300 AOE 2.5; саморемонт × supply.
- Енергія: firing-дренаж (laser +4, missile +7, bomb charge 8 e/s) у energyTick.
- Каркас ворога (grid-простір): flow-стерінг, axis-separated колізія (без зрізання кутів), гризіння при блокуванні, контакт-детонація бомб, core hit; малюнок базових форм усіх 8 типів (повна поведінка — фаза 5).
- БАГ-ФІКСИ: (1) effDps містив ramp-фактор + updateLaser додавав свій → нелінковий лазер втрачав 75% DPS; (2) правило з'єднання мережі min(range) ламало лінки на відстані 3..3.5 від ядра → тепер вузол підключається коли ІСНУЮЧА мережа його дістає (n.range), а ребра релеїв — по max(range).
- Тести: energtest тепер 27 OK (ланцюги ×1.5/×2.25/cycles/unlinkAll, laser kill + reward, бомба-контакт + splash, missile shell, brownout 1.0/0.0); tools/shot-chain.js — браузерний пробіл: білі фідер-промені, boost у панелі, 0 помилок.

### Фаза 5 — Вороги і хвилі (виконано, головна сесія; бот — окремим комітом від сабагента B)
- Threat-хвилі: бюджет 10×threat^1.2×mult, пул рівня з maps.js (unlockWave), swarm пачками 5-8, бос на фінальній хвилі L12 і кожну 10-ту в Endless; callWave(early) з кредитним бонусом, хвиля очищена → бонус + перерва; перемога після останньої хвилі кампанії.
- Спец-поведінки: kamikaze (пікірує в щільний кластер laser/link, ігнорує лабіринт, детонує 60 AOE 1.5), teleporter (ховер поза звичайною дальністю, блінк 2 клітинки до ядра кожні 4с — карає нелінковані лазери), sapper (ленчиться на лінк, п'є 15 e/s, downstream повний блекаут через sapped-маркування шляху), boss (смэш 40 AOE 1.8 кожні 5с), rocket/tank/swarm — базовий похід.
- БАГ-ФІКС: сапер, убитий на ланчі, лишав лінк _sapped назавжди → damageEnemy відпускає лінк; energyTick скіпає мертвих саперів.
- БАЛАНС-ЗМІНА: kamikaze hp 20→30 — одиночний лазер не встигає збити на підльоті (юніт-покарач має доходити).
- Тести: energtest = 38 OK, зокрема T13 — повна перемога L1 (3 хвилі, ланцюг ×3.375, зірки збережено); браузерний пробіл tools/shot-battle.js — реальний бій хвилі, brownout під стрільбою (supply 0.5 при gen 4/demand 15), 0 помилок.

### Фаза 6 — Меню і режими (виконано; сабагент A злив README + переклад карт)
- Режими: Game(levelIdx, mode) — campaign | wave | endless; арена для wave/endless; wave = 10 хвиль на час (runTime), медаль GOLD ≤6:00 / SILVER ≤9:00 / BRONZE, Save.setWaveBest; endless — рекорд хвиль.
- Вибір рівня: 12 кампанійних кнопок + WAVE ATTACK (відкривається після L5) + ENDLESS (після L8) з бестами.
- Win-екран: кампанія — зірки за ціліст ядра; wave — медаль + час; lose — контекстні тексти. HUD-чіп хвилі показує таймер у wave-режимі.
- Розблокування будівель: у wave/endless доступна вся палітра, у кампанії — по рівню.
- Deep links: ?level=N, ?mode=wave, ?mode=endless.
- Сабагент A: maps.js → всі назви/туторіали англійською (валідатор 13/13, кирилиці 0), README.md створено (фічі/керування/запуск/тулзи/credits). LICENSE (MIT) додав головною сесією.
- UI-рішення: мова гри — англійська (як у laserlink; туторіали перекладено), комунікація з користувачем — українська.

### Фаза 5-7 (бот) — сабагент B
- js/bot.js переписаний під sungrid-API (10 правил: guard-не-будувати-під-гризінням, стал-бомба проти сапера, bootstrap лазер→лінк→харвестер→plant, save-for-plant, ланцюги ≤4 фідерів з far-mode, place+undo з антибоксингом, кластеризація родовищ).
- tools/balance.js — vm-стенд 12 карт × reps + Endless, watchdog, results.json.
- ФІНАЛЬНИЙ БАЛАНС (після тюнінгу фази 7): L1-L10 100%, L11 67%, L12 67% (core 21%), Endless до 14 хвилі, 0 stuck — всі цілі handoff виконані (L1-8 ~100%, L9-12 50-80%, Endless 12+).

### Фаза 7 — тюнінг (головна сесія)
- boss.hp 3000→2500 (L12 core 12-27% → 21%+), хвильовий бонус 30+10w → 30+12w.
- КРИТИЧНИЙ ФІКС від B: Game.spawnHitParticles губнувся при інтеграції — ворог при гризінні будівлі валив гру (entities.js:124). Відновлено.
- tools/trace.js: додано iso/save/maps у список скриптів (падав на ISO.px).
- Прийняті нотатки B: sapper-блекаут залишено жорстким (свідоме рішення), detonateBomb без перевірки charge — гейтиться UI-кнопкою.

### Фаза 8 — тести і скріни (сабагенти A+B, злито головною сесією)
- tools/functest.js: 8 пасів реальних кліків (палітра→канвас з ISO-математикою через boundingBox, LINK-флоу лазер→лазер ×1.50→×2.25, Shift+клік розлінк, бомба DETONATE, overload→burnout, HUD-кнопки, Esc-пауза). 3 прогони стабільні, 0 помилок. Валіжна знахідка: net-геометрія евклідова — для overload-тесту plants треба поза радіусом ядра.
- tools/shots.js: 11 повносторінкових скрінів (title/howto/select/×2/game×3/pause/win×2/lose) в output/shots/. Знахідка: --use-gl=angle+swiftshader вішали page.screenshot після першого capture (канвас 2D — прапорці не потрібні).
- Фікси після рев'ю скрінів: App.state тепер синхронізується на win/lose (Esc/blur не відкриють паузу поверх перемоги), прибрано дубльований 🔒 на замкнених кнопках режимів, пробіл у заголовку панелі.

### Постр phases: Фікс лазера з L1 + ЕКОНОМІКА v2 (рішення користувача)
- **Фікс (скарга користувача «чим відбиватися на L1»)**: Laser Tower unlock 2→0 — лазер доступний з 1-го рівня; L3 лишається туторіалом про ланцюги. L1-туторіал тепер прямо каже поставити лазер.
- **ЕКОНОМІКА v2 — одна валюта: ЕНЕРГІЯ** (користувач: «за енергію будується, не за монетки за вбитих»):
  - `g.energy` — ПУЛ (старт 200, CFG.START_ENERGY); будь-яка будівля купується пулом, включно з power plant; sell/upgrade теж з/в пул.
  - Надлишок виробництва (gen − demand) банкиться в пул щокадру → дилема «будувати vs відбиватися» реальна: лазер, що стріляє, з'їдає 6 e/s надлишку.
  - Харвестери = генератори на родовищах: rate 8/11/14 (×1.75 W) прямо в генерацію сітки, drain 4/5/6 лишився; в gridGen через supply попереднього тіка (без циклу).
  - Вбивства НЕ дають валюти (kills лічильник فقط). Бонуси: ранній CALL (+2/с) і зачистка хвилі (30+12w) — в пул.
  - HUD: один чіп — пул + net-потік (зелений/червоний); render_game_to_text: `credits`→`energyPool`, income = net.
- Джерела по оригіналу підтвердили, що будівлі в Harvest платять енергією (IndieFAQs: "cost credits and energy"); користувач звів до однієї валюти — енергії.

### Реворк v3 (за вимогами користувача: «масштабніше, атомне будівництво, світліше, складніше, без довгих ботів»)
1. **Карта 32×32** (з 20×20): усі 13 карт перемальовано (сабагент A; впав на фініші через збій моделі — полагоджено вручну зайвий `},` у кінці), валідатор 13/13. Родовище тепер ЗНАХОДЯТЬСЯ далеко — до них прокладаються лінки (сенс великої карти). Спавни ≥10 тайлів від ядра.
2. **Камера**: Renderer.cam {x,y,z}; fitZoom ~0.57 (вся карта видно), зум колесом 0.54..1.8 (до курсора), пан — перетягування правою кнопкою (клік без руху = скасувати placement, як і було), стрілки. Пікінг крізь камеру (UI.pickAt). ISO.px переведено на світові координати (OX = центр статичного полотна 1024, OY = 110) — частинки/флоатери консистентні з рендером.
3. **Атомне будівництво**: жодних таймерів. Недобудована будівля = споживач сітки (want 22 e/s = CFG.BUILD_RATE); прогрес built += delivered×dt/cost. Немає сполучення з сіткою → не будується взагалі. Атоми видно, як вони течуть у будмайданчик. Пул платить повну ціну при постановці (v2Mechanik збережено).
4. **Світлий візуал**: render.js повністю перемальований (PAL: теплий пісок #d8d2ac/#cec7a0, білі будівлі з кольоровими дахами, скали-сірі, бірюза/золоті кристали, промені — насичена рожево-червона гама замість additive-неону, який вимивається на світлому). CSS — світла пергаментна тема (панелі #fffdf6, текст #3a4034, акцент #3fa7d6).
5. **Складність +**: HP_SCALE 0.19→0.23, kamikaze hp 30→40 (один лазер не збиває на підльоті), FIRST_BREAK 40 (великій карті треба час), CORE_GEN 6, CORE_RANGE 4.
6. **Без бот-прогонів** (вимога користувача): баланс-саніті = energtest T13 (повна перемога L1 на нових механіках, 3 хвилі, core 100%, зірки збережено).
7. energtest переписано на map-agnostic координати (spot/near/hookUp — скан навколо ядра, прокладка лінків до родовищ) — 17/17 OK.

## TODO / нотатки
- Гра на цьому етапі — робочий скелет laserlink під іменем SUNGRID; фази 2–8 переписують рушій на iso. (фази 2-3 зроблено)
- bot.js поки від laserlink (не викликається до фази 5) — перепишеть сабагент B.
- **Мова UI змішана** (палітра/тости англ, туторіали укр) — фаза 6 робить повний уніфікований прохід локалізації.
- Дрібний артефакт: idle-дренаж лінка може рахуватись через сусідній релей (0.5 e/s) — прийнятно, не впливає на геймплей.
- Дублікати flowEdges (релей+споживче ребро з тими ж координатами) — лише трохи яскравіші атоми, ок.

## Harvesturr UI migration — finish (auto-continue, 2026-09-15)

Continued the interrupted structural port to the new `HSEngine` runtime (js/hsgame.js).

### What was completed
- **js/ui.js** — finished the migration off the removed `Sim` API:
  - `updateHUD(engine)` → `engine.Resources`, `engine.CurWave`, `engine.NextWaveSpawnTime - engine.Time`, `engine.Time`.
  - `refreshUnitPanel` keyed by `u.Name` (conduit heat/100, laser charges/damage/range/feeder, harvester charges, `*_wip` BuildCostRemaining, ufo Health, mineral MineralCount).
  - `pickUnit` via `engine.GetAllGameUnitsArray()` + `GetBoundingRect()` (dropped the dead `Utils2`).
  - `onKey` 1–5 → `SelectTool(GameTools[n-1])`; `showLose(engine)`; `btn-restart`/`btn-retry` → `app.newGame()`; middle-click → `Renderer.zoomTo(2)`; `btn-continue` wired; added the `UI.UpdateInput` per-tick hook the engine expects.
- **js/ui.js bugfix (found by the browser test)** — `onPointerMove` now calls `updateMouse()` and `onPointerDown` refreshes `tool.Update()` before the press. Previously `engine.MousePosWorld` was only set on pointerdown/up, so placement validity (and the green/red ghost) was judged at the *previous* mouse position. Now mirrors the reference order: per-frame `GameEngine.Update` → `tool.Update` → `OnWorldClick`.
- **js/main.js** — restored `togglePause()` (engine.PauseGame + pause screen), window-blur auto-pause, `continueGame()` + CONTINUE button shown after quitting a live game; removed the dead `SIM_DEFS` from `window.SG`.
- **js/hsgame.js** —
  - `ClearGameState` no longer clears `OnLoseCheck` (lose detection was dead after the first newGame).
  - Map-generation fidelity fix: `HSMap.RandomMineralPoint` used `HSUtils.RandomPoint(200)` (a disc around the origin) instead of the reference's `GameMap.RandomPoint` (a uniform point inside the map rect) — so all ~750 minerals piled within ~320px of the centre. Added `HSMap.RandomPoint(distanceFromBounds)`; minerals now spread across the whole 3392×3392 map (probe: maxDist 1999, 602/751 beyond 800px, previously everything inside 320).
- **.gitignore** — added `.codegraph/` (tool cache, ~7 MB).
- **tools/browsertest.js** — NEW Playwright functional test (replaces the Sim-era functest.js/shots.js): starts the static server itself, real pointer clicks, asserts boot / new game / HUD / palette / placement(-5 R$) / packet-driven construction / pause-resume / render_game_to_text / canvas pixel histogram / zero console errors.

### Verification (all green)
- `node --check` on all `js/*.js` and `tools/browsertest.js`.
- `node tools/hstest.js` → **all harvesturr-port tests passed** (H1–H13; H12: 750 minerals, 553 far, 115 mega).
- `node tools/browsertest.js --port 8131` → **ALL BROWSER CHECKS PASSED (12 checks)**, 0 console/page errors. Screenshot: `output/web-game/browsertest.png`.

### Stale tools removed
`tools/functest.js`, `tools/shots.js`, `tools/trace.js` (targeted the removed Sim/grid APIs) deleted — superseded by `tools/browsertest.js` / `tools/hstest.js`.

### Final live verification (2026-09-15)
- Local: `node tools/hstest.js` all pass; `node tools/browsertest.js` 12/12.
- Published site (closirr.github.io/sungrid): serves current build (hsgame.js 200, scripts util/audio/save/hsgame/render/ui/main).
- Live e2e via Playwright: boot → newGame → 754 units (750 minerals + starters) → select Conduit → click places WIP, −5 R$ (50→45) → energy packet delivers → real conduit appears; 0 console/page errors. Placement with 0 R$ is correctly rejected (reference-faithful economy: income comes from the harvester, +1 R$ per 5s).
- Pages build fixed by root `.gitmodules` (commit c968634) — checkout previously failed with exit 128 on the reference/Harvesturr gitlink.

### TODO / next agent
- Visual pixel review of the screenshot was not possible in the agent runtime (image model unavailable); a deterministic pixel histogram (62 colour buckets) is used instead. A quick human glance at the screenshot is recommended.
- Reference SFX for `building_finish_constructing` / `harvester_laser` are not wired (only explosion/hit are).
- Hover tooltip (reference `GUI.DrawTooltip`) is not ported.
- Economy (start at 0 R$, harvester-dependent income) is faithful to the reference; tune only if the user asks.

## Playability fixes after user playtest (2026-09-15, bug report from gameplay video)

Root causes found and fixed:
1. **window.UI / window.App were undefined** — top-level `const` bindings are not window properties, but hsgame.js calls `UI.UpdateInput` via `window.UI` (engine never ticked tool.Update -> placement ghost was permanently red "can't afford" even at valid spots). Fixed by publishing `window.App` / `window.UI` in main.js before App.start().
2. **Canvas was never cleared** -> frame smearing / hall-of-mirrors (the "everything smears" in the video). render() now fills PAL.bg every frame.
3. **Finished buildings were invisible**: drawUnitWorld called prism() with a missing argument (NaN geometry) and the solar tint key was "solar" instead of "solarpanel" (early return). Buildings now render as iso prisms sized from TexWidth/TexHeight.
4. **720p buffer stretched over the window** ("blurry") -> fitCanvas now sizes the buffer to the real window x devicePixelRatio (cap 2), camera offset = screen/2 (reference resize behaviour).
5. **Silent rejection at 0 R$** felt like "clicking does nothing": palette cards gray out (.nopay) when unaffordable, ghost shows a price tag and turns red, clicking unaffordable placement toasts "Not enough R$ ... harvester earns R$ from minerals".
6. **Unexplained flying dots**: FIRST STEPS hint panel on the first new game (packets = energy, money = harvester+minerals, tools 1-5, UFO timing); wave chip says "UFOs arrive at wave 8 (build up!)" until then (reference formula: floor(((w-5)/5)*2), first UFOs at wave 8 ~80s). Locked behind tests H14.
7. Voice lines in the user's video are NOT from the game (audio.js is 100% procedural WebAudio; no speech synthesis, no external assets).
8. Level select (bug-report item 5): not applicable — the port is a single endless map by design (reference GameMap.Load).

Tests: hstest 15/15 (new H14 wave timing), browsertest 21/21 (new: native-res buffer, hint panel, honest wave chip, nopay cards, ghost validity via window.UI, unaffordable-click toast, corrected screen->canvas coords for the native-res canvas).

## UX round 2 from second gameplay video (2026-09-15)

1. **Floor void (the big one)**: ground iteration bounds were derived from only two opposite screen corners; in the iso lattice the extremes of the a-axis live at the OTHER two corners -> the floor rendered as a diagonal band with void corners (invisible for weeks because bg ~= floor colours; red-bg debug render exposed it). Fixed by sampling all four corners with the lattice-consistent inverse (a = x/TL + y/TH, b = x/TL - y/TH); ground pass also clips to the map island. Pixel-probe: all 4 screen corners now floor-coloured.
2. **Pan inverted** to grab-the-terrain (world follows the mouse): drag delta negated in UI._panning.
3. **Build-mode cancel**: Esc (when a builder tool is active) and right-click-without-drag return to Select/Link; a real right-drag pan still does not cancel (6px threshold). Esc with picker active still pauses.
4. **Palette icons** are now iso prisms generated from the same dims/colours as the in-game models (SVG), picker shows a cursor glyph.
5. **Harvester pre-placement radius**: already drawn (dashed green 64px + mineral links) — verified by screenshot; was broken only by the earlier window.UI bug.
6. **Packet dead-ends**: reference destroys the packet (no stacking) — added a gold fizzle ring at the death point so the loss is visible.
7. **Harvester feedback**: floating "+1" text on each mineral converted (also visible: res increments).
8. **Hint panel** auto-hides after 14s (was: stayed until dismissed).

Tests: hstest 15/15, browsertest 23/23 (new: Esc cancels tool, right-click cancels tool, pause still on second Esc).

## Dev start funds (user request, 2026-09-15)
- `HSEngine.StartMoney = 200` — new games start with 200 R$ so the whole palette
  can be playtested immediately. Reference 1:1 is 0 R$: set `StartMoney` back to 0
  in js/hsgame.js to restore the true economy (income only from the harvester).
- Tests updated: hstest H13 asserts start = StartMoney; browsertest B expects the
  HUD to show 200, section D zeroes funds first to exercise the unaffordable path.
- hstest 29/29, browsertest 23/23.

## Visual clarity sprint #1 (user review, 2026-09-15)
Scope = user's own "first sprint" cut: distinct buildings, contrast, unambiguous
placement, energy-network state, obvious enemies.

1. **Distinct silhouettes** (render.js redraw): Solar Panel = wide tilted panel with
   a bilinear 4x2 grid of blue cells; Conduit = pedestal + ring node whose glow heats
   blue->orange->red and pulses while relaying; Harvester = tracked body + boom arm
   that aims at the nearest mineral + spinning drill + gold mining beam; Laser = tall
   turret with rotating barrel (keeps last aim) + charge dot; WIP = shimmering
   hologram of the final building + dashed footprint + growing gold progress diamond.
   All buildings got contact shadows; palette icons are now rendered FROM the real
   silhouettes (icon == model forever).
2. **Contrast / colour system**: darker desaturated backdrop, graphite outlines,
   blue=energy (packets, links, ranges, laser charge), yellow=money/minerals (crystals,
   +1, progress), green=valid/working, orange=overheat/no-energy (heat ring, NO ENERGY
   markers, poor ghost), red=enemy/damage/forbidden, white UI.
3. **Unambiguous placement**: ghost now 3 states — green (ok), orange "NO FUNDS"
   (poor), red + prohibition symbol + "BLOCKED" (overlapping); price tag always
   "-N R$"; green flash + dust + Snd.place on success, Snd.error on rejected click;
   money charged only on valid placement (verified).
4. **Energy network**: drag-link preview exactly mirrors the release outcome — green
   line = will link, red + reason (TOO FAR / INVALID TARGET / ALREADY CONNECTED),
   source range circle shown (turns red when invalid); candidates pulse on hover;
   link success fires blue rings at both ends; conduit links are animated marching
   dashes (flow direction).
5. **Obvious enemies**: UFO = saucer with purple outline, cyan dome, red running
   lights, hover bob; red HP bar when damaged/hovered; white hit-flash on anything
   that takes damage; red sparks at UFO attack impact; explosion ring + debris on
   death.

Real bug found by the new tests: IsValidLocation fed a rect into the point-Pick, so
only the top-left corner was tested — buildings could partially overlap. Fixed to
PickRect (reference Pick(Rectangle) 1:1). Also: toast() no longer stacks identical
messages; HP/heat/charge bars clamp to the viewport; F = fullscreen; text dump lists
ufo hp.

Tests: hstest 29/29, browsertest 38/38 (new: J ghost 3 states, K link preview
reasons + real link, L ufo flash/hp/boom, M clean restart, N hotkeys 1-5/Space).
Judge pass on 6 screenshots after fixes (red range circle on invalid drag is by
design: whole preview turns red = forbidden).

## Automation & readability round (user feedback list, 2026-09-15)
1. **No more Select/Link tool** (user request: automatic intuitive connections).
   Select mode = no active tool (click inspects units, Esc/right-click return to it);
   palette is 4 cards, keys 1-4. Conduits AUTO-LINK: an unlinked conduit grabs the
   nearest unlinked conduit in 96px (one-way hop, no packet bouncing, self-heals on
   death). Lasers AUTO-FEED: an unlinked laser becomes a feeder of the nearest
   unlinked laser in 64px; chains stack damage exactly like reference manual links
   (LinkLaser's cycle guard rejects bad topologies; uncharged feeders add 0 dmg —
   reference rule). Blue marching chevrons show flow direction on links.
2. **Harvester readability**: dashed green coverage circle + gold mineral links are
   now ALWAYS visible (brighter on hover); persistent faint mining beam to the aimed
   mineral, flaring gold with sparks at each conversion; green charged pip / orange
   "needs energy" pip on the body; NO ENERGY diamond when gray.
3. **Gradual construction**: everything spawned lands softly (rise-in + scale over
   0.35s, engine.Spawn stamps SpawnTime) — WIP completion no longer pops in; WIP
   hologram solidifies with progress (alpha 0.14→0.55).
4. **Livelier energy** (user choice of "increase particles OR starting buffer"):
   PacketInterval = 1s per solar panel (dev tweak, reference 2s — set back for 1:1);
   StartMoney 200 already covers the money buffer.
5. **Placement zone**: exact collision-size footprint diamond with corner brackets
   + soft state-coloured halo under the silhouette ghost (was one oversized diamond).
6. **Laser powering made explicit**: unit panel shows role (Feeder →/Receiver),
   feeders count, auto-connect range; flow arrows on feed lines.
7. Prohibition symbol on blocked ghost enlarged + white backing disc.

Tests: hstest 36/36 (new H15 conduit auto-link incl. leaf/no-bounce + out-of-range +
death relink, H16 laser auto-feed + chain 2@76.8 + independence), browsertest 38/38
(K rewritten to auto-link/auto-feed, C/F/N under the 4-tool palette, select-mode
inspect check). Judge pass on all 6 snapshots.

## Ghost footprint fix (user report: "зелений ром непонятно що маркує")
- Symptom: placement marker was a tall `tw × th` rhombus centered on the building's base anchor, so half of it hung in empty ground below the sprite ("непонятне місце знизу").
- Fix: ghost marker is now a FLAT ground pad `tw × tw/2` under the building's feet — the same pad shape the construction site (WIP) already draws. Sprite stands ON the pad; corner brackets + halo rescaled; labels moved to `hh+16/hh+28`.
- Placement/install logic untouched: ghost, WIP hologram and the finished building all share the anchor (cursor = building base), collision stays 1:1 with the reference AABB (`GetBoundingRect` centered on Position, size = texture).
- Tests: hstest 36/36, browsertest 38/38; judge pass on snap-ghost-ok/poor/blocked.

## Conduit load meter + overload feedback (user report: "один вузол не перевантажується")
- Verified by simulation: overload mechanics are ALREADY identical for one node and for chains (heat +1 per packet arrival, −2 per 0.2s decay, >100 destroys the packet — 1:1 reference). A single bombarded conduit climbs to heat 66-100 exactly like a 2-node chain. The catch: heat stays ~0 below ~10 packets/s, so nothing was visible.
- Added visual-only load meter (user-requested addition): conduit tracks packets/s hitting it (1s rolling window, EMA-smoothed). Nothing in the sim reads it.
- Bar above the conduit: fill = max(load/10, heat/100); blue = normal relay, orange ≥ 70%, red when overheating. Appears from the first steady packets — the "полоска, коли енергія б'є, але нікуди не йде".
- Unit panel: conduit shows "Heat X/100 · Load N/10 pkt/s" + OVERLOAD / Heavy load warnings.
- Note: dead-end packets bounce panel↔conduit (reference-faithful), so bombardment reads even higher than the panel rate.
- Tests: hstest 40/40 (new H17: single node overloads same as chain, load meter tracks rate, idle = 0), browsertest 39/39 (new K2 + snap-hot), judge pass.

## Floor lattice sign fix (user report: "сіра область наїзджає до центру при зумі")
- Root cause: drawGround's inverse lattice formula had a sign error — for x=(a−b)·TL/2, y=(a+b)·TH/2 the inverse is a = x/TL + y/TH, b = y/TH − x/TL, but the code had b = x/TL − y/TH. The a/b ranges sampled from the screen corners were therefore wrong, so the drawn floor was a warped region: whole screen areas got no tiles (near the map edge), and the void boundary ran along lattice diagonals and crawled across the view when zooming.
- Fix: one-line sign correction (+ comment). Floor now covers the island square (±1696) fully at every zoom/pan; island border = clean axis-aligned edge with the strokeRect outline. Camera stays free like the reference (void visible only past the island edge).
- Verified with edge probes at left tip (z 1.6 / 2.4), bottom edge (z 1.6), zoomed out (z 0.7): full coverage everywhere.
- Tests: hstest 40/40, browsertest 39/39, judge pass (snap-base, edge-left-tip, edge-zoom-out).

## Manual drag-link (user request: "зажимаю на вузлі і перетягую на інший — має направити енергію; другий раз — прибрати")
- New gesture in select mode: press a conduit/laser, drag onto another node, release → link; the SAME drag again → unlink (toggle, per user request). Drag released on nothing valid clears the node's link (reference GameToolPicker.OnMouseDrag rule). Range rules 1:1 (conduit 96, laser current AttackRange).
- Engine helper HSManualLink(engine, a, b) ports the reference rules + toggle + link effects; nodes touched by hand get ManualLink = true and leave the auto-connect/auto-feed pool for the session (so auto-link can't undo manual routing).
- Visuals: dashed blue range circle on the dragged node, line to the cursor — solid green = will link, dashed orange = will remove, red dashed = out of range; pulsing marker on the target. Standard hover-range circles suppressed during the drag (judge feedback: two same-radius circles read as swapped centers). Also fixed a latent bug: the laser hover range circle used GetAttackRange (undefined) and never drew.
- Panel: conduit/laser show manual state ("Manual link — drag again to remove" / "Manual — drag to another node"). Hints (FIRST STEPS + start toast) mention the gesture.
- Tests: hstest 46/46 (new H18: link/toggle/no-auto-relink/drag-to-invalid/laser toggle), browsertest 41/41 (new K3: real-mouse drag links and unlinks + snap-draglink), judge pass.

## Laser link system (user report: "лазер якось з'єднується — треба крутая зручна система лінкування")
- Root-cause bug found: the drag-link visual read the laser range via GetAttackRange (undefined in our port) — dragging a laser onto a laser ALWAYS drew the red "out of range" line even though the link actually worked. Fixed to from.AttackRange. This alone made laser linking feel broken.
- Placement preview (ghost): while the conduit/laser tool is active, HSAutoLinkPreview simulates the real auto-link rule in spawn order (each free node links to its NEAREST free node in range; the new node links last) and draws exactly the links that will form: dashed arrows from nodes that will feed the new one + a "CHAIN N DMG · RNG R" chip for lasers. No lines = building here stays unconnected. Solar panel keeps the plain "packets to any conduit in range" lines.
- Drag upgrade: directional arrowhead on the link (feeds are directional), result chips above the target — "FEED +N DMG" (N = source's potential chain damage) / "REMOVE LINK" / "TOO FAR" / "ROUTE ENERGY" for conduits.
- Hover/selection readout: the laser's whole chain lights up (bright feeder lines + arrowheads both ways) and a floating chip shows "UNPOWERED · CHAIN N DMG · RNG R" (hover-only; selected unit's numbers live in the unit panel — two chips from a selected + hovered tower pair overlapped, judge caught it).
- Panel: feeder shows "+N dmg to its chain" + retarget/release instructions; receiver shows "Fed by N lasers — chain N dmg, range R" with potential (charge-independent) numbers.
- New helpers (exported on SG for tests): HSPotentialDamage / HSPotentialRange (chain damage ignoring current charge — AttackDamage reads 0 while unpowered, hiding the chain structure) and HSAutoLinkPreview(engine, pos, kind).
- Tests: hstest 52/52 (new H19: preview honesty — pair wins over ghost, lone laser feeds, out-of-range, manual exclusion, conduit 96px; potential dmg/range), browsertest 49/49 (new K4: real-mouse laser drag toggles off/on, panel wording, preview checks + snap-laserdrag/-drag2/-laserghost/-laserchain), judge pass on all 4 after chip-overlap fix.

## Harvester mining cycle animation (user report: "ми вже про це говорили, а ти так і не зробив — хоч щоб видно було добичу: рука/вишка/полоска, дійшла вверх — оп, і +1")
- The old animation was sub-perceptual: static boom, constant drill spin (no rhythm), 1.2px beam with a 0.3s gold flare every 5s (~6% duty). Now the drill runs a legible cycle driven purely by existing sim fields — zero mechanics changes.
- Cycle (renderer math off NextUpdateTime + HarvestFx*): the drill head rides the boom from the body out to the nearest mineral face over the 5s slow-tick (smoothstep, beam strengthens as it closes in), strikes on the tick (+1 R$ float, pulsing gold beam flare + sparks at the face — the engine's existing HarvestFx window), then retracts. Drill spin scales with proximity.
- Added a small gold progress bar above the harvester (fills as the strike approaches, drains on the pop; detail zoom only). Starved (gray) harvesters park the drill.
- Tests: hstest 56/56 (new H20: tick rhythm readable from NextUpdateTime, strike arms HarvestFx*, starved never strikes), browsertest 49/49 (new K5: snap-harvester mid-rise + snap-harvester-pop strike). Judge caught two staging issues — real-time race (fixed by freezing the sim with engine.PauseGame during staged shots; render loop keeps drawing) and a leftover pre-pause starved tint suppressing the FX — final pass on both frames.

## Overload bar at any zoom (user report: "чому я повинен приближати, щоб побачити полоску перевантаження?!")
- Root cause: all status bars were gated on engine.DrawZoomDetails, which ui.js sets to `zoom >= 2` — zoom out below 2 and the overload bar vanished.
- Fix: the conduit load/heat bar now renders at ANY zoom (bars are screen-space 48×8, so zoom never affected legibility — only the gate did). Appearance threshold per the user's rule: bar shows from ~5 pkt/s load ("5 зарядів") or any accumulated heat > 0 (packets already being lost — red, never hidden); below that the node stays clean.
- Laser charge bar also ungated (readiness must read from afar); shows only while it has charges (grey tint already marks starving towers).
- Tests: hstest 56/56, browsertest 50/50 (K2 now screenshots the hot conduit at zoom 1.2 and hard-asserts the bar is in the DrawWorld list below the detail threshold), judge pass on snap-hot at 1.2.

## Build grid + sprite-sized footprints (user report: "кордони незрозумілі; тайл більший за спрайт — як це можливо?"; не виходило ставити панелі рядишком)
- Root cause: placement blocked with texture-size AABBs (32×32 for a panel) — in iso that square covers far more ground than the drawn base diamond (36×18) and pokes out below/above it, so "BLOCKED" fired with no visible reason. The reference does the same (user-authorized deviation here).
- Footprints (HSFootprintWidth): every building now blocks EXACTLY its drawn iso base diamond — panel 36×18, conduit/laser/harvester 16×8, minerals 12/18, WIP like its finished type. Exclusive diamond overlap (|dx|+2|dy| < (wA+wB)/2) — tiles that touch edge/corner are legal, so clean rows place.
- Tile lattice snap (HSBuildSnap): the build ghost snaps to the footprint's tiling lattice (origin-anchored, same-parity points) — panels land edge-to-edge in perfect rows; clicks place where the ghost shows (tool.GhostPos), WYSIWYG.
- Visuals while building: the ghost type's tiling grid draws around the cursor (closer rings brighter), every nearby building/mineral shows its footprint outline, and the specific unit blocking placement fills + outlines RED under the BLOCKED tag. Ghost pad and construction-site pad now draw the true tile diamond.
- Tests: hstest 63/63 (new H21: footprints, edge-to-edge legal vs 1px overlap blocked, small-in-panel blocked, snap to lattice, WIP footprint), browsertest 52/52 (new K6: lattice-anchored row checks, real click lands exactly on the snapped tile, snap-grid + snap-grid-blocked), judge pass on both frames.

## QA click-through + enemy variety + wave levels (user: "проклацай усе і виправ; різних ворогів, рівні додай")
- Full UI click-through (new tools/qa-click.js, 18 checks): title → howto → back → new game → hint dismiss → click-build (WIP + R$ charged) → 2× speed → pause/resume/restart/quit → CONTINUE of a live base → lose screen + stats → RETRY clean slate → zero console errors. All flows pass.
- Fixed: the HUD kill counter was dead — App.kills was never incremented. New engine hook OnUnitDestroyed (fired from HSGameUnit.Destroy) now feeds it.
- Enemy variety (user-authorized deviation — the reference has a single UFO): UnitAlienScout (hp 20, speed 24, dmg 2, green dome, small) opens the raids; the reference UFO stays the backbone; UnitAlienCruiser (hp 160, speed 5, dmg 12, amber dome, near-black bulk, 1.55×) gates wave 20+. Lasers/targeting/pick treat all hulls identically (shared GameUnitAlien).
- Wave levels: composition tiers (8-9 scouts → 10-14 mixed → 15-19 UFO-heavy → 20+ cruisers), every 10th wave a BOSS RAID (+2 escort cruisers, always announced as such). Base count formula stays the reference's.
- Wave announcements: centre banner "WAVE N" + tier note (SCOUTS INBOUND / HOSTILES INBOUND / HEAVY CRUISERS INBOUND / BOSS RAID) with a CSS pop animation, plus purple pulsing rings + base-ward chevrons at every spawn point for 3s (engine.AddWaveMarker).
- Panel names for the new hulls; text dump lists each saucer's name; HOW TO PLAY SURVIVE text updated.
- Fixed: lose-screen pluralization "1 waves" → "1 wave" (judge catch).
- Tests: hstest 72/72 (new H22: wave tiers, boss raid, hull stats, destroy hook, announcement hook; H9 now counts any hostile hull), browsertest 57/57 (new K7: scout spawn + dump name, banner visible, kills delta per destroy, boss raid), qa-click 18/18, judge pass on snap-wave + title + pause + lose.

## Long-play soak: real waves, economy, routing (user: "запускай хвилі, перевіряй будівництво і економіку; щоб енергію можна було перенаправляти і лінії були видимі")
- New tools/longplay.js — a real gameplay soak (17 checks): builds by REAL clicks, mines R$ for 20s, forces a routing fork and re-routes energy with a real mouse drag, fights a scout raid, then soaks to wave 20 with waves announcing and attacking.
- THE fundamental bug found and fixed: PickNextAttackTarget picked with the pickUnpickable flag (the reference calls PickInRange WITHOUT it) — aliens could target flying energy packets (unreachable, 96px/s) and wander forever instead of attacking the base. After the fix raid scouts beeline to buildings, lasers kill them, the base takes real damage, wave kills accumulate.
- Link visibility: laser feed lines were hidden below zoom 2 (detail gate) — now drawn at ANY zoom (dashed blue + chevrons); conduit lines unchanged. Judge confirms lines read clearly at 1.4×.
- Starved construction sites now show a "NO POWER" chip (orange) — a WIP with no packet supply used to sit forever silently; now the player sees it and builds a panel/relay nearby. (Verified the reference's own cost quirk — unit BUILD_COST 15/10 vs tool 10/8 — is genuine reference behavior, left 1:1.)
- Verified working end-to-end: click-build → WIP → packets finish construction; mining earns R$; fork auto-routing picks nearest hubs and diffusion trickles energy into branches; manual drag re-route makes delivery deterministic (charges fill to cap); lasers defend (raid kills, base hp drops); waves escalate to wave 20 with mixed hulls; no runaway packet loops; base survives.
- Tests: hstest 72/72, browsertest 57/57, qa-click 18/18, longplay 17/17, judge pass on reroute/lines/battle frames.

## Level system + store-quality flow (user: "де обіцяна система рівнів? Це має виглядати як AAA гра")
- Real level system (LEVELS, 6 scenarios): First Contact (10 waves) → Scout Rush (12) → Iron Curtain (15) → Cruiser Threshold (18, cruisers from wave 12) → Boss Citadel (20, boss raid every 5th wave) → Endless Siege (unbounded, bosses every 10). Each level = wave goal + boss cadence + enemy-mix tier; enemy stats stay 1:1.
- Victory condition: the level's final wave has spawned AND every raider is down (engine WinCheck, filtered against destroyed-but-unswept units and IsGameOver). Endless never wins.
- Level select on the title screen: 6 cards with number, description, earned stars, locked state (Save.data.unlocked progression, persisted via the existing localStorage Save which already had completeLevel/starsFor wired to nothing — now fully connected). NEXT LEVEL chains after victory; REPLAY restarts the same level; pause RESTART restarts the current level (not level 1).
- Victory screen: "LEVEL N COMPLETE", 1-3 gold stars by buildings lost (flawless defense = 3), stats (time, kills, buildings lost), NEXT/REPLAY/MENU. Progress + stars persist across sessions.
- HUD: level mode shows "wave X of Y in Ns" and "FINAL WAVE — wipe the raid!"; endless keeps the reference wave readout.
- Polish fixes (judge-caught): the transient wave banner could overlap the title logo and the victory panel — now force-hidden on every screen transition; gameplay toasts cleared and hidden outside the game; logo line-height safety; version "v0.7 — SUNGRID" (Harvesturr mention dropped from the UI).
- Fixed en route: startLevel set LevelConfig before HSMap.Load, whose ClearGameState wiped it (level config silently lost); WinCheck now ignores destroyed-but-unswept raiders.
- Tests: hstest 81/81 (new H23: level configs, per-level tiers/bosses, victory once-only, blocked while raiders remain, endless never wins), browsertest 62/62 (new K8: grid locks, card starts level, victory screen with stars, progression save, NEXT LEVEL), qa-click 18/18, longplay 17/17, judge pass on level-select and victory screens.

## Call-wave button (user request: "кнопка негайного виклику ворогів / запуску першої хвилі")
- New HUD button "⚔ N" (N = next wave number, purple accent) in the top bar + hotkey C (both keyboard layouts). Summons the next wave immediately instead of waiting out the 10s gap — routes through the regular wave tick, so the announcement banner and spawn-edge markers fire as usual.
- Rules: blocked at the level's final wave (button shows "⚔✓" and disables — nothing left to summon), blocked after game over; endless mode allows it always. Rejected clicks play the error sound.
- HUD updates live: label tracks the next wave, wave-state chip shows the level goal; screenshot verified the button matches the HUD style without overlap.
- Tests: hstest 86/86 (new H24: summons within a tick, repeat calls, final-wave block, endless always allowed, game-over block), browsertest 65/65 (new K9: instant summon via click and C hotkey, final-wave disable state), qa-click 18/18, longplay 17/17, judge pass on the HUD button frame.

## Starter base on the build grid (user: "початкові будівлі стоять мимо ґрида — нові з ними не matchуються")
- The starter buildings were hardcoded off-lattice (harvester (10,-31), conduit (30,0), panel (34,50)) while player buildings snap to footprint lattices anchored at the origin — the starter base never matched new construction.
- SpawnStarters now lays every starter ON its footprint lattice, preserving the working chain: megamineral (-36,-18), harvester (-16,-24) [21px from the mineral], conduit (32,0) [panel 54px away], solar panel (36,54). New panels/conduits/harvesters snap to the same lattices → clean rows that align with the starter base.
- Tests: hstest 90/90 (new H13 lattice-membership + starter-chain-intact checks), browsertest 65/65, qa-click 19/19, longplay 17/17, judge pass on the starter base frame.

## Range visibility on placement (user, tenth time: "не видно радіусів Harvester/ноди — зроби крупніший штрихпунктир, інший колір, або заливку кольором")
- All three suggested remedies at once: the placement ghost now FILLS the whole radius area with a translucent color tint AND draws a bold dashed ring (2.5px screen-constant width, big dashes that can't shrink with zoom): blue for conduit/panel (96px), green for harvester (64px), red for laser (64px).
- Harvester ghost additionally marks every mineable mineral inside the coverage with a gold diamond — you see what you'll mine before you pay.
- Bonus root-cause fix: the ghost range rings were still anchored to the raw mouse point while the ghost snaps to the tile — they could draw displaced from the actual tile. Everything now anchors at the snapped GhostPos.
- Hover rings of PLACED buildings (conduit/laser/harvester/panel) boosted too: brighter color, 2px screen-constant dashes.
- Tests: hstest 90/90, browsertest 65/65 (+snap-range-harv/-cond), qa-click 19/19, longplay 17/17, judge pass on both range frames ("the discs read instantly even over the tiled sand texture").

## Radii rewritten as ALWAYS-ON bold coverage (user, seventh complaint: "все ще не видно радіуси харвестерів і нод")
- Root cause of the repeated complaints: the radii only existed transiently (placement ghost / hover) at subtle alphas — during normal play nothing showed. Now:
- PLACED buildings show their radius ALWAYS (no hover needed): harvester = green fill 24% + 2.4px solid border at 85%; conduit = blue fill 16% + 2.2px border at 80%; solar panel = lighter blue fill 13% + 2px border. Hover/selection brightens further (fill up to 30%, 3px border).
- GHOST (placement) discs: solid pulsing border 3.5px (dashes removed — they read as "broken" and vanished on sand) + 26% fill.
- Coverage now reads as a permanent colored map: green = what a harvester mines, blue = what a conduit/panel reaches, red (hover) = laser range.
- Verified the earlier hover-ring patches had actually applied — the issue was visibility strength and transience, not a missing draw.
- Tests: hstest 90/90, browsertest 65/65, qa-click 19/19, longplay 17/17; judge: ghost discs "unmistakable" (pass ×2), base always-on coverage "definite colored coverage zones at one glance, on par with placement-ghost strength" (pass).

## Radius state machine (user: "не треба завжди видимих — idle штрихпунктир, ховер включає свій радіус, при будуванні всі радіуси, панелі — тільки штрихпунктир")
- Replaced the always-on coverage with the user's exact state model:
  - IDLE (no tool, nothing hovered): every placed radius is a subtle DASHED outline — no fills anywhere.
  - HOVER: the hovered building's radius goes LOUD (green harvester fill 30% + 3px solid border; blue conduit fill 24% + 3px); all others stay dashed.
  - BUILD MODE (any build tool active): ALL placed radii light up with fills (harvester 24%, conduit 16%) — you see coverage where you're about to place; laser placed radii stay outline-only so red doesn't shout over planning.
  - SOLAR PANELS: dashed outline only, never a fill (brighter while building/hover).
  - Placement ghost keeps the approved loud disc (solid pulsing 3.5px + 26% fill).
- Test staging fixes (judge-caught): the idle snapshot had the mouse resting on the harvester (hover state firing) — pointer parked off-scene; stale wave banner hidden in the snapshot section; K7 kill-count assertion made dynamic (real raids now produce kills during fast-forward).
- Tests: hstest 90/90, browsertest 65/65 (new frames: snap-buildmode, snap-hover), qa-click 19/19, longplay 17/17; judge pass on all four state frames (idle/hover/build-mode/ghost).

## Audit round: 12 critical bugs fixed + level differentiation (user: "все зроби дороби і виправ і запуш")
The independent audit found gameplay-breaking bugs; this round fixes every one of them and reshapes the levels so they actually differ.

Critical fixes:
- **Level never stopped waves** — the wave tick scheduled raids forever, so a "4 raids" level marched to wave 14 under a FINAL WAVE banner. The spawner now stands down once the level's final raid is out (CallWave blocked there too). Regression-tested in hstest (H25) and longplay (level 1 ends at exactly 4 raids).
- **Camera stuck after releasing keys** — keyup deleted the raw key while the set held mapped directions ("up"/"left"…), so WASD/arrows never stopped panning. One CAM_KEYS map for keydown+keyup; keys cleared on every screen change and level start; the camera is now CLAMPED to the map island in panBy/zoomAt (no more empty screen past the edge).
- **Completed construction counted as a lost building** — the finishing WIP destroyed itself through the same OnUnitDestroyed hook the star rating listens to. WIP now flags `_finishing`; flawless 3-star games are possible again.
- **Laser charge exceeded the cap** — +15 on a half-full laser produced 70/60, 74/60. Now clamped to MaxEnergyCharges (H2 extended with overshoot cases).
- **Wave numbers mismatched** — the banner showed the 0-based raid index while the HUD showed the post-increment counter. Banner now announces wave+1, matching the HUD.
- **Victory/defeat didn't freeze the sim** — time and waves kept flowing behind the outcome screens. win() and the defeat branch now PauseGame(true), and the engine skips its sim block once _victory/IsGameOver is set.
- **Victory without a base was possible** — with no enemies AND no structures the win check ran before the defeat check. Defeat is evaluated first, and WinCheck additionally requires a standing building.
- **Failed drag-link destroyed the old link and flipped control modes** — dragging onto an out-of-range node returned "rejected": no links touched, no ManualLink set (conduit and laser paths both; H26 covers it).
- **Continue showed 1× while the sim ran 2×** — the label is now read from the actual App.speed on every game (re)entry.
- **Restart reset a decoy camera** — startLevel reset `engine.Camera`, which nothing renders; the renderer's `Renderer.cam` is what resets now (decoy field deleted).
- **Memory leaked** — 1182 stale effects and a grow-only unit array after 10 minutes. Effects are swept every 2s of sim time; nulled unit slots compact once >128 accumulate (H27).
- **Mobile clipping at 390px** — level grid is `auto-fit minmax(150px,190px)` (1 column on phones), HUD chips/buttons wrap and shrink under a 700px media query, how-to goes single-column; the rotate-to-landscape hint now fires when entering the game in portrait (it only showed on resize before).

Design fixes:
- **Levels actually differ now** — each level carries its own raidInterval (25–34s), waveCap (3–8), firstRaidAt (15–20s), enemy mix (Scout Rush scout-heavy, Iron Curtain saucer-heavy) and mineral density (44–60 clusters) instead of three identical durations.
- **Cruisers no longer crawl** — speed 5 → 8 (120–150s spawn-ring crossings became ~70–90s) and the spawn ring tightened 600–750 → 550–700.
- **DebugFastBuild ships OFF** — real build costs apply in the shipped game (a conduit site eats 5 packets); the fast path stays available to tests explicitly.
- **How-to text matches the game** — 1–4 tools, 1s packet cadence, real costs, raid-based pacing, boss cadence, ⚔/C call-wave; the endless-mode HUD line no longer references the dead "UFOs at wave 8" rule.
- **Clicking a turret's head selects it** — units pick via GetPickRect; the laser's hit box covers the drawn barrel/head that rose above its texture AABB.
- **Endless record survives defeat** — setEndlessBest fires on the lose path and the lose screen shows the record.

Tests: hstest 106/106 (new H0 defaults, H25 wave stand-down, H26 rejected drag-link, H27 memory compaction), browsertest 65/65, qa-click 19/19 (lose-flow now polls state instead of a fixed sleep), longplay 18/18 (soak now asserts level 1 stands down at 4 raids — the old expectation encoded the bug). Mobile verified on 390×844 and 844×390 shots.

## Audit completion round: scenario/energy/perf suites + one hidden bug found (user: "продовжив і закінчив аудит?")
The remaining four audit-plan items are now closed with dedicated suites:
- **tools/audit-scenarios.js (41 checks)** — walks all six levels through the real UI: per-level wave composition (sizes within caps, scouts open, cruisers only from level 4, boss escorts on schedule), win/lose for the full chain, NEXT-LEVEL unlock chain, star ratings (0/1/5 losses → 3/2/1★) with save persistence across reload, endless defeat saving + showing the record, star best upgrade 1★→3★ without downgrade.
- **tools/audit-energynet.js (15 checks)** — 30-relay chain delivery, mid-chain break (nothing crosses; stranded packets self-limit via the heat rule at ~40), self-healing via auto-link bridge, 90s manual cycles that keep their links and self-limit, delivery priority (live consumer beats relay; full consumer defers), 15-of-40 destruction storm without crashes or unbounded arrays.
- **tools/audit-perf.js (6 checks)** — heavy scene (~1150 live units) measured **30.7 FPS** in headless software rendering; effects swept (55), dead slots compacted (49), packets bounded (~200); all 22 Sfx entry points throw-safe; mute toggle drives UI + save.
- **AUDIT.md** — the final close-out report: every issue with code location, repro, fix and verifying test; **BALANCE.md** — per-level/raid/enemy/economy tables taken from the code.
- **Hidden bug №13 found by the new suites**: the raid ticker never checked `IsGameRunning`, so raids spawned into non-level scenes (headless/sandbox) and scouts silently chewed on "isolated" test stands — this was the cause of a flaky cycle test. Fixed + hstest H25 now asserts a non-running game never schedules raids.
Tests: hstest 107/107, browsertest 65/65, qa-click 19/19, longplay 18/18, audit-scenarios 41/41, audit-energynet 15/15 (×3 stability runs), audit-perf 6/6.

## v0.9: two new levels with map GEOMETRY + full audio wiring + the balance bot (user: "додай рівнів, покращ")
Closed the last "planned but never built" items:
- **Campaign grows to 8 levels**, and levels now differ by map GEOMETRY, not only parameters:
  - **Overload Ring** (level 6) — `mapPattern: "ring"`: two concentric mineral rings at ~360/560px around the base; rich veins mid-range, thin cover at home. 7 raids at 26s with saucer-heavy mix.
  - **Titan Fall** (level 7) — `mapPattern: "field"`: island-wide scattered veins. 9 raids, boss escorts every 2nd raid (raids 3/5/7/9), biggest raid cap (7) — the hardest authored level before Endless.
  - HSMap.SpawnAllMinerals learned the "ring" and "field" patterns (H33 pins both geometrically).
- **Audio wiring (the Snd library finally left dormancy)**: raid horn on every wave, overcharge alarm when a conduit crosses into the hot zone (heat 60, once per crossing, sim→OnSfx hook), burnout sound when overload starts destroying packets (throttled 1.5s), continuous laser hum scaled by firing towers and atom hum scaled by packet flow (throttled 0.25s, silenced off-screen). H34 pins the sim-side hooks.
- **Endless record on the title card** — "BEST N WAVES" in gold under the Endless Siege card.
- **tools/balance.js exists** (the README promised it since day one): a scripted autoplay bot (3 panels → conduit spine → 8-laser ring, rebuilds as things die) plays every level and reports win/lose/waves/kills/losses/stars. v0.9 readout: L1-L4 comfortable wins, Boss Citadel 1★@13 losses, Overload Ring 3★, Titan Fall 1★@25 losses, Endless — bot survives 243s to wave 8. A clean difficulty curve, measured.
- Bonus correctness: the BOSS RAID banner note now reads the level's bossEvery instead of a hard-coded `% 10`.
- Version → v0.9.
Tests: hstest 115/115 (H23 expanded, H33 map geometry, H34 audio hooks), browsertest 65/65 (8 cards), audit-scenarios 52/52 (7-level chain, Titan Fall cadence), qa-click 19/19, longplay 18/18, audit-energynet 15/15, audit-perf 6/6, balance.js report run.
