"""sms.py — текст, номер, mock-отправка и клиент Eskiz на фейковом HTTP (без сети)."""
import json

import httpx
import pytest

from extras import sms

URL = "http://localhost:8001/pay/" + "x" * 43            # как secrets.token_urlsafe(32)


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    """Outbox во временной папке, режим mock, без настоящего .env."""
    monkeypatch.setattr(sms, "OUTBOX_PATH", tmp_path / "outbox.jsonl")
    monkeypatch.setenv("SMS_PROVIDER", "mock")
    monkeypatch.setattr(sms, "_eskiz_token", None)


# --- текст ----------------------------------------------------------------------------

def test_text_matches_spec_example():
    t = sms.build_reminder_text("Dilshod do'koni", "Alisher", 450_000, URL)
    assert t == f"Assalomu alaykum, Alisher! \"Dilshod do'koni\"da 450 000 so'm qarzingiz bor. To'lash: {URL}"
    assert len(t) <= 160


@pytest.mark.parametrize("shop,person,amount", [
    ("Dilshod do'koni", "Alisher", 450_000),
    ("A" * 120, "B" * 120, 999_999_999),
    ("Dilshod do'koni", "Muhammadamin Abdurahmonov Xo'jayevich", 12_345_678),
    ("«Дилшод дўкони»", "Алишер", 1_000),
    ("S", "", 5_000),
])
def test_text_always_fits_and_keeps_full_url(shop, person, amount):
    t = sms.build_reminder_text(shop, person, amount, URL)
    assert len(t) <= sms.MAX_LEN
    assert t.endswith(URL)
    assert sms.format_amount(amount) in t


def test_text_is_gsm_latin_only():
    t = sms.build_reminder_text("«Дилшод дўкони»", "Алишер ака", 450_000, URL)
    assert all(ord(ch) < 128 for ch in t), t
    assert "Alisher aka" in t and "Dilshod do'koni" in t


def test_long_name_uses_first_word_not_cut_letters():
    t = sms.build_reminder_text("Dilshod do'koni", "Muhammadamin Abdurahmonov Xo'jayevich", 12_345_678, URL)
    assert "Muhammadamin!" in t and len(t) <= 160


def test_huge_name_falls_back_to_no_name():
    t = sms.build_reminder_text("Dilshod do'koni", "B" * 120, 450_000, URL)
    assert t.startswith("Assalomu alaykum! ") and "B" not in t


def test_text_without_name_uses_neutral_greeting():
    t = sms.build_reminder_text("Dilshod do'koni", None, 450_000, URL)
    assert t.startswith("Assalomu alaykum! ")


def test_tiny_shop_name_is_not_dropped():
    assert "\"S\"da" in sms.build_reminder_text("S", "", 5_000, URL)


def test_text_has_no_pressure_words():
    t = sms.build_reminder_text("Dilshod do'koni", "Alisher", 450_000, URL).lower()
    for word in ("sud", "jarima", "majbur", "darhol", "politsiya", "ogohlantirish"):
        assert word not in t


@pytest.mark.parametrize("amount", [0, -1])
def test_text_rejects_bad_amount(amount):
    with pytest.raises(ValueError):
        sms.build_reminder_text("S", "A", amount, URL)


@pytest.mark.parametrize("url", ["", None, "http://a b"])
def test_text_rejects_bad_url(url):
    with pytest.raises(ValueError):
        sms.build_reminder_text("S", "A", 1000, url)


def test_text_rejects_url_too_long_for_one_sms():
    with pytest.raises(ValueError):
        sms.build_reminder_text("S", "A", 1000, "http://x/" + "y" * 200)


@pytest.mark.parametrize("amount,text", [(450_000, "450 000"), (1_000, "1 000"), (999, "999"),
                                         (1_234_567, "1 234 567")])
def test_format_amount(amount, text):
    assert sms.format_amount(amount) == text


def test_to_sms_latin():
    assert sms.to_sms_latin("Ғайрат қўшни“") == "G'ayrat qo'shni"
    assert sms.to_sms_latin("Nigora  ʻopa ") == "Nigora 'opa"


