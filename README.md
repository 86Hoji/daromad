# Daromad

Голосовой Telegram-бот для владельцев микро- и малого бизнеса в Узбекистане. Владелец голосом
(узбекский / русский / смесь) говорит, что продал, что потратил, кто взял в долг и какие платежи
предстоят. Бот считает главную цифру — **свободные деньги до следующего платежа** — и
предупреждает о нехватке: сначала предлагает напомнить должникам, потом овердрафт; при излишке — вклад.

**Принцип:** ИИ (Gemini) понимает речь и извлекает данные → **код** считает все цифры → **человек** подтверждает кнопкой.

## Структура

```
backend/
  main.py        FastAPI + бот (aiogram, long polling) в одном процессе
  bot.py         хендлеры Telegram, тексты на узбекском
  ai.py          Gemini: распознавание голоса/текста в JSON, маскирование телефонов, сверка сумм
  uz_numbers.py  детерминированный парсер сумм ("2 million 300 ming", "bir yarim million", "1,5 mln")
  pipeline.py    общий конвейер бота и API: ИИ → валидация → черновики → подтверждение
  logic.py       free_money, forecast, recommendation (только код, без ИИ)
  api.py         REST API /api/* для будущего Mini App
  db.py          SQLite (backend/data/daromad.db)
  seed.py        демо-данные «Dilshod do'koni»
  tests/         pytest
```

## Установка (Windows)

Проект лежит в OneDrive, поэтому виртуальное окружение — **вне OneDrive**, в `C:\venvs\daromad`.

```powershell
py -3.12 -m venv C:\venvs\daromad
```

```powershell
C:\venvs\daromad\Scripts\Activate.ps1
```

```powershell
pip install -r backend\requirements.txt
```

Если PowerShell запрещает запуск скриптов при активации:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (или вызывайте `C:\venvs\daromad\Scripts\python.exe` напрямую).

## Настройка `.env`

Скопируйте `backend/.env.example` в `backend/.env` и заполните:

| Ключ | Что это |
|---|---|
| `BOT_TOKEN` | токен бота от @BotFather |
| `GEMINI_API_KEY` | ключ Google AI Studio |
| `GEMINI_MODEL` | по умолчанию `gemini-flash-latest`. Для новых ключей Google `*-latest` и `gemini-2.5-flash` недоступны — ставьте `gemini-3.8-flash`. Если модель не найдена (404) или перегружена (503/таймаут 25 с), код сам переходит по цепочке `gemini-3.8-flash` → `gemini-3.5-flash-lite`, а упавшую модель пропускает 5 минут |
| `WEBAPP_URL` | https-адрес Mini App (фаза 2), даёт кнопку «Kassam»; можно оставить пустым |
| `DEV_SHOP_ID` | магазин для API без Telegram-заголовка (демо), по умолчанию `1` |

Без `BOT_TOKEN` поднимается только API; без `GEMINI_API_KEY` не работает распознавание (бот отвечает понятной ошибкой).

## Запуск

```powershell
cd backend
```

```powershell
python seed.py --reset
```

```powershell
uvicorn main:app --port 8000
```

`seed.py --reset` идемпотентно пересоздаёт демо-магазин (#1). Если демо уже привязан к вашему Telegram, привязка сохраняется.
В Telegram: `/start` → «🧪 Demo do'konni ulash» — бот покажет данные seed и нехватку к четвергу.

## Тесты

```powershell
cd backend; python -m pytest -q
```

## Как считается «свободные деньги»

```
свободные = остаток сейчас + ожидаемые продажи − ожидаемые обычные расходы − платежи (pending, срок ≤ горизонт)
```

- остаток = opening_cash + продажи − расходы + возвращённые долги (выдача в долг кассу не меняет);
- ожидание на день = среднее за последние 4 таких же дня недели; учитываются дни с завтрашнего по день перед платежом (сегодня — факт, платёж уходит утром);
- аренда (`ijara`) и оплаченные плановые платежи в «обычные» расходы не входят;
- горизонт = ближайший pending платёж, иначе +7 дней;
- долги покупателей в формулу не входят — показываются отдельно (`total_receivable`, `top_debtors`).

## API

Без заголовка `X-Telegram-Init-Data` используется магазин `DEV_SHOP_ID`. С заголовком подпись проверяется по `BOT_TOKEN`
(стандартный алгоритм Telegram WebApp), магазин ищется по Telegram user id. Денежные поля в summary/forecast/recommendation округлены до 1000.

```bash
curl localhost:8000/api/summary
curl "localhost:8000/api/forecast?days=14"
curl localhost:8000/api/debts
curl "localhost:8000/api/entries?period=week"
curl localhost:8000/api/recommendation
curl "localhost:8000/api/audit?limit=20"

# распознать текст -> черновики (pending) с id
curl -X POST localhost:8000/api/text -H "Content-Type: application/json" \
  -d '{"text":"Bugun 2 million 300 ming sotdim, Alisher 150 ming qarz oldi, payshanba kuni yetkazib beruvchiga 3 million"}'

# голос (ogg/webm/mp3)
curl -X POST localhost:8000/api/voice -F "audio=@voice.ogg;type=audio/ogg"

# подтвердить / отклонить черновики
curl -X POST localhost:8000/api/entries/confirm -H "Content-Type: application/json" -d '{"ids":[1,2,3]}'
curl -X POST localhost:8000/api/entries/reject  -H "Content-Type: application/json" -d '{"ids":[4]}'
```

В PowerShell используйте `curl.exe` вместо `curl`.

## Не в этой фазе

Фронтенд (`miniapp/` — фаза 2), распознавание фото (фаза 3), реальные SMS / платежи / банк.
