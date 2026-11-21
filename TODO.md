# TODO — что требует решения или действий владельца

## Ребрендинг Flowcast
- [ ] Бот всё ещё называется `@daromad_hoji_test_bot` (username нельзя переименовать). Если нужен `@flowcast_…_bot` —
      создать нового бота в @BotFather, прислать токен (в `backend/.env` → `BOT_TOKEN`) и обновить `VITE_BOT_URL`.
- [ ] Имя бота (display name) и аватар — в @BotFather → `/setname`, `/setuserpic` (знак — `miniapp/public/favicon.svg`).
- Оставлено намеренно: слово «daromad» (узб. «доход») в тексте про доход по вкладу; пути `C:\venvs\daromad`,
  файл `daromad.db`, переменная `DAROMAD_DB`, ключ localStorage — это идентификаторы, не пользовательский текст.

## Блок 3 — склейка с модулями Темура (backend/extras) — ОТЛОЖЕН
- [ ] По просьбе владельца пропущен: ветка `origin/feature/extras` ещё не готова, ничего не вливалось.
      Когда будет готова: merge в main, реальные адаптеры (debts, debt_payments, audit_log, shops, notify_owner),
      роутеры reminders/payments в main.py, фото -> vision.parse_photo -> черновики (source=photo), Eskiz в тестовом
      режиме (ESKIZ_TEST_MODE=1), фронт «Eslatish» и /pay/:token на реальные эндпоинты (demo-фолбэк на 404 уже есть).

## Деплой
- [ ] Vercel: создать проект (Root Directory `miniapp`), задать `VITE_API_URL` (печатает `scripts\start_demo.ps1`) и `VITE_BOT_URL`.
- [ ] `backend/.env`: `WEBAPP_URL=https://<проект>.vercel.app/tg`, `DEMO_RESET=1` на время показа.
- [ ] @BotFather: Menu Button -> `https://<проект>.vercel.app/tg`.