# --- телефон --------------------------------------------------------------------------

@pytest.mark.parametrize("raw", ["+998 90 123-45-67", "998901234567", "90 123 45 67", "(90) 123 45 67",
                                 "+998(90)1234567"])
def test_normalize_phone_ok(raw):
    assert sms.normalize_phone(raw) == "998901234567"


@pytest.mark.parametrize("raw", [None, "", "12345", "+7 900 123 45 67", "998 90 123 45 6", "+998 90 *** ** 67",
                                 "9989012345678"])
def test_normalize_phone_invalid(raw):
    with pytest.raises(ValueError):
        sms.normalize_phone(raw)


# --- mock-отправка --------------------------------------------------------------------

def test_mock_send_writes_outbox():
    r = sms.send_sms("+998 90 123 45 67", "Salom")
    assert r["status"] == "sent" and r["provider"] == "mock" and r["id"]
    rows = sms.read_outbox()
    assert len(rows) == 1
    assert rows[0]["phone"] == "998901234567" and rows[0]["text"] == "Salom" and rows[0]["id"] == r["id"]


def test_mock_ids_unique_and_outbox_appends():
    ids = {sms.send_sms("901234567", f"t{i}")["id"] for i in range(5)}
    assert len(ids) == 5 and len(sms.read_outbox()) == 5


def test_outbox_is_valid_jsonl_with_unicode():
    sms.send_sms("901234567", "Qarz ✅ 450 000 so'm")
    line = sms.OUTBOX_PATH.read_text(encoding="utf-8").strip()
    assert json.loads(line)["text"] == "Qarz ✅ 450 000 so'm"


def test_empty_outbox_reads_empty():
    assert sms.read_outbox() == []


def test_invalid_phone_sends_nothing():
    with pytest.raises(ValueError):
        sms.send_sms("12345", "Salom")
    assert sms.read_outbox() == []


@pytest.mark.parametrize("text", ["", "   ", None])
def test_empty_text_sends_nothing(text):
    with pytest.raises(ValueError):
        sms.send_sms("901234567", text)
    assert sms.read_outbox() == []


def test_default_provider_is_mock(monkeypatch):
    monkeypatch.delenv("SMS_PROVIDER", raising=False)
    assert sms.provider() == "mock"


def test_unknown_provider_is_config_error(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    with pytest.raises(ValueError):
        sms.send_sms("901234567", "Salom")
    assert sms.read_outbox() == []


# --- Eskiz на фейковом HTTP ------------------------------------------------------------

def eskiz(monkeypatch, handler, email="a@b.uz", password="pw"):
    monkeypatch.setenv("SMS_PROVIDER", "eskiz")
    monkeypatch.setenv("ESKIZ_EMAIL", email)
    monkeypatch.setenv("ESKIZ_PASSWORD", password)
    monkeypatch.setenv("ESKIZ_TEST_MODE", "0")
    monkeypatch.setenv("SMS_ALLOW_ANY", "1")             # здесь проверяется сам клиент Eskiz
    calls = []

    def _handler(request):
        calls.append(request)
        return handler(request, calls)
    monkeypatch.setattr(sms, "_http_client",
                        lambda: httpx.Client(base_url=sms.ESKIZ_BASE_URL, transport=httpx.MockTransport(_handler)))
    return calls


def form(request):
    return dict(x.split("=", 1) for x in request.content.decode().split("&"))


def ok_handler(request, calls):
    if request.url.path.endswith("/auth/login"):
        return httpx.Response(200, json={"data": {"token": "T1"}})
    return httpx.Response(200, json={"id": "abc-1", "status": "waiting"})


def test_eskiz_login_then_send(monkeypatch):
    calls = eskiz(monkeypatch, ok_handler)
    r = sms.send_sms("+998 90 123 45 67", "Salom")
    assert r == {"status": "sent", "provider": "eskiz", "id": "abc-1", "provider_status": "waiting",
                 "test_mode": False}
    assert [c.url.path for c in calls] == ["/api/auth/login", "/api/message/sms/send"]
    assert calls[1].headers["Authorization"] == "Bearer T1"
    assert form(calls[1])["mobile_phone"] == "998901234567"
    assert sms.read_outbox() == []                       # eskiz не пишет в mock-outbox


def test_eskiz_token_is_reused(monkeypatch):
    calls = eskiz(monkeypatch, ok_handler)
    sms.send_sms("901234567", "a")
    sms.send_sms("901234567", "b")
    assert [c.url.path for c in calls].count("/api/auth/login") == 1


def test_eskiz_relogin_once_on_401(monkeypatch):
    def handler(request, calls):
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"token": f"T{len(calls)}"}})
        sends = [c for c in calls if c.url.path.endswith("/send")]
        return httpx.Response(401) if len(sends) == 1 else httpx.Response(200, json={"id": "ok"})
    calls = eskiz(monkeypatch, handler)
    assert sms.send_sms("901234567", "a")["status"] == "sent"
    assert [c.url.path.rsplit("/", 1)[-1] for c in calls] == ["login", "send", "login", "send"]


