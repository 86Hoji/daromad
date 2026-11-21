"""Фото накладной / чека / скриншота Payme-Click -> события в общем формате Flowcast.

ИИ (Gemini) только читает картинку и извлекает данные. Код проверяет суммы, типы и даты.
Сохранение и подтверждение кнопкой делает основной бэк (источник записи — "photo").

    await aparse_photo(image_bytes, mime, today)   # из бота (async)
    parse_photo(image_bytes, mime, today)          # из скриптов и тестов (sync)
    python -m extras.vision samples/nakladnaya1.jpg [--today 2026-11-23]   # запуск из backend/

Модели: GEMINI_MODEL, при 503/429/404/таймауте — по очереди GEMINI_FALLBACK_MODELS.

Ответ всегда в формате:
    {"intent": "record", "events": [...], "transcript": "..."}
Ошибки не роняют программу: events = [], transcript = "error: ...".
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from . import clock

log = logging.getLogger("extras.vision")

EXTRAS_DIR = Path(__file__).resolve().parent
EVENT_TYPES = ("sale", "expense", "debt_given", "debt_returned", "scheduled_payment")
CATEGORIES = ("tovar", "ijara", "maosh", "kommunal", "transport", "boshqa")
MAX_AMOUNT = 1_000_000_000
MAX_IMAGE_BYTES = 15 * 1024 * 1024          # inline-запрос Gemini — до ~20 МБ
MAX_EVENTS = 10
TIMEOUT_SECONDS = 60            # на весь запрос, со всеми запасными моделями
ATTEMPT_TIMEOUT = 25            # на одну модель
DEFAULT_MODEL = "gemini-3.5-flash"
DEFAULT_FALLBACKS = "gemini-3.5-flash-lite"
# Ошибки, при которых пробуем следующую модель: перегрузка, лимит, модель недоступна, таймаут.
_RETRYABLE = ("503", "unavailable", "429", "resource_exhausted", "404", "not_found", "500", "internal",
              "deadline", "timeout")
ALLOWED_MIME = ("image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf")
WEEKDAYS_UZ = ("dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba")


# --- схема ответа Gemini (JSON mode) ---------------------------------------------

class PhotoEvent(BaseModel):
    type: str
    amount: int
    amount_text: Optional[str] = None
    person: Optional[str] = None
    phone: Optional[str] = None
    category: Optional[str] = None
    due_date: Optional[str] = None
    note: Optional[str] = None


class PhotoParsed(BaseModel):
    events: list[PhotoEvent]
    transcript: str


PROMPT = """Sen "Flowcast" — kichik do'kon egasining yordamchisisan. Senga RASM beriladi: yetkazib beruvchining
nakladnoyi (hisob-faktura), xarajat cheki yoki Payme/Click o'tkazma skrinshoti. Matn o'zbekcha (lotin yoki kirill)
yoki ruscha bo'lishi mumkin. Vazifang — rasmdagi ma'lumotni ajratib, FAQAT JSON qaytarish.
Hech narsani hisoblama va qo'shma: summa sifatida hujjatda YOZILGAN yakuniy summani ol (ИТОГО / Jami / К оплате).

Bugun: {today} ({today_wd}). Kelgusi kunlar: {week_table}

events[].type — rasm turiga qarab:
- Yetkazib beruvchi nakladnoyi, hali to'lanmagan -> "scheduled_payment": amount = to'lanadigan jami summa,
  person = yetkazib beruvchi (firma yoki ism), due_date = to'lov muddati (YYYY-MM-DD) agar yozilgan bo'lsa, aks holda null,
  note = hujjat raqami (masalan "nakladnaya № 145").
