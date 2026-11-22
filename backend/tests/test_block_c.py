"""Блок C: регулярные платежи, надёжность «посчитано по N% данных», вопрос про пропущенный день,
mock банковского фида. Gemini не вызывается (parse_input подменён)."""
import asyncio
import random
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import ai
import bank_feed
import bot
import config
import db
import logic
import pipeline
import recurring
import seed
from tests.test_logic import TODAY, add_entry, make_shop


# --- шаблоны и даты ------------------------------------------------------------------

def test_occurrences_monthly_clips_to_month_end_and_weekly():
    t = {"period": "monthly", "day": 31}
    got = recurring.occurrences(t, date(2026, 1, 15), date(2026, 4, 30))
    assert got == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]
    w = {"period": "weekly", "day": 5}                      # суббота
    got = recurring.occurrences(w, date(2026, 11, 22), date(2026, 12, 6))
    assert got == [date(2026, 11, 28), date(2026, 12, 5)]


def test_validate_rejects_bad_input():
    with pytest.raises(recurring.RecurringError):
        recurring.validate({"period": "daily", "day": 1, "amount": 1000})
    with pytest.raises(recurring.RecurringError):
        recurring.validate({"period": "monthly", "day": 32, "amount": 1000})
    with pytest.raises(recurring.RecurringError):
        recurring.validate({"period": "weekly", "day": 7, "amount": 1000})
    with pytest.raises(recurring.RecurringError):
        recurring.validate({"period": "monthly", "day": 5, "amount": 0})
    v = recurring.validate({"period": "monthly", "day": "5", "amount": 3_000_000, "category": "IJARA"})
    assert v == {"title": "Ijara", "category": "ijara", "amount": 3_000_000, "period": "monthly", "day": 5}


def test_recurring_in_free_money_and_forecast(tmp_db):
    shop = make_shop()
    before = logic.free_money(shop, horizon_date=TODAY + timedelta(days=14), today=TODAY)
    recurring.create(shop, {"title": "Ijara", "category": "ijara", "amount": 700_000, "period": "monthly",
                            "day": (TODAY + timedelta(days=4)).day})
    fm = logic.free_money(shop, today=TODAY)
    assert fm["horizon"] == (TODAY + timedelta(days=4)).isoformat()      # следующий платёж — по шаблону
    assert fm["payments"][0]["recurring"] is True and fm["payments"][0]["id"] < 0
    after = logic.free_money(shop, horizon_date=TODAY + timedelta(days=14), today=TODAY)
    assert before["free_money"] - after["free_money"] == 700_000
    fc = logic.forecast(shop, days=14, today=TODAY)
    ev = [e for e in fc["events"] if e.get("recurring")]
    assert len(ev) == 1 and ev[0]["amount"] == 700_000 and ev[0]["title"] == "Ijara"


def test_template_category_excluded_from_averages_and_no_double_with_real_payment(tmp_db):
    shop = make_shop()
    for i in range(1, 29):
        if (TODAY - timedelta(days=i)).weekday() == 5:
            add_entry(shop, "expense", 600_000, "maosh", TODAY - timedelta(days=i))
    with_avg = logic.free_money(shop, horizon_date=TODAY + timedelta(days=8), today=TODAY)
    recurring.create(shop, {"title": "Maosh", "category": "maosh", "amount": 600_000, "period": "weekly", "day": 5})
    with_tpl = logic.free_money(shop, horizon_date=TODAY + timedelta(days=8), today=TODAY)
    # средняя суббота больше не содержит зарплату, зато есть ровно один платёж по шаблону
    assert with_tpl["expected_expenses"] < with_avg["expected_expenses"]
    assert sum(1 for p in with_tpl["payments"] if p["recurring"]) == 1
    # записанный вручную платёж с тем же названием рядом с датой — шаблон его не дублирует
    sat = TODAY + timedelta(days=7)
    db.execute("INSERT INTO scheduled_payments (shop_id, title, counterparty, amount, due_date, source, status) "
               "VALUES (?, 'Maosh', NULL, 600000, ?, 'voice', 'pending')", (shop, sat.isoformat()))
    fm = logic.free_money(shop, horizon_date=TODAY + timedelta(days=8), today=TODAY)
    assert [p["recurring"] for p in fm["payments"]] == [False]


def test_paid_early_skips_occurrence(tmp_db):
    shop = make_shop()
    due = TODAY + timedelta(days=2)
    recurring.create(shop, {"title": "Ijara", "category": "ijara", "amount": 1_000_000, "period": "monthly",
                            "day": due.day})
    assert logic.free_money(shop, horizon_date=due, today=TODAY)["payments_due"] == 1_000_000
    add_entry(shop, "expense", 1_000_000, "ijara", TODAY)               # заплатил аренду заранее
    assert logic.free_money(shop, horizon_date=due, today=TODAY)["payments_due"] == 0


