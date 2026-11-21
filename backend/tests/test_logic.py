from datetime import date, timedelta

import db
import logic
import pipeline

TODAY = date(2026, 11, 21)          # суббота
THURSDAY = date(2026, 11, 26)


def make_shop(opening=1_000_000, days=28, sale=100_000, expense=30_000, weekend_sale=None):
    shop_id = db.execute(
        "INSERT INTO shops (tg_user_id, name, owner_name, opening_cash, created_at) VALUES (NULL,'Test','T',?,?)",
        (opening, (TODAY - timedelta(days=days)).isoformat() + " 08:00:00"))
    for i in range(1, days + 1):
        d = TODAY - timedelta(days=i)
        s = weekend_sale if (weekend_sale and d.weekday() >= 5) else sale
        add_entry(shop_id, "sale", s, "tovar", d)
        add_entry(shop_id, "expense", expense, "boshqa", d)
    return shop_id


def add_entry(shop_id, kind, amount, category, d, is_scheduled=0, source="text"):
    db.execute(
        "INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
        "VALUES (?,?,?,?,NULL,?,?,'confirmed',?,?)",
        (shop_id, kind, amount, category, d.isoformat(), source, is_scheduled, d.isoformat() + " 20:00:00"))


def add_payment(shop_id, amount, due, status="pending"):
    db.execute("INSERT INTO scheduled_payments (shop_id, title, counterparty, amount, due_date, source, status) "
               "VALUES (?,?,?,?,?,'voice',?)", (shop_id, "Akmal", "Akmal", amount, due.isoformat(), status))


def test_free_money_formula(tmp_db):
    shop = make_shop()
    # аренда и оплаченный плановый платёж: уменьшают остаток, но не входят в средние расходы
    add_entry(shop, "expense", 500_000, "ijara", TODAY - timedelta(days=10))
    add_entry(shop, "expense", 200_000, "tovar", TODAY - timedelta(days=3), is_scheduled=1)
    # долг: выдача не меняет остаток, частичный возврат 50 000 — добавляет
    debt = db.execute("INSERT INTO debts (shop_id, person_name, amount, remaining, created_at, status) "
                      "VALUES (?,?,?,?,?, 'open')", (shop, "Ali", 300_000, 250_000, "2026-11-11 10:00:00"))
    db.execute("INSERT INTO debt_payments (debt_id, shop_id, amount, date, source, created_at) VALUES (?,?,?,?,?,?)",
               (debt, shop, 50_000, "2026-11-15", "voice", "2026-11-15 10:00:00"))
    add_payment(shop, 400_000, THURSDAY)

    fm = logic.free_money(shop, today=TODAY)
    cash = 1_000_000 + 28 * 100_000 - 28 * 30_000 - 500_000 - 200_000 + 50_000
    assert fm["cash_now"] == cash == 2_310_000
    assert fm["horizon"] == THURSDAY.isoformat()
    # ожидаемые дни: вс, пн, вт, ср (сегодня — факт, в четверг платёж уходит утром)
    assert fm["expected_sales"] == 4 * 100_000
    assert fm["expected_expenses"] == 4 * 30_000
    assert fm["payments_due"] == 400_000
    assert fm["free_money"] == cash + 4 * 70_000 - 400_000 == 2_190_000
    assert fm["total_receivable"] == 250_000
    assert fm["top_debtors"][0]["person_name"] == "Ali"
    assert fm["top_debtors"][0]["days_open"] == 10


def test_default_horizon_is_7_days_without_payments(tmp_db):
    shop = make_shop(opening=0)
    fm = logic.free_money(shop, today=TODAY)
    assert fm["horizon"] == (TODAY + timedelta(days=7)).isoformat()
    assert fm["expected_sales"] == 6 * 100_000


def test_average_uses_same_weekday(tmp_db):
    shop = make_shop(opening=0, sale=100_000, weekend_sale=300_000)
    add_payment(shop, 1, THURSDAY)
    fm = logic.free_money(shop, today=TODAY)
    # вс (выходной) + пн + вт + ср
    assert fm["expected_sales"] == 300_000 + 3 * 100_000


def test_new_shop_without_history(tmp_db):
    shop = db.create_shop(None, "Yangi", "X", 500_000)
    fm = logic.free_money(shop)
    assert fm["free_money"] == 500_000
    assert fm["expected_sales"] == 0


def test_payment_beyond_horizon_not_counted(tmp_db):
    shop = make_shop()
    add_payment(shop, 400_000, THURSDAY)
    add_payment(shop, 9_000_000, THURSDAY + timedelta(days=10))
    fm = logic.free_money(shop, today=TODAY)
    assert fm["payments_due"] == 400_000


def test_forecast_consistent_with_free_money(tmp_db):
    shop = make_shop(opening=-2_000_000)
    add_payment(shop, 400_000, THURSDAY)
    fc = logic.forecast(shop, days=14, today=TODAY)
    assert len(fc["history"]) == 14 and fc["history"][-1]["date"] == TODAY.isoformat()
    assert len(fc["forecast"]) == 14
    thu = next(r for r in fc["forecast"] if r["date"] == THURSDAY.isoformat())
    assert thu["balance"] == logic.free_money(shop, horizon_date=THURSDAY, today=TODAY)["free_money"]
    assert thu["events"][0]["amount"] == 400_000
    assert all(r["red"] == (r["balance"] < 0) for r in fc["forecast"])


