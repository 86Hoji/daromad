# Flowcast extras

Модули второго разработчика. Живут отдельно от основного бэка (`backend/*.py`) и пока не
меняют его файлы. Данные берут только через `adapters.py`: при склейке с `db.py` меняется
один этот файл.

| Модуль | Что делает |
|---|---|
| `adapters.py` | доступ к магазину, долгам, оплатам, журналу; сейчас — демо-данные в памяти |
| `vision.py` | фото накладной / чека / скриншота Payme-Click → события Flowcast (Gemini + проверка кодом) |
| `sms.py` | текст напоминания (узбекский, ≤160 символов), номер, отправка: `mock` или Eskiz |
| `payments.py` | ссылка на оплату долга: токен на 7 дней, подтверждение без двойного списания; `router` (APIRouter) |
| `reminders.py` | напоминание должнику: проверки → ссылка → SMS → журнал; `router` (APIRouter) |
| `dev_app.py` | FastAPI на порту 8001 для проверки: подключает оба роутера (только JSON) |
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
| `DEMO_DEBTOR_PHONE` | свой или командный номер: им становится телефон демо-должника Alisher; на него разрешены настоящие SMS |
| `SMS_ALLOWLIST` | ещё номера через запятую, на которые разрешены настоящие SMS |
| `SMS_ALLOW_ANY` | `0` — при `SMS_PROVIDER=eskiz` SMS на номер не из двух строк выше **не уходит** (`sms_failed`, без списания); `1` — только в боевом режиме с реальными должниками |
| `EXTRAS_ADMIN_TOKEN` | пусто — локально; на публичном адресе — длинная случайная строка, тогда маршруты владельца и `/api/dev/*` требуют заголовок `X-Admin-Token` |

**Перед демо с настоящими SMS:** `SMS_PROVIDER=eskiz`, `ESKIZ_TEST_MODE=1`, свой номер в
`DEMO_DEBTOR_PHONE`. Одно SMS стоит 145 сум (видно в статусе Eskiz) — 5 000 сум хватит примерно на 34 SMS.

**Время.** Все отметки времени и «сегодня» — по Ташкенту (UTC+5) независимо от часового пояса сервера
(`extras/clock.py`).

**Лимит Gemini.** На бесплатном уровне у модели около 20 запросов в день на проект
(21.11.2026 после ~20 запросов пришёл `429 RESOURCE_EXHAUSTED`). Для демо — платный уровень
или отдельный ключ, и не гонять `eval_ai` перед выступлением.

## Запуск

Все команды из `backend/`.

**API напоминаний и оплаты** (порт 8001):

```bash
extras/.venv/bin/uvicorn extras.dev_app:app --port 8001
```

