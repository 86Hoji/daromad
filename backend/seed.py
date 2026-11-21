"""Демо-данные: «Dilshod Biznes» (малый торгово-сервисный бизнес, владелец Dilshod), 30 дней истории.

    python seed.py --reset    # пересоздать демо-бизнес (DEV_SHOP_ID), идемпотентно

Изъятия владельца (owner_draw) подбираются так, чтобы к ближайшему четвергу (платёж Akmal 3 000 000)
свободные деньги были ровно −350 000, а фактический остаток в истории оставался положительным.
"""
from __future__ import annotations

import argparse
import random
from datetime import date, timedelta

import config
import db
import logic

SHOP_NAME = "Dilshod Biznes"
OWNER = "Dilshod"
TARGET_FREE = -350_000
AKMAL_AMOUNT = 3_000_000
RENT = 2_500_000
WEEKLY_PAY = 600_000
OPENING = 2_000_000          # стартовый остаток 30 дней назад
DRAW_WEEKDAYS = (2, 6)       # среда и воскресенье
MIN_KEEP = 300_000           # ниже этого фактический остаток в истории не опускается

DEBTS = [  # (имя, сумма, дней назад, телефон, согласие на SMS)
    ("Alisher", 450_000, 21, "+998901234567", True),
    ("Nigora opa", 300_000, 9, None, False),
    ("Bobur", 150_000, 2, None, False),
    ("Malika", 120_000, 12, "+998935557788", False),
    ("Jasur", 100_000, 5, None, False),
    ("Sardor", 80_000, 4, None, False),
]  # итого 1 200 000


def k(x: float) -> int:
    """Округлить до 1000."""
    return int(round(x / 1000)) * 1000


def next_thursday(today: date) -> date:
    days = (3 - today.weekday()) % 7
    return today + timedelta(days=days or 7)


def wipe(shop_id: int) -> int | None:
    shop = db.get_shop(shop_id)
    tg_user_id = shop["tg_user_id"] if shop else None
    with db.connect() as conn:
        for table in ("pay_links", "debt_payments", "drafts", "entries", "debts", "scheduled_payments", "cash_flows", "offers",
                      "audit_log"):
            conn.execute(f"DELETE FROM {table} WHERE shop_id=?", (shop_id,))
        conn.execute("DELETE FROM shops WHERE id=?", (shop_id,))
    return tg_user_id