- Nakladnoyda "to'landi"/"оплачено"/"paid" belgisi bo'lsa -> "expense", category = "tovar".
- Payme/Click/bank o'tkazma skrinshoti ("O'tkazma muvaffaqiyatli", "Перевод выполнен" va h.k.) — bu MIJOZ do'kon egasiga
  pul o'tkazgani: egasi = "Qabul qiluvchi"/"Получатель", mijoz = "Jo'natuvchi"/"Отправитель".
  Bunday skrinshot HECH QACHON "expense" emas. -> "debt_returned", person = Jo'natuvchi/Отправитель ismi
  (skrinshotda qanday yozilgan bo'lsa; Qabul qiluvchi ismini person ga YOZMA). Jo'natuvchi ismi ko'rinmasa -> "sale".
- Xarajat cheki (paket, svet, gaz, taksi, benzin, ijara va h.k.) -> "expense", category tanla:
  tovar | ijara | maosh | kommunal | transport | boshqa (svet/gaz/suv -> kommunal; taksi/benzin -> transport; paket va mayda -> boshqa).
amount — butun son, so'mda, tiyinsiz ("3 000 000,00" = 3000000, "3.000.000" = 3000000).
amount_text — rasmdagi aynan shu summa yozuvi, harfma-harf (masalan "3 000 000,00 so'm").
phone — faqat to'liq telefon raqami aniq ko'rinsa, aks holda null.
Bo'lmagan maydon — null (bo'sh qator emas).
transcript — rasmda ko'rgan asosiy matn qisqacha (hujjat turi, kimdan, summa, sana).
Rasm o'qilmasa yoki bu hujjat/chek/skrinshot bo'lmasa: events = [], transcript = sababi.
"""


# --- суммы: код перепроверяет ИИ ---------------------------------------------------

_NUM_RE = re.compile(r"\d{1,3}(?:[   .,']\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)")
_WORD_AMOUNT_RE = re.compile(r"(ming|mln|million|milliard|тыс|млн|миллион|минг|\d\s*[kк]\b)", re.IGNORECASE)


def _token_to_int(token: str) -> int:
    t = token.strip()
    t = re.sub(r"[.,]\d{1,2}$", "", t) if re.search(r"\d[   .,']\d{3}", t) or re.fullmatch(r"\d+[.,]\d{1,2}", t) else t
    return int(re.sub(r"\D", "", t) or 0)


def digit_amounts(text: str | None) -> list[int]:
    """Все суммы из цифр: "3 000 000,00" -> 3000000, "3,000,000.00" -> 3000000, "3.000.000" -> 3000000."""
    if not text:
        return []
    return [_token_to_int(m.group(0)) for m in _NUM_RE.finditer(text)]


def amount_from_text(amount_text: str | None) -> int | None:
    """Сумма из строки, которую ИИ увидел на фото. None — если разобрать нельзя."""
    if not amount_text:
        return None
    if _WORD_AMOUNT_RE.search(amount_text):
        try:
            import uz_numbers  # основной парсер слов ("3 mln", "2 million 300 ming"), есть в main
        except ImportError:
            return None
        return uz_numbers.parse_amount(amount_text)
    values = [v for v in digit_amounts(amount_text) if v >= 1000]
    return max(values) if values else None


def check_amount(ai_amount: int, amount_text: str | None, transcript: str) -> tuple[int, bool]:
    """-> (сумма, needs_check). Если сумма из текста фото расходится с ИИ — верим тексту и просим проверить."""
    parsed = amount_from_text(amount_text)
    if parsed is not None and parsed >= 1000:
        return (parsed, True) if parsed != ai_amount else (ai_amount, False)
    candidates = set(digit_amounts(transcript)) | set(digit_amounts(amount_text))
    return ai_amount, ai_amount not in candidates


# --- нормализация полей -------------------------------------------------------------

def _clean_str(value, limit: int) -> str | None:
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value)).strip()
    if not s or s.lower() in ("null", "none", "-"):
        return None
    return s[:limit]


def normalize_phone(raw) -> str | None:
    """Как в основном ai.normalize_phone: '+998XXXXXXXXX' или None."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return "+" + digits
    return None


def _coerce_amount(value) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        return amount_from_text(value) or (max(digit_amounts(value)) if digit_amounts(value) else 0)
    return 0


