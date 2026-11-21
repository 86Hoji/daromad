"""adapters.py поверх настоящей БД (db.py): долги, debt_payments, audit_log, уведомление владельцу."""
import pytest

import db
from extras import adapters
from extras.tests.conftest import audits, pays


def test_seed_data():
    assert adapters.get_shop(1)["name"] == "Dilshod do'koni"
    assert adapters.get_debt(1)["remaining"] == 450_000
    assert adapters.get_debt(2)["sms_consent"] is False
    assert adapters.get_debt(3)["phone"] is None
    assert adapters.get_debt(99) is None
    assert adapters.IN_MEMORY is False


def test_partial_then_full_payment_closes_debt():
    d = adapters.record_debt_payment(1, 200_000)
    assert d["remaining"] == 250_000 and d["status"] == "open"
    d = adapters.record_debt_payment(1, 250_000, source="link")
    assert d["remaining"] == 0 and d["status"] == "closed" and d["close_source"] == "link"
    assert [p["source"] for p in pays()] == ["link", "link"] and pays()[0]["date"]


def test_overpayment_does_not_go_negative():
    d = adapters.record_debt_payment(3, 999_000)
    assert d["remaining"] == 0 and d["status"] == "closed"
    assert pays()[-1]["amount"] == 150_000


def test_closed_debt_cannot_be_paid_again():
    adapters.record_debt_payment(1, 450_000)
    with pytest.raises(ValueError):
        adapters.record_debt_payment(1, 1)


def test_bad_payments_rejected():
    with pytest.raises(KeyError):
        adapters.record_debt_payment(99, 1000)
    with pytest.raises(ValueError):
        adapters.record_debt_payment(1, 0)
    with pytest.raises(ValueError):
        adapters.record_debt_payment(1, 1000, source="magic")
    assert pays() == []


def test_returned_dicts_are_copies():
    adapters.get_debt(1)["remaining"] = 0
    assert adapters.get_debt(1)["remaining"] == 450_000


def test_audit_actor_is_checked():
    adapters.add_audit(1, "system", "sms_sent", {"debt_id": 1})
    assert audits()[-1]["action"] == "sms_sent"
    with pytest.raises(ValueError):
        adapters.add_audit(1, "robot", "x")


def test_notify_owner_calls_bot_and_survives_errors():
    sent = []
    adapters.set_notifier(lambda shop_id, text: sent.append((shop_id, text)))
    adapters.notify_owner(1, "Alisher to'ladi ✅ 450 000 so'm")
    assert sent == [(1, "Alisher to'ladi ✅ 450 000 so'm")]
    assert adapters.notifications[-1]["text"].startswith("Alisher to'ladi")
    adapters.set_notifier(lambda *a: 1 / 0)                     # бот упал — оплата не должна падать
    adapters.notify_owner(1, "x")


def test_payment_changes_cash_in_main_logic():
    """debt_payments (source='link') — тот же учёт, что у основного бэка: остаток в кассе растёт."""
    import logic
    from datetime import date
    before = logic.cash_on(1, date(2030, 1, 1))
    adapters.record_debt_payment(1, 450_000, source="link")
    assert logic.cash_on(1, date(2030, 1, 1)) == before + 450_000
    assert db.query_one("SELECT status FROM debts WHERE id=1")["status"] == "closed"
