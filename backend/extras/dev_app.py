"""Отдельный FastAPI для модулей extras (порт 8001), пока они не склеены с основным api.py.

Запуск из backend/:
    extras/.venv/bin/uvicorn extras.dev_app:app --port 8001

    POST /api/debts/{id}/remind/preview   текст SMS и можно ли отправить
    POST /api/debts/{id}/remind           отправить напоминание (SMS + ссылка на 7 дней)
    GET  /api/pay/{token}                 данные для страницы оплаты
    POST /api/pay/{token}/confirm         оплатить (повтор не списывает дважды)
    GET  /pay/{token}                     страница оплаты для должника (по ссылке из SMS)
    GET  /api/dev/debts, POST /api/dev/reset   только для демо

Ошибки: {"error": code, "detail": ...} с кодами not_found, token_expired, debt_closed,
no_phone, no_consent, too_soon, sms_failed.
ВНИМАНИЕ: маршруты владельца (/api/debts/...) здесь без авторизации — при склейке с api.py
они идут через Depends(current_shop) и проверку, что долг принадлежит магазину.
"""
from __future__ import annotations

import html

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from . import adapters, payments, reminders
from .payments import ExtrasError

app = FastAPI(title="Daromad extras (dev)")


@app.exception_handler(ExtrasError)
async def _extras_error(_: Request, exc: ExtrasError) -> JSONResponse:
    return JSONResponse({"error": exc.code, "detail": exc.detail}, status_code=exc.http_status)


@app.post("/api/debts/{debt_id}/remind/preview")
def remind_preview(debt_id: int) -> dict:
    return reminders.preview_reminder(debt_id)


@app.post("/api/debts/{debt_id}/remind")
def remind(debt_id: int) -> dict:
    return reminders.send_reminder(debt_id)


@app.get("/api/pay/{token}")
def pay_info(token: str) -> dict:
    return payments.get_payment(token)


@app.post("/api/pay/{token}/confirm")
def pay_confirm(token: str) -> dict:
    return payments.confirm_payment(token)


@app.get("/api/dev/debts")
def dev_debts() -> dict:
    debts = [adapters.get_debt(i) for i in sorted(adapters._debts)]
    return {"debts": debts, "notifications": adapters.notifications[-20:]}


@app.post("/api/dev/reset")
def dev_reset() -> dict:
    adapters.reset()
    with payments._lock:
        payments._save_tokens({})
    return {"ok": True}


# --- страница оплаты --------------------------------------------------------------------

_ERRORS_UZ = {"not_found": "Havola topilmadi.", "token_expired": "Havola muddati tugagan.",
              "debt_closed": "Bu qarz allaqachon yopilgan."}

_PAGE = """<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Daromad — to'lov</title>
<style>body{{font-family:system-ui,sans-serif;background:#f4f5f7;margin:0;padding:24px 16px;color:#1d1d1f}}
.card{{max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px #0001}}
.sum{{font-size:32px;font-weight:700;margin:8px 0 16px}} .muted{{color:#6b6b70}}
button{{width:100%;padding:14px;border:0;border-radius:12px;background:#0a7d4f;color:#fff;font-size:17px}}
button:disabled{{background:#9aa}} .ok{{color:#0a7d4f;font-weight:600}}</style></head>
<body><div class="card">{body}</div>
<script>
async function pay(){{
  const b=document.getElementById('pay'); b.disabled=true; b.textContent='...';
  const r=await fetch('/api/pay/{token}/confirm',{{method:'POST'}}); const j=await r.json();
  document.querySelector('.card').innerHTML = r.ok
    ? '<p class="ok">To\\'lov qabul qilindi. Rahmat!</p>'
    : '<p>Xatolik: '+(j.error||r.status)+'</p>';
}}
</script></body></html>"""


@app.get("/pay/{token}", response_class=HTMLResponse)
def pay_page(token: str) -> HTMLResponse:
    try:
        p = payments.get_payment(token)
    except ExtrasError as exc:
        body = f"<p>{_ERRORS_UZ.get(exc.code, 'Xatolik.')}</p>"
        return HTMLResponse(_PAGE.format(body=body, token=""), status_code=exc.http_status)
    amount = f"{p['amount']:,}".replace(",", " ")
    shop = html.escape(p["shop_name"] or "Do'kon")
    if p["status"] == "paid":
        body = f"<p class='muted'>{shop}</p><div class='sum'>{amount} so'm</div><p class='ok'>To'langan.</p>"
    elif p["status"] != "open":
        body = f"<p>{_ERRORS_UZ['debt_closed']}</p>"
    else:
        body = (f"<p class='muted'>{shop} — qarz</p><div class='sum'>{amount} so'm</div>"
                f"<button id='pay' onclick='pay()'>To'lash (demo)</button>"
                f"<p class='muted'>Havola {html.escape(p['expires_at'])} gacha amal qiladi.</p>")
    return HTMLResponse(_PAGE.format(body=body, token=html.escape(token)))
