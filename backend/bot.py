"""Telegram-бот Flowcast (aiogram 3). Все цифры — из logic.

Язык: узбекский по умолчанию; если владелец пишет или говорит по-русски, бот отвечает по-русски
(язык определяет AI или эвристика texts.detect_lang и запоминается в shops.lang). Тексты — texts.py.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ChatAction, ParseMode
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (BotCommand, BufferedInputFile, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
                           MenuButtonWebApp, Message, WebAppInfo)

import ai
import config
import db
import logic
import pipeline
import texts
import tts
import uz_numbers
from logic import round1000
from texts import _

log = logging.getLogger("flowcast.bot")
router = Router()

# язык пользователей без бизнеса (онбординг): tg_user_id -> lang
_pending_lang: dict[int, str] = {}


class Onboarding(StatesGroup):
    name = State()
    cash = State()


# --- язык -------------------------------------------------------------------------

def user_lang(user_id: int, shop: dict | None = None) -> str:
    shop = shop if shop is not None else db.get_shop_by_tg(user_id)
    if shop and shop.get("lang") in texts.LANGS:
        return shop["lang"]
    return _pending_lang.get(user_id, texts.DEFAULT_LANG)


def remember_lang(user_id: int, lang: str | None, shop: dict | None = None) -> str:
    """Запомнить язык последнего сообщения. None (одни цифры/эмодзи) — оставить прежний."""
    if lang not in texts.LANGS:
        return user_lang(user_id, shop)
    if shop:
        if shop.get("lang") != lang:
            db.set_shop_lang(shop["id"], lang)
            shop["lang"] = lang
    else:
        _pending_lang[user_id] = lang
    return lang


# --- форматирование ---------------------------------------------------------------

def money(x: int, lang: str) -> str:
    """Округлённая сумма с валютой: 1 200 000 so'm / сум."""
    return texts.fmt_money(x, lang)


def exact(x: int, lang: str) -> str:
    """Точная сумма для карточки подтверждения (что именно сохранится)."""
    return f"{int(x):,}".replace(",", " ") + " " + texts.currency(lang)


def num(x: int) -> str:
    return f"{round1000(x):,}".replace(",", " ")


def esc(s: str | None) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mask_phone(phone: str | None) -> str:
    if not phone or len(phone) < 13:
        return phone or ""
    return f"{phone[:4]} {phone[4:6]} *** ** {phone[-2:]}"


def _date(iso: str) -> date:
    return datetime.strptime(iso[:10], "%Y-%m-%d").date()


def event_line(ev: dict, lang: str) -> str:
    t, amt = ev["type"], exact(ev["amount"], lang)
    person = esc(ev.get("person"))
    if t == "sale":
        line = f"💰 {_('Sotuv', lang)} — <b>{amt}</b>"
    elif t == "expense":
        line = f"💸 {_('Xarajat', lang)} ({_(ev.get('category') or 'boshqa', lang)}"
        line += f", {esc(ev.get('note') or ev.get('person'))})" if (ev.get("note") or ev.get("person")) else ")"
        line += f" — <b>{amt}</b>"
    elif t == "debt_given":
        line = f"🤝 {_('{person} qarzga oldi', lang, person=person)} — <b>{amt}</b>"
        if ev.get("phone"):
            line += f" (📞 {mask_phone(ev['phone'])})"
    elif t == "debt_returned":
        line = f"↩️ {_('{person} qarzini qaytardi', lang, person=person)} — <b>{amt}</b>"
    elif t == "recurring_payment":
        when = texts.recurring_when(ev["period"], ev["day"], lang)
        label = _("Doimiy to'lov", lang)
        line = f"🔁 {label}: {esc(ev.get('note'))} — <b>{amt}</b>, {esc(when)}"
    else:
        who = esc(ev.get("note") or ev.get("person") or _("to'lov", lang))
        d = _date(ev["due_date"])
        pay = _("To'lov", lang)
        line = f"📅 {pay}: {who} — <b>{amt}</b>, {texts.weekday(d, lang)} ({d.strftime('%d.%m')})"
    if t in ("sale", "expense") and ev.get("date"):
        line += f" · 📆 {_date(ev['date']).strftime('%d.%m')}"
    line += f" · <i>{_(ev.get('trust') or db.trust_label(ev.get('source')), lang)}</i>"
    if ev.get("needs_check"):
        line += f"\n   ⚠️ {_('summani tekshiring', lang)}"
    return line


