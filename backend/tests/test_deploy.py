"""Готовность к деплою: CORS для фронта на другом домене, initData -> привязанный демо-бизнес, сброс демо."""
import time

import pytest
from fastapi.testclient import TestClient

import config
import db
import logic
import seed
from main import app

TOKEN = "123456:TEST-TOKEN"
VERCEL = "https://flowcast-demo.vercel.app"


@pytest.fixture()
def client(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    monkeypatch.setattr(config, "BOT_TOKEN", TOKEN)
    return TestClient(app)


def signed(user_id: int) -> str:
    from tests.test_validation import _signed_init_data

    return _signed_init_data(TOKEN, user_id, int(time.time()))


def test_cors_preflight_allows_init_data_header(client):
    r = client.options("/api/summary", headers={
        "Origin": VERCEL, "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-telegram-init-data,content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] in ("*", VERCEL)
    assert "x-telegram-init-data" in r.headers["access-control-allow-headers"].lower()
    r = client.get("/api/summary", headers={"Origin": VERCEL})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] in ("*", VERCEL)


def test_init_data_resolves_linked_demo_shop(client):
    # как после «Demo biznesni ulash» в боте
    db.execute("UPDATE shops SET tg_user_id=? WHERE id=1", (777,))
    r = client.get("/api/summary", headers={"X-Telegram-Init-Data": signed(777)})
    assert r.status_code == 200 and r.json()["shop"]["id"] == 1
    assert client.get("/api/summary", headers={"X-Telegram-Init-Data": signed(778)}).status_code == 404
    assert client.get("/api/summary", headers={"X-Telegram-Init-Data": signed(777) + "0"}).status_code == 401


def test_demo_reset_flag_and_link_preserved(client, monkeypatch):
    assert client.post("/api/demo/reset").status_code == 404  # DEMO_RESET выключен
    monkeypatch.setattr(config, "DEMO_RESET", True)
    db.execute("UPDATE shops SET tg_user_id=? WHERE id=1", (777,))
    # демо «испорчено»: крупная продажа закрыла нехватку
    db.execute("INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
               "VALUES (1, 'sale', 9000000, 'tovar', 'test', date('now'), 'text', 'confirmed', 0, datetime('now'))")
    assert logic.free_money(1)["free_money"] > 0
    r = client.post("/api/demo/reset")
    assert r.status_code == 200 and r.json()["ok"] and r.json()["free_money"] < 0  # снова нехватка
    assert db.get_shop(1)["tg_user_id"] == 777
    # чужой бизнес сбросить нельзя
    other = db.create_shop(555, "Boshqa", None, 0)
    assert other != 1
    assert client.post("/api/demo/reset", headers={"X-Telegram-Init-Data": signed(555)}).status_code == 403
