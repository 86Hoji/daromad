"""Этап 4: напоминания, токены оплаты, API dev_app — без сети, SMS в mock."""
import json
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

def test_preview_returns_text_and_link_without_sending():
    p = reminders.preview_reminder(ALISHER, now=T0)
    assert p["can_send"] is True and p["reason"] is None
    assert "450 000 so'm" in p["sms_text"] and len(p["sms_text"]) <= 160
    assert p["pay_url"].startswith("http://localhost:8001/pay/") and p["pay_url"] in p["sms_text"]
    assert p["phone"].endswith("67") and "1234" not in p["phone"]
    assert sms.read_outbox() == []
    rec = payments.load_tokens()[token_from(p["pay_url"])]
    assert rec["sent_at"] is None                                       # черновик, не «отправлено»


def test_preview_twice_same_link_and_remind_sends_it():
    p1 = reminders.preview_reminder(ALISHER, now=T0)
    p2 = reminders.preview_reminder(ALISHER, now=T0 + timedelta(minutes=5))
    r = reminders.send_reminder(ALISHER, now=T0 + timedelta(minutes=6))
    assert p1["pay_url"] == p2["pay_url"] == r["pay_url"] and p1["sms_text"] == r["sms_text"]
    assert len(payments.load_tokens()) == 1 and r["sent_at"] == "2026-11-21 10:06:00"


def test_preview_does_not_count_as_reminder():
    for i in range(3):
        reminders.preview_reminder(ALISHER, now=T0 + timedelta(hours=i))
    assert reminders.send_reminder(ALISHER, now=T0 + timedelta(hours=3))["status"] == "sent"


def test_expired_draft_is_replaced():
    old = reminders.preview_reminder(ALISHER, now=T0)["pay_url"]
    new = reminders.preview_reminder(ALISHER, now=T0 + timedelta(days=8))["pay_url"]
    assert old != new


def test_legacy_token_without_sent_at_counts_as_sent():
    payments.TOKENS_PATH.write_text(json.dumps({"legacy": {
        "debt_id": ALISHER, "created_at": "2026-11-20 10:00:00", "expires_at": "2026-11-27 10:00:00",
        "paid_at": None, "paid_amount": None}}), encoding="utf-8")
    assert code_of(reminders.send_reminder, ALISHER, now=T0) == "too_soon"


@pytest.mark.parametrize("debt_id,reason", [(NIGORA, "no_consent"), (BOBUR, "no_phone")])
def test_preview_shows_reason(debt_id, reason):
    p = reminders.preview_reminder(debt_id, now=T0)
    assert p["can_send"] is False and p["reason"] == reason
    assert p["sms_text"] is None and p["pay_url"] is None and payments.load_tokens() == {}


def test_preview_unknown_debt():
    assert code_of(reminders.preview_reminder, 999, now=T0) == "not_found"


def test_preview_text_equals_sent_text():
    p = reminders.preview_reminder(ALISHER, now=T0)
    s = reminders.send_reminder(ALISHER, now=T0)
    assert p["sms_text"] == s["sms_text"] == sms.read_outbox()[0]["text"]


# --- send -------------------------------------------------------------------------------

def test_send_ok_writes_sms_token_audit():
    r = reminders.send_reminder(ALISHER, now=T0)
    assert r["status"] == "sent" and r["provider"] == "mock" and r["sent_at"] == "2026-11-21 10:00:00"
    assert {"status", "sms_text", "pay_url", "sent_at"} <= r.keys()         # поля ответа из ТЗ
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
    [rec] = payments.load_tokens().values()
    assert rec["sent_at"] is None                                          # снова черновик
    assert adapters.audit_log[-1]["action"] == "debt_reminder_failed"
    assert reminders.send_reminder(ALISHER, now=T0)["status"] == "sent"   # неудача не считается за 3 дня
    assert len(payments.load_tokens()) == 1 and calls[0] == calls[1]       # та же ссылка


def test_sends_remaining_not_original_amount():
    adapters.record_debt_payment(ALISHER, 100_000, source="voice")
    r = reminders.send_reminder(ALISHER, now=T0)
    assert "350 000 so'm" in r["sms_text"]


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
    assert [n["text"] for n in adapters.notifications] == ["Alisher to'ladi ✅ 450 000 so'm"]   # текст из ТЗ
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
    c1, c2 = client.post(f"/api/pay/{tok}/confirm"), client.post(f"/api/pay/{tok}/confirm")
    assert c1.json()["already_paid"] is False and c2.json()["already_paid"] is True
    assert client.get(f"/api/pay/{tok}").json()["status"] == "paid"
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


