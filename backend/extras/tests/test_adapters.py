import pytest

from extras import adapters


@pytest.fixture(autouse=True)
def fresh():
    adapters.reset()


def test_seed_data():
    assert adapters.get_shop(1)["name"] == "Dilshod do'koni"
    assert adapters.get_debt(1)["remaining"] == 450_000
    assert adapters.get_debt(2)["sms_consent"] is False
    assert adapters.get_debt(3)["phone"] is None
    assert adapters.get_debt(99) is None


def test_partial_then_full_payment_closes_debt():
    d = adapters.record_debt_payment(1, 200_000)
    assert d["remaining"] == 250_000 and d["status"] == "open"
    d = adapters.record_debt_payment(1, 250_000, source="link")
    assert d["remaining"] == 0 and d["status"] == "closed" and d["close_source"] == "link"


def test_overpayment_does_not_go_negative():
    d = adapters.record_debt_payment(3, 999_000)
    assert d["remaining"] == 0 and d["status"] == "closed"
    assert adapters.payments[-1]["amount"] == 150_000


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


def test_returned_dicts_are_copies():
    adapters.get_debt(1)["remaining"] = 0
    assert adapters.get_debt(1)["remaining"] == 450_000


def test_audit_actor_is_checked():
    adapters.add_audit(1, "system", "sms_sent", {"debt_id": 1})
    assert adapters.audit_log[-1]["action"] == "sms_sent"
    with pytest.raises(ValueError):
        adapters.add_audit(1, "robot", "x")


def test_notify_owner_is_recorded():
    adapters.notify_owner(1, "Alisher to'ladi ✅ 450 000 so'm")
    assert adapters.notifications[-1]["text"].startswith("Alisher to'ladi")



def test_demo_debtor_phone_from_env(monkeypatch):
    monkeypatch.setenv("DEMO_DEBTOR_PHONE", "93 000 00 11")
    adapters.reset()
    assert adapters.get_debt(1)["phone"] == "998930000011"
    assert adapters.get_debt(2)["phone"] == "998907654321"           # остальные не трогаем
    monkeypatch.setenv("DEMO_DEBTOR_PHONE", "garbage")
    adapters.reset()
    assert adapters.get_debt(1)["phone"] == "998901234567"           # мусор — остаётся сид
