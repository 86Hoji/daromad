"""Telegram-бот Daromad (aiogram 3). Тексты — узбекский (латиница). Все цифры — из logic."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ChatAction, ParseMode
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (BotCommand, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
                           MenuButtonWebApp, Message, WebAppInfo)

import ai
import config
import db
import logic
import pipeline
import uz_numbers
from logic import WEEKDAYS_UZ, fmt_money, round1000

log = logging.getLogger("daromad.bot")
router = Router()


class Onboarding(StatesGroup):
    name = State()
    cash = State()


# --- форматирование ---------------------------------------------------------------

def money(x: int) -> str:
    """Округлённая сумма без «so'm»: 1 200 000."""
    return f"{round1000(x):,}".replace(",", " ")


def exact(x: int) -> str:
    """Точная сумма для карточки подтверждения (что именно сохранится)."""
    return f"{int(x):,}".replace(",", " ") + " so'm"


def esc(s: str | None) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mask_phone(phone: str | None) -> str:
    if not phone or len(phone) < 13:
        return phone or ""
    return f"{phone[:4]} {phone[4:6]} *** ** {phone[-2:]}"


def day_label(iso: str, today: date | None = None, dative: bool = True) -> str:
    """«Payshanbaga» / «Ertaga» / «26.11 gacha»."""
    today = today or date.today()
    d = datetime.strptime(iso[:10], "%Y-%m-%d").date()
    delta = (d - today).days
    if delta <= 0:
        return "Bugunga" if dative else "bugun"
    if delta == 1:
        return "Ertaga" if dative else "ertaga"
    if delta <= 6:
        wd = WEEKDAYS_UZ[d.weekday()]
        return (wd.capitalize() + "ga") if dative else wd
    return d.strftime("%d.%m") + (" gacha" if dative else "")


def event_line(ev: dict) -> str:
    t, amt = ev["type"], exact(ev["amount"])
    person = esc(ev.get("person"))
    if t == "sale":
        line = f"💰 Sotuv — <b>{amt}</b>"
    elif t == "expense":
        line = f"💸 Xarajat ({ev.get('category') or 'boshqa'}"
        line += f", {esc(ev.get('note') or ev.get('person'))})" if (ev.get("note") or ev.get("person")) else ")"
        line += f" — <b>{amt}</b>"
    elif t == "debt_given":
        line = f"🤝 {person} qarzga oldi — <b>{amt}</b>"
        if ev.get("phone"):
            line += f" (📞 {mask_phone(ev['phone'])})"
    elif t == "debt_returned":
        line = f"↩️ {person} qarzini qaytardi — <b>{amt}</b>"
    else:
        who = esc(ev.get("note") or ev.get("person") or "to'lov")
        d = datetime.strptime(ev["due_date"], "%Y-%m-%d").date()
        line = f"📅 To'lov: {who} — <b>{amt}</b>, {WEEKDAYS_UZ[d.weekday()]} ({d.strftime('%d.%m')})"
    line += f" · <i>{ev.get('trust') or db.trust_label(ev.get('source'))}</i>"
    if ev.get("needs_check"):
        line += "\n   ⚠️ summani tekshiring"
    return line


def card_text(result: dict) -> str:
    lines = ["<b>Yozib oldim:</b>"]
    for i, d in enumerate(result["drafts"], 1):
        lines.append(f"{i}. {event_line(d)}")
    if result["errors"]:
        lines.append("")
        lines += [f"❗ {esc(e)}" for e in result["errors"]]
    # сырую расшифровку не показываем: в ней бывают ошибки вида «150000 ming»,
    # а список выше — уже нормализованные события с суммами из кода
    return "\n".join(lines)


def kb(*rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=c) for t, c in row] for row in rows])


