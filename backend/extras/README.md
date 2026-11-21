# Daromad extras

Модули второго разработчика. Живут отдельно от основного бэка (`backend/*.py`) и пока не
меняют его файлы. Данные берут только через `adapters.py`: при склейке с `db.py` меняется
один этот файл.

| Модуль | Что делает |
|---|---|
| `adapters.py` | доступ к магазину, долгам, оплатам, журналу; сейчас — демо-данные в памяти |
| `vision.py` | фото накладной / чека / скриншота Payme-Click → события Daromad (Gemini + проверка кодом) |
| `sms.py` | текст напоминания (узбекский, ≤160 символов), номер, отправка: `mock` или Eskiz |
| `payments.py` | ссылка на оплату долга: токен на 7 дней, подтверждение без двойного списания |
| `reminders.py` | напоминание должнику: проверки → токен → SMS → журнал |
| `dev_app.py` | отдельный FastAPI на порту 8001 + страница оплаты для должника |
| `eval_ai.py` | проверка точности ИИ на эталонных примерах (текст, голос, фото) |

Принцип тот же, что у основного бэка: ИИ только извлекает данные, суммы и правила проверяет код,
запись подтверждает человек.

## Установка (macOS / Linux)

Из папки `backend/`:

```bash
python3 -m venv extras/.venv
```

```bash
extras/.venv/bin/pip install -r extras/requirements-extras.txt
```

```bash
cp extras/.env.example extras/.env
```

Windows: `py -3.12 -m venv extras\.venv`, дальше `extras\.venv\Scripts\python.exe` вместо `extras/.venv/bin/python`.

## Настройка `extras/.env`

Файл в `.gitignore`. Ключи и пароли пишутся только сюда, **никогда** в `.env.example`.

| Ключ | Значение |
|---|---|
| `GEMINI_API_KEY` | ключ из Google AI Studio |
| `GEMINI_MODEL` | основная модель, по умолчанию `gemini-3.5-flash` |
| `GEMINI_FALLBACK_MODELS` | запасные через запятую, по умолчанию `gemini-3.5-flash-lite`; берутся при 503/429/404/таймауте |
| `PUBLIC_BASE_URL` | адрес, с которого открывается ссылка на оплату; для телефона нужен публичный https |
| `SMS_PROVIDER` | `mock` — SMS пишется в `extras/outbox.jsonl`; `eskiz` — настоящая отправка |
| `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` | вход в кабинет Eskiz (notify.eskiz.uz) |
| `ESKIZ_FROM` | имя отправителя, по умолчанию `4546` |
| `ESKIZ_TEST_MODE` | `1` — тестовый аккаунт Eskiz: уходит «Bu Eskiz dan test», владелец в Mini App видит настоящий текст; `0` — после договора с Eskiz |
| `EXTRAS_ADMIN_TOKEN` | пусто — локально; на публичном адресе — длинная случайная строка, тогда маршруты владельца и `/api/dev/*` требуют заголовок `X-Admin-Token` |

**Лимит Gemini.** На бесплатном уровне у модели около 20 запросов в день на проект
(21.11.2026 после ~20 запросов пришёл `429 RESOURCE_EXHAUSTED`). Для демо — платный уровень
или отдельный ключ, и не гонять `eval_ai` перед выступлением.

## Запуск

Все команды из `backend/`.

**API напоминаний и оплаты** (порт 8001):