def _valid_due_date(value, today: date) -> str | None:
    s = _clean_str(value, 10)
    if not s:
        return None
    try:
        d = date.fromisoformat(s)
    except ValueError:
        return None
    if not (today - timedelta(days=365) <= d <= today + timedelta(days=365)):
        return None
    return d.isoformat()


def normalize_event(raw: dict, transcript: str, today: date) -> dict | None:
    """Одно событие от ИИ -> событие контракта или None (выбросить)."""
    t = _clean_str(raw.get("type"), 30)
    t = t.lower() if t else None
    if t not in EVENT_TYPES:
        log.warning("vision: unknown type %r dropped", raw.get("type"))
        return None

    ai_amount = _coerce_amount(raw.get("amount"))
    amount_text = _clean_str(raw.get("amount_text"), 60)
    amount, needs_check = check_amount(ai_amount, amount_text, transcript)
    if not (0 < amount < MAX_AMOUNT):
        log.warning("vision: amount %r out of range dropped", amount)
        return None

    person = _clean_str(raw.get("person"), 60)
    if t in ("debt_given", "debt_returned") and not person:
        if t == "debt_given":
            return None
        t = "sale"                       # перевод без имени отправителя — просто продажа

    category = None
    if t in ("sale", "expense"):
        cat = (_clean_str(raw.get("category"), 20) or "").lower()
        category = cat if cat in CATEGORIES else ("tovar" if t == "sale" else "boshqa")

    return {
        "type": t,
        "amount": amount,
        "person": person,
        "phone": normalize_phone(raw.get("phone")),
        "category": category,
        "due_date": _valid_due_date(raw.get("due_date"), today) if t == "scheduled_payment" else None,
        "note": _clean_str(raw.get("note"), 120),
        "amount_text": amount_text,
        "needs_check": needs_check or amount != ai_amount,
    }


def postprocess(raw: dict, today: date) -> dict:
    transcript = _clean_str(raw.get("transcript"), 2000) or ""
    events = []
    for ev in (raw.get("events") or [])[:MAX_EVENTS]:
        if isinstance(ev, dict):
            norm = normalize_event(ev, transcript, today)
            if norm:
                events.append(norm)
    if not events and not transcript:
        transcript = "Rasmdan yozuv topilmadi."
    return {"intent": "record", "events": events, "transcript": transcript}


def error_result(reason: str) -> dict:
    return {"intent": "record", "events": [], "transcript": f"error: {reason}"}


# --- вызов Gemini --------------------------------------------------------------------

def _settings() -> tuple[str, list[str]]:
    """-> (ключ, модели по порядку: GEMINI_MODEL, потом GEMINI_FALLBACK_MODELS через запятую)."""
    try:
        from dotenv import load_dotenv
        load_dotenv(EXTRAS_DIR / ".env")
    except ImportError:
        pass
    key = os.getenv("GEMINI_API_KEY", "").strip()
    main = os.getenv("GEMINI_MODEL", "").strip() or DEFAULT_MODEL
    fallbacks = os.getenv("GEMINI_FALLBACK_MODELS", DEFAULT_FALLBACKS).split(",")
    models = []
    for m in [main, *fallbacks]:
        m = m.strip()
        if m and m not in models:
            models.append(m)
    return key, models


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, asyncio.TimeoutError):
        return True
    msg = f"{exc.__class__.__name__} {exc}".lower()
    return any(marker in msg for marker in _RETRYABLE)


def build_prompt(today: date) -> str:
    week = ", ".join(f"{WEEKDAYS_UZ[(today + timedelta(days=i)).weekday()]} = {(today + timedelta(days=i)).isoformat()}"
                     for i in range(1, 8))
    return PROMPT.format(today=today.isoformat(), today_wd=WEEKDAYS_UZ[today.weekday()], week_table=week)


