"""vision.py на фейковых ответах Gemini — без сети и без ключа."""
import asyncio
import json
from datetime import date

import pytest

from extras import vision

TODAY = date(2026, 11, 23)          # понедельник
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200
CONTRACT_KEYS = {"type", "amount", "person", "phone", "category", "due_date", "note"}


@pytest.fixture(autouse=True)
def fake_settings(monkeypatch):
    """Ключ и модели из теста, а не из настоящего .env."""
    monkeypatch.setattr(vision, "_settings", lambda: ("test-key", ["model-a", "model-b"]))


def fake_gemini(monkeypatch, payload, calls=None):
    """Подменить вызов Gemini: payload — dict (будет JSON), str (как есть) или Exception."""
    async def _fake(image_bytes, mime, prompt, model, key):
        if calls is not None:
            calls.append({"bytes": image_bytes, "mime": mime, "prompt": prompt, "model": model})
        if isinstance(payload, Exception):
            raise payload
        return payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    monkeypatch.setattr(vision, "_call_gemini", _fake)


def run(payload, monkeypatch, image=JPEG, mime="image/jpeg"):
    fake_gemini(monkeypatch, payload)
    return vision.parse_photo(image, mime, TODAY)


def one(events, transcript="hujjat"):
    return {"events": events, "transcript": transcript}


# --- типы документов ----------------------------------------------------------------

def test_unpaid_invoice_becomes_scheduled_payment(monkeypatch):
    r = run(one([{"type": "scheduled_payment", "amount": 3_000_000, "amount_text": "3 000 000,00 so'm",
                  "person": "Akmal", "due_date": "2026-11-26", "note": "nakladnaya № 145"}],
                "Nakladnaya № 145, Akmal, jami 3 000 000,00 so'm, to'lov 26.11"), monkeypatch)
    assert r["intent"] == "record"
    ev = r["events"][0]
    assert ev["type"] == "scheduled_payment" and ev["amount"] == 3_000_000
    assert ev["person"] == "Akmal" and ev["due_date"] == "2026-11-26" and ev["note"] == "nakladnaya № 145"
    assert ev["category"] is None and ev["needs_check"] is False
    assert CONTRACT_KEYS <= ev.keys()


def test_invoice_without_due_date_keeps_null(monkeypatch):
    ev = run(one([{"type": "scheduled_payment", "amount": 1_200_000, "amount_text": "1 200 000",
                   "person": "OOO Coca-Cola", "due_date": None}]), monkeypatch)["events"][0]
    assert ev["due_date"] is None and ev["person"] == "OOO Coca-Cola"


def test_paid_invoice_is_expense_tovar(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 2_500_000, "amount_text": "2.500.000", "category": "tovar"}]),
             monkeypatch)["events"][0]
    assert ev["type"] == "expense" and ev["category"] == "tovar" and ev["due_date"] is None


def test_payme_screenshot_with_sender_is_debt_returned(monkeypatch):
    ev = run(one([{"type": "debt_returned", "amount": 300_000, "amount_text": "300 000 so'm", "person": "NIGORA K."}]),
             monkeypatch)["events"][0]
    assert ev["type"] == "debt_returned" and ev["person"] == "NIGORA K." and ev["category"] is None


def test_payme_screenshot_without_sender_becomes_sale(monkeypatch):
    ev = run(one([{"type": "debt_returned", "amount": 300_000, "amount_text": "300 000", "person": "  "}]),
             monkeypatch)["events"][0]
    assert ev["type"] == "sale" and ev["person"] is None and ev["category"] == "tovar"


def test_receipt_expense_keeps_valid_category(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 120_000, "amount_text": "120 000.00 UZS", "category": "Kommunal"}]),
             monkeypatch)["events"][0]
    assert ev["category"] == "kommunal"


def test_debt_given_without_person_is_dropped(monkeypatch):
    assert run(one([{"type": "debt_given", "amount": 100_000, "person": None}]), monkeypatch)["events"] == []


# --- суммы: код перепроверяет ИИ ---------------------------------------------------

