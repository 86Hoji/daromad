# Flowcast extras

Модули второго разработчика (Темур): фото накладных, SMS-напоминания должнику, оплата долга по ссылке,
проверка точности ИИ. **Склеены с основным бэком** (ноябрь 2026): данные — в той же SQLite через
`adapters.py` → `db.py`, роутеры подключены в `main.py`, настройки — в `backend/.env`.

| Модуль | Что делает |
|---|---|
| `adapters.py` | магазин, долги, `debt_payments` (`source='link'`), `audit_log` через `db.py`; `notify_owner` → сообщение владельцу в бот |
| `vision.py` | фото накладной / чека / скриншота Payme-Click → события Flowcast (Gemini + проверка кодом); ключ и цепочка моделей — из основного `ai.py` |
| `sms.py` | текст напоминания (узбекский, ≤160 символов), номер, отправка: `mock` или Eskiz |
| `payments.py` | ссылка на оплату: токен на 7 дней в таблице `pay_links`, подтверждение одной транзакцией без двойного списания; `router` |
| `reminders.py` | напоминание должнику: проверки → ссылка → SMS → журнал; `router` |
| `eval_ai.py` | проверка точности ИИ на эталонных примерах (текст, голос, фото) |

Принцип тот же, что у основного бэка: ИИ только извлекает данные, суммы и правила проверяет код,
запись подтверждает человек.

Установка не нужна: общий venv и `backend/requirements.txt` (новых зависимостей у extras нет).

## Настройки (`backend/.env`)

Файл в `.gitignore`. Ключи и пароли пишутся только сюда, **никогда** в `.env.example`.

| Ключ | Значение |
|---|---|
| `PUBLIC_BASE_URL` | адрес **фронтенда**: ссылка в SMS = `PUBLIC_BASE_URL/pay/<token>` (страница оплаты в Mini App); пусто → `WEBAPP_URL` без `/tg`, иначе `http://localhost:5173` |
| `SMS_PROVIDER` | `mock` (по умолчанию) — SMS пишется в `backend/data/outbox.jsonl`; `eskiz` — настоящая отправка |
| `ESKIZ_EMAIL`, `ESKIZ_PASSWORD` | вход в кабинет Eskiz (notify.eskiz.uz) |
| `ESKIZ_FROM` | имя отправителя, по умолчанию `4546` |
| `ESKIZ_TEST_MODE` | `1` (по умолчанию) — тестовый аккаунт Eskiz: уходит «Bu Eskiz dan test», владелец в приложении видит настоящий текст; `0` — после договора с Eskiz |
| `DEMO_DEBTOR_PHONE` | свой или командный номер: им становится телефон демо-должника Alisher в `seed.py`; на него разрешены настоящие SMS |
| `SMS_ALLOWLIST` | ещё номера через запятую, на которые разрешены настоящие SMS |
| `SMS_ALLOW_ANY` | `0` — при `SMS_PROVIDER=eskiz` SMS на номер не из двух строк выше **не уходит**; `1` — только в боевом режиме |

**Перед демо с настоящими SMS:** `SMS_PROVIDER=eskiz`, `ESKIZ_TEST_MODE=1`, свой номер в
`DEMO_DEBTOR_PHONE`, затем `python seed.py --reset`. Одно SMS стоит 145 сум.

**Время.** Отметки времени и «сегодня» в extras — по Ташкенту (UTC+5), `extras/clock.py`.

## API (в основном бэке, порт 8000)

Маршруты владельца требуют `X-Telegram-Init-Data` (в Mini App) и проверяют, что долг принадлежит
магазину: чужой долг — `404 not_found`. Локально без initData работает демо-магазин `DEV_SHOP_ID`.
Оплата открыта — её вызывает страница, которую должник открывает из SMS.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/api/debts/{id}/remind/preview` | `sms_text`, `pay_url`, замаскированный `phone`, `can_send`, `reason`; SMS не шлёт |
| POST | `/api/debts/{id}/remind` | отправить; ответ: `status`, `sms_text`, `pay_url`, `sent_at`, `expires_at`, `sms_test_mode` |
| GET | `/api/debts/{id}/remind/status` | последнее напоминание: `sent_at`, `delivery` (`DELIVERED`…), `delivered`, `paid` |
| GET | `/api/pay/{token}` | данные для страницы оплаты (без телефона должника) |
| POST | `/api/pay/{token}/confirm` | оплатить остаток; повтор возвращает `already_paid: true` и не списывает |

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

**Цепочка оплаты через curl** (бэкенд на :8000, `python seed.py --reset`, `SMS_PROVIDER=mock`):

```bash
curl -s -X POST localhost:8000/api/debts/1/remind/preview
```

```bash
curl -s -X POST localhost:8000/api/debts/1/remind
```

SMS появилась в `backend/data/outbox.jsonl`. Токен — конец `pay_url` из ответа:

```bash
curl -s localhost:8000/api/pay/ТОКЕН
```

```bash
curl -s -X POST localhost:8000/api/pay/ТОКЕН/confirm
```

Долг закрыт в БД (`debt_payments.source='link'`, в журнале «tasdiqlangan»), бо'ш пул вырос, владельцу в бот
пришло `Alisher to'ladi ✅ 450 000 so'm`. Повторный confirm
возвращает `"already_paid": true` и не списывает. Проверка отказов:

```bash
curl -s -X POST localhost:8000/api/debts/2/remind
```

→ `{"error":"no_consent"}` (в демо-сиде согласие на SMS есть только у Alisher).

**SMS:**

```bash
C:\venvs\daromad\Scripts\python.exe -m extras.sms --check
```

Проверяет вход в Eskiz, SMS не отправляет.

```bash
C:\venvs\daromad\Scripts\python.exe -m extras.sms --to 998XXXXXXXXX --text "Salom"
```

Отправляет в текущем режиме `SMS_PROVIDER` (в Eskiz это списывает баланс).

```bash
C:\venvs\daromad\Scripts\python.exe -m extras.sms --status ID
```

Доставлено ли SMS (id — из ответа отправки), без списания.

**Фото:**

```bash
C:\venvs\daromad\Scripts\python.exe -m extras.vision extras/samples/synthetic/payme_alisher.png --today 2026-11-21
```

**Проверка точности ИИ:**

```bash
C:\venvs\daromad\Scripts\python.exe -m extras.eval_ai
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
C:envs\daromad\Scripts\python.exe -m pytest -q
```

Из `backend/`: тесты основного бэка и `extras/tests/`. Сеть не нужна: Gemini и Eskiz подменены фейками.
`extras/tests/conftest.py` даёт каждому тесту свою SQLite-БД с демо-долгами и перекрывает настоящий `.env`
(`SMS_PROVIDER=mock`, пустые ключи Eskiz), поэтому тесты никогда не отправят настоящее SMS.

## Безопасность и данные

- Секреты — только в `backend/.env`. Тест `test_env_example_has_no_secrets` не даст закоммитить их в `.env.example`.
- Маршруты владельца — только свой долг (initData → магазин → `debt.shop_id`), иначе `404`.
- Номер должника в ответах API маскируется (`+99890 *** ** 67`); `/api/pay/{token}` номер не отдаёт вовсе.
- Токен оплаты — `secrets.token_urlsafe(32)`, 7 дней; оплата — одна транзакция `BEGIN IMMEDIATE`, повтор не списывает.
- SMS только сервисное (сумма и ссылка), без рекламы, только при согласии должника и не чаще раза в 3 дня.
- Бесплатный Gemini может использовать запросы для улучшения моделей: реальные ФИО и номера в тестовые примеры не класть.