def test_api_unknown_token(client):
    assert client.get("/api/pay/zzz").json()["error"] == "not_found"
    assert client.post("/api/pay/zzz/confirm").status_code == 404


def test_no_html_pages_only_json(client):
    """ТЗ: «только JSON, без страниц» — страницу оплаты делает Mini App."""
    tok = token_from(client.post(f"/api/debts/{ALISHER}/remind").json()["pay_url"])
    assert client.get(f"/pay/{tok}").status_code == 404
    from fastapi.routing import APIRoute
    for r in dev_app.app.routes:
        if isinstance(r, APIRoute):
            assert "text/html" not in str(getattr(r, "response_class", "")), r.path


def test_api_reset(client):
    client.post(f"/api/debts/{ALISHER}/remind")
    assert client.post("/api/dev/reset").json() == {"ok": True}
    assert payments.load_tokens() == {}
    assert client.post(f"/api/debts/{ALISHER}/remind").status_code == 200


def test_reminder_reports_eskiz_test_mode(monkeypatch):
    monkeypatch.setattr(sms, "send_sms", lambda p, t: {"status": "sent", "provider": "eskiz", "id": "1",
                                                       "test_mode": True})
    r = reminders.send_reminder(ALISHER, now=T0)
    assert r["sms_test_mode"] is True and "450 000 so'm" in r["sms_text"]   # владелец видит настоящий текст


def test_reminder_mock_is_not_test_mode():
    assert reminders.send_reminder(ALISHER, now=T0)["sms_test_mode"] is False


# --- регрессии после ревью ---------------------------------------------------------------

@pytest.mark.parametrize("raw,masked", [("998901234567", "+99890 *** ** 67"), ("+998901234567", "+99890 *** ** 67"),
                                        ("+998 90 123-45-67", "+99890 *** ** 67"), (None, None), ("", None),
                                        ("12", "***")])
def test_mask_phone_handles_plus_format(raw, masked):
    assert reminders.mask_phone(raw) == masked          # основной бэк хранит номера как +998...


def test_main_backend_phone_format_works_end_to_end():
    adapters._debts[ALISHER]["phone"] = "+998901234567"
    r = reminders.send_reminder(ALISHER, now=T0)
    assert r["phone"] == "+99890 *** ** 67" and sms.read_outbox()[0]["phone"] == "998901234567"


def test_link_too_long_does_not_block_debt(monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://" + "a" * 120 + ".example.com")
    p = reminders.preview_reminder(ALISHER, now=T0)
    assert p["can_send"] is False and p["reason"] == "link_too_long" and p["sms_text"] is None
    assert code_of(reminders.send_reminder, ALISHER, now=T0) == "link_too_long"
    assert payments.load_tokens() == {} and sms.read_outbox() == []
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://localhost:8001")
    assert reminders.send_reminder(ALISHER, now=T0)["status"] == "sent"      # не too_soon


def test_unexpected_send_crash_does_not_block(monkeypatch):
    def boom(phone, text):
        raise OSError("disk full")
    monkeypatch.setattr(sms, "send_sms", boom)
    with pytest.raises(OSError):
        reminders.send_reminder(ALISHER, now=T0)
    assert all(t["sent_at"] is None for t in payments.load_tokens().values())


@pytest.mark.parametrize("record", [{"debt_id": 1}, {"expires_at": "2026-11-28 10:00:00"}, "junk", None,
                                    {"debt_id": 1, "expires_at": "not a date"}])
def test_broken_token_record_is_not_found(record):
    payments.TOKENS_PATH.write_text(json.dumps({"abc": record}), encoding="utf-8")
    assert code_of(payments.get_payment, "abc", now=T0) == "not_found"
    assert code_of(payments.confirm_payment, "abc", now=T0) == "not_found"


def test_concurrent_reminders_send_one_sms():
    from concurrent.futures import ThreadPoolExecutor

    def go(_):
        try:
            return reminders.send_reminder(ALISHER, now=T0)["status"]
        except ExtrasError as e:
            return e.code
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(go, range(8)))
    assert results.count("sent") == 1 and results.count("too_soon") == 7
    assert len(sms.read_outbox()) == 1


def test_concurrent_confirm_charges_once():
    from concurrent.futures import ThreadPoolExecutor
    tok = _sent_token()
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda _: payments.confirm_payment(tok, now=T0)["already_paid"], range(8)))
    assert results.count(False) == 1 and len(adapters.payments) == 1