def recommendation_message(shop_id: int) -> tuple[str, InlineKeyboardMarkup | None]:
    rec = logic.recommendation(shop_id)
    label = day_label(rec["horizon"])
    if rec["kind"] == "shortage":
        text = f"⚠️ {label} <b>{money(rec['gap'])} so'm</b> yetmaydi."
        top = rec["top_debtors"]
        if rec["receivable"] > 0 and top:
            t = top[0]
            text += (f" Sizga {money(rec['receivable'])} so'm qarz bor, eng ko'p — "
                     f"{esc(t['person_name'])} ({money(t['remaining'])}, {t['days_open']} kun).")
        if rec["covers_by_debts"]:
            text += "\n\nQarzlar yetishmovchilikni yopadi — avval qarzdorlarga eslatma yuboring."
        else:
            text += "\n\nQarzlar yetmaydi — eslatmadan keyin bank overdrafti variant bo'lishi mumkin."
        rows = []
        if rec["debtors_to_remind"]:
            rows.append([("📨 Qarzdorlarga eslatma", "rem")])
        rows.append([("🏦 Overdraft shartlari", "od")])
        return text, kb(*rows)
    if rec["kind"] == "surplus":
        dep = rec["deposit"]
        text = (f"✅ {label} ham yetadi, bo'sh pul: <b>{money(rec['free_money'])} so'm</b>.\n"
                f"{money(dep['amount'])} so'mni omonatga qo'ysangiz, {dep['term_days']} kunda "
                f"~{money(dep['income'])} so'm daromad.")
        return text, kb([("🏦 Omonat shartlari", "dep")])
    return f"✅ {label} yetadi. Bo'sh pul: <b>{money(rec['free_money'])} so'm</b>.", None


def status_text(shop: dict) -> str:
    fm = logic.free_money(shop["id"])
    lines = [
        f"📊 <b>{esc(shop['name'])}</b>",
        f"Hisobingizda: <b>{fmt_money(fm['cash_now'])}</b>",
        f"{day_label(fm['horizon'], dative=False).capitalize()}gacha bo'sh pul: <b>{fmt_money(fm['free_money'])}</b>",
    ]
    if fm["payments"]:
        lines.append("To'lovlar: " + ", ".join(
            f"{esc(p['counterparty'] or p['title'])} {money(p['amount'])} ({day_label(p['due_date'], dative=False)})"
            for p in fm["payments"]))
    if fm["total_receivable"]:
        lines.append(f"Sizga qarz: {fmt_money(fm['total_receivable'])}")
    return "\n".join(lines)


def debts_text(shop_id: int) -> str:
    debts = logic.open_debts(shop_id)
    if not debts:
        return "Hozir sizga hech kim qarz emas. 👍"
    total = sum(d["remaining"] for d in debts)
    lines = [f"Sizga jami <b>{fmt_money(total)}</b> qarz bor:"]
    for d in debts:
        lines.append(f"• {esc(d['person_name'])} — {money(d['remaining'])} ({d['days_open']} kun)")
    return "\n".join(lines)


def current_shop(user_id: int) -> dict | None:
    return db.get_shop_by_tg(user_id)


# --- /start и онбординг ----------------------------------------------------------

INTRO = ("Assalomu alaykum! Men <b>Daromad</b> — kichik va mikro biznes uchun ovozli moliyaviy yordamchiman. "
         "Savdo, xarajat va qarzlarni ovoz bilan yozing — men bo'sh pulingizni oldindan hisoblab, "
         "kerak bo'lsa ogohlantiraman.")

HELP = ("Menga ovozli yoki matnli xabar yuboring, masalan:\n"
        "• «Bugun 2 million 300 ming sotdim»\n"
        "• «Alisher 150 ming qarz oldi»\n"
        "• «Payshanba kuni yetkazib beruvchiga 3 million»\n"
        "• «Kim menga qarz?»  • «Payshanbagacha yetadimi?»\n\n"
        "/holat — hisob holati va bo'sh pul, /qarzlar — qarzdorlar.")


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    shop = current_shop(message.from_user.id)
    if shop:
        await message.answer(f"Assalomu alaykum! 👋\n\n{status_text(shop)}\n\n{HELP}")
        return
    demo = db.get_shop(config.DEV_SHOP_ID)
    if demo and demo["tg_user_id"] is None:
        await message.answer(
            f"{INTRO}\n\nDemo biznes «{esc(demo['name'])}» tayyor. Uni ulaysizmi yoki o'z biznesingizni qo'shasizmi?",
            reply_markup=kb([("🧪 Demo biznesni ulash", "demo")], [("➕ O'z biznesimni qo'shish", "newshop")]))
        return
    await message.answer(INTRO)
    await start_onboarding(message, state)


async def start_onboarding(message: Message, state: FSMContext) -> None:
    await state.set_state(Onboarding.name)
    await message.answer("Biznesingiz nomi?")


@router.callback_query(F.data == "newshop")
async def cb_newshop(cq: CallbackQuery, state: FSMContext) -> None:
    await cq.answer()
    await cq.message.edit_reply_markup(reply_markup=None)
    await start_onboarding(cq.message, state)


