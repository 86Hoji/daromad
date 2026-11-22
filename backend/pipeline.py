"""Общий конвейер для бота и API: ИИ -> валидация кодом -> черновики -> подтверждение человеком."""
from __future__ import annotations

import difflib
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta

import ai
import db
import logic
import recurring
import texts
import tts
from logic import EXPENSE_CATEGORIES, round1000

log = logging.getLogger("flowcast.pipeline")

EVENT_TYPES = ("sale", "expense", "debt_given", "debt_returned", "scheduled_payment", "recurring_payment")
BACKDATE_DAYS = 30          # «kecha sotdim» — дописать можно за последние 30 дней
MAX_AMOUNT = 1_000_000_000
SOURCES = ("voice", "text", "photo", "bank", "link")


# --- валидация ---------------------------------------------------------------------

def validate_event(ev: dict, today: date | None = None) -> tuple[dict | None, str | None]:
    """-> (нормализованное событие, None) или (None, текст ошибки на узбекском)."""
    today = today or date.today()
    t = ev.get("type")
    if t not in EVENT_TYPES:
        return None, f"Noma'lum yozuv turi: {t!r}."
    try:
        amount = int(ev.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if not (0 < amount < MAX_AMOUNT):
        return None, "Summani tushunmadim — iltimos, summani aniqroq ayting."

    person = (ev.get("person") or "").strip() or None
    out = {
        "type": t,
        "amount": amount,
        "person": person,
        "phone": ai.normalize_phone(ev.get("phone")),
        "category": None,
        "due_date": None,
        "note": (ev.get("note") or "").strip() or None,
        "needs_check": bool(ev.get("needs_check")),
        "ai_amount": ev.get("ai_amount"),
        "amount_text": ev.get("amount_text"),
    }
    if t in ("sale", "expense"):
        cat = (ev.get("category") or "").strip().lower()
        out["category"] = cat if cat in EXPENSE_CATEGORIES else ("tovar" if t == "sale" else "boshqa")
        raw = ev.get("date")
        if raw:
            try:
                when = datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
            except ValueError:
                when = today
            if when > today:
                return None, "Sana kelajakda bo'lishi mumkin emas."
            if (today - when).days > BACKDATE_DAYS:
                return None, "Faqat oxirgi 30 kun uchun yozish mumkin."
            if when < today:
                out["date"] = when.isoformat()
    if t == "recurring_payment":
        try:
            v = recurring.validate({"period": ev.get("period"), "day": ev.get("day"), "amount": amount,
                                    "category": ev.get("category"), "title": ev.get("note")})
        except recurring.RecurringError as exc:
            return None, str(exc)
        out.update(category=v["category"], period=v["period"], day=v["day"], note=v["title"])
    if t in ("debt_given", "debt_returned") and not person:
        return None, "Kim qarz olgani/qaytargani aniq emas — ismini ayting."
    if t == "scheduled_payment":
        raw = ev.get("due_date")
        if not raw:
            return None, "To'lov qaysi kuni ekanini ayting (masalan, «payshanba kuni»)."
        try:
            due = datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
        except ValueError:
            return None, f"To'lov sanasini tushunmadim: {raw}."
        if due < today:
            return None, f"To'lov sanasi ({due.strftime('%d.%m')}) o'tib ketgan — to'g'ri sanani ayting."
        out["due_date"] = due.isoformat()
    return out, None


# --- матчинг имён ------------------------------------------------------------------

_HONORIFICS = {"opa", "aka", "uka", "singil", "xola", "amaki", "ака", "опа", "хола"}
_APOSTROPHES = "‘’ʻʼ`´"


def _norm_name(name: str) -> str:
    n = name.lower()
    for ch in _APOSTROPHES:
        n = n.replace(ch, "'")
    parts = [p for p in re.split(r"[\s\-]+", n) if p and p not in _HONORIFICS]
    return " ".join(parts)


def names_match(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    x, y = _norm_name(a), _norm_name(b)
    if not x or not y:
        return False
    if x == y or x.startswith(y) or y.startswith(x):
        return True
    return difflib.SequenceMatcher(None, x, y).ratio() >= 0.8


# --- черновики ---------------------------------------------------------------------

def _draft_view(row: dict) -> dict:
    ev = json.loads(row["event_json"])
    return {"id": row["id"], "batch_id": row["batch_id"], "source": row["source"],
            "trust": db.trust_label(row["source"]), **ev}


def save_drafts(shop_id: int, events: list[dict], source: str) -> tuple[str, list[dict]]:
    batch_id = uuid.uuid4().hex[:12]
    out = []
    for ev in events:
        did = db.execute(
            "INSERT INTO drafts (shop_id, batch_id, event_json, source, needs_check, created_at) VALUES (?,?,?,?,?,?)",
            (shop_id, batch_id, json.dumps(ev, ensure_ascii=False), source, int(ev["needs_check"]), db.now_str()))
        out.append(_draft_view(db.query_one("SELECT * FROM drafts WHERE id=?", (did,))))
    return batch_id, out


def get_drafts(shop_id: int, ids: list[int] | None = None, batch_id: str | None = None) -> list[dict]:
    if batch_id:
        rows = db.query("SELECT * FROM drafts WHERE shop_id=? AND batch_id=? ORDER BY id", (shop_id, batch_id))
    else:
        ids = [int(i) for i in (ids or [])]
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        rows = db.query(f"SELECT * FROM drafts WHERE shop_id=? AND id IN ({marks}) ORDER BY id", (shop_id, *ids))
    return [_draft_view(r) for r in rows]


# --- основной конвейер -------------------------------------------------------------

async def process(shop_id: int, *, text: str | None = None, audio: bytes | None = None,
                  mime_type: str = "audio/ogg", source: str = "text", today: date | None = None,
                  lang: str | None = None) -> dict:
    """Распознать ввод. record -> черновики; question -> ответ из цифр logic.
    Язык ответа и ошибок — язык, на котором говорил владелец (AI language / эвристика); lang — запасной
    вариант (язык интерфейса), если язык не определился. Бросает ai.AIUnavailable, если Gemini недоступен."""
    today = today or date.today()
    parsed = await ai.parse_input(audio=audio, text=text, mime_type=mime_type, today=today)
    lang = parsed.get("language") or texts.detect_lang(text) or texts.norm_lang(lang)
    db.audit(shop_id, "ai", "parsed", {"source": source, "intent": parsed["intent"],
                                       "transcript": parsed["transcript"], "events": parsed["events"]})
    result = {"intent": parsed["intent"], "transcript": parsed["transcript"], "language": lang,
              "batch_id": None, "drafts": [], "errors": [], "answer": None, "voice_text": None}

    if parsed["intent"] == "question":
        question = parsed.get("question") or parsed["transcript"]
        result["answer"], facts = await answer_full(shop_id, question, parsed.get("question_date"), today=today,
                                                    lang=lang)
        result["voice_text"] = voice_text(question, result["answer"], facts, lang=lang)
        return result

    valid = []
    for ev in parsed["events"]:
        norm, err = validate_event(ev, today)
        if err:
            result["errors"].append(err)
        else:
            valid.append(norm)
    if valid:
        result["batch_id"], result["drafts"] = save_drafts(shop_id, valid, source)
    elif not result["errors"]:
        result["errors"].append("Hech qanday yozuv topmadim. Masalan: «Bugun 2 million sotdim».")
    result["errors"] = texts.tr_list(result["errors"], lang)
    return result


async def process_photo(shop_id: int, image: bytes, mime_type: str | None = None,
                        today: date | None = None, lang: str | None = None) -> dict:
    """Фото накладной / чека / скриншота Payme-Click -> черновики (source='photo'). Ничего не сохраняет
    без «To'g'ri». Gemini читает картинку (extras.vision), суммы и типы проверяет код."""
    from extras import vision

    today = today or date.today()
    parsed = await vision.aparse_photo(image, mime_type, today)
    transcript = parsed.get("transcript") or ""
    db.audit(shop_id, "ai", "parsed", {"source": "photo", "intent": "record",
                                       "transcript": transcript, "events": parsed["events"]})
    lang = texts.norm_lang(lang)
    result = {"intent": "record", "transcript": transcript, "language": lang, "batch_id": None, "drafts": [],
              "errors": [], "answer": None, "voice_text": None}
    if transcript.startswith("error:"):
        result["transcript"] = ""
        result["errors"].append(texts._("Rasmni o'qib bo'lmadi. Aniqroq suratga olib qayta yuboring yoki ovoz bilan ayting.", lang))
        return result
    valid = []
    for ev in parsed["events"]:
        norm, err = validate_event(ev, today)
        if err:
            result["errors"].append(err)
        else:
            valid.append(norm)
    if valid:
        result["batch_id"], result["drafts"] = save_drafts(shop_id, valid, "photo")
    elif not result["errors"]:
        result["errors"].append("Rasmda summa topilmadi. Chek, nakladnoy yoki Payme/Click skrinshotini yuboring.")
    result["errors"] = texts.tr_list(result["errors"], lang)
    return result


def reject(shop_id: int, ids: list[int] | None = None, batch_id: str | None = None) -> int:
    drafts = get_drafts(shop_id, ids=ids, batch_id=batch_id)
    for d in drafts:
        db.execute("DELETE FROM drafts WHERE id=?", (d["id"],))
    if drafts:
        db.audit(shop_id, "owner", "drafts_rejected", {"ids": [d["id"] for d in drafts]})
    return len(drafts)


def confirm(shop_id: int, ids: list[int] | None = None, batch_id: str | None = None,
            today: date | None = None) -> dict:
    """Превратить черновики в записи. -> {confirmed: [...], errors: [...], new_debts_with_phone: [...]}"""
    today = today or date.today()
    drafts = get_drafts(shop_id, ids=ids, batch_id=batch_id)
    confirmed, errors, phone_debts = [], [], []
    for d in drafts:
        try:
            res = _materialize(shop_id, d, today)
        except ValueError as exc:
            errors.append(str(exc))
            res = None
        db.execute("DELETE FROM drafts WHERE id=?", (d["id"],))
        if res:
            confirmed.append(res)
            if res.get("debt_id") and d["type"] == "debt_given" and d.get("phone"):
                phone_debts.append({"debt_id": res["debt_id"], "person": d["person"], "phone": d["phone"]})
    db.audit(shop_id, "owner", "drafts_confirmed", {"confirmed": confirmed, "errors": errors})
    return {"confirmed": confirmed, "errors": errors, "new_debts_with_phone": phone_debts}


def _materialize(shop_id: int, d: dict, today: date) -> dict:
    t, amount, source = d["type"], d["amount"], d["source"]
    now, day = db.now_str(), today.isoformat()

    if t in ("sale", "expense"):
        is_sched, paid_id = 0, None
        if t == "expense" and d.get("person"):
            for p in db.query("SELECT * FROM scheduled_payments WHERE shop_id=? AND status='pending' ORDER BY due_date",
                              (shop_id,)):
                if names_match(p["counterparty"], d["person"]):
                    db.execute("UPDATE scheduled_payments SET status='paid' WHERE id=?", (p["id"],))
                    is_sched, paid_id = 1, p["id"]
                    break
        note = d.get("note") or d.get("person")
        when = d.get("date") or day        # «kecha» — запись за вчера (дописанный пропуск)
        eid = db.execute(
            "INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (shop_id, t, amount, d["category"], note, when, source, "confirmed", is_sched, now))
        return {"type": t, "entry_id": eid, "amount": amount, "scheduled_payment_paid": paid_id, "date": when}

    if t == "debt_given":
        did = db.execute(
            "INSERT INTO debts (shop_id, person_name, phone, sms_consent, amount, remaining, created_at, status) "
            "VALUES (?,?,?,?,?,?,?, 'open')",
            (shop_id, d["person"], d.get("phone"), 0, amount, amount, now))
        return {"type": t, "debt_id": did, "amount": amount, "person": d["person"]}

    if t == "debt_returned":
        debts = [r for r in db.query(
            "SELECT * FROM debts WHERE shop_id=? AND status='open' AND remaining>0 ORDER BY created_at", (shop_id,))
            if names_match(r["person_name"], d["person"])]
        if not debts:
            raise ValueError(f"{d['person']} nomida ochiq qarz topilmadi — yozuv saqlanmadi.")
        left, paid = amount, []
        close_source = source if source in ("voice", "photo", "link") else "voice"
        for r in debts:
            if left <= 0:
                break
            pay = min(left, r["remaining"])
            remaining = r["remaining"] - pay
            if remaining == 0:
                db.execute("UPDATE debts SET remaining=0, status='closed', closed_at=?, close_source=? WHERE id=?",
                           (now, close_source, r["id"]))
            else:
                db.execute("UPDATE debts SET remaining=? WHERE id=?", (remaining, r["id"]))
            db.execute("INSERT INTO debt_payments (debt_id, shop_id, amount, date, source, created_at) VALUES (?,?,?,?,?,?)",
                       (r["id"], shop_id, pay, day, source, now))
            paid.append({"debt_id": r["id"], "paid": pay, "remaining": remaining})
            left -= pay
        return {"type": t, "amount": amount - left, "person": d["person"], "debts": paid,
                "overpaid": left if left > 0 else 0}

    if t == "scheduled_payment":
        title = d.get("note") or (f"{d['person']}ga to'lov" if d.get("person") else "To'lov")
        pid = db.execute(
            "INSERT INTO scheduled_payments (shop_id, title, counterparty, amount, due_date, source, status) "
            "VALUES (?,?,?,?,?,?, 'pending')",
            (shop_id, title, d.get("person") or d.get("note"), amount, d["due_date"], source))
        return {"type": t, "payment_id": pid, "amount": amount, "due_date": d["due_date"]}

    if t == "recurring_payment":
        try:
            r = recurring.create(shop_id, {"title": d.get("note"), "category": d.get("category"), "amount": amount,
                                           "period": d.get("period"), "day": d.get("day")}, source=source)
        except recurring.RecurringError as exc:
            raise ValueError(str(exc)) from None
        return {"type": t, "recurring_id": r["id"], "amount": amount, "period": r["period"], "day": r["day"]}

    raise ValueError(f"Noma'lum tur: {t}")


def set_sms_consent(shop_id: int, debt_id: int, consent: bool) -> bool:
    row = db.query_one("SELECT id FROM debts WHERE id=? AND shop_id=?", (debt_id, shop_id))
    if not row:
        return False
    db.execute("UPDATE debts SET sms_consent=? WHERE id=?", (int(consent), debt_id))
    db.audit(shop_id, "owner", "sms_consent", {"debt_id": debt_id, "consent": consent})
    return True


# --- офферы ------------------------------------------------------------------------

def save_offer(shop_id: int, offer: dict) -> int:
    value = offer.get("cost") if offer["type"] == "overdraft" else offer.get("income")
    oid = db.execute(
        "INSERT INTO offers (shop_id, type, amount, term_days, cost_or_income, risk_text, status, created_at) "
        "VALUES (?,?,?,?,?,?, 'proposed', ?)",
        (shop_id, offer["type"], offer["amount"], offer["term_days"], int(value or 0),
         offer.get("risk_text") or offer.get("early_withdrawal"), db.now_str()))
    db.audit(shop_id, "system", "offer_proposed", {"offer_id": oid, **offer})
    return oid


class OfferConflict(Exception):
    """Уже есть активный овердрафт — второй не выдаём."""


OVERDRAFT_MAX_AMOUNT = 50_000_000
BANK_OK = "Bank tasdiqladi (demo)"


def build_offer(offer_type: str, amount: int, term_days: int | None = None) -> dict:
    """Пересчитать оффер по константам logic: клиенту доверяем только тип, сумму и срок."""
    if offer_type == "overdraft":
        if not (0 < amount <= OVERDRAFT_MAX_AMOUNT):
            raise ValueError(f"Overdraft summasi 1 dan {OVERDRAFT_MAX_AMOUNT:,} so'mgacha bo'lishi kerak.")
        return logic.overdraft_offer(amount, term_days or logic.OVERDRAFT["max_days"])
    if offer_type == "deposit":
        if not (0 < amount < MAX_AMOUNT):
            raise ValueError("Omonat summasi noto'g'ri.")
        return logic.deposit_offer(int(amount))
    raise ValueError(f"Noma'lum taklif turi: {offer_type!r}")


def _active_overdraft(shop_id: int, today: date) -> dict | None:
    return db.query_one("SELECT * FROM cash_flows WHERE shop_id=? AND kind='overdraft_repay' AND date>=?",
                        (shop_id, today.isoformat()))


def _apply_offer(shop_id: int, offer_id: int, offer: dict, today: date) -> dict:
    """Записать денежные потоки принятого оффера — logic учитывает их в остатке и прогнозе."""
    now, d0 = db.now_str(), today.isoformat()
    end = (today + timedelta(days=offer["term_days"])).isoformat()
    if offer["type"] == "overdraft":
        flows = [("overdraft_in", offer["amount"], d0), ("overdraft_repay", -(offer["amount"] + offer["cost"]), end)]
    else:
        flows = [("deposit_out", -offer["amount"], d0), ("deposit_return", offer["amount"] + offer["income"], end)]
    for kind, amount, day in flows:
        db.execute("INSERT INTO cash_flows (shop_id, offer_id, kind, amount, date, note, created_at) VALUES (?,?,?,?,?,?,?)",
                   (shop_id, offer_id, kind, amount, day, offer["name"], now))
    return {"start_date": d0, "end_date": end,
            "flows": [{"kind": k, "amount": a, "date": d} for k, a, d in flows]}


def _insert_offer(shop_id: int, offer: dict, status: str) -> int:
    value = offer.get("cost") if offer["type"] == "overdraft" else offer.get("income")
    return db.execute(
        "INSERT INTO offers (shop_id, type, amount, term_days, cost_or_income, risk_text, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (shop_id, offer["type"], offer["amount"], offer["term_days"], int(value or 0),
         offer.get("risk_text") or offer.get("early_withdrawal"), status, db.now_str()))


def _accept(shop_id: int, offer_id: int, offer: dict, today: date) -> dict:
    if offer["type"] == "overdraft" and _active_overdraft(shop_id, today):
        raise OfferConflict("Sizda faol overdraft bor — avval uni qaytaring.")
    applied = _apply_offer(shop_id, offer_id, offer, today)
    db.execute("UPDATE offers SET status='accepted' WHERE id=?", (offer_id,))
    fm = logic.free_money(shop_id, today=today)
    result = {"status": "accepted", "offer_id": offer_id, "bank": BANK_OK, **offer, **applied,
              "free_money_after": fm["free_money"], "horizon": fm["horizon"]}
    db.audit(shop_id, "owner", "offer_accepted", result)
    return result


def accept_offer(shop_id: int, offer_type: str, amount: int, term_days: int | None = None,
                 today: date | None = None) -> dict:
    """API: принять оффер (mock-банк сразу «tasdiqladi»). ValueError / OfferConflict."""
    today = today or date.today()
    offer = build_offer(offer_type, int(amount), term_days)
    if offer["type"] == "overdraft" and _active_overdraft(shop_id, today):
        raise OfferConflict("Sizda faol overdraft bor — avval uni qaytaring.")
    oid = _insert_offer(shop_id, offer, "proposed")
    return _accept(shop_id, oid, offer, today)


def decline_offer(shop_id: int, offer_type: str, amount: int, term_days: int | None = None) -> dict:
    offer = build_offer(offer_type, int(amount), term_days)
    oid = _insert_offer(shop_id, offer, "declined")
    db.audit(shop_id, "owner", "offer_declined", {"offer_id": oid, **offer})
    return {"status": "declined", "offer_id": oid, "type": offer["type"]}


def set_offer_status(shop_id: int, offer_id: int, accepted: bool, today: date | None = None) -> dict | None:
    """Бот: принять/отклонить ранее показанный оффер. Принятие — тем же путём, что и в API."""
    row = db.query_one("SELECT * FROM offers WHERE id=? AND shop_id=?", (offer_id, shop_id))
    if not row or row["status"] != "proposed":
        return row
    if accepted:
        offer = build_offer(row["type"], row["amount"], row["term_days"])
        try:
            res = _accept(shop_id, offer_id, offer, today or date.today())
        except OfferConflict as exc:
            return {**row, "error": str(exc)}
        return {**row, "status": "accepted", "result": res}
    db.execute("UPDATE offers SET status='declined' WHERE id=?", (offer_id,))
    db.audit(shop_id, "owner", "offer_declined", {"offer_id": offer_id})
    return {**row, "status": "declined"}


# --- вопросы: цифры считает код, ИИ только формулирует -----------------------------

def build_facts(shop_id: int, question_date: str | None = None, today: date | None = None) -> dict:
    today = today or date.today()
    fm = logic.free_money(shop_id, today=today)

    def fm_view(f: dict) -> dict:
        free = f["free_money"]
        return {
            "sana": f["horizon"], "hafta_kuni": f["horizon_weekday"],
            "bo'sh_pul": round1000(free), "yetadimi": free >= 0,
            "yetmaydigan_summa": round1000(-free) if free < 0 else 0,
            "shu_kungacha_to'lovlar": [
                {"kimga": p["counterparty"] or p["title"], "summa": round1000(p["amount"]), "sana": p["due_date"]}
                for p in f["payments"]],
        }

    facts = {
        "bugun": today.isoformat(),
        "hisobda_hozir": round1000(fm["cash_now"]),
        "keyingi_to'lovgacha": fm_view(fm),
        "sotuv": {}, "xarajat": {}, "foyda": {},
        "jami_qarzdorlik": round1000(fm["total_receivable"]),
        "qarzdorlar": [
            {"ism": r["person_name"], "qarz": round1000(r["remaining"]), "necha_kun": r["days_open"]}
            for r in logic.open_debts(shop_id, today)],
        "kutilayotgan_to'lovlar": [
            {"kimga": p["counterparty"] or p["title"], "summa": round1000(p["amount"]), "sana": p["due_date"]}
            for p in db.query("SELECT * FROM scheduled_payments WHERE shop_id=? AND status='pending' ORDER BY due_date",
                              (shop_id,))],
    }
    for key, period in (("bugun", "today"), ("shu_hafta", "week"), ("shu_oy", "month")):
        t = logic.totals(shop_id, period, today)
        facts["sotuv"][key] = round1000(t["sales"])
        facts["xarajat"][key] = round1000(t["expenses"])
        facts["foyda"][key] = round1000(t["profit"])
    if question_date:
        try:
            qd = datetime.strptime(question_date[:10], "%Y-%m-%d").date()
            if qd >= today:
                facts["savoldagi_sanagacha"] = fm_view(logic.free_money(shop_id, horizon_date=qd, today=today))
        except ValueError:
            pass
    return facts


def fallback_answer(question: str, facts: dict, lang: str = "uz") -> str:
    """Детерминированный ответ без ИИ (если Gemini недоступен или придумал цифры)."""
    q = question.lower()
    _ = texts._

    def m(x):
        return texts.fmt_money(x, lang)

    if any(w in q for w in ("qarz", "долж", "долг", "қарз")):
        debtors = facts["qarzdorlar"]
        if not debtors:
            return _("Hozir sizga hech kim qarz emas.", lang)
        lines = [_("Sizga jami {total} qarz bor:", lang, total=m(facts["jami_qarzdorlik"]))]
        lines += [f"• {d['ism']} — {m(d['qarz'])} ({texts.days(d['necha_kun'], lang)})" for d in debtors]
        return "\n".join(lines)
    if any(w in q for w in ("yetadi", "yetarmi", "хватит", "хватает", "етади")):
        f = facts.get("savoldagi_sanagacha") or facts["keyingi_to'lovgacha"]
        if f["yetadimi"]:
            return _("Ha, {date} gacha yetadi: bo'sh pul {free}.", lang, date=f["sana"], free=m(f["bo'sh_pul"]))
        return _("Yo'q, {date} gacha {gap} yetmaydi.", lang, date=f["sana"], gap=m(f["yetmaydigan_summa"]))
    if any(w in q for w in ("sot", "прода", "выручк", "сот")):
        s = facts["sotuv"]
        return _("Sotuv: bugun {today}, shu hafta {week}, shu oy {month}.", lang,
                 today=m(s["bugun"]), week=m(s["shu_hafta"]), month=m(s["shu_oy"]))
    if any(w in q for w in ("xarajat", "расход", "потрат", "харажат")):
        s = facts["xarajat"]
        return _("Xarajat: bugun {today}, shu hafta {week}, shu oy {month}.", lang,
                 today=m(s["bugun"]), week=m(s["shu_hafta"]), month=m(s["shu_oy"]))
    f = facts["keyingi_to'lovgacha"]
    return _("Hisobingizda hozir {cash}. {date} gacha bo'sh pul: {free}.", lang,
             cash=m(facts["hisobda_hozir"]), date=f["sana"], free=m(f["bo'sh_pul"]))


async def answer_full(shop_id: int, question: str, question_date: str | None = None,
                      today: date | None = None, lang: str = "uz") -> tuple[str, dict]:
    facts = build_facts(shop_id, question_date, today)
    try:
        text = await ai.answer_question(question, facts, lang=lang)
    except ai.AIUnavailable:
        return fallback_answer(question, facts, lang), facts
    if not ai.answer_uses_only_facts(text, facts):
        log.warning("AI javobida faktlarda yo'q raqam bor, shablon javob ishlatildi: %s", text)
        return fallback_answer(question, facts, lang), facts
    return text, facts


async def answer(shop_id: int, question: str, question_date: str | None = None, today: date | None = None,
                 lang: str = "uz") -> str:
    return (await answer_full(shop_id, question, question_date, today, lang=lang))[0]


DEBT_WORDS = ("qarz", "долж", "долг", "қарз")


def voice_text(question: str, answer_text: str, facts: dict, top: int = 3, lang: str = "uz") -> str:
    """Текст для озвучки. Списки на слух — топ-3 и общая сумма (цифры — только из facts, как и в тексте)."""
    debtors = sorted(facts.get("qarzdorlar") or [], key=lambda d: -d["qarz"])
    if debtors and any(w in question.lower() for w in DEBT_WORDS):
        def m(x):
            return texts.fmt_money(x, lang)
        names = ", ".join(f"{d['ism']} — {m(d['qarz'])}" for d in debtors[:top])
        rest = len(debtors) - top
        tail = texts._(", va yana {n} kishi.", lang, n=rest) if rest > 0 else "."
        return texts._("Sizga jami {total} qarz bor. Eng kattalari: {names}", lang,
                       total=m(facts["jami_qarzdorlik"]), names=names) + tail
    return tts.for_voice(answer_text, lang=lang)
