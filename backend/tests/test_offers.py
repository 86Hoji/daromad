from datetime import date, timedelta

import pytest

import db
import logic
import pipeline
import seed

TODAY = date(2026, 11, 21)       # суббота, платёж Akmal — четверг 26.11
THURSDAY = "2026-11-26"


@pytest.fixture()
def demo(tmp_db):
    seed.seed(reset=True, today=TODAY, shop_id=1)
    return 1


def red_days(shop_id):
    return [r["date"] for r in logic.forecast(shop_id, days=14, today=TODAY)["forecast"] if r["red"]]


def test_overdraft_term_counted_from_today(demo):
    rec = logic.recommendation(demo, today=TODAY)
    od = rec["overdraft"]
    assert rec["kind"] == "shortage" and rec["gap"] == 350_000
    assert od["amount"] == 400_000
    # возврат — после четверга, считая от сегодняшнего дня
    assert (TODAY + timedelta(days=od["term_days"])).isoformat() > THURSDAY
    assert od["cost"] == round(400_000 * logic.OVERDRAFT["annual_rate"] * od["term_days"] / 365)


def test_accept_overdraft_removes_red_zone_and_logs(demo):
    assert red_days(demo) == [THURSDAY]
    od = logic.recommendation(demo, today=TODAY)["overdraft"]
    res = pipeline.accept_offer(demo, "overdraft", od["amount"], od["term_days"], today=TODAY)

    assert res["status"] == "accepted" and res["bank"]
    assert res["free_money_after"] == -350_000 + od["amount"]
    assert red_days(demo) == []
    assert logic.recommendation(demo, today=TODAY)["kind"] != "shortage"
    # деньги пришли сегодня, возврат с переплатой — в день окончания срока
    assert logic.cash_on(demo, TODAY) == logic.cash_on(demo, TODAY - timedelta(days=1)) + od["amount"]
    flows = db.query("SELECT kind, amount, date FROM cash_flows WHERE shop_id=? AND kind LIKE 'overdraft%' ORDER BY id", (demo,))
    assert flows[0] == {"kind": "overdraft_in", "amount": od["amount"], "date": TODAY.isoformat()}
    assert flows[1]["kind"] == "overdraft_repay" and flows[1]["amount"] == -(od["amount"] + od["cost"])
    # событие возврата видно в прогнозе
    events = logic.forecast(demo, days=14, today=TODAY)["events"]
    assert any(e["type"] == "overdraft_repay" for e in events)
    # журнал и статус оффера
    assert db.query_one("SELECT status FROM offers WHERE id=?", (res["offer_id"],))["status"] == "accepted"
    assert db.scalar("SELECT COUNT(*) FROM audit_log WHERE shop_id=? AND action='offer_accepted'", (demo,)) == 1


def test_second_overdraft_conflicts(demo):
    pipeline.accept_offer(demo, "overdraft", 400_000, 6, today=TODAY)
    with pytest.raises(pipeline.OfferConflict):
        pipeline.accept_offer(demo, "overdraft", 400_000, 6, today=TODAY)


def test_decline_changes_nothing_but_status(demo):
    before = logic.free_money(demo, today=TODAY)["free_money"]
    res = pipeline.decline_offer(demo, "overdraft", 400_000, 6)
    assert res["status"] == "declined"
    assert logic.free_money(demo, today=TODAY)["free_money"] == before
    assert db.scalar("SELECT COUNT(*) FROM cash_flows WHERE kind != 'owner_draw'") == 0
    assert db.scalar("SELECT COUNT(*) FROM audit_log WHERE action='offer_declined'") == 1


def test_deposit_moves_money_and_returns_with_income(tmp_db):
    shop = db.create_shop(None, "Boy", "B", 10_000_000)
    res = pipeline.accept_offer(shop, "deposit", 5_000_000, today=date.today())
    assert logic.cash_on(shop, date.today()) == 5_000_000
    back = db.query_one("SELECT * FROM cash_flows WHERE kind='deposit_return'")
    assert back["amount"] == 5_000_000 + res["income"]


def test_invalid_offer_rejected(demo):
    with pytest.raises(ValueError):
        pipeline.accept_offer(demo, "loan", 100_000, today=TODAY)
    with pytest.raises(ValueError):
        pipeline.accept_offer(demo, "overdraft", 999_000_000, 5, today=TODAY)


def test_bot_accept_uses_same_path(demo):
    od = logic.recommendation(demo, today=TODAY)["overdraft"]
    oid = pipeline.save_offer(demo, od)
    row = pipeline.set_offer_status(demo, oid, True, today=TODAY)
    assert row["status"] == "accepted" and row["result"]["type"] == "overdraft"
    assert red_days(demo) == []


def test_api_offers_endpoints(demo, monkeypatch):
    from fastapi.testclient import TestClient

    import config
    from main import app
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    client = TestClient(app)  # без `with`: lifespan (и бот) не запускается
    r = client.post("/api/offers/decline", json={"type": "overdraft", "amount": 400_000, "term_days": 6})
    assert r.status_code == 200 and r.json()["status"] == "declined"
    r = client.post("/api/offers/accept", json={"type": "overdraft", "amount": 400_000, "term_days": 6})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "accepted" and "recommendation" in body
    assert client.post("/api/offers/accept", json={"type": "overdraft", "amount": 400_000}).status_code == 409
    assert client.post("/api/offers/accept", json={"type": "loan", "amount": 1}).status_code == 422