@router.callback_query(F.data == "demo")
async def cb_demo(cq: CallbackQuery, state: FSMContext) -> None:
    if current_shop(cq.from_user.id):
        await cq.answer("Sizda biznes allaqachon qo'shilgan.", show_alert=True)
        return
    demo = db.get_shop(config.DEV_SHOP_ID)
    if not demo or demo["tg_user_id"] is not None:
        await cq.answer("Demo biznes band.", show_alert=True)
        return
    db.execute("UPDATE shops SET tg_user_id=? WHERE id=? AND tg_user_id IS NULL", (cq.from_user.id, demo["id"]))
    db.audit(demo["id"], "owner", "demo_linked", {"tg_user_id": cq.from_user.id})
    await cq.answer("Ulandi!")
    await cq.message.edit_reply_markup(reply_markup=None)
    await set_webapp_button(cq.bot, cq.message.chat.id)
    shop = db.get_shop(demo["id"])
    await cq.message.answer(f"✅ Demo biznes ulandi.\n\n{status_text(shop)}")
    text, markup = recommendation_message(shop["id"])
    await cq.message.answer(text, reply_markup=markup)
    await cq.message.answer(HELP)


@router.message(Onboarding.name, F.text)
async def onb_name(message: Message, state: FSMContext) -> None:
    name = message.text.strip()[:80]
    if not name or name.startswith("/"):
        await message.answer("Biznesingiz nomini yozing, masalan: «Dilshod Biznes».")
        return
    await state.update_data(name=name)
    await state.set_state(Onboarding.cash)
    await message.answer("Hozir hisobingizda qancha pul bor? (masalan: «2 million» yoki «1 500 000»)")


@router.message(Onboarding.cash, F.text)
async def onb_cash(message: Message, state: FSMContext) -> None:
    amount = uz_numbers.parse_amount(message.text)
    if amount is None or amount < 0 or amount >= pipeline.MAX_AMOUNT:
        await message.answer("Summani tushunmadim. Raqam bilan yozing, masalan: 1 500 000")
        return
    data = await state.get_data()
    await state.clear()
    if current_shop(message.from_user.id):
        await message.answer("Biznesingiz allaqachon qo'shilgan. /holat")
        return
    db.create_shop(message.from_user.id, data["name"], message.from_user.first_name, amount)
    await set_webapp_button(message.bot, message.chat.id)
    await message.answer(f"✅ «{esc(data['name'])}» qo'shildi, hisobingizda {exact(amount)}.\n\n{HELP}")


async def set_webapp_button(bot: Bot, chat_id: int) -> None:
    url = config.WEBAPP_URL
    if not url:
        return
    try:
        await bot.set_chat_menu_button(chat_id=chat_id,
                                       menu_button=MenuButtonWebApp(text="Hisobim", web_app=WebAppInfo(url=url)))
    except Exception as exc:  # Telegram требует https
        log.warning("WebApp tugmasini o'rnatib bo'lmadi: %s", exc)


# --- команды ----------------------------------------------------------------------

@router.message(Command("holat"))
async def cmd_status(message: Message) -> None:
    shop = current_shop(message.from_user.id)
    if not shop:
        await message.answer("Avval /start bosing.")
        return
    await message.answer(status_text(shop))
    text, markup = recommendation_message(shop["id"])
    await message.answer(text, reply_markup=markup)


@router.message(Command("qarzlar"))
async def cmd_debts(message: Message) -> None:
    shop = current_shop(message.from_user.id)
    if not shop:
        await message.answer("Avval /start bosing.")
        return
    await message.answer(debts_text(shop["id"]))


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(HELP)


# --- голос / текст -> конвейер ----------------------------------------------------

async def run_pipeline(message: Message, *, text: str | None = None, audio: bytes | None = None,
                       mime_type: str = "audio/ogg", source: str) -> None:
    shop = current_shop(message.from_user.id)
    if not shop:
        await message.answer("Avval /start bosib, biznesingizni qo'shing.")
        return
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    wait = await message.answer("⏳ Tinglayapman..." if audio else "⏳ O'qiyapman...")
    try:
        result = await pipeline.process(shop["id"], text=text, audio=audio, mime_type=mime_type, source=source)
    except ai.AIUnavailable as exc:
        await wait.edit_text(f"😔 {esc(str(exc))}")
        return
    except Exception:
        log.exception("pipeline xatosi")
        await wait.edit_text("😔 Kutilmagan xato. Qayta urinib ko'ring.")
        return

    if result["intent"] == "question":
        await wait.edit_text(esc(result["answer"]))
        return
    if not result["drafts"]:
        msg = "\n".join(f"❗ {esc(e)}" for e in result["errors"])
        await wait.edit_text(msg + "\n\nIltimos, aniqroq qilib qayta yuboring.")
        return
    await wait.edit_text(card_text(result), reply_markup=kb(
        [("✅ To'g'ri", f"ok:{result['batch_id']}"), ("✏️ Tuzatish", f"fix:{result['batch_id']}")]))