@pytest.mark.parametrize("text,value", [
    ("3 000 000", 3_000_000), ("3.000.000", 3_000_000), ("3 000 000,00 so'm", 3_000_000),
    ("3,000,000.00", 3_000_000), ("Итого: 3 000 000,00", 3_000_000), ("450000", 450_000),
    ("120 000.00 UZS", 120_000), ("1 500 000 сум", 1_500_000), ("3 mln", 3_000_000),
    ("2 million 300 ming", 2_300_000), ("150к", 150_000),
])
def test_amount_from_text(text, value):
    assert vision.amount_from_text(text) == value


@pytest.mark.parametrize("text", [None, "", "so'm", "5,5", "45"])
def test_amount_from_text_unparseable(text):
    assert vision.amount_from_text(text) is None


def test_ai_amount_wrong_text_wins_and_flags_check(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 300_000_000, "amount_text": "3 000 000,00 so'm"}]),
             monkeypatch)["events"][0]
    assert ev["amount"] == 3_000_000 and ev["needs_check"] is True


def test_amount_not_seen_on_photo_flags_check(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 75_000, "amount_text": None}], "chek: paket 50 000"),
             monkeypatch)["events"][0]
    assert ev["amount"] == 75_000 and ev["needs_check"] is True


def test_amount_seen_in_transcript_no_check(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 50_000, "amount_text": None}], "chek: paket 50 000 so'm"),
             monkeypatch)["events"][0]
    assert ev["needs_check"] is False


def test_string_amount_is_coerced(monkeypatch):
    ev = run(one([{"type": "sale", "amount": "450 000", "amount_text": "450 000"}]), monkeypatch)["events"][0]
    assert ev["amount"] == 450_000 and isinstance(ev["amount"], int)


@pytest.mark.parametrize("amount", [0, -5000, 1_000_000_000, 5_000_000_000, None, "abc", True])
def test_bad_amounts_dropped(monkeypatch, amount):
    assert run(one([{"type": "expense", "amount": amount}], ""), monkeypatch)["events"] == []


# --- нормализация полей -------------------------------------------------------------

def test_unknown_type_dropped_others_kept(monkeypatch):
    r = run(one([{"type": "refund", "amount": 10_000}, {"type": " SALE ", "amount": 20_000, "amount_text": "20 000"}]),
            monkeypatch)
    assert [e["type"] for e in r["events"]] == ["sale"]


def test_invalid_category_defaults(monkeypatch):
    r = run(one([{"type": "expense", "amount": 10_000, "category": "food"},
                 {"type": "sale", "amount": 20_000, "category": None},
                 {"type": "scheduled_payment", "amount": 30_000, "category": "tovar", "due_date": "2026-11-30"}]),
            monkeypatch)
    assert [e["category"] for e in r["events"]] == ["boshqa", "tovar", None]


@pytest.mark.parametrize("due,expected", [
    ("2026-11-26", "2026-11-26"), ("26.11.2026", None), ("2026-13-01", None),
    ("2030-01-01", None), ("", None), ("null", None),
])
def test_due_date_validation(monkeypatch, due, expected):
    ev = run(one([{"type": "scheduled_payment", "amount": 100_000, "person": "X", "due_date": due}]),
             monkeypatch)["events"][0]
    assert ev["due_date"] == expected


def test_due_date_ignored_for_non_scheduled(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 10_000, "due_date": "2026-11-26"}]), monkeypatch)["events"][0]
    assert ev["due_date"] is None


@pytest.mark.parametrize("raw,expected", [
    ("90 123 45 67", "+998901234567"), ("+998 (90) 123-45-67", "+998901234567"),
    ("+998 90 *** ** 67", None), ("12345", None), (None, None),
])
def test_phone_normalization(monkeypatch, raw, expected):
    ev = run(one([{"type": "debt_returned", "amount": 10_000, "person": "A", "phone": raw}]), monkeypatch)["events"][0]
    assert ev["phone"] == expected


def test_empty_and_null_strings_become_none(monkeypatch):
    ev = run(one([{"type": "expense", "amount": 10_000, "person": "", "note": "null", "amount_text": "  "}]),
             monkeypatch)["events"][0]
    assert ev["person"] is None and ev["note"] is None and ev["amount_text"] is None


def test_long_strings_truncated(monkeypatch):
    ev = run(one([{"type": "debt_returned", "amount": 10_000, "person": "A" * 500, "note": "n" * 500}]),
             monkeypatch)["events"][0]
    assert len(ev["person"]) == 60 and len(ev["note"]) == 120