```bash
extras/.venv/bin/uvicorn extras.dev_app:app --port 8001
```

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/debts/{id}/remind/preview` | текст SMS, замаскированный номер, можно ли отправить и почему нет |
| POST | `/api/debts/{id}/remind` | отправить напоминание; ответ: `text`, `pay_url`, `expires_at`, `sms_test_mode` |
| GET | `/api/pay/{token}` | данные для страницы оплаты (без телефона должника) |
| POST | `/api/pay/{token}/confirm` | оплатить остаток; повтор возвращает `already_paid: true` и не списывает |
| GET | `/pay/{token}` | страница оплаты для должника (по ссылке из SMS) |
| GET | `/api/dev/debts` | демо: долги и уведомления владельцу |
| POST | `/api/dev/reset` | демо: вернуть данные к исходным |

Ошибки приходят как `{"error": code, "detail": ...}`:

| Код | HTTP | Когда |
|---|---|---|
| `not_found` | 404 | нет долга или ссылки |
| `debt_closed` | 409 | долг уже закрыт |
| `no_phone` | 422 | нет телефона или он неверный |
| `no_consent` | 403 | должник не давал согласия на SMS |
| `too_soon` | 429 | напоминание по этому долгу было меньше 3 дней назад (`next_allowed_at` в preview) |
| `token_expired` | 410 | ссылке больше 7 дней и она не оплачена |
| `sms_failed` | 502 | провайдер не отправил SMS; попытка не считается, можно повторить сразу |
| `link_too_long` | 500 | `PUBLIC_BASE_URL` такой длинный, что ссылка не влезает в одно SMS; долг не блокируется |
| `unauthorized` | 401 | задан `EXTRAS_ADMIN_TOKEN`, а заголовка `X-Admin-Token` нет или он неверный |

> Страница и API оплаты открыты всем — их открывает должник по ссылке. Маршруты владельца и
> `/api/dev/*` открыты, пока `EXTRAS_ADMIN_TOKEN` пуст: на публичном адресе его **обязательно** задать,
> иначе любой сможет слать SMS за ваш счёт. При склейке с `api.py` маршруты владельца идут через
> `Depends(current_shop)` и проверку, что долг принадлежит магазину. Номера в ответах всегда замаскированы.

**SMS:**

```bash
extras/.venv/bin/python -m extras.sms --check
```

Проверяет вход в Eskiz, SMS не отправляет.

```bash
extras/.venv/bin/python -m extras.sms --to 998XXXXXXXXX --text "Salom"
```

Отправляет в текущем режиме `SMS_PROVIDER` (в Eskiz это списывает баланс).

**Фото:**

```bash
extras/.venv/bin/python -m extras.vision extras/samples/synthetic/payme_alisher.png --today 2026-11-21
```

**Проверка точности ИИ:**

```bash
extras/.venv/bin/python -m extras.eval_ai
```

Фильтры: `--only text|audio|photo`, `--ids t01_sale,p03_payme`. Отчёт — в консоли и в
`extras/eval_report.json`. Эталоны — `extras/eval_cases.json`; настоящие голосовые и фото команды
кладутся в `extras/samples/private/` вместе с `cases.json` того же формата (папка в `.gitignore`,
реальные лица и номера в git не попадают).

Последний прогон (21.11.2026): 21/23 — текст 15/15, голос 4/4 (синтетический русский голос macOS),
фото 2/4 (два — сбой 503 у Gemini, не ошибка распознавания). Запасная `flash-lite` на фото
слабее основной: однажды записала перевод Payme как расход.

## Тесты

```bash
extras/.venv/bin/python -m pytest -q
```

Запускаются тесты основного бэка и `extras/tests/`. Сеть не нужна: Gemini и Eskiz подменены
фейками, файлы пишутся во временные папки. `extras/tests/conftest.py` перекрывает настоящий `.env`
(`SMS_PROVIDER=mock`, пустые ключи Eskiz), поэтому тесты никогда не отправят настоящее SMS.

## Безопасность и данные

- Секреты — только в `extras/.env`. Тест `test_env_example_has_no_secrets` не даст закоммитить их в `.env.example`.
- Номер должника в ответах API маскируется (`+99890 *** ** 67`); страница оплаты номер не показывает.
- Токен оплаты — `secrets.token_urlsafe(32)`, 7 дней, одноразовый.
- SMS только сервисное (сумма и ссылка), без рекламы, только при согласии должника и не чаще раза в 3 дня.
- Бесплатный Gemini может использовать запросы для улучшения моделей: реальные ФИО и номера в тестовые примеры не класть.

## Склейка с основным бэком

1. `adapters.py`: тела функций → вызовы `db.py` (`shops`, `debts`, `debt_payments`, `audit_log`), `notify_owner` → сообщение в бот.
2. Маршруты из `dev_app.py` → в `api.py` под `Depends(current_shop)`; `/api/dev/*` не переносить.
3. `tokens.json` → таблица в SQLite (тот же формат: `token, debt_id, created_at, expires_at, paid_at, paid_amount`).
4. Фото в боте: `await vision.aparse_photo(...)` → `pipeline.save_drafts(shop_id, events, source="photo")`.