def test_seed_stays_350k_with_salary_template(tmp_db):
    fm = seed.seed(reset=True, today=TODAY, shop_id=1)
    assert fm["free_money"] == -350_000
    assert [t["title"] for t in recurring.templates(1)] == ["Yordamchi maoshi"]


# --- голосом: «har oy 5-sanada ijara 3 million» ---------------------------------------

def _fake(events, language="uz"):
    async def fake(audio=None, text=None, mime_type=None, today=None):
        return {"intent": "record", "events": events, "question": None, "question_date": None,
                "transcript": text or "", "language": language}
    return fake


def test_voice_recurring_payment_draft_then_confirm(tmp_db, monkeypatch):
    shop = make_shop()
    monkeypatch.setattr(ai, "parse_input", _fake([
        {"type": "recurring_payment", "amount": 3_000_000, "period": "monthly", "day": 5, "category": "ijara",
         "note": "ijara", "needs_check": False}]))
    res = asyncio.run(pipeline.process(shop, text="har oy 5-sanada ijara 3 million", today=TODAY))
    assert not res["errors"] and res["drafts"][0]["type"] == "recurring_payment"
    assert recurring.templates(shop) == []                               # без «To'g'ri» ничего не сохранено
    line = bot.event_line(res["drafts"][0], "ru")
    assert "Регулярный платёж" in line and "каждый месяц 5-го числа" in line
    out = pipeline.confirm(shop, batch_id=res["batch_id"], today=TODAY)
    assert out["confirmed"][0]["type"] == "recurring_payment"
    t = recurring.templates(shop)[0]
    assert (t["amount"], t["period"], t["day"], t["category"], t["source"]) == (3_000_000, "monthly", 5, "ijara", "text")


def test_voice_recurring_bad_day_is_error(tmp_db, monkeypatch):
    shop = make_shop()
    monkeypatch.setattr(ai, "parse_input", _fake([
        {"type": "recurring_payment", "amount": 500_000, "period": "weekly", "day": 9, "needs_check": False}], "ru"))
    res = asyncio.run(pipeline.process(shop, text="каждую неделю", today=TODAY))
    assert res["drafts"] == [] and res["errors"] == ["Неверный день недели."]


def test_backdated_sale_for_yesterday(tmp_db, monkeypatch):
    shop = make_shop()
    y = TODAY - timedelta(days=1)
    monkeypatch.setattr(ai, "parse_input", _fake([
        {"type": "sale", "amount": 1_200_000, "date": y.isoformat(), "needs_check": False},
        {"type": "sale", "amount": 5000, "date": (TODAY + timedelta(days=1)).isoformat(), "needs_check": False}]))
    res = asyncio.run(pipeline.process(shop, text="kecha 1 million 200 ming sotdim", today=TODAY))
    assert res["errors"] == ["Sana kelajakda bo'lishi mumkin emas."]
    assert res["drafts"][0]["date"] == y.isoformat()
    pipeline.confirm(shop, batch_id=res["batch_id"], today=TODAY)
    assert db.scalar("SELECT date FROM entries WHERE shop_id=? AND amount=1200000", (shop,)) == y.isoformat()


# --- надёжность ------------------------------------------------------------------------

def test_reliability_components(tmp_db):
    shop = make_shop()                     # каждый день записи владельца (source=text), банка нет
    r = logic.reliability(shop, TODAY)
    assert r["window_days"] == 14 and r["missing_days"] == 0
    assert r["coverage"] == 1.0 and r["regularity"] == 1.0 and r["confirmed_share"] == 0.0
    assert r["percent"] == 60 and not r["low"]
    for i in range(1, 15):                  # банк приносит столько же денег, сколько наличные
        add_entry(shop, "sale", 130_000, "tovar", TODAY - timedelta(days=i), source="bank")
    assert logic.reliability(shop, TODAY)["percent"] == 80


def test_reliability_low_when_owner_stops_recording(tmp_db):
    shop = make_shop()
    db.execute("DELETE FROM entries WHERE shop_id=? AND date>=?", (shop, (TODAY - timedelta(days=10)).isoformat()))
    r = logic.reliability(shop, TODAY)
    assert r["missing_days"] == 10 and r["low"]
    rec = logic.recommendation(shop, today=TODAY)
    assert rec["offers_allowed"] is False and rec["reliability"] == r["percent"]