def test_events_capped_and_non_dicts_skipped(monkeypatch):
    events = ["junk", None] + [{"type": "sale", "amount": 1000 * (i + 1)} for i in range(20)]
    r = run(one(events), monkeypatch)
    assert len(r["events"]) == vision.MAX_EVENTS - 2


def test_unreadable_photo_keeps_reason(monkeypatch):
    r = run({"events": [], "transcript": "Rasm xira, o'qib bo'lmadi"}, monkeypatch)
    assert r == {"intent": "record", "events": [], "transcript": "Rasm xira, o'qib bo'lmadi"}


def test_empty_answer_gets_default_reason(monkeypatch):
    assert run({"events": [], "transcript": ""}, monkeypatch)["transcript"] == "Rasmdan yozuv topilmadi."


# --- ошибки не роняют программу ------------------------------------------------------

@pytest.mark.parametrize("payload", ["not json", "[1, 2]", "", "null"])
def test_bad_json_returns_error(monkeypatch, payload):
    r = run(payload, monkeypatch)
    assert r["events"] == [] and r["transcript"].startswith("error:")


def test_gemini_exception_returns_error(monkeypatch):
    r = run(RuntimeError("429 quota exceeded"), monkeypatch)
    assert r["events"] == [] and "429" in r["transcript"]


def test_timeout_returns_error(monkeypatch):
    async def slow(*a):
        await asyncio.sleep(1)
    monkeypatch.setattr(vision, "_call_gemini", slow)
    monkeypatch.setattr(vision, "ATTEMPT_TIMEOUT", 0.01)
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert r["events"] == [] and "timeout" in r["transcript"]


def test_missing_api_key_returns_error(monkeypatch):
    calls = []
    fake_gemini(monkeypatch, one([]), calls)
    monkeypatch.setattr(vision, "_settings", lambda: ("", ["model-a"]))
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert r["events"] == [] and "GEMINI_API_KEY" in r["transcript"] and calls == []


# --- запасные модели ------------------------------------------------------------------

def scripted(monkeypatch, answers):
    """Каждая модель отвечает по-своему: answers = {model: Exception | dict | coroutine-sleep}."""
    tried = []

    async def _fake(image_bytes, mime, prompt, model, key):
        tried.append(model)
        a = answers[model]
        if a == "slow":
            await asyncio.sleep(1)
        if isinstance(a, Exception):
            raise a
        return json.dumps(a)
    monkeypatch.setattr(vision, "_call_gemini", _fake)
    return tried


OK = one([{"type": "sale", "amount": 20_000, "amount_text": "20 000"}])


@pytest.mark.parametrize("err", [
    RuntimeError("503 UNAVAILABLE. high demand"), RuntimeError("429 RESOURCE_EXHAUSTED"),
    RuntimeError("404 NOT_FOUND. model is no longer available"), RuntimeError("500 INTERNAL"),
])
def test_falls_back_to_next_model(monkeypatch, err):
    tried = scripted(monkeypatch, {"model-a": err, "model-b": OK})
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert tried == ["model-a", "model-b"] and r["events"][0]["amount"] == 20_000


def test_slow_model_falls_back(monkeypatch):
    monkeypatch.setattr(vision, "ATTEMPT_TIMEOUT", 0.05)
    tried = scripted(monkeypatch, {"model-a": "slow", "model-b": OK})
    assert vision.parse_photo(JPEG, "image/jpeg", TODAY)["events"] and tried == ["model-a", "model-b"]


@pytest.mark.parametrize("err", [RuntimeError("400 INVALID_ARGUMENT"), RuntimeError("401 API key not valid"),
                                 RuntimeError("403 PERMISSION_DENIED")])
def test_non_retryable_error_stops(monkeypatch, err):
    tried = scripted(monkeypatch, {"model-a": err, "model-b": OK})
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert tried == ["model-a"] and r["events"] == [] and r["transcript"].startswith("error:")


def test_all_models_fail_reports_last_error(monkeypatch):
    scripted(monkeypatch, {"model-a": RuntimeError("503 a"), "model-b": RuntimeError("503 b")})
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert r["events"] == [] and "503 b" in r["transcript"]