def test_eskiz_twice_401_fails(monkeypatch):
    def handler(request, calls):
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"token": "T"}})
        return httpx.Response(401)
    eskiz(monkeypatch, handler)
    r = sms.send_sms("901234567", "a")
    assert r["status"] == "failed" and r["provider"] == "eskiz"


@pytest.mark.parametrize("status", [400, 500])
def test_eskiz_http_error_is_failed_not_exception(monkeypatch, status):
    eskiz(monkeypatch, lambda req, calls: httpx.Response(200, json={"data": {"token": "T"}})
          if req.url.path.endswith("/login") else httpx.Response(status, json={"message": "bad"}))
    r = sms.send_sms("901234567", "a")
    assert r["status"] == "failed" and r["error"]


def test_eskiz_network_error_is_failed(monkeypatch):
    def handler(request, calls):
        raise httpx.ConnectError("no network")
    eskiz(monkeypatch, handler)
    assert sms.send_sms("901234567", "a")["status"] == "failed"


def test_eskiz_without_credentials_fails_without_request(monkeypatch):
    calls = eskiz(monkeypatch, ok_handler, email="", password="")
    r = sms.send_sms("901234567", "a")
    assert r["status"] == "failed" and "ESKIZ_EMAIL" in r["error"] and calls == []


def test_eskiz_login_without_token_fails(monkeypatch):
    eskiz(monkeypatch, lambda req, calls: httpx.Response(200, json={"data": {}}))
    assert sms.send_sms("901234567", "a")["status"] == "failed"


# --- CLI ------------------------------------------------------------------------------

def test_cli_check_ok(monkeypatch, capsys):
    calls = eskiz(monkeypatch, ok_handler)
    assert sms.main(["--check"]) == 0
    assert "OK" in capsys.readouterr().out and [c.url.path for c in calls] == ["/api/auth/login"]


def test_cli_check_bad_password(monkeypatch, capsys):
    eskiz(monkeypatch, lambda req, calls: httpx.Response(401, json={"message": "Invalid"}))
    assert sms.main(["--check"]) == 1 and "ERROR" in capsys.readouterr().out


def test_cli_send_mock(capsys):
    assert sms.main(["--to", "+998 90 123 45 67", "--text", "Salom"]) == 0
    assert json.loads(capsys.readouterr().out)["provider"] == "mock" and len(sms.read_outbox()) == 1


def test_cli_send_bad_phone(capsys):
    assert sms.main(["--to", "123", "--text", "Salom"]) == 2 and sms.read_outbox() == []


def test_cli_without_args_shows_help(capsys):
    assert sms.main([]) == 2


# --- ESKIZ_TEST_MODE: тестовый аккаунт Eskiz пропускает только свой текст ---------------