def card_text(result: dict, lang: str) -> str:
    lines = [f"<b>{_('Yozib oldim:', lang)}</b>"]
    for i, d in enumerate(result["drafts"], 1):
        lines.append(f"{i}. {event_line(d, lang)}")
    if result["errors"]:
        lines.append("")
        lines += [f"❗ {esc(e)}" for e in result["errors"]]
    # сырую расшифровку не показываем: в ней бывают ошибки вида «150000 ming»,
    # а список выше — уже нормализованные события с суммами из кода
    return "\n".join(lines)


def kb(*rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=c) for t, c in row] for row in rows])


def recommendation_message(shop_id: int, lang: str) -> tuple[str, InlineKeyboardMarkup | None]:
    rec = logic.recommendation(shop_id)
    label = texts.until_day(rec["horizon"], lang)
    if rec["kind"] == "shortage":
        text = "⚠️ " + _("{label} <b>{gap}</b> yetmaydi.", lang, label=label, gap=money(rec["gap"], lang))
        top = rec["top_debtors"]
        if rec["receivable"] > 0 and top:
            t = top[0]
            text += _(" Sizga {receivable} qarz bor, eng ko'p — {name} ({amount}, {days}).", lang,
                      receivable=money(rec["receivable"], lang), name=esc(t["person_name"]),
                      amount=num(t["remaining"]), days=texts.days(t["days_open"], lang))
        if rec["covers_by_debts"]:
            text += "\n\n" + _("Qarzlar yetishmovchilikni yopadi — avval qarzdorlarga eslatma yuboring.", lang)
        else:
            text += "\n\n" + _("Qarzlar yetmaydi — eslatmadan keyin bank overdrafti variant bo'lishi mumkin.", lang)
        rows = []
        if rec["debtors_to_remind"]:
            rows.append([(_("📨 Qarzdorlarga eslatma", lang), "rem")])
        if rec.get("offers_allowed", True):
            rows.append([(_("🏦 Overdraft shartlari", lang), "od")])
        else:
            text += "\n\n" + _("Ma'lumot kam — bank takliflari yashirildi. Naqd savdo va xarajatlarni yozib boring.", lang)
        return text, kb(*rows)
    if rec["kind"] == "surplus" and not rec.get("offers_allowed", True):
        text = _("✅ {label} yetadi. Bo'sh pul: <b>{free}</b>.", lang, label=label, free=money(rec["free_money"], lang))
        return text + "\n\n" + _("Ma'lumot kam — bank takliflari yashirildi. Naqd savdo va xarajatlarni yozib boring.",
                                 lang), None
    if rec["kind"] == "surplus":
        dep = rec["deposit"]
        text = _("✅ {label} ham yetadi, bo'sh pul: <b>{free}</b>.\n{amount}ni omonatga qo'ysangiz, {days}da ~{income} daromad.",
                 lang, label=label, free=money(rec["free_money"], lang), amount=money(dep["amount"], lang),
                 days=texts.days(dep["term_days"], lang), income=money(dep["income"], lang))
        return text, kb([(_("🏦 Omonat shartlari", lang), "dep")])
    return _("✅ {label} yetadi. Bo'sh pul: <b>{free}</b>.", lang, label=label, free=money(rec["free_money"], lang)), None


def status_text(shop: dict, lang: str) -> str:
    fm = logic.free_money(shop["id"])
    lines = [
        f"📊 <b>{esc(shop['name'])}</b>",
        _("Hisobingizda: <b>{cash}</b>", lang, cash=money(fm["cash_now"], lang)),
        _("{label} bo'sh pul: <b>{free}</b>", lang, label=texts.until_day(fm["horizon"], lang),
          free=money(fm["free_money"], lang)),
    ]
    if fm["payments"]:
        lines.append(_("To'lovlar: ", lang) + ", ".join(
            f"{esc(p['counterparty'] or p['title'])} {num(p['amount'])} ({texts.weekday(_date(p['due_date']), lang)})"
            for p in fm["payments"]))
    if fm["total_receivable"]:
        lines.append(_("Sizga qarz: {total}", lang, total=money(fm["total_receivable"], lang)))
    rel = logic.reliability(shop["id"])
    lines.append(_("Hisob {pct}% ma'lumotga asoslangan", lang, pct=rel["percent"]))
    return "\n".join(lines)


