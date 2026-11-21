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

## Квоты Gemini на день защиты — ВАЖНО
- [ ] Ключ на бесплатном тарифе: `gemini-3.8-flash-tts` даёт **10 запросов в день**, у `gemini-3.8-flash` тоже дневной лимит.
      За день отладки 22.11 обе квоты закончились (429). Перед защитой: включить billing в AI Studio или взять отдельный
      ключ только для показа (`GEMINI_API_KEY` в `backend/.env`), и не гонять демо много раз в день защиты.
- [ ] За 15 минут до выхода — один прогон-репетиция (docs/DEMO.md). Голосовой ответ ляжет в `backend/data/tts_cache`,
      и на сцене квота TTS уже не понадобится.
- [ ] Желательно перезаписать `docs/demo.webm` (`scripts/record_demo.mjs`), когда вернётся квота: в текущем видео
      транскрипт шага 6 — «O'zbek tilida: Kim menga qarz?» (старый WAV микрофона, уже исправлен).
- Стилевая подсказка TTS «O'zbek tilida, xotirjam va aniq o'qing:» из ТЗ отключена (`tts.USE_STYLE=False`):
  модель зачитывала её вслух, это проверено через STT.