def test_total_deadline_stops_trying(monkeypatch):
    monkeypatch.setattr(vision, "TIMEOUT_SECONDS", 1.05)
    monkeypatch.setattr(vision, "ATTEMPT_TIMEOUT", 0.2)
    tried = scripted(monkeypatch, {"model-a": "slow", "model-b": OK})
    r = vision.parse_photo(JPEG, "image/jpeg", TODAY)
    assert tried == ["model-a"] and "timeout" in r["transcript"]


def test_settings_order_and_dedup(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "m1")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", " m2, m1 ,,m3")
    assert vision._settings() == ("k", ["m1", "m2", "m3"])


def test_settings_defaults(monkeypatch):
    monkeypatch.undo()
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "")
    monkeypatch.delenv("GEMINI_FALLBACK_MODELS", raising=False)
    monkeypatch.setattr(vision, "EXTRAS_DIR", vision.Path("/nonexistent"))
    assert vision._settings() == ("k", [vision.DEFAULT_MODEL, "gemini-3.5-flash-lite"])


def test_empty_file(monkeypatch):
    fake_gemini(monkeypatch, one([]))
    assert vision.parse_photo(b"", "image/jpeg", TODAY)["transcript"].startswith("error:")


def test_too_big_file(monkeypatch):
    fake_gemini(monkeypatch, one([]))
    big = JPEG + b"0" * vision.MAX_IMAGE_BYTES
    assert "katta" in vision.parse_photo(big, "image/jpeg", TODAY)["transcript"]


@pytest.mark.parametrize("mime", ["text/plain", "image/gif", "audio/ogg"])
def test_unsupported_mime(monkeypatch, mime):
    calls = []
    fake_gemini(monkeypatch, one([]), calls)
    r = vision.parse_photo(JPEG, mime, TODAY)
    assert r["transcript"].startswith("error:") and calls == []


@pytest.mark.parametrize("mime,sent", [
    ("image/jpg", "image/jpeg"), ("IMAGE/JPEG; q=1", "image/jpeg"), (None, "image/jpeg"), ("", "image/jpeg"),
])
def test_mime_normalized_before_gemini(monkeypatch, mime, sent):
    calls = []
    fake_gemini(monkeypatch, one([]), calls)
    vision.parse_photo(JPEG, mime, TODAY)
    assert calls[0]["mime"] == sent


def test_prompt_has_today_and_weekdays(monkeypatch):
    calls = []
    fake_gemini(monkeypatch, one([]), calls)
    vision.parse_photo(JPEG, "image/jpeg", TODAY)
    prompt = calls[0]["prompt"]
    assert "2026-11-23 (dushanba)" in prompt and "payshanba = 2026-11-26" in prompt


@pytest.mark.parametrize("head,name,expected", [
    (b"\x89PNG\r\n\x1a\n", None, "image/png"),
    (b"RIFF\x00\x00\x00\x00WEBPVP8 ", None, "image/webp"),
    (b"\x00\x00\x00\x18ftypheic", None, "image/heic"),
    (b"%PDF-1.7", None, "application/pdf"),
    (b"unknownbytes", "scan.JPG", "image/jpeg"),
    (b"unknownbytes", "scan.txt", None),
    (b"unknownbytes", None, None),
])
def test_detect_mime(head, name, expected):
    assert vision.detect_mime(head + b"0" * 20, name) == expected


def test_sync_wrapper_refuses_inside_event_loop(monkeypatch):
    fake_gemini(monkeypatch, one([]))

    async def inside():
        with pytest.raises(RuntimeError):
            vision.parse_photo(JPEG, "image/jpeg", TODAY)
        return await vision.aparse_photo(JPEG, "image/jpeg", TODAY)

    assert asyncio.run(inside())["intent"] == "record"


# --- CLI ----------------------------------------------------------------------------

def test_cli_prints_json(monkeypatch, tmp_path, capsys):
    fake_gemini(monkeypatch, one([{"type": "expense", "amount": 45_000, "amount_text": "45 000", "category": "boshqa"}]))
    img = tmp_path / "chek.jpg"
    img.write_bytes(JPEG)
    assert vision.main([str(img), "--today", "2026-11-23"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["events"][0]["amount"] == 45_000


def test_cli_missing_file(tmp_path, capsys):
    assert vision.main([str(tmp_path / "nope.jpg")]) == 2


def test_cli_bad_date(tmp_path):
    img = tmp_path / "a.jpg"
    img.write_bytes(JPEG)
    assert vision.main([str(img), "--today", "23.11.2026"]) == 2