def debts_text(shop_id: int, lang: str) -> str:
    debts = logic.open_debts(shop_id)
    if not debts:
        return _("Hozir sizga hech kim qarz emas. 👍", lang)
    total = sum(d["remaining"] for d in debts)
    lines = [_("Sizga jami <b>{total}</b> qarz bor:", lang, total=money(total, lang))]
    for d in debts:
        lines.append(f"• {esc(d['person_name'])} — {num(d['remaining'])} ({texts.days(d['days_open'], lang)})")
    return "\n".join(lines)


def current_shop(user_id: int) -> dict | None:
    return db.get_shop_by_tg(user_id)


# --- /start и онбординг ----------------------------------------------------------

INTRO = ("Assalomu alaykum! Men <b>Flowcast</b> — kichik va mikro biznes uchun ovozli moliyaviy yordamchiman. "
         "Savdo, xarajat va qarzlarni ovoz bilan yozing — men bo'sh pulingizni oldindan hisoblab, kerak bo'lsa ogohlantiraman.")

HELP = ("Menga ovozli yoki matnli xabar yuboring, masalan:\n"
        "• «Bugun naqdga 2 million 300 ming sotdim»\n"
        "• «Alisher 150 ming qarz oldi»\n"
        "• «Payshanba kuni yetkazib beruvchiga 3 million»\n"
        "• «Har oy 5-sanada ijara 3 million»\n"
        "• «Kim menga qarz?»  • «Payshanbagacha yetadimi?»\n\n"
        "Karta va QR to'lovlari o'zi tushadi — ovoz va rasm naqd savdo, xarajat va qarzlar uchun.\n"
        "/holat — hisob holati va bo'sh pul, /qarzlar — qarzdorlar.")


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    shop = current_shop(message.from_user.id)
    lang = user_lang(message.from_user.id, shop)
    if shop:
        await message.answer(f"{_('Assalomu alaykum! 👋', lang)}\n\n{status_text(shop, lang)}\n\n{_(HELP, lang)}")
        return
    demo = db.get_shop(config.DEV_SHOP_ID)
    if demo and demo["tg_user_id"] is None:
        await message.answer(
            f"{_(INTRO, lang)}\n\n" + _("Demo biznes «{name}» tayyor. Uni ulaysizmi yoki o'z biznesingizni qo'shasizmi?",
                                        lang, name=esc(demo["name"])),
            reply_markup=kb([(_("🧪 Demo biznesni ulash", lang), "demo")],
                            [(_("➕ O'z biznesimni qo'shish", lang), "newshop")]))
        return
    await message.answer(_(INTRO, lang))
    await start_onboarding(message, state, lang)


async def start_onboarding(message: Message, state: FSMContext, lang: str) -> None:
    await state.set_state(Onboarding.name)
    await message.answer(_("Biznesingiz nomi?", lang))


@router.callback_query(F.data == "newshop")
async def cb_newshop(cq: CallbackQuery, state: FSMContext) -> None:
    await cq.answer()
    await cq.message.edit_reply_markup(reply_markup=None)
    await start_onboarding(cq.message, state, user_lang(cq.from_user.id))


@router.callback_query(F.data == "demo")
async def cb_demo(cq: CallbackQuery, state: FSMContext) -> None:
    lang = user_lang(cq.from_user.id)
    if current_shop(cq.from_user.id):
        await cq.answer(_("Sizda biznes allaqachon qo'shilgan.", lang), show_alert=True)
        return
    demo = db.get_shop(config.DEV_SHOP_ID)
    if not demo or demo["tg_user_id"] is not None:
        await cq.answer(_("Demo biznes band.", lang), show_alert=True)
        return
    db.execute("UPDATE shops SET tg_user_id=?, lang=? WHERE id=? AND tg_user_id IS NULL",
               (cq.from_user.id, lang, demo["id"]))
    db.audit(demo["id"], "owner", "demo_linked", {"tg_user_id": cq.from_user.id})
    await cq.answer(_("Ulandi!", lang))
    await cq.message.edit_reply_markup(reply_markup=None)
    await set_webapp_button(cq.bot, cq.message.chat.id, lang)
    shop = db.get_shop(demo["id"])
    await cq.message.answer(f"{_('✅ Demo biznes ulandi.', lang)}\n\n{status_text(shop, lang)}")
    text, markup = recommendation_message(shop["id"], lang)
    await cq.message.answer(text, reply_markup=markup)
    await cq.message.answer(_(HELP, lang))