@router.message(StateFilter(None), F.voice | F.audio)
async def on_voice(message: Message) -> None:
    media = message.voice or message.audio
    buf = await message.bot.download(media)
    mime = getattr(media, "mime_type", None) or "audio/ogg"
    await run_pipeline(message, audio=buf.read(), mime_type=mime, source="voice")


@router.message(StateFilter(None), F.photo)
async def on_photo(message: Message) -> None:
    await message.answer("📷 Chek/skrinshotni tanish keyingi bosqichda qo'shiladi. Hozircha ovoz yoki matn yuboring.")


@router.message(StateFilter(None), F.text & ~F.text.startswith("/"))
async def on_text(message: Message) -> None:
    await run_pipeline(message, text=message.text, source="text")


# --- подтверждение ----------------------------------------------------------------

@router.callback_query(F.data.startswith("ok:"))
async def cb_confirm(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    batch = cq.data.split(":", 1)[1]
    if not shop or not pipeline.get_drafts(shop["id"], batch_id=batch):
        await cq.answer("Bu yozuv allaqachon ko'rib chiqilgan.", show_alert=True)
        return
    res = pipeline.confirm(shop["id"], batch_id=batch)
    await cq.answer("Saqlandi ✅")
    text = cq.message.html_text + "\n\n✅ <b>Saqlandi</b>"
    if res["errors"]:
        text += "\n" + "\n".join(f"❗ {esc(e)}" for e in res["errors"])
    await cq.message.edit_text(text, reply_markup=None)

    for d in res["new_debts_with_phone"]:
        await cq.message.answer(
            f"📞 {esc(d['person'])} ({mask_phone(d['phone'])}) SMS eslatmaga rozimi?",
            reply_markup=kb([("Ha", f"sms:1:{d['debt_id']}"), ("Yo'q", f"sms:0:{d['debt_id']}")]))

    text, markup = recommendation_message(shop["id"])
    await cq.message.answer(text, reply_markup=markup)


@router.callback_query(F.data.startswith("fix:"))
async def cb_fix(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    batch = cq.data.split(":", 1)[1]
    n = pipeline.reject(shop["id"], batch_id=batch) if shop else 0
    await cq.answer()
    if not n:
        await cq.message.edit_reply_markup(reply_markup=None)
        return
    await cq.message.edit_text(cq.message.html_text + "\n\n✏️ <b>Bekor qilindi</b>", reply_markup=None)
    await cq.message.answer("To'g'ri variantini ovoz yoki matn bilan qayta yuboring.")


@router.callback_query(F.data.startswith("sms:"))
async def cb_sms(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    _, flag, debt_id = cq.data.split(":")
    if not shop or not pipeline.set_sms_consent(shop["id"], int(debt_id), flag == "1"):
        await cq.answer("Topilmadi", show_alert=True)
        return
    await cq.answer("Saqlandi")
    answer = "rozi ✅" if flag == "1" else "rozi emas"
    await cq.message.edit_text(cq.message.html_text + f"\n\nJavob: <b>{answer}</b>", reply_markup=None)


# --- рекомендации: эслатма, овердрафт, вклад ---------------------------------------

@router.callback_query(F.data == "rem")
async def cb_remind(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    if not shop:
        await cq.answer()
        return
    await cq.answer()
    rec = logic.recommendation(shop["id"])
    debtors = rec.get("debtors_to_remind") or logic.free_money(shop["id"])["top_debtors"]
    if not debtors:
        await cq.message.answer("Qarzdorlar yo'q.")
        return
    lines = ["📨 <b>Eslatma matnlari</b> (nusxalab yuboring):"]
    for d in debtors:
        lines.append(
            f"\n<b>{esc(d['person_name'])}</b>"
            + (" — SMS roziligi bor (avtomatik SMS keyingi bosqichda)" if d["sms_consent"] else "")
            + f"\n<code>Assalomu alaykum, {esc(d['person_name'])}! «{esc(shop['name'])}» dan eslatma: "
              f"{money(d['remaining'])} so'm qarzingiz bor. Imkoningiz bo'lsa, qaytarib bering. Rahmat!</code>")
    db.audit(shop["id"], "owner", "reminders_shown", {"debtors": [d["id"] for d in debtors]})
    await cq.message.answer("\n".join(lines))


@router.callback_query(F.data == "od")
async def cb_overdraft(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    await cq.answer()
    if not shop:
        return
    rec = logic.recommendation(shop["id"])
    if rec["kind"] != "shortage":
        await cq.message.answer("Hozir yetishmovchilik yo'q — overdraft kerak emas. ✅")
        return
    od = rec["overdraft"]
    oid = pipeline.save_offer(shop["id"], od)
    text = (f"🏦 <b>{od['name']}</b> (demo)\n"
            f"Summa: <b>{money(od['amount'])} so'm</b>\n"
            f"Muddat: {od['term_days']} kun, yillik {od['annual_rate'] * 100:.0f}%\n"
            f"Ortiqcha to'lov: <b>~{money(od['cost'])} so'm</b>\n\n⚠️ {esc(od['risk_text'])}")
    await cq.message.answer(text, reply_markup=kb([("✅ Qabul qilaman", f"off:1:{oid}"),
                                                   ("❌ Kerak emas", f"off:0:{oid}")]))


@router.callback_query(F.data == "dep")
async def cb_deposit(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    await cq.answer()
    if not shop:
        return
    rec = logic.recommendation(shop["id"])
    if rec["kind"] != "surplus":
        await cq.message.answer("Hozir omonat uchun bo'sh pul yo'q.")
        return
    dep = rec["deposit"]
    oid = pipeline.save_offer(shop["id"], dep)
    text = (f"🏦 <b>{dep['name']}</b> (demo)\n"
            f"Summa: <b>{money(dep['amount'])} so'm</b>, {dep['term_days']} kun, yillik {dep['annual_rate'] * 100:.0f}%\n"
            f"Daromad: <b>~{money(dep['income'])} so'm</b>\n\nℹ️ {esc(dep['early_withdrawal'])}")
    await cq.message.answer(text, reply_markup=kb([("✅ Qabul qilaman", f"off:1:{oid}"),
                                                   ("❌ Kerak emas", f"off:0:{oid}")]))


@router.callback_query(F.data.startswith("off:"))
async def cb_offer(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    _, flag, oid = cq.data.split(":")
    row = pipeline.set_offer_status(shop["id"], int(oid), flag == "1") if shop else None
    await cq.answer()
    if not row:
        return
    if row.get("error"):
        note = f"❗ {esc(row['error'])}"
    elif row["status"] == "accepted" and row.get("result"):
        r = row["result"]
        when = datetime.strptime(r["end_date"], "%Y-%m-%d").strftime("%d.%m")
        if r["type"] == "overdraft":
            note = (f"✅ {r['bank']}: {money(r['amount'])} so'm hisobingizga tushdi, "
                    f"{when} gacha {money(r['amount'] + r['cost'])} so'm qaytariladi.")
        else:
            note = (f"✅ {r['bank']}: {money(r['amount'])} so'm omonatga qo'yildi, "
                    f"{when} da {money(r['amount'] + r['income'])} so'm qaytadi.")
        fm = logic.free_money(shop["id"])
        note += f"\n{day_label(fm['horizon'])} bo'sh pul: <b>{money(fm['free_money'])} so'm</b>."
    elif row["status"] == "accepted":
        note = "Bu taklif allaqachon qabul qilingan."
    else:
        note = "Rad etildi."
    await cq.message.edit_text(cq.message.html_text + f"\n\n{note}", reply_markup=None)


# --- сборка -----------------------------------------------------------------------

def create_bot() -> tuple[Bot, Dispatcher]:
    bot = Bot(token=config.BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    dp.include_router(router)
    return bot, dp


async def setup_commands(bot: Bot) -> None:
    await bot.set_my_commands([
        BotCommand(command="start", description="Boshlash"),
        BotCommand(command="holat", description="Hisob holati va bo'sh pul"),
        BotCommand(command="qarzlar", description="Kim menga qarz"),
        BotCommand(command="help", description="Yordam"),
    ])
