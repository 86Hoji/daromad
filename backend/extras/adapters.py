"""Доступ к данным для модулей extras — поверх основной БД (db.py).

Таблицы: shops, debts, debt_payments (source='link' для оплаты по ссылке), audit_log; ссылки — pay_links
(см. payments.py). notify_owner отправляет сообщение владельцу в бот (bot.py регистрирует отправителя
через set_notifier при запуске). Остальные модули extras работают с данными только через эти функции.
"""
from __future__ import annotations

import logging
import sqlite3
from collections import deque
from typing import Callable

import db

from . import clock

log = logging.getLogger("flowcast.extras.adapters")

ACTORS = ("owner", "system", "ai")          # как CHECK в audit_log
SOURCES = ("voice", "text", "photo", "bank", "link")

IN_MEMORY = False                            # данные в SQLite: переживают перезапуск

# последние уведомления владельцу (для логов, отладки и тестов)
notifications: "deque[dict]" = deque(maxlen=50)
_notifier: Callable[[int, str], None] | None = None


def set_notifier(fn: Callable[[int, str], None] | None) -> None:
    """bot.py: fn(shop_id, text) отправляет сообщение владельцу. Вызывается из любого потока."""
    global _notifier
    _notifier = fn


def _debt_view(row) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    d["sms_consent"] = bool(d.get("sms_consent"))
    return d


def get_shop(shop_id: int) -> dict | None:
    return db.get_shop(shop_id)


def get_debt(debt_id: int) -> dict | None:
    return _debt_view(db.query_one("SELECT * FROM debts WHERE id=?", (debt_id,)))


def record_debt_payment(debt_id: int, amount: int, source: str = "link",
                        conn: sqlite3.Connection | None = None) -> dict:
    """Уменьшает остаток долга, закрывает его при 0 и пишет debt_payments. Возвращает долг после оплаты.

    Платёж больше остатка засчитывается только на остаток. conn — чтобы оплата по ссылке шла одной
    транзакцией с отметкой ссылки (payments.confirm_payment).
    """
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if amount <= 0:
        raise ValueError("amount must be positive")
    if conn is None:
        with db.connect() as c:
            return record_debt_payment(debt_id, amount, source, c)

    row = conn.execute("SELECT * FROM debts WHERE id=?", (debt_id,)).fetchone()
    if row is None:
        raise KeyError(f"debt {debt_id} not found")
    debt = dict(row)
    if debt["status"] != "open" or debt["remaining"] <= 0:
        raise ValueError(f"debt {debt_id} is already closed")
    paid = min(int(amount), debt["remaining"])
    remaining = debt["remaining"] - paid
    now = clock.stamp()
    if remaining == 0:
        conn.execute("UPDATE debts SET remaining=0, status='closed', closed_at=?, close_source=? WHERE id=?",
                     (now, source, debt_id))
    else:
        conn.execute("UPDATE debts SET remaining=? WHERE id=?", (remaining, debt_id))
    conn.execute("INSERT INTO debt_payments (debt_id, shop_id, amount, date, source, created_at) VALUES (?,?,?,?,?,?)",
                 (debt_id, debt["shop_id"], paid, clock.today().isoformat(), source, now))
    return _debt_view(conn.execute("SELECT * FROM debts WHERE id=?", (debt_id,)).fetchone())


def add_audit(shop_id: int | None, actor: str, action: str, payload: dict | None = None) -> None:
    if actor not in ACTORS:
        raise ValueError(f"actor must be one of {ACTORS}")
    db.audit(shop_id, actor, action, payload)


def notify_owner(shop_id: int, text: str) -> None:
    """Сообщение владельцу в бот (если бот запущен) + строка в консоли uvicorn. Ошибки не бросаются."""
    notifications.append({"shop_id": shop_id, "text": text, "created_at": clock.stamp()})
    log.info("notify_owner shop=%s: %s", shop_id, text)
    line = f"[owner shop={shop_id}] {text}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:                               # консоль не UTF-8 (Windows, вывод в файл)
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)
    if _notifier is not None:
        try:
            _notifier(shop_id, text)
        except Exception:
            log.exception("notify_owner: bot send failed")
