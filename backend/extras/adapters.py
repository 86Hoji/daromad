"""Доступ к данным для модулей extras.

ЗАГЛУШКА: сейчас данные лежат в словарях в памяти. При склейке с основным бэком
тела этих функций заменятся вызовами db.py (таблицы shops, debts, debt_payments,
audit_log), а notify_owner — отправкой сообщения владельцу в бот.
Остальные модули extras работают с данными ТОЛЬКО через эти функции.
"""
from __future__ import annotations

import copy
import logging
import os
from pathlib import Path
from . import clock

log = logging.getLogger("extras.adapters")

ACTORS = ("owner", "system", "ai")          # как CHECK в audit_log основного db.py
SOURCES = ("voice", "text", "photo", "bank", "link")

_SEED_SHOPS = {1: {"id": 1, "name": "Dilshod do'koni", "owner_name": "Dilshod"}}
_SEED_DEBTS = {
    1: {"id": 1, "shop_id": 1, "person_name": "Alisher", "phone": "998901234567", "sms_consent": True,
        "amount": 450_000, "remaining": 450_000, "status": "open", "created_at": "2026-11-01 10:00:00"},
    2: {"id": 2, "shop_id": 1, "person_name": "Nigora opa", "phone": "998907654321", "sms_consent": False,
        "amount": 300_000, "remaining": 300_000, "status": "open", "created_at": "2026-11-08 12:30:00"},
    3: {"id": 3, "shop_id": 1, "person_name": "Bobur", "phone": None, "sms_consent": False,
        "amount": 150_000, "remaining": 150_000, "status": "open", "created_at": "2026-11-15 18:00:00"},
}

_shops: dict[int, dict] = {}
_debts: dict[int, dict] = {}
payments: list[dict] = []        # история оплат долгов
audit_log: list[dict] = []       # журнал действий
notifications: list[dict] = []   # что ушло бы владельцу в бот


def _now() -> str:
    return clock.stamp()                        # время Ташкента, не сервера


IN_MEMORY = True     # заглушка: данные живут в памяти и сбрасываются при перезапуске (с db.py станет False)


def _demo_phone() -> str | None:
    """Номер демо-должника (Alisher) из extras/.env: свой/командный, чтобы демо-SMS не ушло незнакомцу."""
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent / ".env")
    except ImportError:
        pass
    digits = "".join(ch for ch in os.getenv("DEMO_DEBTOR_PHONE", "") if ch.isdigit())
    if len(digits) == 9:
        digits = "998" + digits
    return digits if len(digits) == 12 and digits.startswith("998") else None


def reset() -> None:
    """Вернуть демо-данные к исходным (для тестов и перезапуска демо)."""
    _shops.clear()
    _shops.update(copy.deepcopy(_SEED_SHOPS))
    _debts.clear()
    _debts.update(copy.deepcopy(_SEED_DEBTS))
    phone = _demo_phone()
    if phone:
        _debts[1]["phone"] = phone
    payments.clear()
    audit_log.clear()
    notifications.clear()


def get_shop(shop_id: int) -> dict | None:
    shop = _shops.get(shop_id)
    return dict(shop) if shop else None


def get_debt(debt_id: int) -> dict | None:
    debt = _debts.get(debt_id)
    return dict(debt) if debt else None


def record_debt_payment(debt_id: int, amount: int, source: str = "link") -> dict:
    """Уменьшает остаток долга, закрывает его при 0. Возвращает долг после оплаты.

    Платёж больше остатка засчитывается только на остаток (в минус не уходим).
    """
    debt = _debts.get(debt_id)
    if debt is None:
        raise KeyError(f"debt {debt_id} not found")
    if debt["status"] != "open":
        raise ValueError(f"debt {debt_id} is already closed")
    if amount <= 0:
        raise ValueError("amount must be positive")
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")

    paid = min(amount, debt["remaining"])
    debt["remaining"] -= paid
    payments.append({"debt_id": debt_id, "shop_id": debt["shop_id"], "amount": paid,
                     "source": source, "created_at": _now()})
    if debt["remaining"] == 0:
        debt["status"] = "closed"
        debt["closed_at"] = _now()
        debt["close_source"] = source
    return dict(debt)


def add_audit(shop_id: int | None, actor: str, action: str, payload: dict | None = None) -> None:
    if actor not in ACTORS:
        raise ValueError(f"actor must be one of {ACTORS}")
    audit_log.append({"shop_id": shop_id, "actor": actor, "action": action,
                      "payload": payload, "created_at": _now()})


def notify_owner(shop_id: int, text: str) -> None:
    """Потом: сообщение владельцу в бот. Сейчас: лог."""
    notifications.append({"shop_id": shop_id, "text": text, "created_at": _now()})
    log.info("notify_owner shop=%s: %s", shop_id, text)
    print(f"[owner shop={shop_id}] {text}", flush=True)     # видно в консоли uvicorn на демо


reset()
