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

## TODO / нотатки
- Гра на цьому етапі — робочий скелет laserlink під іменем SUNGRID; фази 2–8 переписують рушій на iso. (фази 2-3 зроблено)
- bot.js поки від laserlink (не викликається до фази 5) — перепишеть сабагент B.
- **Мова UI змішана** (палітра/тости англ, туторіали укр) — фаза 6 робить повний уніфікований прохід локалізації.
- Дрібний артефакт: idle-дренаж лінка може рахуватись через сусідній релей (0.5 e/s) — прийнятно, не впливає на геймплей.
- Дублікати flowEdges (релей+споживче ребро з тими ж координатами) — лише трохи яскравіші атоми, ок.
