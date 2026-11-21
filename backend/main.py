"""Flowcast: FastAPI + Telegram-бот в одном процессе.

Запуск (из папки backend):  uvicorn main:app
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import api
import config
import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("flowcast")


async def _run_bot(bot, dp) -> None:
    try:
        from bot import setup_commands
        me = await bot.get_me()
        log.info("Bot @%s ishga tushdi (long polling)", me.username)
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
    if config.BOT_TOKEN:
        from bot import create_bot
        bot, dp = create_bot()
        task = asyncio.create_task(_run_bot(bot, dp))
    else:
        log.warning("BOT_TOKEN bo'sh — faqat API ishlaydi.")
    try:
        yield
    finally:
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


@app.get("/")
def health() -> dict:
    return {"ok": True, "service": "flowcast", "bot": bool(config.BOT_TOKEN), "ai": bool(config.GEMINI_API_KEY),
            "model": config.GEMINI_MODEL}
