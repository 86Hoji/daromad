"""Напоминание должнику по SMS со ссылкой на оплату.

    preview_reminder(debt_id) -> {sms_text, pay_url, phone, can_send, reason, next_allowed_at}   # ничего не шлёт
    send_reminder(debt_id)    -> {status, sms_text, pay_url, sent_at, ...}                       # проверки -> SMS
    reminder_status(debt_id)  -> {sent_at, provider, sms_id, delivery, delivered, paid}         # для Mini App
    router                    -> FastAPI APIRouter: POST .../remind/preview, POST .../remind, GET .../remind/status

Ссылка: preview создаёт токен-черновик (sent_at = null) и показывает настоящую ссылку; remind берёт
этот же токен, отправляет SMS и ставит sent_at. Частота «не чаще раза в 3 дня» считается только по
отправленным SMS, поэтому preview и неудачная отправка ничего не блокируют.

Коды ошибок (ExtrasError.code):
    not_found     — долга нет
    debt_closed   — долг уже закрыт
    no_phone      — у должника нет телефона или он неверный
    no_consent    — должник не давал согласия на SMS
    too_soon      — SMS по этому долгу уже уходило меньше 3 дней назад
    sms_failed    — провайдер не отправил SMS (можно сразу повторить)
    link_too_long — PUBLIC_BASE_URL слишком длинный: ссылка не влезает в одно SMS (ошибка настройки)
    phone_not_allowed — SMS_PROVIDER=eskiz, а номера нет в DEMO_DEBTOR_PHONE/SMS_ALLOWLIST (защита от SMS
                        незнакомцам; в бою — SMS_ALLOW_ANY=1)
    link_not_public — настоящее SMS (Eskiz без тестового режима), а PUBLIC_BASE_URL = localhost:
                      должник не откроет ссылку (ошибка настройки)
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter

from . import adapters, payments, sms
from .payments import ExtrasError, error_response

MIN_INTERVAL = timedelta(days=3)


def mask_phone(phone: str | None) -> str | None:
    """'998901234567', '+998 90 123-45-67', '90 123 45 67' -> '+99890 *** ** 67'."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return None
    if len(digits) == 9:                      # введён без кода страны, как в sms.normalize_phone
        digits = "998" + digits
    return f"+{digits[:5]} *** ** {digits[-2:]}" if len(digits) >= 7 else "***"


def _last_sent(debt_id: int) -> datetime | None:
    times = []
    for t in payments.tokens_for_debt(debt_id):
        sent = t.get("sent_at", t.get("created_at"))       # старые записи без sent_at считались отправленными
        if sent:
            try:
                times.append(payments._parse(sent))
            except ValueError:
                continue
    return max(times) if times else None


def _check(debt: dict | None, now: datetime) -> str | None:
    """Первая причина, по которой слать нельзя, или None."""
    if debt is None:
        return "not_found"
    if debt["status"] != "open" or debt["remaining"] <= 0:
        return "debt_closed"
    if not debt.get("phone"):
        return "no_phone"
    try:
        sms.normalize_phone(debt["phone"])
    except ValueError:
        return "no_phone"
    if not debt.get("sms_consent"):
        return "no_consent"
    if sms.provider() == "eskiz" and not sms.number_allowed(sms.normalize_phone(debt["phone"])):
        return "phone_not_allowed"
    last = _last_sent(debt["id"])
    if last is not None and now - last < MIN_INTERVAL:
        return "too_soon"
    return None


def _text(debt: dict, url: str) -> str:
    shop = adapters.get_shop(debt["shop_id"]) or {}
    return sms.build_reminder_text(shop.get("name") or "", debt.get("person_name") or "",
                                   debt["remaining"], url)


def _link_problem() -> str | None:
    """Ссылка дойдёт до должника, только если SMS настоящее; тогда адрес должен быть публичным."""
    real_sms = sms.provider() == "eskiz" and not sms.eskiz_test_mode()
    return "link_not_public" if real_sms and not payments.base_url_is_public() else None


def _fits(debt: dict) -> bool:
    """Влезает ли ссылка такой длины в одно SMS (проверка до создания токена)."""
    try:
        _text(debt, payments.pay_url("x" * payments.TOKEN_LENGTH))
        return True
    except ValueError:
        return False


