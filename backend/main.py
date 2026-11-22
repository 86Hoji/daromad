"""Flowcast: FastAPI + Telegram-бот в одном процессе.

Запуск (из папки backend):  uvicorn main:app
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import api
import config
import db
import tg_api
from extras import adapters, payments, reminders
from extras.payments import ExtrasError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("flowcast")


async def _run_bot(bot, dp) -> None:
    try:
        from bot import setup_commands
        from bot import install_owner_notifier
        me = await bot.get_me()
        log.info("Bot @%s ishga tushdi (long polling)", me.username)
        install_owner_notifier(bot, asyncio.get_running_loop())
        await setup_commands(bot)
        await dp.start_polling(bot, handle_signals=False)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("Bot ishga tushmadi (BOT_TOKEN to'g'rimi?). API ishlashda davom etadi.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if not config.GEMINI_API_KEY:
        log.warning("GEMINI_API_KEY bo'sh — ovoz/matnni tanish ishlamaydi.")
    task = bot = dp = None
    background: list[asyncio.Task] = []
    if config.BOT_TOKEN:
        from bot import create_bot, nudge_loop
        bot, dp = create_bot()
        task = asyncio.create_task(_run_bot(bot, dp))
        background.append(asyncio.create_task(nudge_loop(bot)))      # утренний вопрос про пропущенный день
    else:
        log.warning("BOT_TOKEN bo'sh — faqat API ishlaydi.")
    if config.DEMO_FEED:
        import bank_feed
        log.info("DEMO_FEED: har %s s — karta/QR savdo (mock)", config.DEMO_FEED_SECONDS)
        background.append(asyncio.create_task(bank_feed.feed_loop()))
    try:
        yield
    finally:
        for t in background:
            t.cancel()
        adapters.set_notifier(None)
        if task:
            try:
                await dp.stop_polling()
            except (RuntimeError, LookupError):
                pass
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
            await bot.session.close()


app = FastAPI(title="Flowcast API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(api.router)
# SMS-напоминания (backend/extras): только владелец своего долга (initData -> магазин, debt.shop_id == shop.id)
app.include_router(reminders.router, dependencies=[Depends(api.require_debt_owner)])
# оплата по ссылке открыта: её вызывает страница /pay/{token}, которую должник открывает из SMS
app.include_router(payments.router)
# фото чека / накладной из Mini App -> черновики (тот же pipeline, что у фото в боте)
app.include_router(tg_api.router)


@app.exception_handler(ExtrasError)
async def _extras_error(_: Request, exc: ExtrasError) -> JSONResponse:
    return payments.error_response(exc)


@app.get("/")
def health() -> dict:
    return {"ok": True, "service": "flowcast", "bot": bool(config.BOT_TOKEN), "ai": bool(config.GEMINI_API_KEY),
            "model": config.GEMINI_MODEL}
