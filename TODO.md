# TODO — что требует решения или действий владельца

## Ребрендинг Flowcast
- [ ] Бот всё ещё называется `@daromad_hoji_test_bot` (username нельзя переименовать). Если нужен `@flowcast_…_bot` —
      создать нового бота в @BotFather, прислать токен (в `backend/.env` → `BOT_TOKEN`) и обновить `VITE_BOT_URL`.
- [ ] Имя бота (display name) и аватар — в @BotFather → `/setname`, `/setuserpic` (знак — `miniapp/public/favicon.svg`).
- Оставлено намеренно: слово «daromad» (узб. «доход») в тексте про доход по вкладу; пути `C:\venvs\daromad`,
  файл `daromad.db`, переменная `DAROMAD_DB`, ключ localStorage — это идентификаторы, не пользовательский текст.

## Блок 3 — склейка с модулями Темура (backend/extras) — СДЕЛАНО
- [x] `origin/feature/extras` влита в main; adapters -> db.py, ссылки — таблица `pay_links`, роутеры в main.py
      (владелец — только свой долг), настройки в `backend/.env`, фото в боте -> черновики (source=photo),
      фронт «Eslatish» и /pay/:token на реальных эндпоинтах, владельцу в бот «✅ to'ladi».
- [ ] Для SMS на телефон: аккаунт Eskiz.uz -> `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `SMS_PROVIDER=eskiz`,
      `DEMO_DEBTOR_PHONE` (свой номер) в `backend/.env`. Пока `ESKIZ_TEST_MODE=1` — уходит «Bu Eskiz dan test».
- [ ] Распознавание фото проверено только на тестах с фейками: дневная квота Gemini 22.11 исчерпана. Один раз отправить
      боту фото чека/накладной, когда квота вернётся.
- [ ] Click/Payme не подключены: «To'lash» на странице оплаты — демо-кнопка (confirm_payment готов к их callback).

## Деплой
- [ ] Vercel: создать проект (Root Directory `miniapp`), задать `VITE_API_URL` (печатает `scripts\start_demo.ps1`) и `VITE_BOT_URL`.
- [ ] `backend/.env`: `WEBAPP_URL=https://<проект>.vercel.app/tg` (ссылка в SMS берёт адрес отсюда, или задать
      `PUBLIC_BASE_URL=https://<проект>.vercel.app`), `DEMO_RESET=1` на время показа.
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