def preview_reminder(debt_id: int, now: datetime | None = None) -> dict:
    """Текст SMS и ссылка для окна подтверждения. SMS не отправляется."""
    now = now or payments._now()
    with payments._lock:
        debt = adapters.get_debt(debt_id)
        if debt is None:
            raise ExtrasError("not_found", "debt not found")
        reason = _check(debt, now) or _link_problem()
        if reason is None and not _fits(debt):
            reason = "link_too_long"
        text = url = None
        if reason is None:
            url = payments.pay_url(payments.draft_token(debt_id, now))
            text = _text(debt, url)
    last = _last_sent(debt_id)
    return {"debt_id": debt_id, "sms_text": text, "pay_url": url, "phone": mask_phone(debt.get("phone")),
            "can_send": reason is None, "reason": reason,
            "next_allowed_at": payments._fmt(last + MIN_INTERVAL) if reason == "too_soon" else None,
            "sms_mode": sms_mode()}


def sms_mode() -> str:
    """Для подписи в окне напоминания: mock — SMS не уходит; eskiz_test — «Bu Eskiz dan test»; live — настоящее."""
    if sms.provider() != "eskiz":
        return "mock"
    return "eskiz_test" if sms.eskiz_test_mode() else "live"


def send_reminder(debt_id: int, now: datetime | None = None) -> dict:
    now = now or payments._now()
    with payments._lock:                       # две быстрые кнопки подряд не дадут два SMS
        debt = adapters.get_debt(debt_id)
        reason = _check(debt, now) or _link_problem()
        if reason:
            raise ExtrasError(reason, "PUBLIC_BASE_URL must be public https" if reason == "link_not_public" else "")
        if not _fits(debt):
            raise ExtrasError("link_too_long", "PUBLIC_BASE_URL is too long for one SMS")
        token = payments.draft_token(debt_id, now)
        url = payments.pay_url(token)
        text = _text(debt, url)
        payments.mark_sent(token, now)          # до отправки: параллельный запрос уже увидит too_soon

    try:
        result = sms.send_sms(debt["phone"], text)
    except Exception:
        payments.unmark_sent(token)
        raise
    if result.get("status") != "sent":
        payments.unmark_sent(token)             # неудача не считается за «раз в 3 дня»
        adapters.add_audit(debt["shop_id"], "owner", "debt_reminder_failed",
                           {"debt_id": debt_id, "error": result.get("error")})
        raise ExtrasError("sms_failed", str(result.get("error") or "sms not sent"))

    payments.set_sms(token, result.get("provider"), result.get("id"))
    adapters.add_audit(debt["shop_id"], "owner", "debt_reminder_sent",
                       {"debt_id": debt_id, "provider": result.get("provider"), "sms_id": result.get("id")})
    return {"status": "sent", "sms_text": text, "pay_url": url, "sent_at": payments._fmt(now),
            "debt_id": debt_id, "phone": mask_phone(debt["phone"]), "provider": result.get("provider"),
            "sms_test_mode": bool(result.get("test_mode")),   # Eskiz без договора: ушёл «Bu Eskiz dan test»
            "expires_at": payments._fmt(now + payments.TOKEN_TTL)}


def reminder_status(debt_id: int) -> dict:
    """Последнее отправленное напоминание по долгу и доставлено ли оно (Eskiz) — для Mini App."""
    if adapters.get_debt(debt_id) is None:
        raise ExtrasError("not_found", "debt not found")
    sent = [t for t in payments.tokens_for_debt(debt_id) if t.get("sent_at")]
    if not sent:
        raise ExtrasError("not_found", "no reminder sent yet")
    last = max(sent, key=lambda t: t["sent_at"])
    out = {"debt_id": debt_id, "sent_at": last["sent_at"], "provider": last.get("sms_provider"),
           "sms_id": last.get("sms_id"), "paid": last.get("paid_at") is not None}
    if last.get("sms_provider") == "eskiz" and last.get("sms_id"):
        st = sms.eskiz_status(last["sms_id"])
        out.update(delivery=st.get("status"), delivered=st.get("delivered", False))
    else:
        out.update(delivery="mock" if last.get("sms_provider") == "mock" else None,
                   delivered=last.get("sms_provider") == "mock")
    return out


# --- FastAPI router (в основном бэке: app.include_router(reminders.router, dependencies=[...])) ----

router = APIRouter(prefix="/api", tags=["reminders"])


@router.post("/debts/{debt_id}/remind/preview")
def remind_preview(debt_id: int):
    try:
        return preview_reminder(debt_id)
    except ExtrasError as exc:
        return error_response(exc)


@router.get("/debts/{debt_id}/remind/status")
def remind_status(debt_id: int):
    try:
        return reminder_status(debt_id)
    except ExtrasError as exc:
        return error_response(exc)


@router.post("/debts/{debt_id}/remind")
def remind(debt_id: int):
    try:
        return send_reminder(debt_id)
    except ExtrasError as exc:
        return error_response(exc)
