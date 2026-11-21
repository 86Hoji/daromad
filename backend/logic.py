"""Вся арифметика Daromad. Только код, без ИИ.

Главная цифра — «свободные деньги до следующего платежа»:
    free = cash_now + ожидаемые продажи − ожидаемые обычные расходы − платежи (pending, due ≤ horizon)

Соглашения:
  * сегодняшний день — это факт (что записано), прогноз начинается с завтра;
  * платёж уходит утром в день срока, поэтому ожидаемые дни: today < d < horizon;
  * «обычные» расходы для среднего — без аренды (ijara) и без оплаченных плановых платежей (is_scheduled=1);
  * в forecast остаток дня d = остаток на утро после платежей = free_money(horizon=d).
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta

import db

# --- константы -------------------------------------------------------------------

SURPLUS_THRESHOLD = 1_000_000   # свободно больше — предлагаем вклад
DEPOSIT_BUFFER = 500_000        # столько оставляем на счету при вкладе
DEFAULT_HORIZON_DAYS = 7
AVG_WEEKS = 4                   # среднее за последние 4 таких же дня недели
NON_REGULAR_CATEGORIES = ("ijara",)

# Mock-каталог продуктов банка (цифры примерные).
OVERDRAFT = {
    "name": "Biznes overdrafti",
    "annual_rate": 0.28,
    "max_days": 30,
    "min_amount": 100_000,
    "risk_text": (
        "Overdraft — bu qarz. Muddatida qaytarilmasa, kechiktirilgan har bir kun uchun "
        "qo'shimcha foiz olinadi va kredit tarixingiz yomonlashadi."
    ),
}
DEPOSIT = {
    "name": "Omonat «Bo'sh pul»",
    "annual_rate": 0.20,
    "term_days": 30,
    "early_withdrawal": "Muddatidan oldin yechilsa, foiz yillik 5% gacha kamayadi.",
}

WEEKDAYS_UZ = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"]
EXPENSE_CATEGORIES = ("tovar", "ijara", "maosh", "kommunal", "transport", "boshqa")


# --- утилиты ---------------------------------------------------------------------

def round1000(x: float | int | None) -> int:
    """Округление до 1000 сум для отображения (половина — вверх по модулю)."""
    if x is None:
        return 0
    sign = -1 if x < 0 else 1
    return sign * int(math.floor(abs(x) / 1000 + 0.5)) * 1000


def fmt_money(x: float | int) -> str:
    return f"{round1000(x):,}".replace(",", " ") + " so'm"


def _d(v) -> date:
    if isinstance(v, date):
        return v
    return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()


def _today(today: date | None) -> date:
    return today or date.today()


def days_between(a, b) -> int:
    return (_d(b) - _d(a)).days


# --- остаток ---------------------------------------------------------------------

def cash_on(shop_id: int, day: date) -> int:
    """Фактический остаток на конец дня day."""
    shop = db.get_shop(shop_id)
    if not shop:
        raise ValueError(f"shop {shop_id} not found")
    d = day.isoformat()
    sales = db.scalar(
        "SELECT COALESCE(SUM(amount),0) FROM entries WHERE shop_id=? AND kind='sale' "
        "AND status='confirmed' AND date<=?", (shop_id, d))
    expenses = db.scalar(
        "SELECT COALESCE(SUM(amount),0) FROM entries WHERE shop_id=? AND kind='expense' "
        "AND status='confirmed' AND date<=?", (shop_id, d))
    returned = db.scalar(
        "SELECT COALESCE(SUM(amount),0) FROM debt_payments WHERE shop_id=? AND date<=?", (shop_id, d))
    flows = db.scalar(
        "SELECT COALESCE(SUM(amount),0) FROM cash_flows WHERE shop_id=? AND date<=?", (shop_id, d))
    return int(shop["opening_cash"] + sales - expenses + returned + flows)


def _shop_start(shop_id: int) -> date:
    shop = db.get_shop(shop_id)
    first_entry = db.scalar("SELECT MIN(date) FROM entries WHERE shop_id=?", (shop_id,))
    start = _d(shop["created_at"])
    if first_entry:
        start = min(start, _d(first_entry))
    return start


class _Averages:
    """Средние продажи/обычные расходы по дням недели (за последние 4 таких же дня до today)."""

    def __init__(self, shop_id: int, today: date):
        start = _shop_start(shop_id)
        since = today - timedelta(days=7 * AVG_WEEKS)
        rows = db.query(
            "SELECT date, kind, category, is_scheduled, amount FROM entries "
            "WHERE shop_id=? AND status='confirmed' AND date>=? AND date<?",
            (shop_id, since.isoformat(), today.isoformat()),
        )
        sales: dict[str, int] = {}
        exps: dict[str, int] = {}
        for r in rows:
            if r["kind"] == "sale":
                sales[r["date"]] = sales.get(r["date"], 0) + r["amount"]
            elif not r["is_scheduled"] and r["category"] not in NON_REGULAR_CATEGORIES:
                exps[r["date"]] = exps.get(r["date"], 0) + r["amount"]
        self.sales: dict[int, float] = {}
        self.expenses: dict[int, float] = {}
        # разброс продаж по тем же дням недели — для полосы неопределённости прогноза
        self.sales_min: dict[int, float] = {}
        self.sales_max: dict[int, float] = {}
        for wd in range(7):
            back = (today.weekday() - wd) % 7 or 7  # ближайший прошлый такой день (не сегодня)
            days = [today - timedelta(days=back + 7 * k) for k in range(AVG_WEEKS)]
            days = [x for x in days if x >= start]
            if not days:
                self.sales[wd] = self.sales_min[wd] = self.sales_max[wd] = 0.0
                self.expenses[wd] = 0.0
                continue
            day_sales = [sales.get(x.isoformat(), 0) for x in days]
            self.sales[wd] = sum(day_sales) / len(days)
            self.sales_min[wd] = float(min(day_sales))
            self.sales_max[wd] = float(max(day_sales))
            self.expenses[wd] = sum(exps.get(x.isoformat(), 0) for x in days) / len(days)

    def net(self, d: date) -> float:
        return self.sales[d.weekday()] - self.expenses[d.weekday()]


def _pending_payments(shop_id: int) -> list[dict]:
    return db.query(
        "SELECT * FROM scheduled_payments WHERE shop_id=? AND status='pending' ORDER BY due_date, id",
        (shop_id,))


FLOW_TITLES = {
    "overdraft_in": "Overdraft tushumi",
    "overdraft_repay": "Overdraftni qaytarish",
    "deposit_out": "Omonatga o'tkazish",
    "deposit_return": "Omonat qaytishi",
    "owner_draw": "Egasi oldi",
}


def _future_flows(shop_id: int, today: date) -> list[dict]:
    """Будущие потоки офферов (овердрафт/вклад). Как и платежи, учитываются утром дня date."""
    return db.query("SELECT * FROM cash_flows WHERE shop_id=? AND date>? ORDER BY date, id",
                    (shop_id, today.isoformat()))


def _flow_event(f: dict) -> dict:
    return {"id": f["id"], "date": f["date"], "type": f["kind"], "title": FLOW_TITLES.get(f["kind"], f["kind"]),
            "counterparty": "Bank", "amount": f["amount"], "offer_id": f["offer_id"]}


def open_debts(shop_id: int, today: date | None = None) -> list[dict]:
    today = _today(today)
    rows = db.query(
        "SELECT * FROM debts WHERE shop_id=? AND status='open' AND remaining>0", (shop_id,))
    for r in rows:
        r["days_open"] = max(0, days_between(r["created_at"], today))
    rows.sort(key=lambda r: (-r["remaining"], -r["days_open"]))
    return rows


def _debtor_view(r: dict) -> dict:
    return {
        "id": r["id"],
        "person_name": r["person_name"],
        "remaining": r["remaining"],
        "days_open": r["days_open"],
        "has_phone": bool(r["phone"]),
        "sms_consent": bool(r["sms_consent"]),
    }


def default_horizon(shop_id: int, today: date | None = None) -> date:
    today = _today(today)
    pend = _pending_payments(shop_id)
    if pend:
        return max(_d(pend[0]["due_date"]), today)
    return today + timedelta(days=DEFAULT_HORIZON_DAYS)


# --- 1) свободные деньги ---------------------------------------------------------

def free_money(shop_id: int, horizon_date: date | None = None, today: date | None = None) -> dict:
    today = _today(today)
    horizon = _d(horizon_date) if horizon_date else default_horizon(shop_id, today)
    horizon = max(horizon, today)

    cash_now = cash_on(shop_id, today)
    avg = _Averages(shop_id, today)
    exp_sales = exp_exps = 0.0
    d = today + timedelta(days=1)
    while d < horizon:
        exp_sales += avg.sales[d.weekday()]
        exp_exps += avg.expenses[d.weekday()]
        d += timedelta(days=1)

    payments = [p for p in _pending_payments(shop_id) if _d(p["due_date"]) <= horizon]
    payments_due = sum(p["amount"] for p in payments)
    flows = [f for f in _future_flows(shop_id, today) if _d(f["date"]) <= horizon]
    flows_total = sum(f["amount"] for f in flows)
    free = cash_now + exp_sales - exp_exps - payments_due + flows_total

    debts = open_debts(shop_id, today)
    next_payment = _pending_payments(shop_id)[:1]
    return {
        "today": today.isoformat(),
        "horizon": horizon.isoformat(),
        "horizon_weekday": WEEKDAYS_UZ[horizon.weekday()],
        "free_money": int(round(free)),
        "cash_now": cash_now,
        "expected_sales": int(round(exp_sales)),
        "expected_expenses": int(round(exp_exps)),
        "payments_due": payments_due,
        "payments": [
            {"id": p["id"], "title": p["title"], "counterparty": p["counterparty"],
             "amount": p["amount"], "due_date": p["due_date"]} for p in payments],
        "flows": [_flow_event(f) for f in flows],
        "flows_total": flows_total,
        "next_payment": next_payment[0] if next_payment else None,
        "total_receivable": sum(r["remaining"] for r in debts),
        "top_debtors": [_debtor_view(r) for r in debts[:3]],
    }


# --- 2) прогноз ------------------------------------------------------------------

def forecast(shop_id: int, days: int = 14, today: date | None = None) -> dict:
    today = _today(today)
    history = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        history.append({"date": d.isoformat(), "balance": cash_on(shop_id, d)})

    avg = _Averages(shop_id, today)
    cash = cash_on(shop_id, today)
    pend = _pending_payments(shop_id)
    flows = _future_flows(shop_id, today)
    end_date = today + timedelta(days=days)

    out = []
    flows_so_far = 0
    dev_low = dev_high = 0.0  # накопленное отклонение продаж от среднего: худший / лучший сценарий
    morning_base = cash  # остаток к утру дня d без учёта платежей
    paid_so_far = sum(p["amount"] for p in pend if _d(p["due_date"]) <= today)
    for i in range(1, days + 1):
        d = today + timedelta(days=i)
        day_payments = [p for p in pend if _d(p["due_date"]) == d]
        paid_so_far += sum(p["amount"] for p in day_payments)
        day_flows = [f for f in flows if _d(f["date"]) == d]
        flows_so_far += sum(f["amount"] for f in day_flows)
        balance = morning_base - paid_so_far + flows_so_far
        out.append({
            "date": d.isoformat(),
            "weekday": WEEKDAYS_UZ[d.weekday()],
            "balance": int(round(balance)),
            "low": int(round(balance + dev_low)),
            "high": int(round(balance + dev_high)),
            "expected_sales": int(round(avg.sales[d.weekday()])),
            "expected_expenses": int(round(avg.expenses[d.weekday()])),
            "events": [{"id": p["id"], "type": "scheduled_payment", "title": p["title"],
                        "counterparty": p["counterparty"], "amount": p["amount"]} for p in day_payments]
                      + [_flow_event(f) for f in day_flows],
            "red": balance < 0,
        })
        morning_base += avg.net(d)
        dev_low += avg.sales_min[d.weekday()] - avg.sales[d.weekday()]
        dev_high += avg.sales_max[d.weekday()] - avg.sales[d.weekday()]

    events = [
        {"id": p["id"], "date": p["due_date"], "type": "scheduled_payment", "title": p["title"],
         "counterparty": p["counterparty"], "amount": p["amount"], "overdue": _d(p["due_date"]) < today}
        for p in pend if _d(p["due_date"]) <= end_date
    ] + [{**_flow_event(f), "overdue": False} for f in flows if _d(f["date"]) <= end_date]
    events.sort(key=lambda e: e["date"])
    return {"today": today.isoformat(), "cash_now": cash, "history": history, "forecast": out, "events": events}


# --- 3) рекомендация -------------------------------------------------------------

def overdraft_offer(amount: int, days: int) -> dict:
    amount = max(OVERDRAFT["min_amount"], int(math.ceil(amount / 100_000) * 100_000))
    days = max(1, min(days, OVERDRAFT["max_days"]))
    cost = amount * OVERDRAFT["annual_rate"] * days / 365
    return {
        "type": "overdraft", "name": OVERDRAFT["name"], "amount": amount, "term_days": days,
        "annual_rate": OVERDRAFT["annual_rate"], "cost": int(round(cost)),
        "risk_text": OVERDRAFT["risk_text"],
    }


def deposit_offer(amount: int) -> dict:
    days = DEPOSIT["term_days"]
    income = amount * DEPOSIT["annual_rate"] * days / 365
    return {
        "type": "deposit", "name": DEPOSIT["name"], "amount": amount, "term_days": days,
        "annual_rate": DEPOSIT["annual_rate"], "income": int(round(income)),
        "early_withdrawal": DEPOSIT["early_withdrawal"],
    }


def overdraft_term(fc: list[dict], horizon: str, today: date, amount: int) -> int:
    """Срок овердрафта в днях ОТ СЕГОДНЯ (деньги берутся сегодня).

    Возврат — в первый день после горизонта, начиная с которого прогноз до конца окна
    не опускается ниже переплаты: после возврата остаток = прогноз − переплата, красного не будет.
    """
    max_cost = amount * OVERDRAFT["annual_rate"] * OVERDRAFT["max_days"] / 365
    rows = [r for r in fc if r["date"] > horizon]
    for i, row in enumerate(rows):
        if all(r["balance"] >= max_cost for r in rows[i:]):
            return max(1, min((_d(row["date"]) - today).days, OVERDRAFT["max_days"]))
    return OVERDRAFT["max_days"]


def recommendation(shop_id: int, today: date | None = None) -> dict:
    today = _today(today)
    fm = free_money(shop_id, today=today)
    free = fm["free_money"]
    base = {"free_money": free, "horizon": fm["horizon"], "horizon_weekday": fm["horizon_weekday"],
            "cash_now": fm["cash_now"]}

    if free < 0:
        gap = -free
        receivable = fm["total_receivable"]
        debtors = open_debts(shop_id, today)
        to_remind, acc = [], 0
        for r in debtors:
            if acc >= gap:
                break
            to_remind.append(_debtor_view(r))
            acc += r["remaining"]
        fc = forecast(shop_id, days=OVERDRAFT["max_days"] + 7, today=today)["forecast"]
        amount = overdraft_offer(gap, 1)["amount"]
        term = overdraft_term(fc, fm["horizon"], today, amount)
        return {
            **base, "kind": "shortage", "gap": gap, "receivable": receivable,
            "covers_by_debts": receivable >= gap,
            "debtors_to_remind": to_remind,
            "top_debtors": fm["top_debtors"],
            "overdraft": overdraft_offer(gap, term),
        }
    if free > SURPLUS_THRESHOLD:
        amount = int((free - DEPOSIT_BUFFER) // 100_000 * 100_000)
        if amount > 0:
            return {**base, "kind": "surplus", "amount": amount, "deposit": deposit_offer(amount)}
    return {**base, "kind": "ok"}


# --- сводки для API и ответов на вопросы -----------------------------------------

def period_start(period: str, today: date | None = None) -> date:
    today = _today(today)
    if period == "today":
        return today
    if period == "week":
        return today - timedelta(days=today.weekday())   # с понедельника
    if period == "month":
        return today.replace(day=1)
    raise ValueError(period)


def totals(shop_id: int, period: str, today: date | None = None) -> dict:
    today = _today(today)
    start = period_start(period, today)
    rows = db.query(
        "SELECT kind, COALESCE(SUM(amount),0) s FROM entries WHERE shop_id=? AND status='confirmed' "
        "AND date>=? AND date<=? GROUP BY kind", (shop_id, start.isoformat(), today.isoformat()))
    s = {r["kind"]: r["s"] for r in rows}
    sales, exps = s.get("sale", 0), s.get("expense", 0)
    return {"from": start.isoformat(), "to": today.isoformat(),
            "sales": sales, "expenses": exps, "profit": sales - exps}


def trust_share(shop_id: int) -> dict:
    rows = db.query(
        "SELECT source, COUNT(*) c FROM entries WHERE shop_id=? AND status='confirmed' GROUP BY source",
        (shop_id,))
    total = sum(r["c"] for r in rows) or 1
    out = {"so'zdan": 0.0, "skrinshot": 0.0, "tasdiqlangan": 0.0}
    for r in rows:
        out[db.trust_label(r["source"])] += r["c"] / total
    return {k: round(v, 3) for k, v in out.items()}