def test_tokens_file_written_atomically_no_tmp_left():
    payments.create_token(ALISHER, T0)
    assert not payments.TOKENS_PATH.with_suffix(".tmp").exists()


# --- API: доступ, маска, CORS, дата ------------------------------------------------------

def test_admin_token_protects_owner_and_dev_routes(client, monkeypatch):
    monkeypatch.setenv("EXTRAS_ADMIN_TOKEN", "s3cret-admin")
    for method, path in [("post", f"/api/debts/{ALISHER}/remind/preview"), ("post", f"/api/debts/{ALISHER}/remind"),
                         ("get", "/api/dev/debts"), ("post", "/api/dev/reset")]:
        r = getattr(client, method)(path)
        assert r.status_code == 401 and r.json()["error"] == "unauthorized", path
        r = getattr(client, method)(path, headers={"X-Admin-Token": "wrong"})
        assert r.status_code == 401, path
    assert sms.read_outbox() == []
    r = client.post(f"/api/debts/{ALISHER}/remind", headers={"X-Admin-Token": "s3cret-admin"})
    assert r.status_code == 200
    tok = token_from(r.json()["pay_url"])
    assert client.get(f"/api/pay/{tok}").status_code == 200             # должнику ключ не нужен
    assert client.post(f"/api/pay/{tok}/confirm").status_code == 200


def test_dev_debts_masks_phones(client):
    phones = [d["phone"] for d in client.get("/api/dev/debts").json()["debts"]]
    assert phones == ["+99890 *** ** 67", "+99890 *** ** 21", None]
    assert adapters.get_debt(ALISHER)["phone"] == "998901234567"         # данные не испорчены маской


def test_cors_allows_mini_app(client):
    r = client.options(f"/api/debts/{ALISHER}/remind", headers={
        "Origin": "https://web.telegram.org", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-admin-token"})
    assert r.status_code == 200 and r.headers.get("access-control-allow-origin") in ("*", "https://web.telegram.org")


def test_api_link_too_long(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://" + "a" * 120 + ".example.com")
    assert client.post(f"/api/debts/{ALISHER}/remind/preview").json()["reason"] == "link_too_long"
    r = client.post(f"/api/debts/{ALISHER}/remind")
    assert r.status_code == 500 and r.json()["error"] == "link_too_long"


def test_env_example_has_no_secrets():
    """В .env.example (он в git) — только пустые ключи и безопасные значения по умолчанию."""
    from pathlib import Path
    text = (Path(payments.__file__).parent / ".env.example").read_text(encoding="utf-8")
    values = dict(line.split("=", 1) for line in text.splitlines() if "=" in line and not line.startswith("#"))
    for key in ("GEMINI_API_KEY", "ESKIZ_EMAIL", "ESKIZ_PASSWORD", "EXTRAS_ADMIN_TOKEN"):
        assert values.get(key, "") == "", f"{key} must be empty in .env.example"
    assert values["SMS_PROVIDER"] == "mock"



# --- роутеры как в main.py: app.include_router(...) без обработчиков dev_app --------------

def test_routers_work_when_included_in_plain_app(capsys):
    from fastapi import FastAPI
    main_like = FastAPI()
    main_like.include_router(reminders.router)
    main_like.include_router(payments.router)
    c = TestClient(main_like)
    p = c.post(f"/api/debts/{ALISHER}/remind/preview").json()
    r = c.post(f"/api/debts/{ALISHER}/remind").json()
    assert r["pay_url"] == p["pay_url"] and r["sms_text"] == p["sms_text"]
    tok = token_from(r["pay_url"])
    info = c.get(f"/api/pay/{tok}").json()
    assert {"shop_name", "person_name", "amount", "status"} <= info.keys() and "phone" not in info
    assert c.post(f"/api/pay/{tok}/confirm").json()["already_paid"] is False
    assert c.post(f"/api/pay/{tok}/confirm").json()["already_paid"] is True
    assert adapters.get_debt(ALISHER)["status"] == "closed"
    assert "Alisher to'ladi ✅ 450 000 so'm" in capsys.readouterr().out     # видно в консоли uvicorn
    for path, status, code in [(f"/api/debts/{NIGORA}/remind", 403, "no_consent"),
                               (f"/api/debts/{BOBUR}/remind", 422, "no_phone"),
                               (f"/api/debts/{ALISHER}/remind", 409, "debt_closed"),
                               ("/api/debts/999/remind/preview", 404, "not_found")]:
        res = c.post(path)
        assert res.status_code == status and res.json()["error"] == code, path
    res = c.get("/api/pay/nope")
    assert res.status_code == 404 and res.json()["error"] == "not_found"
