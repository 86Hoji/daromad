"""SMS-напоминание должнику: текст и отправка.

    build_reminder_text(shop_name, person, amount, pay_url) -> str   # узбекский (латиница), <= 160 символов
    normalize_phone("+998 90 123-45-67") -> "998901234567"           # неверный номер -> ValueError
    send_sms(phone, text) -> {"status", "provider", "id", ...}

Режим — переменная SMS_PROVIDER в backend/.env:
    mock  (по умолчанию) — SMS не уходит, а пишется в лог и в backend/data/outbox.jsonl (для демо);
    eskiz — настоящая отправка через Eskiz.uz (нужны ESKIZ_EMAIL и ESKIZ_PASSWORD).
Только сервисный текст (сумма долга и ссылка на оплату), без рекламы.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from pathlib import Path

log = logging.getLogger("flowcast.extras.sms")

import config  # noqa: E402

OUTBOX_PATH = config.BASE_DIR / "data" / "outbox.jsonl"     # backend/data/ в .gitignore
MAX_LEN = 160                      # одно SMS латиницей (GSM-7)
MIN_SHOP_CHARS = 10                # название магазина короче не обрезаем — иначе не узнать, кто пишет
PROVIDERS = ("mock", "eskiz")

# Eskiz.uz, по публичной документации. TODO: сверить с актуальной документацией перед включением.
ESKIZ_BASE_URL = "https://notify.eskiz.uz/api"
ESKIZ_DEFAULT_FROM = "4546"        # TODO: своё имя отправителя после регистрации в Eskiz
# Тестовый аккаунт Eskiz (без договора) пропускает только свои тестовые тексты.
# ESKIZ_TEST_MODE=1 -> вместо нашего текста уходит этот; владелец в Mini App видит настоящий текст.
ESKIZ_TEST_TEXT = "Bu Eskiz dan test"
HTTP_TIMEOUT = 15


# --- текст ----------------------------------------------------------------------------

_CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "x", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "'", "ы": "i", "ь": "",
    "э": "e", "ю": "yu", "я": "ya", "ў": "o'", "қ": "q", "ғ": "g'", "ҳ": "h",
}
_APOSTROPHES = "‘’ʻʼ`´"
_QUOTES = "«»“”„\""


def to_sms_latin(text: str) -> str:
    """Кириллицу -> латиница, «умные» апострофы и кавычки -> ASCII, чтобы SMS не стало Unicode (70 символов)."""
    out = []
    for ch in text:
        low = ch.lower()
        if low in _CYR_TO_LAT:
            lat = _CYR_TO_LAT[low]
            out.append(lat.capitalize() if ch != low and lat else lat)
        elif ch in _APOSTROPHES:
            out.append("'")
        elif ch in _QUOTES:
            out.append("")
        else:
            out.append(ch)
    return re.sub(r"\s+", " ", "".join(out)).strip()


def format_amount(amount: int) -> str:
    """450000 -> '450 000'."""
    return f"{int(amount):,}".replace(",", " ")


def _fit(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: max(limit - 1, 1)].rstrip() + "."


def build_reminder_text(shop_name: str, person: str, amount: int, pay_url: str) -> str:
    """Вежливое напоминание без давления, <= 160 символов. Ссылка никогда не обрезается."""
    if int(amount) <= 0:
        raise ValueError("amount must be positive")
    pay_url = (pay_url or "").strip()
    if not pay_url or " " in pay_url:
        raise ValueError("pay_url is required")
    shop = to_sms_latin(shop_name or "") or "Do'kon"
    name = to_sms_latin(person or "")
    money = f"{format_amount(amount)} so'm"

    templates = [
        "Assalomu alaykum, {name}! \"{shop}\"da {money} qarzingiz bor. To'lash: {url}",
        "Assalomu alaykum! \"{shop}\"da {money} qarzingiz bor. To'lash: {url}",
        "\"{shop}\": {money} qarzingiz bor. To'lash: {url}",
        "Qarz {money}. To'lash: {url}",
    ]
    for tpl in templates:
        if "{name}" in tpl and not name:
            continue
        # длинные имена магазина/человека подрезаем, а не теряем всё сообщение
        fixed = len(tpl.format(name="", shop="", money=money, url=pay_url))
        room = MAX_LEN - fixed
        if room < 0:
            continue
        n, s = name, shop
        if "{name}" in tpl:
            if len(name) + len(shop) > room:          # длинное имя — только первое слово, имя не режем
                n = name.split()[0]
            if len(n) + len(shop) > room:
                s = _fit(shop, room - len(n))
        elif "{shop}" in tpl:
            s = _fit(shop, room)
        text = tpl.format(name=n, shop=s, money=money, url=pay_url)
        # магазин важнее имени (своё имя должник знает): обрезка магазина до огрызка — берём шаблон без имени
        shop_ok = "{shop}" not in tpl or s == shop or len(s) >= MIN_SHOP_CHARS
        if len(text) <= MAX_LEN and shop_ok:
            return text
    raise ValueError("pay_url is too long for one SMS")


# --- телефон --------------------------------------------------------------------------

def normalize_phone(raw) -> str:
    """-> '998XXXXXXXXX'. Принимает '+998 90 123-45-67', '90 123 45 67', '998901234567'. Иначе ValueError."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) != 12 or not digits.startswith("998"):
        raise ValueError(f"invalid phone: {raw!r}")
    return digits


