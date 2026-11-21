"""Ссылка на оплату долга: токен на 7 дней и подтверждение оплаты. Хранение — таблица pay_links (db.py).

    draft_token(debt_id) -> token                   # secrets.token_urlsafe(32), 7 дней
    pay_url(token) -> "{PUBLIC_BASE_URL}/pay/{token}"   # PUBLIC_BASE_URL = адрес фронтенда (страница /pay/:token)
    get_payment(token) -> {shop_name, person_name, amount, status, ...}   # что видит должник
    confirm_payment(token) -> {...}                 # закрывает остаток долга; повтор не списывает дважды
    router                                          # GET /api/pay/{token}, POST /api/pay/{token}/confirm

Запись: {debt_id, shop_id, created_at, expires_at, sent_at, paid_at, paid_amount, sms_provider, sms_id};
sent_at = NULL — черновик из preview (SMS ещё не ушло).

Ошибки — ExtrasError(code): not_found, token_expired, debt_closed (битая запись = not_found).
Оплата пока демо (кнопка на странице); при подключении Click/Payme confirm_payment
вызывается из их callback после успешного платежа.
"""
from __future__ import annotations

import logging
import secrets
import threading
from datetime import datetime, timedelta

from fastapi import APIRouter
from fastapi.responses import JSONResponse

import config
import db

from . import adapters, clock

TOKEN_TTL = timedelta(days=7)
TOKEN_LENGTH = 43                   # len(secrets.token_urlsafe(32))
TIME_FMT = "%Y-%m-%d %H:%M:%S"

_lock = threading.RLock()
log = logging.getLogger("flowcast.extras.payments")


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
    return config.public_base_url()


def pay_url(token: str) -> str:
    return f"{public_base_url()}/pay/{token}"


def base_url_is_public() -> bool:
    """False для localhost / 127.x / 0.0.0.0 / ::1 / *.local — такую ссылку телефон должника не откроет."""
    from urllib.parse import urlparse
    host = (urlparse(public_base_url()).hostname or "").lower()
    return bool(host) and not (host in ("localhost", "0.0.0.0", "::1") or host.startswith("127.")
                               or host.endswith(".local") or host.endswith(".localhost"))


# --- хранилище: таблица pay_links -----------------------------------------------------

_COLS = ("debt_id", "shop_id", "created_at", "expires_at", "sent_at", "paid_at", "paid_amount", "sms_provider", "sms_id")


def _rec(row) -> dict:
    return {k: row[k] for k in _COLS}


def load_tokens() -> dict[str, dict]:
    """Все ссылки {token: запись} (для тестов и отладки)."""
    return {r["token"]: _rec(r) for r in db.query("SELECT * FROM pay_links ORDER BY created_at")}


def create_token(debt_id: int, now: datetime | None = None) -> str:
    now = now or _now()
    debt = adapters.get_debt(debt_id)
    if debt is None:
        raise ExtrasError("not_found", "debt not found")
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO pay_links (token, debt_id, shop_id, created_at, expires_at) VALUES (?,?,?,?,?)",
               (token, debt_id, debt["shop_id"], _fmt(now), _fmt(now + TOKEN_TTL)))
    return token


def draft_token(debt_id: int, now: datetime | None = None) -> str:
    """Неотправленный неоплаченный действующий токен этого долга (из прошлого preview) или новый."""
    now = now or _now()
    with _lock:
        row = db.query_one("SELECT token FROM pay_links WHERE debt_id=? AND sent_at IS NULL AND paid_at IS NULL "
                           "AND expires_at > ? ORDER BY created_at DESC LIMIT 1", (debt_id, _fmt(now)))
        return row["token"] if row else create_token(debt_id, now)


def mark_sent(token: str, now: datetime) -> None:
    """SMS со ссылкой уходит: отметить и продлить ссылку на 7 дней от отправки."""
    db.execute("UPDATE pay_links SET sent_at=?, expires_at=? WHERE token=?",
               (_fmt(now), _fmt(now + TOKEN_TTL), token))


def set_sms(token: str, provider: str | None, sms_id: str | None) -> None:
    """Запомнить, каким провайдером и с каким id ушло SMS со ссылкой (для статуса доставки)."""
    db.execute("UPDATE pay_links SET sms_provider=?, sms_id=? WHERE token=?", (provider, sms_id, token))


def unmark_sent(token: str) -> None:
    """SMS не ушло: снова черновик (попытка не считается за «раз в 3 дня»)."""
    db.execute("UPDATE pay_links SET sent_at=NULL WHERE token=?", (token,))


def tokens_for_debt(debt_id: int) -> list[dict]:
    return [dict(_rec(r), token=r["token"]) for r in db.query("SELECT * FROM pay_links WHERE debt_id=?", (debt_id,))]


# --- оплата ---------------------------------------------------------------------------

def _get_valid(token: str, now: datetime, conn=None) -> tuple[dict, dict]:
    sql = "SELECT * FROM pay_links WHERE token=?"
    row = conn.execute(sql, (token or "",)).fetchone() if conn else db.query_one(sql, (token or "",))
    if row is None:
        raise ExtrasError("not_found", "link not found")
    rec = _rec(row)
    if rec["sent_at"] is None:                          # черновик из preview: SMS ещё не уходило
        raise ExtrasError("not_found", "link not sent yet")
    drow = (conn.execute("SELECT * FROM debts WHERE id=?", (rec["debt_id"],)).fetchone() if conn
            else adapters.get_debt(rec["debt_id"]))
    if drow is None:
        raise ExtrasError("not_found", "debt not found")
    debt = dict(drow)
    try:
        expires = _parse(rec["expires_at"])
    except (TypeError, ValueError):
        raise ExtrasError("not_found", "link not found") from None
    if rec["paid_at"] is None and now > expires:
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
    """Оплатить остаток долга по ссылке. Повторный вызов возвращает ту же оплату (already_paid=True).

    Одна транзакция BEGIN IMMEDIATE: проверка ссылки, debt_payments (source='link'), закрытие долга и
    paid_at — две параллельные оплаты (даже из разных процессов) не спишут дважды."""
    now = now or _now()
    with _lock, db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        rec, debt = _get_valid(token, now, conn)
        if rec["paid_at"] is not None:
            return dict(_view(rec, debt), already_paid=True)
        if debt["status"] != "open" or debt["remaining"] <= 0:
            raise ExtrasError("debt_closed", "debt is already closed")
        amount = debt["remaining"]
        debt = adapters.record_debt_payment(debt["id"], amount, source="link", conn=conn)
        conn.execute("UPDATE pay_links SET paid_at=?, paid_amount=? WHERE token=? AND paid_at IS NULL",
                     (_fmt(now), amount, token))
        rec = dict(rec, paid_at=_fmt(now), paid_amount=amount)

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