def test_forecast_band_low_high(tmp_db):
    # будни 100k, но одна суббота назад продали 300k: разброс только у субботы
    shop = make_shop(opening=0, sale=100_000, expense=0)
    add_entry(shop, "sale", 200_000, "tovar", TODAY - timedelta(days=7))      # прошлая суббота: 300k
    fc = logic.forecast(shop, days=14, today=TODAY)["forecast"]
    first = fc[0]                                                             # воскресенье: ещё ничего не прогнозировали
    assert first["low"] == first["balance"] == first["high"]
    assert all(r["low"] <= r["balance"] <= r["high"] for r in fc)
    sat = next(r for r in fc if r["date"] == (TODAY + timedelta(days=7)).isoformat())
    after = fc[fc.index(sat) + 1]                                             # следующий день уже включает субботу
    avg_sat = (300_000 + 3 * 100_000) / 4
    assert after["high"] - after["balance"] == round(300_000 - avg_sat)
    assert after["balance"] - after["low"] == round(avg_sat - 100_000)
    # у будних дней разброса нет: до субботы полоса нулевая
    assert sat["low"] == sat["balance"] == sat["high"]


def test_recommendation_shortage_and_surplus(tmp_db):
    shop = make_shop(opening=-2_000_000)
    add_payment(shop, 400_000, THURSDAY)
    db.execute("INSERT INTO debts (shop_id, person_name, amount, remaining, created_at, status) VALUES (?,?,?,?,?,'open')",
               (shop, "Alisher", 2_000_000, 2_000_000, "2026-10-31 10:00:00"))
    rec = logic.recommendation(shop, today=TODAY)
    fm = logic.free_money(shop, today=TODAY)
    assert rec["kind"] == "shortage"
    assert rec["gap"] == -fm["free_money"]
    assert rec["covers_by_debts"] is (2_000_000 >= rec["gap"])
    assert rec["debtors_to_remind"][0]["person_name"] == "Alisher"
    od = rec["overdraft"]
    assert od["amount"] >= rec["gap"]
    assert od["cost"] == round(od["amount"] * logic.OVERDRAFT["annual_rate"] * od["term_days"] / 365)

    rich = make_shop(opening=10_000_000)
    rec2 = logic.recommendation(rich, today=TODAY)
    assert rec2["kind"] == "surplus"
    assert rec2["deposit"]["amount"] > 0


def test_confirm_debt_flow_changes_cash_only_on_return(tmp_db):
    shop = db.create_shop(None, "S", "S", 1_000_000)
    cash0 = logic.cash_on(shop, date.today())
    ev, err = pipeline.validate_event({"type": "debt_given", "amount": 150_000, "person": "Alisher",
                                       "phone": "90 123 45 67"})
    assert err is None and ev["phone"] == "+998901234567"
    _, drafts = pipeline.save_drafts(shop, [ev], "voice")
    res = pipeline.confirm(shop, ids=[d["id"] for d in drafts])
    assert res["new_debts_with_phone"][0]["person"] == "Alisher"
    assert logic.cash_on(shop, date.today()) == cash0          # выдача в долг не даёт денег

    ev2, _ = pipeline.validate_event({"type": "debt_returned", "amount": 100_000, "person": "alisher"})
    _, drafts2 = pipeline.save_drafts(shop, [ev2], "voice")
    pipeline.confirm(shop, ids=[d["id"] for d in drafts2])
    assert logic.cash_on(shop, date.today()) == cash0 + 100_000
    debt = db.query_one("SELECT * FROM debts WHERE shop_id=?", (shop,))
    assert debt["remaining"] == 50_000 and debt["status"] == "open"


def test_expense_to_counterparty_marks_payment_paid(tmp_db):
    shop = db.create_shop(None, "S", "S", 5_000_000)
    add_payment(shop, 3_000_000, date.today() + timedelta(days=3))
    ev, _ = pipeline.validate_event({"type": "expense", "amount": 3_000_000, "person": "Akmal", "category": "tovar"})
    _, drafts = pipeline.save_drafts(shop, [ev], "text")
    res = pipeline.confirm(shop, ids=[d["id"] for d in drafts])
    assert res["confirmed"][0]["scheduled_payment_paid"]
    assert logic.free_money(shop)["payments_due"] == 0
    assert db.scalar("SELECT is_scheduled FROM entries WHERE shop_id=?", (shop,)) == 1


def test_seed_gives_350k_shortage_by_thursday(tmp_db):
    import seed
    fm = seed.seed(reset=True, today=TODAY, shop_id=1)
    assert fm["horizon"] == THURSDAY.isoformat()
    assert fm["free_money"] == -350_000
    assert fm["opening_cash"] > 0 and fm["cash_now"] > 0
    assert fm["total_receivable"] == 1_200_000
    assert fm["top_debtors"][0]["person_name"] == "Alisher"
    assert fm["top_debtors"][0]["days_open"] == 21
    share = logic.trust_share(1)["tasdiqlangan"]
    assert 0.6 <= share <= 0.7
    # месячная прибыль положительная (~3–5 млн), красный в прогнозе — только четверг
    month = logic.totals(1, "month", today=TODAY)["profit"]
    assert 3_000_000 <= month <= 5_000_000
    fc = logic.forecast(1, days=14, today=TODAY)["forecast"]
    assert [r["date"] for r in fc if r["red"]] == [THURSDAY.isoformat()]
    # фактический остаток в истории никогда не был отрицательным (изъятия владельца вне P&L)
    history = [logic.cash_on(1, TODAY - timedelta(days=i)) for i in range(31)]
    assert min(history) >= 0
    assert fm["owner_draws"] > 0
    # идемпотентность
    fm2 = seed.seed(reset=True, today=TODAY, shop_id=1)
    assert fm2["free_money"] == -350_000
    assert db.scalar("SELECT COUNT(*) FROM shops") == 1


def test_round1000():
    assert logic.round1000(349_499) == 349_000
    assert logic.round1000(349_500) == 350_000
    assert logic.round1000(-349_600) == -350_000
    assert logic.fmt_money(1_234_567) == "1 235 000 so'm"
