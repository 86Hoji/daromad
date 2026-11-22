"""REST API для будущего Mini App / сайта. Префикс /api.

Идентификация: заголовок X-Telegram-Init-Data (подпись проверяется по BOT_TOKEN),
без заголовка — бизнес DEV_SHOP_ID (режим сайта/демо).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import date, timedelta
from typing import Any, Literal
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

import ai
import config
import db
import logic
import pipeline
import texts
import tts

router = APIRouter(prefix="/api")

INIT_DATA_MAX_AGE = 24 * 3600
MONEY_KEYS = {
    "free_money", "cash_now", "expected_sales", "expected_expenses", "payments_due", "total_receivable",
    "remaining", "balance", "gap", "receivable", "cost", "income", "sales", "expenses", "profit", "amount",
}


# --- авторизация ------------------------------------------------------------------

def validate_init_data(init_data: str, bot_token: str, max_age: int | None = INIT_DATA_MAX_AGE) -> dict:
    """Стандартная проверка Telegram WebApp initData. -> dict полей (user уже распарсен)."""
    pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=False))
    received = pairs.pop("hash", None)
    if not received or not bot_token:
        raise ValueError("hash yoki BOT_TOKEN yo'q")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received):
        raise ValueError("imzo noto'g'ri")
    if max_age is not None:
        auth_date = int(pairs.get("auth_date", "0") or 0)
        if time.time() - auth_date > max_age:
            raise ValueError("initData eskirgan")
    if "user" in pairs:
        pairs["user"] = json.loads(pairs["user"])
    return pairs


def current_shop(x_telegram_init_data: str | None = Header(default=None)) -> dict:
    if x_telegram_init_data:
        try:
            data = validate_init_data(x_telegram_init_data, config.BOT_TOKEN)
        except (ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=401, detail=f"Telegram initData yaroqsiz: {exc}")
        user = data.get("user") or {}
        shop = db.get_shop_by_tg(int(user.get("id", 0)))
        if not shop:
            raise HTTPException(status_code=404, detail="Biznes topilmadi — avval botda /start bosing.")
        return shop
    shop = db.get_shop(config.DEV_SHOP_ID)
    if not shop:
        raise HTTPException(status_code=404, detail="Demo biznes yo'q — `python seed.py --reset` ishga tushiring.")
    return shop


def require_debt_owner(debt_id: int, shop: dict = Depends(current_shop)) -> dict:
    """Маршруты /api/debts/{debt_id}/remind*: долг должен принадлежать магазину из initData.
    Чужой или несуществующий долг — одинаково 404 not_found (не раскрываем, что такой id есть)."""
    from extras.payments import ExtrasError

    debt = db.query_one("SELECT shop_id FROM debts WHERE id=?", (debt_id,))
    if not debt or debt["shop_id"] != shop["id"]:
        raise ExtrasError("not_found", "debt not found")
    return shop


# --- утилиты ---------------------------------------------------------------------

def rounded(obj: Any) -> Any:
    """Округлить денежные поля до 1000 сум (для отображения)."""
    if isinstance(obj, dict):
        return {k: (logic.round1000(v) if k in MONEY_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool)
                    else rounded(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rounded(v) for v in obj]
    return obj


def mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    if len(phone) >= 13:
        return f"{phone[:4]} {phone[4:6]} *** ** {phone[-2:]}"
    return phone[:3] + "***" + phone[-2:]


def shop_view(shop: dict) -> dict:
    return {k: shop[k] for k in ("id", "name", "owner_name", "opening_cash", "created_at")}


# --- чтение ------------------------------------------------------------------------

@router.get("/summary")
def summary(shop: dict = Depends(current_shop)) -> dict:
    fm = logic.free_money(shop["id"])
    return rounded({
        "shop": shop_view(shop),
        "free_money": fm["free_money"],
        "horizon": fm["horizon"],
        "horizon_weekday": fm["horizon_weekday"],
        "cash_now": fm["cash_now"],
        "expected_sales": fm["expected_sales"],
        "expected_expenses": fm["expected_expenses"],
        "payments_due": fm["payments_due"],
        "payments": fm["payments"],
        "total_receivable": fm["total_receivable"],
        "top_debtors": fm["top_debtors"],
        "periods": {p: logic.totals(shop["id"], p) for p in ("today", "week", "month")},
        "trust_share": logic.trust_share(shop["id"]),
    })


@router.get("/forecast")
def forecast(days: int = Query(14, ge=1, le=60), shop: dict = Depends(current_shop)) -> dict:
    return rounded(logic.forecast(shop["id"], days=days))


@router.get("/debts")
def debts(shop: dict = Depends(current_shop)) -> dict:
    today = date.today()
    rows = db.query("SELECT * FROM debts WHERE shop_id=? ORDER BY status DESC, remaining DESC", (shop["id"],))
    items = []
    for r in rows:
        end = r["closed_at"] or today.isoformat()
        items.append({
            "id": r["id"], "person_name": r["person_name"], "phone": mask_phone(r["phone"]),
            "sms_consent": bool(r["sms_consent"]), "amount": r["amount"], "remaining": r["remaining"],
            "status": r["status"], "created_at": r["created_at"], "closed_at": r["closed_at"],
            "close_source": r["close_source"], "days_open": max(0, logic.days_between(r["created_at"], end)),
        })
    open_items = [i for i in items if i["status"] == "open"]
    return {"total_receivable": sum(i["remaining"] for i in open_items), "open_count": len(open_items),
            "debts": items}


@router.get("/entries")
def entries(period: str = Query("week", pattern="^(today|week|month)$"), shop: dict = Depends(current_shop)) -> dict:
    start = logic.period_start(period)
    rows = db.query(
        "SELECT * FROM entries WHERE shop_id=? AND date>=? AND date<=? ORDER BY date DESC, id DESC",
        (shop["id"], start.isoformat(), date.today().isoformat()))
    by_cat: dict[str, dict[str, int]] = {"sale": {}, "expense": {}}
    for r in rows:
        r["trust"] = db.trust_label(r["source"])
        r["is_scheduled"] = bool(r["is_scheduled"])
        if r["status"] == "confirmed":
            by_cat[r["kind"]][r["category"]] = by_cat[r["kind"]].get(r["category"], 0) + r["amount"]
    return {"period": period, **logic.totals(shop["id"], period),
            "by_category": by_cat, "entries": rows}


@router.get("/recommendation")
def recommendation(shop: dict = Depends(current_shop)) -> dict:
    return rounded(logic.recommendation(shop["id"]))


@router.get("/audit")
def audit(limit: int = Query(100, ge=1, le=1000), shop: dict = Depends(current_shop)) -> dict:
    rows = db.query("SELECT * FROM audit_log WHERE shop_id=? ORDER BY id DESC LIMIT ?", (shop["id"], limit))
    for r in rows:
        try:
            r["payload"] = json.loads(r.pop("payload_json") or "null")
        except json.JSONDecodeError:
            r["payload"] = None
    return {"items": rows}


# --- ввод (тот же конвейер, что в боте) -------------------------------------------

class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class IdsIn(BaseModel):
    ids: list[int] = Field(min_length=1)


def ui_lang(accept_language: str | None = Header(None)) -> str:
    """Язык интерфейса (фронт шлёт Accept-Language: ru|uz|en): ru -> русский, остальное -> узбекский."""
    return texts.norm_lang(accept_language)


async def _run(shop: dict, lang: str, **kwargs) -> dict:
    try:
        return await pipeline.process(shop["id"], lang=lang, **kwargs)
    except ai.AIUnavailable as exc:
        raise HTTPException(status_code=503, detail=texts._(str(exc), lang))


@router.post("/text")
async def post_text(body: TextIn, shop: dict = Depends(current_shop), lang: str = Depends(ui_lang)) -> dict:
    return await _run(shop, lang, text=body.text, source="text")


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=tts.MAX_CHARS)
    format: Literal["wav", "ogg"] = "wav"


@router.post("/tts")
async def post_tts(body: TtsIn, shop: dict = Depends(current_shop)) -> Response:
    """Озвучка ответа. По умолчанию WAV — играет в любом браузере и WebView (OGG/Opus — для Telegram).
    503 — TTS недоступен (фронт просто прячет кнопку)."""
    data = await tts.synthesize(tts.for_voice(body.text), fmt=body.format)
    if not data:
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return Response(content=data, media_type=tts.audio_mime(data), headers={"Cache-Control": "private, max-age=3600"})


@router.post("/demo/reset")
def demo_reset(shop: dict = Depends(current_shop)) -> dict:
    """Сброс демо-данных к сценарию «нехватка в четверг». Выключен, пока DEMO_RESET!=1; только демо-бизнес.
    Привязка демо-бизнеса к Telegram-пользователю сохраняется (seed.wipe возвращает tg_user_id)."""
    if not config.DEMO_RESET:
        raise HTTPException(status_code=404, detail="Not Found")
    if shop["id"] != config.DEV_SHOP_ID:
        raise HTTPException(status_code=403, detail="Faqat demo biznes uchun")
    import seed

    seed.seed(reset=True, shop_id=config.DEV_SHOP_ID)
    db.audit(config.DEV_SHOP_ID, "owner", "demo_reset", {})
    return {"ok": True, "free_money": round(logic.free_money(config.DEV_SHOP_ID)["free_money"], -3)}


@router.post("/voice")
async def post_voice(audio: UploadFile = File(...), shop: dict = Depends(current_shop),
                     lang: str = Depends(ui_lang)) -> dict:
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail=texts._("Bo'sh audio fayl", lang))
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail=texts._("Audio juda katta (20 MB gacha)", lang))
    mime = (audio.content_type or "audio/ogg").split(";")[0]
    return await _run(shop, lang, audio=data, mime_type=mime, source="voice")


@router.post("/entries/confirm")
def confirm(body: IdsIn, shop: dict = Depends(current_shop), lang: str = Depends(ui_lang)) -> dict:
    res = pipeline.confirm(shop["id"], ids=body.ids)
    res["errors"] = texts.tr_list(res["errors"], lang)
    if not res["confirmed"] and not res["errors"]:
        raise HTTPException(status_code=404, detail=texts._("Bunday kutilayotgan yozuvlar yo'q", lang))
    res["recommendation"] = rounded(logic.recommendation(shop["id"]))
    return res


@router.post("/entries/reject")
def reject(body: IdsIn, shop: dict = Depends(current_shop)) -> dict:
    return {"rejected": pipeline.reject(shop["id"], ids=body.ids)}


# --- банковские офферы (mock-банк) --------------------------------------------------

class OfferIn(BaseModel):
    type: Literal["overdraft", "deposit"]
    amount: int = Field(gt=0)
    term_days: int | None = Field(default=None, ge=1, le=365)


@router.post("/offers/accept")
def offers_accept(body: OfferIn, shop: dict = Depends(current_shop)) -> dict:
    """Принять оффер: offers(accepted) + cash_flows (logic учитывает их в прогнозе) + audit_log."""
    try:
        res = pipeline.accept_offer(shop["id"], body.type, body.amount, body.term_days)
    except pipeline.OfferConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    res["recommendation"] = rounded(logic.recommendation(shop["id"]))
    return res


@router.post("/offers/decline")
def offers_decline(body: OfferIn, shop: dict = Depends(current_shop)) -> dict:
    try:
        return pipeline.decline_offer(shop["id"], body.type, body.amount, body.term_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
