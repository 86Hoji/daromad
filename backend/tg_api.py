"""Адреса для Telegram Mini App (/tg), которых нет в api.py. Отдельный роутер, чтобы не мешать правкам сайта.

POST /api/photo          — фото чека / накладной / скриншота Payme-Click -> черновики (как фото в боте:
                           pipeline.process_photo; ничего не сохраняется до «To'g'ri» /api/entries/confirm)
GET  /api/tg/period?days — выручка / расходы / прибыль и подтверждённые записи за последние 7 или 30 дней
                           (карточки Главной и лента «Операции»; /api/entries считает с понедельника / с 1-го)
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

import ai
import api
import db
import pipeline
import texts
from extras import clock
from extras.vision import MAX_IMAGE_BYTES

router = APIRouter(prefix="/api")


@router.post("/photo")
async def post_photo(image: UploadFile = File(...), shop: dict = Depends(api.current_shop),
                     lang: str = Depends(api.ui_lang)) -> dict:
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty_image")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image_too_large")
    mime = (image.content_type or "").split(";")[0] or None      # пусто — vision определит по байтам
    try:
        return await pipeline.process_photo(shop["id"], data, mime, today=clock.today(), lang=lang)
    except ai.AIUnavailable as exc:
        raise HTTPException(status_code=503, detail=texts._(str(exc), lang))


@router.get("/tg/period")
def period(days: int = Query(7, ge=1, le=92), shop: dict = Depends(api.current_shop)) -> dict:
    """Последние `days` дней включая сегодня. Только подтверждённые записи — как в logic.totals.
    «Сегодня» — та же date.today(), что у /api/summary, чтобы цифры совпадали с остальным экраном."""
    today = date.today()
    start = today - timedelta(days=days - 1)
    rows = db.query(
        "SELECT id, kind, amount, category, note, date, source, created_at FROM entries "
        "WHERE shop_id=? AND status='confirmed' AND date>=? AND date<=? ORDER BY date DESC, id DESC",
        (shop["id"], start.isoformat(), today.isoformat()))
    sales = sum(r["amount"] for r in rows if r["kind"] == "sale")
    expenses = sum(r["amount"] for r in rows if r["kind"] == "expense")
    for r in rows:
        r["trust"] = db.trust_label(r["source"])
    return {"days": days, "from": start.isoformat(), "to": today.isoformat(),
            "sales": sales, "expenses": expenses, "profit": sales - expenses, "entries": rows}
