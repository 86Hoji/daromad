"""Вход на сайт: POST /api/auth/demo -> Bearer-токен; Telegram по-прежнему по initData; Demo reset не разлогинивает."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import config
import db
import seed


def _client(monkeypatch):
    import api
    monkeypatch.setattr(config, "BOT_TOKEN", "")
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def test_demo_login_logout(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=config.DEV_SHOP_ID)
    c = _client(monkeypatch)
    r = c.post("/api/auth/demo").json()
    assert r["shop"]["name"] == "Alisher Savdo" and len(r["token"]) > 20
    h = {"Authorization": f"Bearer {r['token']}"}
    assert c.get("/api/auth/me", headers=h).json()["shop"]["id"] == config.DEV_SHOP_ID
    assert c.get("/api/summary", headers=h).status_code == 200
    # Demo reset пересоздаёт магазин — сессия жива
    seed.seed(reset=True, shop_id=config.DEV_SHOP_ID)
    assert c.get("/api/summary", headers=h).status_code == 200
    assert c.post("/api/auth/logout", headers=h).json()["ok"] is True
    assert c.get("/api/summary", headers=h).status_code == 401


def test_bad_or_expired_token_401(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=config.DEV_SHOP_ID)
    c = _client(monkeypatch)
    assert c.get("/api/summary", headers={"Authorization": "Bearer nope"}).status_code == 401
    tok = c.post("/api/auth/demo").json()["token"]
    db.execute("UPDATE sessions SET expires_at='2000-01-01 00:00:00' WHERE token=?", (tok,))
    assert c.get("/api/summary", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
