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

## TODO / нотатки
- Гра на цьому етапі — робочий скелет laserlink під іменем SUNGRID; фази 2–8 переписують рушій на iso.
