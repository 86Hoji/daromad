"""Склейка с backend/extras: напоминание -> SMS (mock) -> оплата по ссылке -> долг закрыт в БД -> бо'ш пул вырос;
чужой долг недоступен; фото -> черновики source='photo'; уведомление владельцу в бот."""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import config
import db
import pipeline
import seed
from extras import adapters, sms
from main import app

TOKEN = "123456:TEST-TOKEN"


@pytest.fixture()
def client(tmp_db, tmp_path, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    monkeypatch.setattr(config, "BOT_TOKEN", TOKEN)
    monkeypatch.setattr(sms, "OUTBOX_PATH", tmp_path / "outbox.jsonl")
    for k, v in {"SMS_PROVIDER": "mock", "PUBLIC_BASE_URL": "https://flowcast-demo.vercel.app",
                 "ESKIZ_TEST_MODE": "1", "SMS_ALLOW_ANY": "0"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(adapters, "_notifier", None)
    return TestClient(app)


def jamshid_id() -> int:
    return db.query_one("SELECT id FROM debts WHERE shop_id=1 AND person_name='Jamshid'")["id"]


def signed(user_id: int) -> str:
    from tests.test_validation import _signed_init_data

    return _signed_init_data(TOKEN, user_id, int(time.time()))


def test_reminder_link_payment_closes_debt_and_changes_free_money(client):
    did = jamshid_id()
    before = client.get("/api/summary").json()

    p = client.post(f"/api/debts/{did}/remind/preview").json()
    assert p["can_send"] is True and p["sms_mode"] == "mock" and "450 000 so'm" in p["sms_text"]
    assert p["pay_url"].startswith("https://flowcast-demo.vercel.app/pay/")      # ссылка — на фронтенд

    r = client.post(f"/api/debts/{did}/remind").json()
    assert r["status"] == "sent" and r["pay_url"] == p["pay_url"] and sms.read_outbox()[0]["text"] == r["sms_text"]
    token = r["pay_url"].rsplit("/", 1)[1]

    info = client.get(f"/api/pay/{token}").json()
    assert info["amount"] == 450_000 and info["status"] == "open" and "phone" not in info
    assert client.post(f"/api/pay/{token}/confirm").json()["already_paid"] is False
    assert client.post(f"/api/pay/{token}/confirm").json()["already_paid"] is True     # второй раз не списывает

    debt = db.query_one("SELECT * FROM debts WHERE id=?", (did,))
    assert debt["status"] == "closed" and debt["close_source"] == "link" and debt["remaining"] == 0
    pays = db.query("SELECT * FROM debt_payments WHERE debt_id=?", (did,))
    assert len(pays) == 1 and pays[0]["source"] == "link" and db.trust_label(pays[0]["source"]) == "tasdiqlangan"

    after = client.get("/api/summary").json()
    assert after["cash_now"] == before["cash_now"] + 450_000
    assert after["total_receivable"] == before["total_receivable"] - 450_000
    closed = [d for d in client.get("/api/debts").json()["debts"] if d["id"] == did][0]
    assert closed["status"] == "closed" and closed["close_source"] == "link"
    assert db.query_one("SELECT 1 FROM audit_log WHERE action='debt_paid_by_link'")


def test_other_shops_debt_is_404_for_owner_routes(client):
    other = db.create_shop(777, "Boshqa do'kon", "X", 0)
    db.execute("INSERT INTO debts (shop_id, person_name, phone, sms_consent, amount, remaining, created_at) "
               "VALUES (?,?,?,?,?,?,?)", (other, "Begona", "+998935550000", 1, 99_000, 99_000, "2026-11-01 10:00:00"))
    foreign = db.query_one("SELECT id FROM debts WHERE shop_id=?", (other,))["id"]
    for method, path in [("post", f"/api/debts/{foreign}/remind/preview"), ("post", f"/api/debts/{foreign}/remind"),
                         ("get", f"/api/debts/{foreign}/remind/status"), ("post", "/api/debts/99999/remind")]:
        r = getattr(client, method)(path)
        assert r.status_code == 404 and r.json()["error"] == "not_found", path
    assert sms.read_outbox() == []

    # тот же долг владельцу магазина 777 (через initData) — доступен
    r = client.post(f"/api/debts/{foreign}/remind/preview", headers={"X-Telegram-Init-Data": signed(777)})
    assert r.status_code == 200 and r.json()["can_send"] is True
    # а свой долг магазина 1 из-под магазина 777 — нет
    r = client.post(f"/api/debts/{jamshid_id()}/remind", headers={"X-Telegram-Init-Data": signed(777)})
    assert r.status_code == 404 and sms.read_outbox() == []


def test_owner_routes_reject_bad_init_data(client):
    r = client.post(f"/api/debts/{jamshid_id()}/remind", headers={"X-Telegram-Init-Data": "user=%7B%7D&hash=bad"})
    assert r.status_code == 401 and sms.read_outbox() == []


def test_error_codes_reach_the_ui(client):
    nigora = db.query_one("SELECT id FROM debts WHERE shop_id=1 AND person_name='Nigora opa'")["id"]
    p = client.post(f"/api/debts/{nigora}/remind/preview").json()
    assert p["can_send"] is False and p["reason"] == "no_phone"
    r = client.post(f"/api/debts/{nigora}/remind")
    assert r.status_code == 422 and r.json() == {"error": "no_phone", "detail": ""}
    did = jamshid_id()
    client.post(f"/api/debts/{did}/remind")
    r = client.post(f"/api/debts/{did}/remind")
    assert r.status_code == 429 and r.json()["error"] == "too_soon"
    assert client.post(f"/api/debts/{did}/remind/preview").json()["next_allowed_at"]


def test_owner_gets_bot_message_with_new_free_money(client):
    import bot

    sent = []

    class FakeBot:
        async def send_message(self, chat_id, text):
            sent.append((chat_id, text))

    db.execute("UPDATE shops SET tg_user_id=555 WHERE id=1")

    async def scenario():
        bot.install_owner_notifier(FakeBot(), asyncio.get_running_loop())
        did = jamshid_id()
        r = await asyncio.to_thread(client.post, f"/api/debts/{did}/remind")
        token = r.json()["pay_url"].rsplit("/", 1)[1]
        await asyncio.to_thread(client.post, f"/api/pay/{token}/confirm")   # sync-роут в другом потоке
        for _ in range(50):
            if sent:
                break
            await asyncio.sleep(0.02)

    asyncio.run(scenario())
    adapters.set_notifier(None)
    assert sent and sent[0][0] == 555
    assert "Jamshid to'ladi ✅ 450 000 so'm" in sent[0][1] and "tasdiqlangan" in sent[0][1] and "Bo'sh pul" in sent[0][1]


def test_photo_becomes_photo_drafts(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    from extras import vision

    async def fake(image, mime=None, today=None):
        return {"intent": "record", "transcript": "Payme: Jamshid 450 000",
                "events": [{"type": "debt_returned", "amount": 450_000, "person": "Jamshid", "phone": None,
                            "category": None, "due_date": None, "note": None, "amount_text": "450 000",
                            "needs_check": False}]}

    monkeypatch.setattr(vision, "aparse_photo", fake)
    res = asyncio.run(pipeline.process_photo(1, b"\xff\xd8\xff fake", "image/jpeg"))
    assert res["batch_id"] and [d["source"] for d in res["drafts"]] == ["photo"]
    assert res["drafts"][0]["type"] == "debt_returned" and res["drafts"][0]["trust"] == "skrinshot"
    assert db.query_one("SELECT COUNT(*) AS n FROM entries")["n"] > 0          # ничего нового без «To'g'ri»
    assert not db.query("SELECT 1 FROM debt_payments WHERE source='photo'")


def test_unreadable_photo_gives_friendly_error(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    from extras import vision

    async def broken(image, mime=None, today=None):
        return vision.error_result("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(vision, "aparse_photo", broken)
    res = asyncio.run(pipeline.process_photo(1, b"x", "image/jpeg"))
    assert res["drafts"] == [] and "Rasmni o'qib bo'lmadi" in res["errors"][0]