async def _call_gemini(image_bytes: bytes, mime: str, prompt: str, model: str, key: str) -> str:
    """Один запрос к одной модели Gemini. Возвращает текст JSON. Подменяется в тестах."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    cfg = types.GenerateContentConfig(temperature=0.0, response_mime_type="application/json",
                                      response_schema=PhotoParsed)
    resp = await client.aio.models.generate_content(
        model=model, contents=[types.Part.from_bytes(data=image_bytes, mime_type=mime), prompt], config=cfg)
    return (resp.text or "").strip()


def detect_mime(image_bytes: bytes, filename: str | None = None) -> str | None:
    head = image_bytes[:16]
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG"):
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"heis"):
        return "image/heic"
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if filename:
        ext = Path(filename).suffix.lower()
        return {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
                ".heic": "image/heic", ".heif": "image/heif", ".pdf": "application/pdf"}.get(ext)
    return None


async def aparse_photo(image_bytes: bytes, mime: str | None = None, today: date | None = None) -> dict:
    """Фото -> {"intent","events","transcript"}. Никогда не бросает исключений."""
    today = today or clock.today()              # «сегодня» по Ташкенту, а не по UTC сервера
    if not image_bytes:
        return error_result("bo'sh fayl")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        return error_result("rasm juda katta (15 MB dan oshmasin)")
    mime = (mime or "").split(";")[0].strip().lower() or detect_mime(image_bytes)
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_MIME:
        return error_result(f"bu turdagi fayl qo'llanmaydi: {mime or 'noma`lum'}")

    key, models = _settings()
    if not key:
        return error_result("GEMINI_API_KEY yo'q (backend/extras/.env)")

    prompt = build_prompt(today)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + TIMEOUT_SECONDS
    text, last_error = None, "noma'lum xato"
    for model in models:
        left = deadline - loop.time()
        if left <= 1:
            last_error = "sun'iy intellekt javob bermadi (timeout)"
            break
        try:
            text = await asyncio.wait_for(_call_gemini(image_bytes, mime, prompt, model, key),
                                          min(ATTEMPT_TIMEOUT, left))
            break
        except Exception as exc:  # сеть, квота, ключ, модель — программа не падает
            last_error = ("sun'iy intellekt javob bermadi (timeout)" if isinstance(exc, asyncio.TimeoutError)
                          else (str(exc)[:300] or exc.__class__.__name__))
            log.warning("vision: model %s failed: %s", model, last_error)
            if not _retryable(exc):
                break
    if text is None:
        return error_result(last_error)

    try:
        raw = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        log.error("vision: not JSON: %s", (text or "")[:300])
        return error_result("javob JSON emas")
    if not isinstance(raw, dict):
        return error_result("javob JSON obyekt emas")
    return postprocess(raw, today)


def parse_photo(image_bytes: bytes, mime: str | None = None, today: date | None = None) -> dict:
    """Синхронная обёртка для скриптов и тестов. В async-коде (бот) — await aparse_photo(...)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(aparse_photo(image_bytes, mime, today))
    raise RuntimeError("parse_photo вызван внутри event loop — используйте await aparse_photo(...)")


# --- CLI ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m extras.vision", description="Фото -> события Flowcast (JSON)")
    ap.add_argument("path", help="фото накладной, чека или скриншота")
    ap.add_argument("--today", help="сегодняшняя дата YYYY-MM-DD (по умолчанию — системная)")
    args = ap.parse_args(argv)

    path = Path(args.path)
    if not path.is_file():
        print(f"Файл не найден: {path}", file=sys.stderr)
        return 2
    try:
        today = date.fromisoformat(args.today) if args.today else clock.today()
    except ValueError:
        print(f"Неверная дата --today: {args.today}", file=sys.stderr)
        return 2
    data = path.read_bytes()
    result = parse_photo(data, detect_mime(data, path.name), today)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    for stream in (sys.stdout, sys.stderr):                 # консоль не UTF-8 (Windows): «?» вместо падения
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    sys.exit(main())