# --- отправка -------------------------------------------------------------------------

def _env(name: str, default: str = "") -> str:
    return config.env(name, default)


def provider() -> str:
    p = (_env("SMS_PROVIDER", "mock") or "mock").lower()
    if p not in PROVIDERS:
        raise ValueError(f"SMS_PROVIDER must be one of {PROVIDERS}, got {p!r}")
    return p


def _now() -> str:
    from . import clock
    return clock.stamp()


_TRUE = ("1", "true", "yes", "on")


def allowed_numbers() -> set[str]:
    """Номера из DEMO_DEBTOR_PHONE и SMS_ALLOWLIST (через запятую); неверные пропускаются."""
    out = set()
    for raw in f"{_env('DEMO_DEBTOR_PHONE')},{_env('SMS_ALLOWLIST')}".split(","):
        try:
            out.add(normalize_phone(raw))
        except ValueError:
            continue
    return out


def number_allowed(number: str) -> bool:
    """Защита от SMS незнакомцам: настоящая отправка — только на разрешённые номера,
    пока явно не включено SMS_ALLOW_ANY=1 (боевой режим с реальными должниками)."""
    return _env("SMS_ALLOW_ANY").lower() in _TRUE or number in allowed_numbers()


def send_sms(phone, text: str) -> dict:
    """Отправить SMS. Неверный номер или пустой текст -> ValueError (ничего не отправляется).

    В режиме eskiz номер вне DEMO_DEBTOR_PHONE / SMS_ALLOWLIST (и без SMS_ALLOW_ANY=1) не отправляется:
    {"status": "failed", "error": "number not allowed ..."} — без обращения к Eskiz и без списания."""
    number = normalize_phone(phone)
    text = (text or "").strip()
    if not text:
        raise ValueError("empty sms text")
    mode = provider()
    if mode == "eskiz":
        if not number_allowed(number):
            log.warning("SMS to %s***%s blocked: not in DEMO_DEBTOR_PHONE/SMS_ALLOWLIST", number[:5], number[-2:])
            return {"status": "failed", "provider": "eskiz", "id": None,
                    "error": "number not allowed: add it to SMS_ALLOWLIST or set SMS_ALLOW_ANY=1"}
        return _send_eskiz(number, text)
    return _send_mock(number, text)


def _send_mock(number: str, text: str) -> dict:
    record = {"id": uuid.uuid4().hex[:12], "provider": "mock", "phone": number, "text": text,
              "status": "sent", "created_at": _now()}
    OUTBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTBOX_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    log.info("mock SMS to %s***%s: %s", number[:5], number[-2:], text)
    return {"status": "sent", "provider": "mock", "id": record["id"]}


def read_outbox() -> list[dict]:
    """Все «отправленные» mock-SMS (для демо и тестов)."""
    if not OUTBOX_PATH.exists():
        return []
    return [json.loads(line) for line in OUTBOX_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]


# --- Eskiz.uz (заготовка, включается SMS_PROVIDER=eskiz) -----------------------------

_eskiz_token: str | None = None


def _http_client():
    """Подменяется в тестах."""
    import httpx
    return httpx.Client(base_url=ESKIZ_BASE_URL, timeout=HTTP_TIMEOUT)


def _eskiz_login(client) -> str:
    email, password = _env("ESKIZ_EMAIL"), _env("ESKIZ_PASSWORD")
    if not email or not password:
        raise RuntimeError("ESKIZ_EMAIL / ESKIZ_PASSWORD yo'q")
    r = client.post("/auth/login", data={"email": email, "password": password})
    r.raise_for_status()
    token = (r.json().get("data") or {}).get("token")
    if not token:
        raise RuntimeError("Eskiz: token yo'q")
    return token