@router.message(Onboarding.name, F.text)
async def onb_name(message: Message, state: FSMContext) -> None:
    lang = remember_lang(message.from_user.id, texts.detect_lang(message.text))
    name = message.text.strip()[:80]
    if not name or name.startswith("/"):
        await message.answer(_("Biznesingiz nomini yozing, masalan: «Dilshod Biznes».", lang))
        return
    await state.update_data(name=name)
    await state.set_state(Onboarding.cash)
    await message.answer(_("Hozir hisobingizda qancha pul bor? (masalan: «2 million» yoki «1 500 000»)", lang))


@router.message(Onboarding.cash, F.text)
async def onb_cash(message: Message, state: FSMContext) -> None:
    lang = user_lang(message.from_user.id)
    amount = uz_numbers.parse_amount(message.text)
    if amount is None or amount < 0 or amount >= pipeline.MAX_AMOUNT:
        await message.answer(_("Summani tushunmadim. Raqam bilan yozing, masalan: 1 500 000", lang))
        return
    data = await state.get_data()
    await state.clear()
    if current_shop(message.from_user.id):
        await message.answer(_("Biznesingiz allaqachon qo'shilgan. /holat", lang))
        return
    shop_id = db.create_shop(message.from_user.id, data["name"], message.from_user.first_name, amount)
    db.set_shop_lang(shop_id, lang)
    await set_webapp_button(message.bot, message.chat.id, lang)
    await message.answer(_("✅ «{name}» qo'shildi, hisobingizda {amount}.", lang, name=esc(data["name"]),
                           amount=exact(amount, lang)) + f"\n\n{_(HELP, lang)}")


async def set_webapp_button(bot: Bot, chat_id: int, lang: str = texts.DEFAULT_LANG) -> None:
    url = config.WEBAPP_URL
    if not url:
        return
    try:
        await bot.set_chat_menu_button(chat_id=chat_id,
                                       menu_button=MenuButtonWebApp(text=_("Hisobim", lang), web_app=WebAppInfo(url=url)))
    except Exception as exc:  # Telegram требует https
        log.warning("WebApp tugmasini o'rnatib bo'lmadi: %s", exc)


# --- команды ----------------------------------------------------------------------

@router.message(Command("holat"))
async def cmd_status(message: Message) -> None:
    shop = current_shop(message.from_user.id)
    lang = user_lang(message.from_user.id, shop)
    if not shop:
        await message.answer(_("Avval /start bosing.", lang))
        return
    await message.answer(status_text(shop, lang))
    text, markup = recommendation_message(shop["id"], lang)
    await message.answer(text, reply_markup=markup)


@router.message(Command("qarzlar"))
async def cmd_debts(message: Message) -> None:
    shop = current_shop(message.from_user.id)
    lang = user_lang(message.from_user.id, shop)
    if not shop:
        await message.answer(_("Avval /start bosing.", lang))
        return
    await message.answer(debts_text(shop["id"], lang))


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(_(HELP, user_lang(message.from_user.id)))


# --- голос / текст -> конвейер ----------------------------------------------------

async def send_voice_reply(message: Message, text: str, lang: str) -> None:
    """Голосовой ответ (Gemini TTS). Любая ошибка — молча: текстовый ответ уже отправлен."""
    try:
        await message.bot.send_chat_action(message.chat.id, ChatAction.RECORD_VOICE)
        data = await tts.synthesize(text, fmt="ogg")
        if not data:
            return
        if tts.audio_mime(data) == "audio/ogg":
            await message.answer_voice(BufferedInputFile(data, "javob.ogg"))
        else:
            await message.answer_audio(BufferedInputFile(data, "javob.wav"), title=_("Javob", lang))
    except Exception:
        log.warning("ovozli javob yuborilmadi", exc_info=True)