def test_eskiz_test_mode_sends_test_text(monkeypatch):
    calls = eskiz(monkeypatch, ok_handler)
    monkeypatch.setenv("ESKIZ_TEST_MODE", "1")
    r = sms.send_sms("998901234567", "Assalomu alaykum! Qarz 450 000 so'm. To'lash: http://x/pay/abc")
    assert r["status"] == "sent" and r["test_mode"] is True
    from urllib.parse import unquote_plus
    assert unquote_plus(form(calls[1])["message"]) == "Bu Eskiz dan test"
    assert form(calls[1])["mobile_phone"] == "998901234567"


@pytest.mark.parametrize("value,expected", [("1", True), ("true", True), ("ON", True),
                                            ("0", False), ("", False), ("no", False)])
def test_eskiz_test_mode_values(monkeypatch, value, expected):
    monkeypatch.setenv("ESKIZ_TEST_MODE", value)
    assert sms.eskiz_test_mode() is expected


def test_test_mode_does_not_touch_mock(monkeypatch):
    monkeypatch.setenv("ESKIZ_TEST_MODE", "1")
    sms.send_sms("998901234567", "Real matn")
    assert sms.read_outbox()[-1]["text"] == "Real matn"


# --- защита: настоящие SMS только на разрешённые номера ---------------------------------

def test_eskiz_blocks_unknown_number_without_calling_eskiz(monkeypatch):
    calls = eskiz(monkeypatch, ok_handler)
    monkeypatch.setenv("SMS_ALLOW_ANY", "")
    r = sms.send_sms("998901234567", "Salom")
    assert r["status"] == "failed" and "not allowed" in r["error"] and calls == []


@pytest.mark.parametrize("var,value", [("DEMO_DEBTOR_PHONE", "+998 93 000 00 11"),
                                       ("SMS_ALLOWLIST", "998901111111, 93 000 00 11"),
                                       ("SMS_ALLOW_ANY", "1")])
def test_eskiz_allows_listed_number(monkeypatch, var, value):
    calls = eskiz(monkeypatch, ok_handler)
    monkeypatch.setenv("SMS_ALLOW_ANY", "")
    monkeypatch.setenv(var, value)
    assert sms.send_sms("998930000011", "Salom")["status"] == "sent" and len(calls) == 2


def test_allowlist_ignores_garbage():
    import os
    os.environ["SMS_ALLOWLIST"] = "abc, 123, ,998901234567"
    assert sms.allowed_numbers() == {"998901234567"}


def test_mock_is_never_blocked(monkeypatch):
    monkeypatch.setenv("SMS_ALLOW_ANY", "")
    assert sms.send_sms("998901234567", "Salom")["status"] == "sent"


# --- статус доставки Eskiz (формат снят с настоящего ответа) ---------------------------

def status_handler(status="DELIVERED", code=200):
    def h(request, calls):
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"token": "T1"}})
        if code != 200:
            return httpx.Response(code, json={"message": "record not found", "status": "error"})
        return httpx.Response(200, json={"status": "success", "data": {
            "request_id": "abc", "status": status, "price": 145, "total_price": 145}})
    return h


@pytest.mark.parametrize("status,delivered", [("DELIVERED", True), ("DELIVRD", True), ("WAITING", False),
                                              ("REJECTED", False), ("", False)])
def test_eskiz_status(monkeypatch, status, delivered):
    calls = eskiz(monkeypatch, status_handler(status))
    r = sms.eskiz_status("abc")
    assert r["ok"] and r["delivered"] is delivered and r["price"] == 145
    assert calls[-1].url.path == "/api/message/sms/status_by_id/abc"


def test_eskiz_status_not_found_and_errors(monkeypatch):
    eskiz(monkeypatch, status_handler(code=404))
    assert sms.eskiz_status("nope") == {"ok": False, "status": None, "delivered": False, "error": "sms not found"}
    assert sms.eskiz_status("")["error"] == "no sms id"


def test_eskiz_status_cli(monkeypatch, capsys):
    eskiz(monkeypatch, status_handler())
    assert sms.main(["--status", "abc"]) == 0
    assert '"delivered": true' in capsys.readouterr().out