def eskiz_test_mode() -> bool:
    return _env("ESKIZ_TEST_MODE", config.ESKIZ_TEST_MODE_DEFAULT).lower() in _TRUE


def _send_eskiz(number: str, text: str) -> dict:
    """Ошибки Eskiz не бросаются, а возвращаются как status="failed" — API покажет их владельцу."""
    global _eskiz_token
    test_mode = eskiz_test_mode()
    if test_mode:
        text = ESKIZ_TEST_TEXT
    try:
        with _http_client() as client:
            for attempt in (1, 2):
                if not _eskiz_token:
                    _eskiz_token = _eskiz_login(client)
                r = client.post("/message/sms/send",
                                data={"mobile_phone": number, "message": text,
                                      "from": _env("ESKIZ_FROM", ESKIZ_DEFAULT_FROM)},
                                headers={"Authorization": f"Bearer {_eskiz_token}"})
                if r.status_code == 401 and attempt == 1:   # токен истёк — один раз логинимся заново
                    _eskiz_token = None
                    continue
                r.raise_for_status()
                body = r.json()
                return {"status": "sent", "provider": "eskiz", "id": str(body.get("id") or ""),
                        "provider_status": body.get("status"), "test_mode": test_mode}
    except Exception as exc:
        log.error("Eskiz SMS failed: %s", exc)
        return {"status": "failed", "provider": "eskiz", "id": None, "error": str(exc)[:200]}
    return {"status": "failed", "provider": "eskiz", "id": None, "error": "unauthorized"}


DELIVERED = ("DELIVERED", "DELIVRD")


def eskiz_status(sms_id: str) -> dict:
    """Статус доставки в Eskiz (проверено на настоящем SMS: GET /message/sms/status_by_id/{id},
    data.status = "DELIVERED" и т.п.). -> {"ok", "status", "delivered", "price"}; ошибки не бросаются."""
    global _eskiz_token
    if not sms_id:
        return {"ok": False, "status": None, "delivered": False, "error": "no sms id"}
    try:
        with _http_client() as client:
            for attempt in (1, 2):
                if not _eskiz_token:
                    _eskiz_token = _eskiz_login(client)
                r = client.get(f"/message/sms/status_by_id/{sms_id}",
                               headers={"Authorization": f"Bearer {_eskiz_token}"})
                if r.status_code == 401 and attempt == 1:
                    _eskiz_token = None
                    continue
                if r.status_code == 404:
                    return {"ok": False, "status": None, "delivered": False, "error": "sms not found"}
                r.raise_for_status()
                data = r.json().get("data") or {}
                status = str(data.get("status") or "").upper() or None
                return {"ok": True, "status": status, "delivered": status in DELIVERED,
                        "price": data.get("total_price", data.get("price"))}
    except Exception as exc:
        return {"ok": False, "status": None, "delivered": False, "error": str(exc)[:200]}
    return {"ok": False, "status": None, "delivered": False, "error": "unauthorized"}


def eskiz_check() -> dict:
    """Проверить логин в Eskiz без отправки SMS."""
    global _eskiz_token
    try:
        with _http_client() as client:
            _eskiz_token = _eskiz_login(client)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:200]}


# --- CLI (запуск из backend/) ----------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """python -m extras.sms --check                         # логин в Eskiz
       python -m extras.sms --to 998901234567 --text "..."   # отправка в текущем режиме SMS_PROVIDER
       python -m extras.sms --status <id>                    # доставлено ли (Eskiz)"""
    import argparse
    ap = argparse.ArgumentParser(prog="python -m extras.sms")
    ap.add_argument("--check", action="store_true", help="проверить логин Eskiz")
    ap.add_argument("--to", help="номер получателя")
    ap.add_argument("--text", help="текст SMS")
    ap.add_argument("--status", metavar="ID", help="статус доставки SMS в Eskiz по id из ответа отправки")
    args = ap.parse_args(argv)
    if args.status:
        r = eskiz_status(args.status)
        print(json.dumps(r, ensure_ascii=False))
        return 0 if r["ok"] else 1
    if args.check:
        r = eskiz_check()
        print("Eskiz login: OK" if r["ok"] else f"Eskiz login: ERROR {r['error']}")
        return 0 if r["ok"] else 1
    if not args.to or not args.text:
        ap.print_help()
        return 2
    try:
        r = send_sms(args.to, args.text)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 2
    print(json.dumps(r, ensure_ascii=False))
    return 0 if r["status"] == "sent" else 1


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    for stream in (sys.stdout, sys.stderr):                 # консоль не UTF-8 (Windows): «?» вместо падения
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    sys.exit(main())
