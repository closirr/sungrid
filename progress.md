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
