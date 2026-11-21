"""Общая страховка для тестов extras.

* Настоящий backend/.env не влияет: SMS только mock, Eskiz без логина — ни один тест не отправит SMS.
* Каждый тест — своя пустая SQLite-БД с демо-данными extras: магазин 1 «Dilshod do'koni» и долги
  1 Alisher (телефон, согласие), 2 Nigora opa (телефон, без согласия), 3 Bobur (без телефона).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # backend/

import config  # noqa: E402
import db  # noqa: E402

SAFE_ENV = {
    "SMS_PROVIDER": "mock",
    "ESKIZ_EMAIL": "",
    "ESKIZ_PASSWORD": "",
    "ESKIZ_TEST_MODE": "0",
    "PUBLIC_BASE_URL": "http://localhost:8001",
    "WEBAPP_URL": "",
    "DEMO_DEBTOR_PHONE": "",
    "SMS_ALLOWLIST": "",
    "SMS_ALLOW_ANY": "",
}

SEED_DEBTS = [  # id, имя, телефон, согласие, сумма
    (1, "Alisher", "998901234567", 1, 450_000),
    (2, "Nigora opa", "998907654321", 0, 300_000),
    (3, "Bobur", None, 0, 150_000),
]


def add_shop(shop_id: int, name: str, owner: str = "") -> None:
    db.execute("INSERT INTO shops (id, tg_user_id, name, owner_name, opening_cash, created_at) VALUES (?,?,?,?,?,?)",
               (shop_id, None, name, owner, 0, "2026-11-01 09:00:00"))


def add_debt(debt_id: int, shop_id: int, person: str, phone, consent: int, amount: int,
             remaining: int | None = None) -> None:
    db.execute("INSERT INTO debts (id, shop_id, person_name, phone, sms_consent, amount, remaining, created_at, status) "
               "VALUES (?,?,?,?,?,?,?,?, 'open')",
               (debt_id, shop_id, person, phone, consent, amount, amount if remaining is None else remaining,
                "2026-11-01 10:00:00"))


def set_debt(debt_id: int, **fields) -> int:
    for k, v in fields.items():
        db.execute(f"UPDATE debts SET {k}=? WHERE id=?", (v, debt_id))
    return debt_id


def pays() -> list[dict]:
    return db.query("SELECT * FROM debt_payments ORDER BY id")


def audits() -> list[dict]:
    return db.query("SELECT * FROM audit_log ORDER BY id")


def reset_demo() -> None:
    """Пустая схема + демо-данные extras (вызывается фикстурой; тесты могут вызвать для «чистого листа»)."""
    with db.connect() as conn:
        for t in ("pay_links", "debt_payments", "drafts", "entries", "debts", "scheduled_payments", "cash_flows",
                  "offers", "audit_log", "shops"):
            conn.execute(f"DELETE FROM {t}")
    add_shop(1, "Dilshod do'koni", "Dilshod")
    for row in SEED_DEBTS:
        add_debt(row[0], 1, *row[1:])


@pytest.fixture(autouse=True)
def safe_env(monkeypatch, tmp_path):
    for k, v in SAFE_ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "extras.db")
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    db.init_db()
    reset_demo()
    from extras import adapters
    adapters.notifications.clear()
    monkeypatch.setattr(adapters, "_notifier", None)
