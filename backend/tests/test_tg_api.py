"""tg_api (Mini App): POST /api/photo — фото -> черновики source='photo', без записи до подтверждения, ошибки понятные;
GET /api/tg/period — итоги и записи за последние N дней совпадают с ручным подсчётом по БД."""
import time
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import ai
import config
import db
import seed
from extras import vision
from main import app

TOKEN = "123456:TEST-TOKEN"
JPEG = b"\xff\xd8\xff\xe0 fake jpeg"


@pytest.fixture()
def client(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    monkeypatch.setattr(config, "BOT_TOKEN", TOKEN)
    return TestClient(app)


def fake_events(*events):
    async def fake(image, mime=None, today=None):
        fake.calls.append((image, mime, today))
        return {"intent": "record", "transcript": "nakladnaya", "events": list(events)}

    fake.calls = []
    return fake


def ev(type_, amount, **kw):
    base = {"type": type_, "amount": amount, "person": None, "phone": None, "category": None, "due_date": None,
            "note": None, "amount_text": str(amount), "needs_check": False}
    base.update(kw)
    return base


def entries_count() -> int:
    return db.query_one("SELECT COUNT(*) AS n FROM entries")["n"]


def test_photo_gives_photo_drafts_and_saves_nothing(client, monkeypatch):
    fake = fake_events(ev("expense", 1_450_000, category="tovar", note="nakladnaya"),
                       ev("debt_returned", 450_000, person="Jamshid"))
    monkeypatch.setattr(vision, "aparse_photo", fake)
    before = entries_count()
    r = client.post("/api/photo", files={"image": ("chek.jpg", JPEG, "image/jpeg")}, headers={"Accept-Language": "ru"})
    assert r.status_code == 200
    body = r.json()
    assert body["intent"] == "record" and body["batch_id"]
    assert [d["source"] for d in body["drafts"]] == ["photo", "photo"]
    assert [d["type"] for d in body["drafts"]] == ["expense", "debt_returned"]
    assert entries_count() == before                      # до «To'g'ri» ничего не записано
    image, mime, today = fake.calls[0]
    assert image == JPEG and mime == "image/jpeg" and today is not None


def test_confirm_after_photo_records_entry(client, monkeypatch):
    monkeypatch.setattr(vision, "aparse_photo", fake_events(ev("expense", 200_000, category="tovar")))
    drafts = client.post("/api/photo", files={"image": ("c.jpg", JPEG, "image/jpeg")}).json()["drafts"]
    before = entries_count()
    r = client.post("/api/entries/confirm", json={"ids": [d["id"] for d in drafts]})
    assert r.status_code == 200 and not r.json()["errors"]
    assert entries_count() == before + 1


def test_unreadable_photo_is_friendly_error_in_ui_language(client, monkeypatch):
    async def broken(image, mime=None, today=None):
        return vision.error_result("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(vision, "aparse_photo", broken)
    r = client.post("/api/photo", files={"image": ("c.jpg", JPEG, "image/jpeg")}, headers={"Accept-Language": "ru"})
    assert r.status_code == 200
    body = r.json()
    assert body["drafts"] == [] and body["errors"] and "429" not in body["errors"][0]


def test_empty_and_too_large_images_rejected(client, monkeypatch):
    monkeypatch.setattr(vision, "aparse_photo", fake_events())
    assert client.post("/api/photo", files={"image": ("e.jpg", b"", "image/jpeg")}).status_code == 400
    monkeypatch.setattr("tg_api.MAX_IMAGE_BYTES", 10)
    assert client.post("/api/photo", files={"image": ("big.jpg", JPEG, "image/jpeg")}).status_code == 413
    assert client.post("/api/photo").status_code == 422                       # файла нет


def test_ai_unavailable_is_503(client, monkeypatch):
    async def down(*a, **kw):
        raise ai.AIUnavailable("AI vaqtincha ishlamayapti")

    monkeypatch.setattr("pipeline.process_photo", down)
    assert client.post("/api/photo", files={"image": ("c.jpg", JPEG, "image/jpeg")}).status_code == 503


def test_photo_requires_valid_telegram_user(client, monkeypatch):
    monkeypatch.setattr(vision, "aparse_photo", fake_events(ev("sale", 100_000)))
    bad = client.post("/api/photo", files={"image": ("c.jpg", JPEG, "image/jpeg")},
                      headers={"X-Telegram-Init-Data": "user=%7B%22id%22%3A1%7D&hash=bad"})
    assert bad.status_code == 401

    from tests.test_validation import _signed_init_data
    stranger = _signed_init_data(TOKEN, 999_999, int(time.time()))      # нет бизнеса у этого пользователя
    r = client.post("/api/photo", files={"image": ("c.jpg", JPEG, "image/jpeg")},
                    headers={"X-Telegram-Init-Data": stranger})
    assert r.status_code == 404


def add_entry(kind, amount, day, status="confirmed", source="text"):
    db.execute("INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
               "VALUES (1, ?, ?, 'boshqa', 'tg-test', ?, ?, ?, 0, datetime('now'))",
               (kind, amount, day.isoformat(), source, status))


def manual_totals(days):
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    rows = db.query("SELECT kind, amount FROM entries WHERE shop_id=1 AND status='confirmed' AND date>=? AND date<=?",
                    (start, date.today().isoformat()))
    s = sum(r["amount"] for r in rows if r["kind"] == "sale")
    e = sum(r["amount"] for r in rows if r["kind"] == "expense")
    return s, e, len(rows)


@pytest.mark.parametrize("days", [7, 30])
def test_period_matches_database(client, days):
    r = client.get(f"/api/tg/period?days={days}")
    assert r.status_code == 200
    body = r.json()
    sales, exps, n = manual_totals(days)
    assert (body["sales"], body["expenses"], body["profit"]) == (sales, exps, sales - exps)
    assert len(body["entries"]) == n and n > 0                       # демо-данные есть в обоих окнах
    assert body["to"] == date.today().isoformat()
    assert body["from"] == (date.today() - timedelta(days=days - 1)).isoformat()
    dates = [e["date"] for e in body["entries"]]
    assert dates == sorted(dates, reverse=True)                       # сначала свежие
    assert all(e["trust"] for e in body["entries"])


def test_period_window_edges_and_pending(client):
    today = date.today()
    base = client.get("/api/tg/period?days=7").json()
    add_entry("sale", 111_000, today - timedelta(days=6))            # первый день окна — входит
    add_entry("sale", 222_000, today - timedelta(days=7))            # за окном — нет
    add_entry("expense", 333_000, today, status="pending")           # не подтверждена — нет
    add_entry("sale", 444_000, today + timedelta(days=1))            # будущее — нет
    after = client.get("/api/tg/period?days=7").json()
    assert after["sales"] == base["sales"] + 111_000
    assert after["expenses"] == base["expenses"]
    assert len(after["entries"]) == len(base["entries"]) + 1


def test_period_validates_days(client):
    assert client.get("/api/tg/period?days=0").status_code == 422
    assert client.get("/api/tg/period?days=1000").status_code == 422
    assert client.get("/api/tg/period").json()["days"] == 7
