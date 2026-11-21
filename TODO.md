# TODO — что требует решения или действий владельца

## Ребрендинг Flowcast
- [ ] Бот всё ещё называется `@daromad_hoji_test_bot` (username нельзя переименовать). Если нужен `@flowcast_…_bot` —
      создать нового бота в @BotFather, прислать токен (в `backend/.env` → `BOT_TOKEN`) и обновить `VITE_BOT_URL`.
- [ ] Имя бота (display name) и аватар — в @BotFather → `/setname`, `/setuserpic` (знак — `miniapp/public/favicon.svg`).
- Оставлено намеренно: слово «daromad» (узб. «доход») в тексте про доход по вкладу; пути `C:\venvs\daromad`,
  файл `daromad.db`, переменная `DAROMAD_DB`, ключ localStorage — это идентификаторы, не пользовательский текст.