async def run_pipeline(message: Message, *, text: str | None = None, audio: bytes | None = None,
                       image: bytes | None = None, mime_type: str = "audio/ogg", source: str) -> None:
    shop = current_shop(message.from_user.id)
    # язык до ответа AI: по тексту — сразу, для голоса и фото — прежний
    lang = remember_lang(message.from_user.id, texts.detect_lang(text), shop) if text else user_lang(message.from_user.id, shop)
    if not shop:
        await message.answer(_("Avval /start bosib, biznesingizni qo'shing.", lang))
        return
    await message.bot.send_chat_action(message.chat.id, ChatAction.TYPING)
    wait = await message.answer(_("⏳ Tinglayapman...", lang) if audio else _("⏳ Rasmni o'qiyapman...", lang) if image
                                else _("⏳ O'qiyapman...", lang))
    try:
        if image is not None:
            result = await pipeline.process_photo(shop["id"], image, mime_type, lang=lang)
        else:
            result = await pipeline.process(shop["id"], text=text, audio=audio, mime_type=mime_type, source=source,
                                            lang=lang)
    except ai.AIUnavailable as exc:
        await wait.edit_text(f"😔 {esc(_(str(exc), lang))}")
        return
    except Exception:
        log.exception("pipeline xatosi")
        await wait.edit_text(_("😔 Kutilmagan xato. Qayta urinib ko'ring.", lang))
        return
    lang = remember_lang(message.from_user.id, result.get("language"), shop)

    if result["intent"] == "question":
        await wait.edit_text(esc(result["answer"]))
        # спросили голосом -> ответим ещё и голосом (текстовые вопросы — только текст)
        if source == "voice" and config.VOICE_REPLIES and result.get("voice_text"):
            await send_voice_reply(message, result["voice_text"], lang)
        return
    if not result["drafts"]:
        msg = "\n".join(f"❗ {esc(e)}" for e in result["errors"])
        await wait.edit_text(msg + "\n\n" + _("Iltimos, aniqroq qilib qayta yuboring.", lang))
        return
    await wait.edit_text(card_text(result, lang), reply_markup=kb(
        [(_("✅ To'g'ri", lang), f"ok:{result['batch_id']}"), (_("✏️ Tuzatish", lang), f"fix:{result['batch_id']}")]))


@router.message(StateFilter(None), F.voice | F.audio)
async def on_voice(message: Message) -> None:
    media = message.voice or message.audio
    buf = await message.bot.download(media)
    mime = getattr(media, "mime_type", None) or "audio/ogg"
    await run_pipeline(message, audio=buf.read(), mime_type=mime, source="voice")


@router.message(StateFilter(None), F.photo)
async def on_photo(message: Message) -> None:
    """Фото чека / накладной / скриншота Payme-Click -> черновики -> To'g'ri / Tuzatish."""
    buf = await message.bot.download(message.photo[-1])          # самое большое разрешение
    await run_pipeline(message, image=buf.read(), mime_type="image/jpeg", source="photo")


@router.message(StateFilter(None), F.document)
async def on_document(message: Message) -> None:
    """Фото, отправленное «файлом» (без сжатия), или PDF накладной."""
    doc = message.document
    mime = (doc.mime_type or "").lower()
    if not (mime.startswith("image/") or mime == "application/pdf"):
        await message.answer(_("Chek, nakladnoy yoki skrinshot rasmini yuboring (JPG, PNG yoki PDF).",
                               user_lang(message.from_user.id)))
        return
    buf = await message.bot.download(doc)
    await run_pipeline(message, image=buf.read(), mime_type=mime, source="photo")


@router.message(StateFilter(None), F.text & ~F.text.startswith("/"))
async def on_text(message: Message) -> None:
    await run_pipeline(message, text=message.text, source="text")


# --- подтверждение ----------------------------------------------------------------

