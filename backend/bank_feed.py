"""Безналичные поступления (mock банковского фида: UzQR / терминал / Uzcard).

Карта и QR приходят сами — владельцу не нужно их записывать: запись source='bank' (метка «tasdiqlangan»).
В демо (DEMO_FEED=1) раз в DEMO_FEED_SECONDS добавляется небольшая безналичная продажа для DEV_SHOP_ID —
её видно в живой ленте /app. Голос и фото — для наличных, расходов и долгов.
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import date

import config
import db

log = logging.getLogger("flowcast.bank_feed")
CHANNELS = ("UzQR", "Uzcard terminal", "Humo terminal", "UzQR (Payme)", "UzQR (Click)")
_rng = random.Random()


def add_bank_sale(shop_id: int, amount: int | None = None, today: date | None = None,
                  rng: random.Random | None = None) -> dict:
    rng = rng or _rng
    amount = amount or rng.randrange(10, 51) * 1000          # мелкая безналичная продажа: 10–50 тыс.
    note = rng.choice(CHANNELS)
    day = (today or date.today()).isoformat()
    eid = db.execute(
        "INSERT INTO entries (shop_id, kind, amount, category, note, date, source, status, is_scheduled, created_at) "
        "VALUES (?, 'sale', ?, 'tovar', ?, ?, 'bank', 'confirmed', 0, ?)", (shop_id, amount, note, day, db.now_str()))
    db.audit(shop_id, "system", "bank_payment", {"entry_id": eid, "amount": amount, "channel": note})
    return {"entry_id": eid, "amount": amount, "note": note, "date": day}


async def feed_loop(shop_id: int | None = None, every: int | None = None) -> None:
    shop_id = shop_id or config.DEV_SHOP_ID
    every = every or config.DEMO_FEED_SECONDS
    while True:
        await asyncio.sleep(every)
        try:
            if db.get_shop(shop_id):
                add_bank_sale(shop_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("bank feed")