def test_low_reliability_hides_bank_offers_in_bot(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(logic, "reliability", lambda shop_id, today=None: {
        "percent": 30, "low": True, "window_days": 14, "confirmed_share": 0, "regularity": 0, "coverage": 0,
        "missing_days": 10, "missing_dates": []})
    text, markup = bot.recommendation_message(1, "ru")
    assert "Дополните данные" in text
    assert all(b.callback_data != "od" for row in markup.inline_keyboard for b in row)


# --- пропущенный день ------------------------------------------------------------------

def test_missing_yesterday_and_morning_nudge(tmp_db):
    shop = make_shop()
    db.execute("UPDATE shops SET tg_user_id=77, lang='ru' WHERE id=?", (shop,))
    today = date.today()
    y = today - timedelta(days=1)
    db.execute("DELETE FROM entries WHERE shop_id=? AND date=?", (shop, y.isoformat()))
    add_entry(shop, "sale", 50_000, "tovar", y, source="bank")         # банк не считается записью наличных
    assert logic.missing_yesterday(shop, today) == y.isoformat()
    early = datetime.combine(today, datetime.min.time()).replace(hour=7, tzinfo=bot.TASHKENT)
    assert bot.due_nudges(early) == []
    morning = early.replace(hour=10)
    assert [s["id"] for s in bot.due_nudges(morning)] == [shop]
    assert bot.due_nudges(morning) == []                                # раз в день
    text, markup = bot.nudge_text("ru")
    assert text == "За вчера нет записей по наличным. Дописать?"
    assert markup.inline_keyboard[0][0].callback_data == "nudge"
    add_entry(shop, "sale", 100_000, "tovar", y, source="voice")
    assert logic.missing_yesterday(shop, today) is None


# --- банковский фид ----------------------------------------------------------------------

def test_bank_feed_adds_confirmed_cashless_sale(tmp_db):
    shop = make_shop()
    cash = logic.cash_on(shop, TODAY)
    res = bank_feed.add_bank_sale(shop, today=TODAY, rng=random.Random(1))
    assert 10_000 <= res["amount"] <= 50_000 and res["amount"] % 1000 == 0
    row = db.query_one("SELECT * FROM entries WHERE id=?", (res["entry_id"],))
    assert (row["source"], row["kind"], row["status"]) == ("bank", "sale", "confirmed")
    assert db.trust_label(row["source"]) == "tasdiqlangan"
    assert logic.cash_on(shop, TODAY) == cash + res["amount"]
    assert db.scalar("SELECT action FROM audit_log WHERE shop_id=? ORDER BY id DESC LIMIT 1", (shop,)) == "bank_payment"


# --- API ------------------------------------------------------------------------------

def _client(monkeypatch):
    import api
    monkeypatch.setattr(config, "BOT_TOKEN", "")
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def test_recurring_crud_api_and_summary_fields(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    c = _client(monkeypatch)
    s = c.get("/api/summary").json()
    assert 0 <= s["reliability"]["percent"] <= 100 and "nudge_date" in s
    r = c.post("/api/recurring", json={"title": "Kommunal", "category": "kommunal", "amount": 400_000,
                                       "period": "monthly", "day": 10})
    assert r.status_code == 200 and r.json()["next_date"]
    rid = r.json()["id"]
    assert len(c.get("/api/recurring").json()["items"]) == 2
    r = c.patch(f"/api/recurring/{rid}", json={"amount": 450_000})
    assert r.json()["amount"] == 450_000 and r.json()["day"] == 10
    bad = c.post("/api/recurring", json={"amount": 1000, "period": "monthly", "day": 40},
                 headers={"Accept-Language": "ru"})
    assert bad.status_code == 400 and bad.json()["detail"] == "День месяца должен быть от 1 до 31."
    assert c.delete(f"/api/recurring/{rid}").status_code == 200
    assert c.delete(f"/api/recurring/{rid}").status_code == 404
    actions = [a["action"] for a in c.get("/api/audit").json()["items"]]
    assert "recurring_saved" in actions and "recurring_deleted" in actions


def test_recurring_api_owner_check(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    other = db.execute("INSERT INTO shops (tg_user_id, name, owner_name, opening_cash, created_at) "
                       "VALUES (NULL,'B','B',0,'2026-01-01 00:00:00')")
    t = recurring.create(other, {"title": "X", "amount": 1000, "period": "weekly", "day": 1})
    c = _client(monkeypatch)
    assert c.patch(f"/api/recurring/{t['id']}", json={"amount": 2000}).status_code == 404
    assert c.delete(f"/api/recurring/{t['id']}").status_code == 404
    assert recurring.get(other, t["id"])["amount"] == 1000
