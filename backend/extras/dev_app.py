"""Отдельный FastAPI для модулей extras (порт 8001), пока они не склеены с основным api.py.

Запуск из backend/:
    extras/.venv/bin/uvicorn extras.dev_app:app --port 8001

    POST /api/debts/{id}/remind/preview   текст SMS и можно ли отправить
    POST /api/debts/{id}/remind           отправить напоминание (SMS + ссылка на 7 дней)
    GET  /api/pay/{token}                 данные для страницы оплаты
    POST /api/pay/{token}/confirm         оплатить (повтор не списывает дважды)
    GET  /api/dev/debts, POST /api/dev/reset   только для демо

Ошибки: {"error": code, "detail": ...} с кодами not_found, token_expired, debt_closed,
no_phone, no_consent, too_soon, sms_failed, link_too_long, unauthorized.

Только JSON: страницу оплаты /pay/{token} делает Ходжиакбар в Mini App поверх /api/pay/*.
Доступ: API оплаты (/api/pay) открыт — его вызывает страница, которую должник открывает по ссылке.
Маршруты владельца (/api/debts/...) и демо (/api/dev/...) открыты, пока EXTRAS_ADMIN_TOKEN пуст
(локальная разработка). На публичном адресе задайте EXTRAS_ADMIN_TOKEN в extras/.env — тогда они
требуют заголовок X-Admin-Token, иначе любой сможет слать SMS за ваш счёт.
При склейке с api.py маршруты владельца идут через Depends(current_shop) и проверку, что долг
принадлежит магазину.
"""
from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import adapters, payments, reminders
from .payments import ExtrasError

app = FastAPI(title="Daromad extras (dev)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])  # как в main.py


def _admin_token() -> str:
    payments.public_base_url()                 # подгружает extras/.env
    return os.getenv("EXTRAS_ADMIN_TOKEN", "").strip()


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    expected = _admin_token()
    if expected and not hmac.compare_digest((x_admin_token or "").encode(), expected.encode()):
        raise ExtrasError("unauthorized", "X-Admin-Token required")


@app.exception_handler(ExtrasError)
async def _extras_error(_: Request, exc: ExtrasError) -> JSONResponse:
    return payments.error_response(exc)


# Так же подключается в основном main.py (там вместо require_admin — авторизация магазина).
app.include_router(reminders.router, dependencies=[Depends(require_admin)])
app.include_router(payments.router)


@app.get("/api/dev/debts", dependencies=[Depends(require_admin)])
def dev_debts() -> dict:
    debts = [adapters.get_debt(i) for i in sorted(adapters._debts)]
    for d in debts:
        d["phone"] = reminders.mask_phone(d.get("phone"))
    return {"debts": debts, "notifications": adapters.notifications[-20:]}


@app.post("/api/dev/reset", dependencies=[Depends(require_admin)])
def dev_reset() -> dict:
    adapters.reset()
    with payments._lock:
        payments._save_tokens({})
    return {"ok": True}