def seed(reset: bool = False, today: date | None = None, shop_id: int | None = None) -> dict:
    today = today or date.today()
    shop_id = shop_id or config.DEV_SHOP_ID
    db.init_db()
    if db.get_shop(shop_id):
        if not reset:
            print(f"Biznes #{shop_id} allaqachon bor. Qayta yaratish uchun: python seed.py --reset")
            return logic.free_money(shop_id, today=today)
    tg_user_id = wipe(shop_id)

    rng = random.Random(42)
    start = today - timedelta(days=30)
    thu = next_thursday(today)
    ts = lambda d, hh="10:00:00": f"{d.isoformat()} {hh}"  # noqa: E731

    with db.connect() as conn:
        conn.execute("INSERT INTO shops (id, tg_user_id, name, owner_name, opening_cash, created_at) VALUES (?,?,?,?,?,?)",
                     (shop_id, tg_user_id, SHOP_NAME, OWNER, 0, ts(start, "08:00:00")))

        def entry(d, kind, amount, category, note, source, is_scheduled=0):
            conn.execute(
                "INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
                "VALUES (?,?,?,?,?,?,?, 'confirmed', ?, ?)",
                (shop_id, kind, amount, category, note, d.isoformat(), source, is_scheduled, ts(d, "20:00:00")))

        for i in range(30):
            d = start + timedelta(days=i)
            weekend = d.weekday() >= 5
            sales = k(rng.uniform(2_300_000, 2_600_000) if weekend else rng.uniform(1_800_000, 2_300_000))
            terminal = k(sales * rng.uniform(0.35, 0.45))
            entry(d, "sale", sales - terminal, "tovar", "naqd savdo", "voice")
            entry(d, "sale", terminal, "tovar", "terminal (karta)", "bank")
            # закупка товара на базаре (~70% выручки; ещё часть товара — от Akmal раз в 2 недели)
            entry(d, "expense", k(sales * rng.uniform(0.67, 0.71)), "tovar", "bozordan tovar", "bank")
            # обычные мелкие расходы ~120–180 тыс/день
            entry(d, "expense", k(rng.uniform(40_000, 60_000)), "boshqa", "paketlar", "voice")
            entry(d, "expense", k(rng.uniform(50_000, 80_000)), "transport", "yetkazish, taksi", "bank")
            entry(d, "expense", k(rng.uniform(25_000, 40_000)), "kommunal", "svet, gaz", "bank")
            if d.day == 1:
                entry(d, "expense", RENT, "ijara", "joy ijarasi", "bank")
            if d.weekday() == 5:  # по субботам: зарплата помощнику
                entry(d, "expense", WEEKLY_PAY, "maosh", "yordamchi maoshi", "voice")
            if d.weekday() == 3 and ((thu - d).days // 7) % 2 == 0:
                # прошлые платежи Akmal раз в 2 недели — плановые, в среднее не входят
                entry(d, "expense", AKMAL_AMOUNT, "tovar", "Akmal (yetkazib beruvchi)", "bank", is_scheduled=1)
                conn.execute(
                    "INSERT INTO scheduled_payments (shop_id, title, counterparty, amount, due_date, source, status) "
                    "VALUES (?,?,?,?,?,?, 'paid')",
                    (shop_id, "Akmal — tovar uchun", "Akmal", AKMAL_AMOUNT, d.isoformat(), "bank"))

        for name, amount, ago, phone, consent in DEBTS:
            if name == "Alisher" and config.DEMO_DEBTOR_PHONE:
                phone = config.DEMO_DEBTOR_PHONE      # свой/командный номер: демо-SMS не уйдёт незнакомцу
            conn.execute(
                "INSERT INTO debts (shop_id, person_name, phone, sms_consent, amount, remaining, created_at, status) "
                "VALUES (?,?,?,?,?,?,?, 'open')",
                (shop_id, name, phone, int(consent), amount, amount, ts(today - timedelta(days=ago))))

        # закрытый долг — для истории и метки close_source
        closed_on = today - timedelta(days=7)
        cur = conn.execute(
            "INSERT INTO debts (shop_id, person_name, phone, sms_consent, amount, remaining, created_at, closed_at, "
            "status, close_source) VALUES (?,?,?,?,?,0,?,?, 'closed', 'voice')",
            (shop_id, "Kamola", None, 0, 200_000, ts(today - timedelta(days=15)), ts(closed_on, "18:00:00")))
        conn.execute("INSERT INTO debt_payments (debt_id, shop_id, amount, date, source, created_at) VALUES (?,?,?,?,?,?)",
                     (cur.lastrowid, shop_id, 200_000, closed_on.isoformat(), "voice", ts(closed_on, "18:00:00")))

        conn.execute(
            "INSERT INTO scheduled_payments (shop_id, title, counterparty, amount, due_date, source, status) "
            "VALUES (?,?,?,?,?,?, 'pending')",
            (shop_id, "Akmal — tovar uchun", "Akmal", AKMAL_AMOUNT, thu.isoformat(), "voice"))

    # Калибровка. Прибыльный бизнес 30 дней назад имел бы меньше денег, чем сейчас, поэтому владелец
    # по средам, воскресеньям и вчера вечером забирает часть денег домой (owner_draw: вне P&L, прибыль не уменьшает).
    # Сумма изъятий подбирается так, чтобы к четвергу было ровно TARGET_FREE (free_money линейна по остатку),
    # а фактический остаток в истории не опускался ниже MIN_KEEP.
    db.execute("UPDATE shops SET opening_cash=? WHERE id=?", (OPENING, shop_id))
    base = logic.free_money(shop_id, today=today)["free_money"]
    to_draw = base - TARGET_FREE
    opening = OPENING
    if to_draw < 0:                       # денег не хватает даже без изъятий — поднимаем стартовый остаток
        opening -= to_draw
        to_draw = 0
        db.execute("UPDATE shops SET opening_cash=? WHERE id=?", (opening, shop_id))

    days = [start + timedelta(days=i) for i in range((today - start).days + 1)]
    cash = {d: logic.cash_on(shop_id, d) for d in days}          # без изъятий
    yesterday = today - timedelta(days=1)
    sundays = [d for d in days if (d.weekday() in DRAW_WEEKDAYS or d == yesterday) and d < today]
    draws: dict[date, int] = {}
    left = to_draw
    for sunday in sundays:
        if left <= 0:
            break
        taken = sum(draws.values())
        # сколько можно забрать, чтобы ни в один день после этого остаток не упал ниже MIN_KEEP
        room = min(cash[d] - taken for d in days if d >= sunday) - MIN_KEEP
        amount = min(left, max(0, int(room // 100_000) * 100_000))
        if amount:
            draws[sunday] = amount
            left -= amount
    if left and sundays:                  # остаток — в последнее воскресенье (тест проверит, что истории хватило)
        draws[sundays[-1]] = draws.get(sundays[-1], 0) + left
    for d, amount in draws.items():
        db.execute("INSERT INTO cash_flows (shop_id, offer_id, kind, amount, date, note, created_at) "
                   "VALUES (?, NULL, 'owner_draw', ?, ?, 'egasi uyga oldi', ?)",
                   (shop_id, -amount, d.isoformat(), ts(d, "21:00:00")))
    db.audit(shop_id, "system", "seed", {"opening_cash": opening, "owner_draws": sum(draws.values()),
                                         "today": today.isoformat()})

    fm = logic.free_money(shop_id, today=today)
    return {**fm, "opening_cash": opening, "owner_draws": sum(draws.values())}


def main() -> None:
    parser = argparse.ArgumentParser(description="Flowcast demo ma'lumotlari")
    parser.add_argument("--reset", action="store_true", help="demo biznesni qayta yaratish")
    args = parser.parse_args()
    fm = seed(reset=args.reset)
    m = logic.fmt_money
    print(f"✓ {SHOP_NAME} (#{config.DEV_SHOP_ID}) -> {config.DB_PATH}")
    if "opening_cash" in fm:
        print(f"  opening_cash:   {m(fm['opening_cash'])}")
    print(f"  hisobda hozir:  {m(fm['cash_now'])}")
    print(f"  gorizont:       {fm['horizon']} ({fm['horizon_weekday']})")
    print(f"  kutilgan sotuv: {m(fm['expected_sales'])}, xarajat: {m(fm['expected_expenses'])}")
    print(f"  to'lovlar:      {m(fm['payments_due'])}")
    print(f"  BO'SH PUL:      {m(fm['free_money'])}")
    print(f"  qarzdorlik:     {m(fm['total_receivable'])}")


if __name__ == "__main__":
    main()