@router.callback_query(F.data.startswith("ok:"))
async def cb_confirm(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    lang = user_lang(cq.from_user.id, shop)
    batch = cq.data.split(":", 1)[1]
    if not shop or not pipeline.get_drafts(shop["id"], batch_id=batch):
        await cq.answer(_("Bu yozuv allaqachon ko'rib chiqilgan.", lang), show_alert=True)
        return
    res = pipeline.confirm(shop["id"], batch_id=batch)
    await cq.answer(_("Saqlandi ✅", lang))
    text = cq.message.html_text + f"\n\n✅ <b>{_('Saqlandi', lang)}</b>"
    if res["errors"]:
        text += "\n" + "\n".join(f"❗ {esc(_(e, lang))}" for e in res["errors"])
    await cq.message.edit_text(text, reply_markup=None)

    for d in res["new_debts_with_phone"]:
        await cq.message.answer(
            _("📞 {person} ({phone}) SMS eslatmaga rozimi?", lang, person=esc(d["person"]), phone=mask_phone(d["phone"])),
            reply_markup=kb([(_("Ha", lang), f"sms:1:{d['debt_id']}"), (_("Yo'q", lang), f"sms:0:{d['debt_id']}")]))

    text, markup = recommendation_message(shop["id"], lang)
    await cq.message.answer(text, reply_markup=markup)


@router.callback_query(F.data.startswith("fix:"))
async def cb_fix(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    lang = user_lang(cq.from_user.id, shop)
    batch = cq.data.split(":", 1)[1]
    n = pipeline.reject(shop["id"], batch_id=batch) if shop else 0
    await cq.answer()
    if not n:
        await cq.message.edit_reply_markup(reply_markup=None)
        return
    await cq.message.edit_text(cq.message.html_text + f"\n\n✏️ <b>{_('Bekor qilindi', lang)}</b>", reply_markup=None)
    await cq.message.answer(_("To'g'ri variantini ovoz yoki matn bilan qayta yuboring.", lang))


@router.callback_query(F.data.startswith("sms:"))
async def cb_sms(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    lang = user_lang(cq.from_user.id, shop)
    _cb, flag, debt_id = cq.data.split(":")
    if not shop or not pipeline.set_sms_consent(shop["id"], int(debt_id), flag == "1"):
        await cq.answer(_("Topilmadi", lang), show_alert=True)
        return
    await cq.answer(_("Saqlandi", lang))
    answer = _("rozi ✅", lang) if flag == "1" else _("rozi emas", lang)
    await cq.message.edit_text(cq.message.html_text + "\n\n" + _("Javob: <b>{answer}</b>", lang, answer=answer),
                               reply_markup=None)


# --- рекомендации: эслатма, овердрафт, вклад ---------------------------------------

@router.callback_query(F.data == "rem")
async def cb_remind(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    await cq.answer()
    if not shop:
        return
    lang = user_lang(cq.from_user.id, shop)
    rec = logic.recommendation(shop["id"])
    debtors = rec.get("debtors_to_remind") or logic.free_money(shop["id"])["top_debtors"]
    if not debtors:
        await cq.message.answer(_("Qarzdorlar yo'q.", lang))
        return
    lines = [_("📨 <b>Eslatma matnlari</b> (nusxalab yuboring):", lang)]
    for d in debtors:
        # текст для должника — на узбекском (его язык мы не знаем), подсказка владельцу — на его языке
        lines.append(
            f"\n<b>{esc(d['person_name'])}</b>"
            + (_(" — SMS roziligi bor: ilovada «Eslatish» SMS va to'lov havolasini yuboradi", lang) if d["sms_consent"] else "")
            + f"\n<code>Assalomu alaykum, {esc(d['person_name'])}! «{esc(shop['name'])}» dan eslatma: "
              f"{num(d['remaining'])} so'm qarzingiz bor. Imkoningiz bo'lsa, qaytarib bering. Rahmat!</code>")
    db.audit(shop["id"], "owner", "reminders_shown", {"debtors": [d["id"] for d in debtors]})
    await cq.message.answer("\n".join(lines))


@router.callback_query(F.data == "od")
async def cb_overdraft(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    await cq.answer()
    if not shop:
        return
    lang = user_lang(cq.from_user.id, shop)
    rec = logic.recommendation(shop["id"])
    if rec["kind"] != "shortage":
        await cq.message.answer(_("Hozir yetishmovchilik yo'q — overdraft kerak emas. ✅", lang))
        return
    od = rec["overdraft"]
    oid = pipeline.save_offer(shop["id"], od)
    text = (f"🏦 <b>{_(od['name'], lang)}</b> (demo)\n"
            + _("Summa: <b>{amount}</b>", lang, amount=money(od["amount"], lang)) + "\n"
            + _("Muddat: {days}, yillik {rate}%", lang, days=texts.days(od["term_days"], lang),
                rate=f"{od['annual_rate'] * 100:.0f}") + "\n"
            + _("Ortiqcha to'lov: <b>~{cost}</b>", lang, cost=money(od["cost"], lang))
            + f"\n\n⚠️ {esc(_(od['risk_text'], lang))}")
    await cq.message.answer(text, reply_markup=kb([(_("✅ Qabul qilaman", lang), f"off:1:{oid}"),
                                                   (_("❌ Kerak emas", lang), f"off:0:{oid}")]))


@router.callback_query(F.data == "dep")
async def cb_deposit(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    await cq.answer()
    if not shop:
        return
    lang = user_lang(cq.from_user.id, shop)
    rec = logic.recommendation(shop["id"])
    if rec["kind"] != "surplus":
        await cq.message.answer(_("Hozir omonat uchun bo'sh pul yo'q.", lang))
        return
    dep = rec["deposit"]
    oid = pipeline.save_offer(shop["id"], dep)
    text = (f"🏦 <b>{_(dep['name'], lang)}</b> (demo)\n"
            + _("Summa: <b>{amount}</b>, {days}, yillik {rate}%", lang, amount=money(dep["amount"], lang),
                days=texts.days(dep["term_days"], lang), rate=f"{dep['annual_rate'] * 100:.0f}") + "\n"
            + _("Daromad: <b>~{income}</b>", lang, income=money(dep["income"], lang))
            + f"\n\nℹ️ {esc(_(dep['early_withdrawal'], lang))}")
    await cq.message.answer(text, reply_markup=kb([(_("✅ Qabul qilaman", lang), f"off:1:{oid}"),
                                                   (_("❌ Kerak emas", lang), f"off:0:{oid}")]))


@router.callback_query(F.data.startswith("off:"))
async def cb_offer(cq: CallbackQuery) -> None:
    shop = current_shop(cq.from_user.id)
    lang = user_lang(cq.from_user.id, shop)
    _cb, flag, oid = cq.data.split(":")
    row = pipeline.set_offer_status(shop["id"], int(oid), flag == "1") if shop else None
    await cq.answer()
    if not row:
        return
    if row.get("error"):
        note = f"❗ {esc(_(row['error'], lang))}"
    elif row["status"] == "accepted" and row.get("result"):
        r = row["result"]
        when = _date(r["end_date"]).strftime("%d.%m")
        if r["type"] == "overdraft":
            note = _("✅ {bank}: {amount} hisobingizga tushdi, {date} gacha {total} qaytariladi.", lang,
                     bank=r["bank"], amount=money(r["amount"], lang), date=when,
                     total=money(r["amount"] + r["cost"], lang))
        else:
            note = _("✅ {bank}: {amount} omonatga qo'yildi, {date} da {total} qaytadi.", lang,
                     bank=r["bank"], amount=money(r["amount"], lang), date=when,
                     total=money(r["amount"] + r["income"], lang))
        fm = logic.free_money(shop["id"])
        note += "\n" + _("{label} bo'sh pul: <b>{free}</b>", lang, label=texts.until_day(fm["horizon"], lang),
                         free=money(fm["free_money"], lang))
    elif row["status"] == "accepted":
        note = _("Bu taklif allaqachon qabul qilingan.", lang)
    else:
        note = _("Rad etildi.", lang)
    await cq.message.edit_text(cq.message.html_text + f"\n\n{note}", reply_markup=None)


# --- утренний вопрос про пропущенный день -------------------------------------------

TASHKENT = timezone(timedelta(hours=5))
NUDGE_HOUR = 9               # после 9:00 по Ташкенту, один раз в день


def nudge_text(lang: str) -> tuple[str, InlineKeyboardMarkup]:
    return (_("Kecha naqd pul bo'yicha yozuv yo'q. Yozib qo'yamizmi?", lang),
            kb([(_("✍️ Yozib qo'yish", lang), "nudge")]))


def due_nudges(now: datetime | None = None) -> list[dict]:
    """Магазины, которым пора задать утренний вопрос. Помечает nudged_on=сегодня у всех проверенных,
    чтобы спрашивать не чаще раза в день. Ничего не дописывает."""
    now = now or datetime.now(TASHKENT)
    if now.hour < NUDGE_HOUR:
        return []
    today = now.date()
    out = []
    for shop in db.query("SELECT * FROM shops WHERE tg_user_id IS NOT NULL AND (nudged_on IS NULL OR nudged_on<>?)",
                         (today.isoformat(),)):
        db.execute("UPDATE shops SET nudged_on=? WHERE id=?", (today.isoformat(), shop["id"]))
        if logic.missing_yesterday(shop["id"], today):
            out.append(shop)
    return out


async def nudge_loop(bot: Bot, every: int = 600) -> None:
    while True:
        try:
            for shop in due_nudges():
                lang = shop.get("lang") if shop.get("lang") in texts.LANGS else texts.DEFAULT_LANG
                text, markup = nudge_text(lang)
                try:
                    await bot.send_message(shop["tg_user_id"], text, reply_markup=markup)
                except Exception:
                    log.warning("nudge yuborilmadi: shop %s", shop["id"], exc_info=True)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("nudge_loop")
        await asyncio.sleep(every)


@router.callback_query(F.data == "nudge")
async def cb_nudge(cq: CallbackQuery) -> None:
    lang = user_lang(cq.from_user.id)
    await cq.answer()
    await cq.message.edit_reply_markup(reply_markup=None)
    await cq.message.answer(_("Kechagi naqd savdo va xarajatlarni yozing yoki ovoz bilan ayting. Masalan: «Kecha naqdga 1 million 200 ming sotdim, 150 ming paketga ketdi».", lang))


# --- уведомления владельцу из extras (оплата по ссылке) ----------------------------

_PAID_RE = re.compile(r"^(?P<name>.+?) to'ladi ✅ (?P<amount>[\d  ]+) so'm$")


def owner_payment_text(shop_id: int, text: str) -> str:
    """«Alisher to'ladi ✅ 450 000 so'm» + новые свободные деньги — владелец сразу видит эффект."""
    shop = db.get_shop(shop_id) or {}
    lang = shop.get("lang") if shop.get("lang") in texts.LANGS else texts.DEFAULT_LANG
    m = _PAID_RE.match(text.strip())
    if m and lang == "ru":
        amount = int(re.sub(r"\D", "", m.group("amount")))
        text = _("{name} to'ladi ✅ {amount}", lang, name=m.group("name"), amount=exact(amount, lang))
    try:
        free = logic.free_money(shop_id)["free_money"]
        tail = "\n" + _("Bo'sh pul endi: <b>{free}</b>", lang, free=money(free, lang))
    except Exception:
        tail = ""
    return f"{esc(text)}\n<i>{_('havola orqali · tasdiqlangan', lang)}</i>{tail}"


def install_owner_notifier(bot: Bot, loop: asyncio.AbstractEventLoop) -> None:
    """extras.adapters.notify_owner -> сообщение владельцу. Оплата приходит из потока FastAPI (sync-роут),
    поэтому корутина отправляется в цикл бота через run_coroutine_threadsafe."""
    from extras import adapters

    def send(shop_id: int, text: str) -> None:
        shop = db.get_shop(shop_id)
        if not shop or not shop.get("tg_user_id"):
            return
        coro = bot.send_message(shop["tg_user_id"], owner_payment_text(shop_id, text))
        try:
            same_loop = asyncio.get_running_loop() is loop
        except RuntimeError:
            same_loop = False
        if same_loop:
            loop.create_task(coro)
        else:
            asyncio.run_coroutine_threadsafe(coro, loop)

    adapters.set_notifier(send)


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
    # русские подписи команд — для Telegram с русским интерфейсом
    await bot.set_my_commands([
        BotCommand(command="start", description="Начать"),
        BotCommand(command="holat", description="Состояние счёта и свободные деньги"),
        BotCommand(command="qarzlar", description="Кто мне должен"),
        BotCommand(command="help", description="Помощь"),
    ], language_code="ru")
    try:
        await bot.set_my_short_description("Flowcast — kichik va mikro biznes uchun ovozli moliyaviy yordamchi")
        await bot.set_my_description(
            "Men Flowcast — kichik va mikro biznes uchun ovozli moliyaviy yordamchiman. Savdo, xarajat va qarzlarni "
            "ovoz bilan yozing — bo'sh pulingizni oldindan hisoblab, kerak bo'lsa ogohlantiraman.")
        await bot.set_my_short_description("Flowcast — голосовой финансовый помощник для малого и микробизнеса",
                                           language_code="ru")
    except Exception:  # описание — не критично (лимиты Telegram на частые вызовы)
        log.warning("set_my_description failed", exc_info=True)
