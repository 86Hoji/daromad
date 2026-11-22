"""Шаблоны регулярных платежей (аренда, зарплата, коммуналка): сумма + день месяца или недели.

Шаблон не создаёт записей в базе: logic подмешивает его ближайшие даты в прогноз и в «свободные деньги»
как запланированные платежи (виртуальные, id < 0). Создать — из /app (лист «Doimiy to'lovlar») или голосом
(«har oy 5-sanada ijara 3 million» -> черновик recurring_payment -> «To'g'ri»).
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

import db

PERIODS = ("monthly", "weekly")
CATEGORIES = ("ijara", "maosh", "kommunal", "tovar", "transport", "boshqa")
# категории, которые шаблон «забирает» из средних расходов прогноза (иначе зарплата посчиталась бы дважды)
REGULAR_CATEGORIES = ("ijara", "maosh", "kommunal")
DEFAULT_TITLES = {"ijara": "Ijara", "maosh": "Maosh", "kommunal": "Kommunal to'lovlar"}
MAX_AMOUNT = 10_000_000_000


class RecurringError(ValueError):
    """Ошибка валидации — сообщение на узбекском (переводится texts._)."""


def validate(data: dict) -> dict:
    period = data.get("period")
    if period not in PERIODS:
        raise RecurringError("Davr noto'g'ri: har oy yoki har hafta.")
    try:
        day = int(data.get("day"))
    except (TypeError, ValueError):
        raise RecurringError("Kunni ko'rsating.") from None
    if period == "monthly" and not 1 <= day <= 31:
        raise RecurringError("Oy kuni 1 dan 31 gacha bo'lishi kerak.")
    if period == "weekly" and not 0 <= day <= 6:
        raise RecurringError("Hafta kuni noto'g'ri.")
    try:
        amount = int(data.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if not 0 < amount < MAX_AMOUNT:
        raise RecurringError("Summani tushunmadim — iltimos, summani aniqroq ayting.")
    category = (data.get("category") or "boshqa").strip().lower()
    if category not in CATEGORIES:
        category = "boshqa"
    title = (data.get("title") or "").strip()[:80] or DEFAULT_TITLES.get(category, "To'lov")
    return {"title": title, "category": category, "amount": amount, "period": period, "day": day}


def create(shop_id: int, data: dict, source: str = "app") -> dict:
    v = validate(data)
    rid = db.execute(
        "INSERT INTO recurring_payments (shop_id, title, category, amount, period, day, active, source, created_at) "
        "VALUES (?,?,?,?,?,?,1,?,?)",
        (shop_id, v["title"], v["category"], v["amount"], v["period"], v["day"], source, db.now_str()))
    db.audit(shop_id, "owner", "recurring_saved", {"id": rid, **v})
    return get(shop_id, rid)


def update(shop_id: int, rid: int, data: dict) -> dict | None:
    cur = get(shop_id, rid)
    if not cur:
        return None
    v = validate({**cur, **{k: val for k, val in data.items() if val is not None}})
    db.execute("UPDATE recurring_payments SET title=?, category=?, amount=?, period=?, day=? WHERE id=? AND shop_id=?",
               (v["title"], v["category"], v["amount"], v["period"], v["day"], rid, shop_id))
    db.audit(shop_id, "owner", "recurring_saved", {"id": rid, **v})
    return get(shop_id, rid)


def delete(shop_id: int, rid: int) -> bool:
    if not get(shop_id, rid):
        return False
    db.execute("UPDATE recurring_payments SET active=0 WHERE id=? AND shop_id=?", (rid, shop_id))
    db.audit(shop_id, "owner", "recurring_deleted", {"id": rid})
    return True


def get(shop_id: int, rid: int) -> dict | None:
    return db.query_one("SELECT * FROM recurring_payments WHERE id=? AND shop_id=? AND active=1", (rid, shop_id))


def templates(shop_id: int) -> list[dict]:
    return db.query("SELECT * FROM recurring_payments WHERE shop_id=? AND active=1 ORDER BY period, day, id",
                    (shop_id,))


def occurrences(t: dict, start: date, end: date) -> list[date]:
    """Даты платежа в [start, end]. День 31 в коротком месяце — последний день месяца."""
    out: list[date] = []
    if t["period"] == "weekly":
        d = start + timedelta(days=(int(t["day"]) - start.weekday()) % 7)
        while d <= end:
            out.append(d)
            d += timedelta(days=7)
        return out
    y, m = start.year, start.month
    while True:
        last = calendar.monthrange(y, m)[1]
        d = date(y, m, min(int(t["day"]), last))
        if d > end:
            return out
        if d >= start:
            out.append(d)
        m += 1
        if m > 12:
            y, m = y + 1, 1


def next_date(t: dict, today: date) -> date | None:
    days = occurrences(t, today + timedelta(days=1), today + timedelta(days=40))
    return days[0] if days else None


def virtual_payments(shop_id: int, today: date, until: date, real: list[dict]) -> list[dict]:
    """Ближайшие платежи по шаблонам (с завтрашнего дня по until) в формате scheduled_payments.
    Если на ±3 дня уже есть настоящий платёж с тем же названием — шаблон его не дублирует."""
    out = []
    for t in templates(shop_id):
        # уже оплачено заранее: расход той же категории (не «boshqa») на ≥80% суммы за последние 5 дней
        paid_early = None
        if t["category"] != "boshqa":
            paid_early = db.scalar(
                "SELECT MAX(date) FROM entries WHERE shop_id=? AND kind='expense' AND status='confirmed' "
                "AND category=? AND amount>=? AND date>=? AND date<=?",
                (shop_id, t["category"], int(t["amount"] * 0.8), (today - timedelta(days=5)).isoformat(),
                 today.isoformat()))
        for i, d in enumerate(occurrences(t, today + timedelta(days=1), until)):
            dup = any((p.get("title") or "").strip().lower() == t["title"].strip().lower()
                      and abs((date.fromisoformat(p["due_date"][:10]) - d).days) <= 3 for p in real)
            if paid_early and (d - date.fromisoformat(paid_early)).days <= 5:
                dup = True
            if dup:
                continue
            out.append({"id": -(t["id"] * 1000 + i + 1), "shop_id": shop_id, "title": t["title"], "counterparty": None,
                        "amount": t["amount"], "due_date": d.isoformat(), "source": "recurring", "status": "pending",
                        "recurring_id": t["id"]})
    return out


def regular_categories(shop_id: int) -> set[str]:
    return {t["category"] for t in templates(shop_id) if t["category"] in REGULAR_CATEGORIES}


def view(t: dict, today: date) -> dict:
    nd = next_date(t, today)
    return {"id": t["id"], "title": t["title"], "category": t["category"], "amount": t["amount"],
            "period": t["period"], "day": t["day"], "next_date": nd.isoformat() if nd else None}
