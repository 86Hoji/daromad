"""Напоминание должнику по SMS со ссылкой на оплату.

    preview_reminder(debt_id) -> {text, phone, can_send, reason}   # ничего не отправляет и не создаёт
    send_reminder(debt_id)    -> {status, sms, pay_url, ...}       # проверки -> токен -> SMS

Проверки перед отправкой (ExtrasError.code):
    not_found   — долга нет
    debt_closed — долг уже закрыт
    no_phone    — у должника нет телефона
    no_consent  — должник не давал согласия на SMS
    too_soon    — напоминание по этому долгу уже было меньше 3 дней назад
    sms_failed  — провайдер не отправил SMS (токен удаляется, попытка не считается)
    link_too_long — PUBLIC_BASE_URL слишком длинный: ссылка не влезает в одно SMS (ошибка настройки)
"""
from __future__ import annotations

from datetime import datetime, timedelta

from . import adapters, payments, sms
from .payments import ExtrasError

MIN_INTERVAL = timedelta(days=3)
PREVIEW_TOKEN = "x" * 43            # такой же длины, как secrets.token_urlsafe(32)


def mask_phone(phone: str | None) -> str | None:
    """'998901234567' или '+998 90 123-45-67' -> '+99890 *** ** 67'."""
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return None
    return f"+{digits[:5]} *** ** {digits[-2:]}" if len(digits) >= 7 else "***"


def _last_reminder(debt_id: int) -> datetime | None:
    times = [payments._parse(t["created_at"]) for t in payments.tokens_for_debt(debt_id)]
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
    last = _last_reminder(debt["id"])
    if last is not None and now - last < MIN_INTERVAL:
        return "too_soon"
    return None


def _text(debt: dict, url: str) -> str:
    shop = adapters.get_shop(debt["shop_id"]) or {}
    return sms.build_reminder_text(shop.get("name") or "", debt.get("person_name") or "",
                                   debt["remaining"], url)


def preview_reminder(debt_id: int, now: datetime | None = None) -> dict:
    """Текст, который уйдёт, и можно ли его отправить сейчас. Токен не создаётся."""
    now = now or payments._now()
    debt = adapters.get_debt(debt_id)
    if debt is None:
        raise ExtrasError("not_found", "debt not found")
    reason = _check(debt, now)
    text = None
    if debt["remaining"] > 0:
        try:
            text = _text(debt, payments.pay_url(PREVIEW_TOKEN))
        except ValueError:
            reason = reason or "link_too_long"
    last = _last_reminder(debt_id)
    return {"debt_id": debt_id, "text": text, "phone": mask_phone(debt.get("phone")),
            "can_send": reason is None, "reason": reason,
            "next_allowed_at": payments._fmt(last + MIN_INTERVAL) if reason == "too_soon" else None}


def send_reminder(debt_id: int, now: datetime | None = None) -> dict:
    now = now or payments._now()
    with payments._lock:                       # две быстрые кнопки подряд не дадут два SMS
        debt = adapters.get_debt(debt_id)
        reason = _check(debt, now)
        if reason:
            raise ExtrasError(reason)
        token = payments.create_token(debt_id, now)

    url = payments.pay_url(token)
    try:
        text = _text(debt, url)
        result = sms.send_sms(debt["phone"], text)
    except ValueError as exc:                  # ссылка не влезла в SMS: токен не должен блокировать долг на 3 дня
        payments.delete_token(token)
        raise ExtrasError("link_too_long", str(exc)) from exc
    except Exception:
        payments.delete_token(token)
        raise
    if result.get("status") != "sent":
        payments.delete_token(token)
        adapters.add_audit(debt["shop_id"], "owner", "debt_reminder_failed",
                           {"debt_id": debt_id, "error": result.get("error")})
        raise ExtrasError("sms_failed", str(result.get("error") or "sms not sent"))

    adapters.add_audit(debt["shop_id"], "owner", "debt_reminder_sent",
                       {"debt_id": debt_id, "provider": result.get("provider"), "sms_id": result.get("id")})
    return {"status": "sent", "debt_id": debt_id, "phone": mask_phone(debt["phone"]), "text": text,
            "pay_url": url, "provider": result.get("provider"),
            "sms_test_mode": bool(result.get("test_mode")),   # Eskiz без договора: ушёл «Bu Eskiz dan test»
            "expires_at": payments._fmt(now + payments.TOKEN_TTL)}
