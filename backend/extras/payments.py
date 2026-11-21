"""Ссылка на оплату долга: токен на 7 дней и подтверждение оплаты.

    draft_token(debt_id) -> token                   # secrets.token_urlsafe(32), 7 дней, extras/tokens.json
    pay_url(token) -> "{PUBLIC_BASE_URL}/pay/{token}"
    get_payment(token) -> {shop_name, person_name, amount, status, ...}   # что видит должник
    confirm_payment(token) -> {...}                 # закрывает остаток долга; повтор не списывает дважды
    router                                          # FastAPI APIRouter: GET /api/pay/{token}, POST /api/pay/{token}/confirm

Запись токена: {debt_id, created_at, expires_at, sent_at, paid_at, paid_amount};
sent_at = null — черновик из preview (SMS ещё не ушло).

Ошибки — ExtrasError(code): not_found, token_expired, debt_closed (битая запись токена = not_found).
Оплата пока демо (кнопка на странице); при подключении Click/Payme confirm_payment
вызывается из их callback после успешного платежа.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import adapters, clock

EXTRAS_DIR = Path(__file__).resolve().parent
TOKENS_PATH = EXTRAS_DIR / "tokens.json"
TOKEN_TTL = timedelta(days=7)
TOKEN_LENGTH = 43                   # len(secrets.token_urlsafe(32))
TIME_FMT = "%Y-%m-%d %H:%M:%S"

_lock = threading.RLock()
log = logging.getLogger("extras.payments")


class ExtrasError(Exception):
    """Ошибка с кодом для API: код уходит клиенту, HTTP-статус берётся из STATUS."""

    STATUS = {"not_found": 404, "token_expired": 410, "debt_closed": 409, "no_phone": 422,
              "no_consent": 403, "too_soon": 429, "sms_failed": 502, "link_too_long": 500, "unauthorized": 401,
              "link_not_public": 500, "phone_not_allowed": 403}

    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail
        self.http_status = self.STATUS.get(code, 400)


def error_response(exc: ExtrasError) -> JSONResponse:
    """Ошибка в JSON для роутеров: {"error": code, "detail": ...} с HTTP-статусом кода."""
    return JSONResponse({"error": exc.code, "detail": exc.detail}, status_code=exc.http_status)


def _now() -> datetime:
    return clock.now()                          # время Ташкента, не сервера (на Railway — UTC)


def _fmt(dt: datetime) -> str:
    return dt.strftime(TIME_FMT)


def _parse(s: str) -> datetime:
    return datetime.strptime(s, TIME_FMT)


def public_base_url() -> str:
    try:
        from dotenv import load_dotenv
        load_dotenv(EXTRAS_DIR / ".env")
    except ImportError:
        pass
    return (os.getenv("PUBLIC_BASE_URL") or "http://localhost:8001").strip().rstrip("/")


def pay_url(token: str) -> str:
    return f"{public_base_url()}/pay/{token}"


def base_url_is_public() -> bool:
    """False для localhost / 127.x / 0.0.0.0 / ::1 / *.local — такую ссылку телефон должника не откроет."""
    from urllib.parse import urlparse
    host = (urlparse(public_base_url()).hostname or "").lower()
    return bool(host) and not (host in ("localhost", "0.0.0.0", "::1") or host.startswith("127.")
                               or host.endswith(".local") or host.endswith(".localhost"))


# --- хранилище токенов ---------------------------------------------------------------

def load_tokens() -> dict[str, dict]:
    with _lock:
        if not TOKENS_PATH.exists():
            return {}
        try:
            data = json.loads(TOKENS_PATH.read_text(encoding="utf-8") or "{}")
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}


def _save_tokens(tokens: dict[str, dict]) -> None:
    TOKENS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKENS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(tokens, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(TOKENS_PATH)          # атомарно: файл не бывает наполовину записан


def create_token(debt_id: int, now: datetime | None = None) -> str:
    now = now or _now()
    token = secrets.token_urlsafe(32)
    with _lock:
        tokens = load_tokens()
        tokens[token] = {"debt_id": debt_id, "created_at": _fmt(now), "expires_at": _fmt(now + TOKEN_TTL),
                         "sent_at": None, "paid_at": None, "paid_amount": None}
        _save_tokens(tokens)
    return token


def draft_token(debt_id: int, now: datetime | None = None) -> str:
    """Неотправленный неоплаченный токен этого долга (из прошлого preview) или новый."""
    now = now or _now()
    with _lock:
        for tok, rec in sorted(load_tokens().items(), key=lambda kv: str(kv[1].get("created_at")), reverse=True):
            if (isinstance(rec, dict) and rec.get("debt_id") == debt_id and "sent_at" in rec
                    and rec["sent_at"] is None and rec.get("paid_at") is None):
                try:
                    if _parse(rec["expires_at"]) > now:
                        return tok
                except (KeyError, TypeError, ValueError):
                    continue
        return create_token(debt_id, now)


def mark_sent(token: str, now: datetime) -> None:
    """SMS со ссылкой уходит: отметить и продлить ссылку на 7 дней от отправки."""
    with _lock:
        tokens = load_tokens()
        tokens[token].update(sent_at=_fmt(now), expires_at=_fmt(now + TOKEN_TTL))
        _save_tokens(tokens)


def set_sms(token: str, provider: str | None, sms_id: str | None) -> None:
    """Запомнить, каким провайдером и с каким id ушло SMS со ссылкой (для статуса доставки)."""
    with _lock:
        tokens = load_tokens()
        if token in tokens:
            tokens[token].update(sms_provider=provider, sms_id=sms_id)
            _save_tokens(tokens)


def unmark_sent(token: str) -> None:
    """SMS не ушло: снова черновик (попытка не считается за «раз в 3 дня»)."""
    with _lock:
        tokens = load_tokens()
        if token in tokens:
            tokens[token]["sent_at"] = None
            _save_tokens(tokens)


def tokens_for_debt(debt_id: int) -> list[dict]:
    return [dict(t, token=k) for k, t in load_tokens().items() if t.get("debt_id") == debt_id]


# --- оплата ---------------------------------------------------------------------------

def _get_valid(token: str, now: datetime) -> tuple[dict, dict]:
    rec = load_tokens().get(token or "")
    if not isinstance(rec, dict) or not {"debt_id", "expires_at"} <= rec.keys():
        raise ExtrasError("not_found", "link not found")
    if "sent_at" in rec and rec["sent_at"] is None:     # черновик из preview: SMS ещё не уходило
        raise ExtrasError("not_found", "link not sent yet")
    debt = adapters.get_debt(rec["debt_id"])
    if debt is None:
        raise ExtrasError("not_found", "debt not found")
    try:
        expires = _parse(rec["expires_at"])
    except (TypeError, ValueError):
        raise ExtrasError("not_found", "link not found") from None
    if rec.get("paid_at") is None and now > expires:
        raise ExtrasError("token_expired", "link expired")
    return rec, debt


def _view(rec: dict, debt: dict) -> dict:
    shop = adapters.get_shop(debt["shop_id"]) or {}
    paid = rec.get("paid_at") is not None
    return {"shop_name": shop.get("name"), "person_name": debt.get("person_name"),
            "amount": rec["paid_amount"] if paid else debt["remaining"],
            "status": "paid" if paid else debt["status"],
            "paid_at": rec.get("paid_at"), "expires_at": rec["expires_at"]}


def get_payment(token: str, now: datetime | None = None) -> dict:
    """Что видит должник по ссылке. Телефон и история не показываются."""
    rec, debt = _get_valid(token, now or _now())
    return _view(rec, debt)


def confirm_payment(token: str, now: datetime | None = None) -> dict:
    """Оплатить остаток долга по ссылке. Повторный вызов возвращает ту же оплату (already_paid=True)."""
    now = now or _now()
    with _lock:
        rec, debt = _get_valid(token, now)
        if rec.get("paid_at") is not None:
            return dict(_view(rec, debt), already_paid=True)
        if debt["status"] != "open" or debt["remaining"] <= 0:
            raise ExtrasError("debt_closed", "debt is already closed")

        amount = debt["remaining"]
        debt = adapters.record_debt_payment(debt["id"], amount, source="link")
        tokens = load_tokens()
        tokens[token].update(paid_at=_fmt(now), paid_amount=amount)
        _save_tokens(tokens)
        rec = tokens[token]

    # Оплата уже записана: сбой журнала или уведомления не должен превращать её в ошибку для должника.
    try:
        adapters.add_audit(debt["shop_id"], "system", "debt_paid_by_link",
                           {"debt_id": debt["id"], "amount": amount})
        adapters.notify_owner(debt["shop_id"],
                              f"{(debt.get('person_name') or '').strip() or 'Mijoz'} to'ladi ✅ {amount:,} so'm"
                              .replace(",", " "))
    except Exception:
        log.exception("payment %s recorded, but audit/notify failed", token[:6])
    return dict(_view(rec, debt), already_paid=False)


# --- FastAPI router (в основном бэке: app.include_router(payments.router)) — открыт для должника ---

router = APIRouter(prefix="/api", tags=["payments"])


@router.get("/pay/{token}")
def pay_info(token: str):
    try:
        return get_payment(token)
    except ExtrasError as exc:
        return error_response(exc)


@router.post("/pay/{token}/confirm")
def pay_confirm(token: str):
    try:
        return confirm_payment(token)
    except ExtrasError as exc:
        return error_response(exc)
