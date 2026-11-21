"""Этап 4: напоминания, токены оплаты, API dev_app — без сети, SMS в mock."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from extras import adapters, dev_app, payments, reminders, sms
from extras.payments import ExtrasError

T0 = datetime(2026, 11, 21, 10, 0, 0)
ALISHER, NIGORA, BOBUR = 1, 2, 3


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    adapters.reset()
    monkeypatch.setattr(payments, "TOKENS_PATH", tmp_path / "tokens.json")
    monkeypatch.setattr(payments, "EXTRAS_DIR", tmp_path)
    monkeypatch.setattr(sms, "OUTBOX_PATH", tmp_path / "outbox.jsonl")
    monkeypatch.setattr(sms, "EXTRAS_DIR", tmp_path)
    monkeypatch.setenv("SMS_PROVIDER", "mock")
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8001")
    yield
    adapters.reset()


def code_of(fn, *a, **kw):
    with pytest.raises(ExtrasError) as e:
        fn(*a, **kw)
    return e.value.code


def token_from(url: str) -> str:
    return url.rsplit("/pay/", 1)[1]


# --- preview ----------------------------------------------------------------------------

def test_preview_ok_does_not_send_or_create_token():
    p = reminders.preview_reminder(ALISHER, now=T0)
    assert p["can_send"] is True and p["reason"] is None
    assert "450 000 so'm" in p["text"] and len(p["text"]) <= 160
    assert p["phone"].endswith("67") and "1234" not in p["phone"]
    assert sms.read_outbox() == [] and payments.load_tokens() == {}


@pytest.mark.parametrize("debt_id,reason", [(NIGORA, "no_consent"), (BOBUR, "no_phone")])
def test_preview_shows_reason(debt_id, reason):
    p = reminders.preview_reminder(debt_id, now=T0)
    assert p["can_send"] is False and p["reason"] == reason and p["text"]


def test_preview_unknown_debt():
    assert code_of(reminders.preview_reminder, 999, now=T0) == "not_found"


def test_preview_text_matches_sent_text_length():
    p = reminders.preview_reminder(ALISHER, now=T0)
    s = reminders.send_reminder(ALISHER, now=T0)
    assert len(p["text"]) == len(s["text"])


# --- send -------------------------------------------------------------------------------

def test_send_ok_writes_sms_token_audit():
    r = reminders.send_reminder(ALISHER, now=T0)
    assert r["status"] == "sent" and r["provider"] == "mock"
    assert r["pay_url"].startswith("http://localhost:8001/pay/")
    out = sms.read_outbox()
    assert len(out) == 1 and out[0]["phone"] == "998901234567" and r["pay_url"] in out[0]["text"]
    tok = payments.load_tokens()[token_from(r["pay_url"])]
    assert tok["debt_id"] == ALISHER and tok["expires_at"] == "2026-11-28 10:00:00"
    assert adapters.audit_log[-1]["action"] == "debt_reminder_sent"
    assert adapters.audit_log[-1]["actor"] == "owner"


@pytest.mark.parametrize("debt_id,code", [(NIGORA, "no_consent"), (BOBUR, "no_phone"), (999, "not_found")])
def test_send_refused(debt_id, code):
    assert code_of(reminders.send_reminder, debt_id, now=T0) == code
    assert sms.read_outbox() == [] and payments.load_tokens() == {}


def test_send_closed_debt():
    adapters.record_debt_payment(ALISHER, 450_000, source="voice")
    assert code_of(reminders.send_reminder, ALISHER, now=T0) == "debt_closed"


def test_bad_phone_counts_as_no_phone():
    adapters._debts[ALISHER]["phone"] = "12345"
    assert code_of(reminders.send_reminder, ALISHER, now=T0) == "no_phone"


def test_too_soon_within_3_days_then_allowed():
    reminders.send_reminder(ALISHER, now=T0)
    assert code_of(reminders.send_reminder, ALISHER, now=T0 + timedelta(days=2, hours=23)) == "too_soon"
    p = reminders.preview_reminder(ALISHER, now=T0 + timedelta(days=1))
    assert p["reason"] == "too_soon" and p["next_allowed_at"] == "2026-11-24 10:00:00"
    r = reminders.send_reminder(ALISHER, now=T0 + timedelta(days=3))
    assert r["status"] == "sent" and len(sms.read_outbox()) == 2


def test_sms_failure_removes_token_and_allows_retry(monkeypatch):
    real_send = sms.send_sms
    calls = []

    def flaky(phone, text):
        calls.append(text)
        if len(calls) == 1:
            return {"status": "failed", "provider": "eskiz", "id": None, "error": "boom"}
        return real_send(phone, text)

    monkeypatch.setattr(sms, "send_sms", flaky)
    assert code_of(reminders.send_reminder, ALISHER, now=T0) == "sms_failed"
    assert payments.load_tokens() == {}
    assert adapters.audit_log[-1]["action"] == "debt_reminder_failed"
    assert reminders.send_reminder(ALISHER, now=T0)["status"] == "sent"   # неудача не считается за 3 дня


def test_sends_remaining_not_original_amount():
    adapters.record_debt_payment(ALISHER, 100_000, source="voice")
    r = reminders.send_reminder(ALISHER, now=T0)
    assert "350 000 so'm" in r["text"]


# --- payment ----------------------------------------------------------------------------

def _sent_token(now=T0):
    return token_from(reminders.send_reminder(ALISHER, now=now)["pay_url"])


def test_get_payment_view_has_no_phone():
    p = payments.get_payment(_sent_token(), now=T0)
    assert p == {"shop_name": "Dilshod do'koni", "person_name": "Alisher", "amount": 450_000,
                 "status": "open", "paid_at": None, "expires_at": "2026-11-28 10:00:00"}


def test_confirm_closes_debt_once():
    tok = _sent_token()
    r1 = payments.confirm_payment(tok, now=T0 + timedelta(hours=1))
    assert r1["already_paid"] is False and r1["status"] == "paid" and r1["amount"] == 450_000
    debt = adapters.get_debt(ALISHER)
    assert debt["status"] == "closed" and debt["remaining"] == 0 and debt["close_source"] == "link"
    r2 = payments.confirm_payment(tok, now=T0 + timedelta(hours=2))
    assert r2["already_paid"] is True and r2["amount"] == 450_000
    assert len(adapters.payments) == 1                       # второй раз не списали
    assert len(adapters.notifications) == 1 and "450 000" in adapters.notifications[0]["text"]
    last = adapters.audit_log[-1]
    assert last["actor"] == "system" and last["action"] == "debt_paid_by_link"


def test_paid_link_still_viewable_after_expiry():
    tok = _sent_token()
    payments.confirm_payment(tok, now=T0)
    assert payments.get_payment(tok, now=T0 + timedelta(days=30))["status"] == "paid"


def test_expired_token():
    tok = _sent_token()
    assert payments.get_payment(tok, now=T0 + timedelta(days=7))["status"] == "open"   # ровно 7 дней — ещё можно
    assert code_of(payments.confirm_payment, tok, now=T0 + timedelta(days=7, seconds=1)) == "token_expired"
    assert adapters.get_debt(ALISHER)["remaining"] == 450_000


def test_unknown_token():
    assert code_of(payments.get_payment, "nope", now=T0) == "not_found"
    assert code_of(payments.confirm_payment, "", now=T0) == "not_found"


def test_debt_closed_elsewhere_before_link_payment():
    tok = _sent_token()
    adapters.record_debt_payment(ALISHER, 450_000, source="voice")
    assert payments.get_payment(tok, now=T0)["status"] == "closed"
    assert code_of(payments.confirm_payment, tok, now=T0) == "debt_closed"
    assert len(adapters.payments) == 1


def test_partial_payment_elsewhere_link_pays_rest():
    tok = _sent_token()
    adapters.record_debt_payment(ALISHER, 200_000, source="voice")
    r = payments.confirm_payment(tok, now=T0)
    assert r["amount"] == 250_000 and adapters.get_debt(ALISHER)["status"] == "closed"


def test_old_unpaid_link_after_new_reminder_is_safe():
    old = _sent_token(T0)
    new = _sent_token(T0 + timedelta(days=3))
    payments.confirm_payment(new, now=T0 + timedelta(days=3))
    assert code_of(payments.confirm_payment, old, now=T0 + timedelta(days=3)) == "debt_closed"
    assert len(adapters.payments) == 1


def test_corrupt_tokens_file_is_empty():
    payments.TOKENS_PATH.write_text("{not json", encoding="utf-8")
    assert payments.load_tokens() == {}


def test_tokens_are_unique_and_long():
    a, b = payments.create_token(ALISHER, T0), payments.create_token(ALISHER, T0)
    assert a != b and len(a) == 43


# --- API --------------------------------------------------------------------------------

@pytest.fixture
def client():
    return TestClient(dev_app.app)


def test_api_full_flow(client):
    p = client.post(f"/api/debts/{ALISHER}/remind/preview")
    assert p.status_code == 200 and p.json()["can_send"] is True
    r = client.post(f"/api/debts/{ALISHER}/remind")
    assert r.status_code == 200
    tok = token_from(r.json()["pay_url"])
    assert client.get(f"/api/pay/{tok}").json()["amount"] == 450_000
    page = client.get(f"/pay/{tok}")
    assert page.status_code == 200 and "450 000 so'm" in page.text and "To'lash" in page.text
    c1, c2 = client.post(f"/api/pay/{tok}/confirm"), client.post(f"/api/pay/{tok}/confirm")
    assert c1.json()["already_paid"] is False and c2.json()["already_paid"] is True
    assert "To'langan" in client.get(f"/pay/{tok}").text
    assert client.get("/api/dev/debts").json()["debts"][0]["status"] == "closed"


@pytest.mark.parametrize("debt_id,status,code", [
    (NIGORA, 403, "no_consent"), (BOBUR, 422, "no_phone"), (999, 404, "not_found")])
def test_api_errors(client, debt_id, status, code):
    r = client.post(f"/api/debts/{debt_id}/remind")
    assert r.status_code == status and r.json()["error"] == code


def test_api_too_soon(client):
    assert client.post(f"/api/debts/{ALISHER}/remind").status_code == 200
    r = client.post(f"/api/debts/{ALISHER}/remind")
    assert r.status_code == 429 and r.json()["error"] == "too_soon"


def test_api_unknown_token_page_does_not_echo_token(client):
    assert client.get("/api/pay/zzz").json()["error"] == "not_found"
    assert client.post("/api/pay/zzz/confirm").status_code == 404
    page = client.get("/pay/evil'token")
    assert page.status_code == 404 and "evil" not in page.text


def test_api_reset(client):
    client.post(f"/api/debts/{ALISHER}/remind")
    assert client.post("/api/dev/reset").json() == {"ok": True}
    assert payments.load_tokens() == {}
    assert client.post(f"/api/debts/{ALISHER}/remind").status_code == 200
