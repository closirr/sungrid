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

### Stale tools kept (file deletion needs explicit user confirmation)
`tools/functest.js`, `tools/shots.js`, `tools/trace.js` still target the removed Sim/grid APIs and are superseded by `tools/browsertest.js`.

### TODO / next agent
- Visual pixel review of the screenshot was not possible in the agent runtime (image model unavailable); a deterministic pixel histogram (62 colour buckets) is used instead. A quick human glance at the screenshot is recommended.
- Reference SFX for `building_finish_constructing` / `harvester_laser` are not wired (only explosion/hit are).
- Hover tooltip (reference `GUI.DrawTooltip`) is not ported.
- Economy (start at 0 R$, harvester-dependent income) is faithful to the reference; tune only if the user asks.