Одним процессом, без `--workers`: демо-долги живут в памяти. При каждом запуске демо-долги и ссылки
(`tokens.json`) начинаются заново — после перезапуска Alisher снова «открыт» и напомнить можно сразу.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/debts/{id}/remind/preview` | `sms_text`, `pay_url`, замаскированный `phone`, `can_send`, `reason`; SMS не шлёт |
| POST | `/api/debts/{id}/remind` | отправить; ответ: `status`, `sms_text`, `pay_url`, `sent_at`, `expires_at`, `sms_test_mode` |
| GET | `/api/debts/{id}/remind/status` | последнее напоминание: `sent_at`, `delivery` (`DELIVERED`…), `delivered`, `paid` |
| GET | `/api/pay/{token}` | данные для страницы оплаты (без телефона должника) |
| POST | `/api/pay/{token}/confirm` | оплатить остаток; повтор возвращает `already_paid: true` и не списывает |
| GET | `/api/dev/debts` | демо: долги и уведомления владельцу |
| POST | `/api/dev/reset` | демо: вернуть данные к исходным |

Preview создаёт ссылку-черновик и показывает настоящий `pay_url`; remind отправляет **ту же** ссылку.
Оплатить черновик нельзя (`not_found`), пока SMS с ним не ушло.
Правило «не чаще раза в 3 дня» считает только отправленные SMS: preview и неудачная отправка его не трогают.

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
| `phone_not_allowed` | 403 | `SMS_PROVIDER=eskiz`, а номера нет в `DEMO_DEBTOR_PHONE`/`SMS_ALLOWLIST` (защита от SMS незнакомцам); preview показывает это заранее |
| `link_not_public` | 500 | настоящее SMS (Eskiz без тестового режима), а `PUBLIC_BASE_URL` — localhost: должник не откроет ссылку |
| `unauthorized` | 401 | задан `EXTRAS_ADMIN_TOKEN`, а заголовка `X-Admin-Token` нет или он неверный |

> Страница и API оплаты открыты всем — их открывает должник по ссылке. Маршруты владельца и
> `/api/dev/*` открыты, пока `EXTRAS_ADMIN_TOKEN` пуст: на публичном адресе его **обязательно** задать,
> иначе любой сможет слать SMS за ваш счёт. При склейке с `api.py` маршруты владельца идут через
> `Depends(current_shop)` и проверку, что долг принадлежит магазину. Номера в ответах всегда замаскированы.

**Цепочка оплаты через curl** (сервер запущен, `SMS_PROVIDER=mock`):

```bash
curl -s -X POST localhost:8001/api/dev/reset
```

```bash
curl -s -X POST localhost:8001/api/debts/1/remind/preview
```

```bash
curl -s -X POST localhost:8001/api/debts/1/remind
```

SMS появилась в `extras/outbox.jsonl`. Токен — конец `pay_url` из ответа:

```bash
curl -s localhost:8001/api/pay/ТОКЕН
```

```bash
curl -s -X POST localhost:8001/api/pay/ТОКЕН/confirm
```

Долг закрыт, в консоли uvicorn: `[owner shop=1] Alisher to'ladi ✅ 450 000 so'm`. Повторный confirm
возвращает `"already_paid": true` и не списывает. Проверка отказов:

```bash
curl -s -X POST localhost:8001/api/debts/2/remind
```

→ `{"error":"no_consent"}`. Если задан `EXTRAS_ADMIN_TOKEN`, к запросам владельца и `/api/dev/*`
добавьте `-H "X-Admin-Token: ..."`.

**SMS:**

```bash
extras/.venv/bin/python -m extras.sms --check
```

Проверяет вход в Eskiz, SMS не отправляет.

```bash
extras/.venv/bin/python -m extras.sms --to 998XXXXXXXXX --text "Salom"
```

Отправляет в текущем режиме `SMS_PROVIDER` (в Eskiz это списывает баланс).

```bash
extras/.venv/bin/python -m extras.sms --status ID
```

Доставлено ли SMS (id — из ответа отправки), без списания.

**Фото:**

```bash
extras/.venv/bin/python -m extras.vision extras/samples/synthetic/payme_alisher.png --today 2026-11-21
```

**Проверка точности ИИ:**

```bash
extras/.venv/bin/python -m extras.eval_ai
```

Фильтры: `--only text|audio|photo`, `--ids s01_spec,p03_payme`. Печатает по каждому примеру
«ожидали / получили / ошибки», в конце — точность по суммам в %; отчёт — `extras/eval_report.json`.

Эталоны:
- `extras/eval_cases.json` — 10 фраз из ТЗ (`s01`–`s10`), ещё 27 фраз, 4 синтетических голосовых, 7 фото;
  `"due_date": null` — «срока нет»; `"validate": false` — не прогонять через `pipeline.validate_event`
  (накладная без срока: основной бэк такой платёж не примет, пока владелец не назовёт дату);
- `extras/samples/expected.json` — «имя файла → ожидаемые события» для **настоящих записей**: запишите
  10 фраз из ТЗ, назовите `voice01` … `voice10` (.ogg/.m4a/.mp3/.wav) и положите в
  `extras/samples/private/` (в `.gitignore`: голос и номера в git не попадают). Фото — так же, добавив
  строку `"nakladnaya1.jpg": {"intent": "record", "events": [...]}`. Ненайденные файлы пропускаются.

Прогоны 21.11.2026:
- 10 фраз из ТЗ (текстом, `flash-lite`): **10/10, суммы 13/13** (2 фразы — со второй попытки, сбой связи);
- остальные: текст 15/15, голос 4/4 (синтетический русский голос macOS);
- фото (`python -m extras.vision`, `flash-lite`): **4/4** — сумма, поставщик/отправитель, срок, категория.
  До уточнения промпта `flash-lite` путала перевод Payme с расходом (брала получателя вместо отправителя).
- новые данные (`n01`–`n12`, `p05`–`p07`: Click на русском, накладная без срока, чек на кириллице):
  **15/15**, суммы 15/15 (1 фраза — со второй попытки, сбой связи).
- `flash-lite` примерно в 1 из 10 запросов отвечает 503 (перегрузка) — бот должен повторять запрос.
- Голос на узбекском на **настоящих** записях ещё не проверен — нужны записи `voice01`…`voice10`.

## Тесты

```bash
extras/.venv/bin/python -m pytest -q
```

Запускаются тесты основного бэка и `extras/tests/`. Сеть не нужна: Gemini и Eskiz подменены
фейками, файлы пишутся во временные папки. `extras/tests/conftest.py` перекрывает настоящий `.env`
(`SMS_PROVIDER=mock`, пустые ключи Eskiz), поэтому тесты никогда не отправят настоящее SMS.

## Безопасность и данные

- Секреты — только в `extras/.env`. Тест `test_env_example_has_no_secrets` не даст закоммитить их в `.env.example`.
- Номер должника в ответах API маскируется (`+99890 *** ** 67`); `/api/pay/{token}` номер не отдаёт вовсе.
- Токен оплаты — `secrets.token_urlsafe(32)`, 7 дней, одноразовый.
- SMS только сервисное (сумма и ссылка), без рекламы, только при согласии должника и не чаще раза в 3 дня.
- Бесплатный Gemini может использовать запросы для улучшения моделей: реальные ФИО и номера в тестовые примеры не класть.

## Склейка с основным бэком

1. `adapters.py`: тела функций → вызовы `db.py` (`shops`, `debts`, `debt_payments`, `audit_log`), `notify_owner` → сообщение в бот.
2. В `main.py`: `app.include_router(reminders.router, dependencies=[Depends(current_shop)])` и
   `app.include_router(payments.router)`; плюс проверка, что долг принадлежит магазину. `/api/dev/*` не переносить.
3. `tokens.json` → таблица в SQLite (тот же формат: `token, debt_id, created_at, expires_at, sent_at, paid_at, paid_amount`).
4. Фото в боте: `await vision.aparse_photo(...)` → `pipeline.save_drafts(shop_id, events, source="photo")`.
5. Страница `/pay/{token}` — в Mini App (Ходжиакбар) поверх `GET /api/pay/{token}` и `POST /api/pay/{token}/confirm`;
   модули extras отдают только JSON.
