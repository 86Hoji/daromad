"""Gemini: понимает речь и извлекает события. Ничего не считает.

parse_input(audio=... | text=...) -> dict (intent, events, question, question_date, transcript)
answer_question(question, facts) -> str  (формулирует ответ только из переданных цифр)
parse_photo(image_bytes) -> заглушка (фаза 3)
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from datetime import date, timedelta
from typing import Optional

from pydantic import BaseModel

import config
import uz_numbers
from logic import WEEKDAYS_UZ

log = logging.getLogger("daromad.ai")


class AIUnavailable(Exception):
    """Gemini недоступен / не настроен. Сообщение — для пользователя (узбекский)."""


# --- схема ответа (JSON mode) ----------------------------------------------------

class AIEvent(BaseModel):
    type: str
    amount: int
    amount_text: Optional[str] = None
    person: Optional[str] = None
    phone: Optional[str] = None
    category: Optional[str] = None
    due_date: Optional[str] = None
    note: Optional[str] = None


class AIParsed(BaseModel):
    intent: str
    events: list[AIEvent]
    question: Optional[str] = None
    question_date: Optional[str] = None
    transcript: str


PROMPT = """Sen "Daromad" — O'zbekistondagi kichik va mikro biznes egasining ovozli moliyaviy yordamchisisan
(kafe, ustaxona, xizmat ko'rsatish, savdo, ulgurji, YaTT, o'zini o'zi band qilganlar).
Egasi o'zbekcha (lotin yoki kirill), ruscha yoki aralash gapiradi. Vazifang — gapni tushunib,
FAQAT JSON qaytarish. Hech narsani hisoblama, faqat aytilganini ajrat.

Bugun: {today} ({today_wd}). Kelgusi kunlar sanasi (hafta kunini shu jadval bo'yicha sanaga aylantir):
{week_table}
"ertaga"/"завтра" = {tomorrow}, "indinga"/"послезавтра" = {after_tomorrow}.

intent:
- "record" — egasi nima sotgani, nima xarajat qilgani, kim qarz olgani/qaytargani yoki qaysi to'lov kutilayotganini aytsa.
- "question" — savol bersa ("Kim menga qarz?", "Bu hafta qancha sotdim?", "Payshanbagacha yetadimi?",
  "Кто мне должен?"). Unda events = [], question = savol matni, question_date = savoldagi sana (YYYY-MM-DD) yoki null.

events[].type:
- "sale" — sotuv ("sotdim", "savdo bo'ldi", "продал", "выручка").
- "expense" — xarajat ("to'ladim", "sotib oldim", "xarajat", "потратил", "заплатил").
- "debt_given" — mijoz qarzga oldi / nasiya ("qarz oldi", "nasiyaga berdim", "взял в долг"). person majburiy.
- "debt_returned" — mijoz qarzini qaytardi ("qarzini berdi", "qaytardi", "вернул долг"). person majburiy.
- "scheduled_payment" — kelajakdagi to'lov ("payshanba kuni yetkazib beruvchiga 3 million", "в четверг аренда").
  due_date majburiy (YYYY-MM-DD), note = nima uchun (masalan "yetkazib beruvchi"), person = kimga (ismi aytilsa).

amount — butun son, so'mda. Misollar: "150 ming" = 150000, "2 million 300 ming" = 2300000,
"bir yarim million" = 1500000, "yarim million" = 500000, "1,5 mln" = 1500000, "ikki yuz ellik ming" = 250000,
"полтора миллиона" = 1500000, "150к" = 150000.
amount_text — transcript ichidagi aynan shu summani bildiruvchi bo'lak, so'zma-so'z (masalan "2 million 300 ming").
category (sale/expense uchun): tovar | ijara | maosh | kommunal | transport | boshqa — taxmin qil
(paket, mayda narsalar -> boshqa; yo'l, benzin, taksi -> transport; svet, gaz, suv -> kommunal; ish haqi -> maosh).
phone — telefon aytilsa yoki [PHONE_n] tokeni bo'lsa, o'shani qaytar (tokenni o'zgartirmay).
transcript — aytilgan gapning to'liq matni (ovoz bo'lsa — eshitganingni yoz, tarjima qilma).
Agar gap tushunarsiz bo'lsa: intent="record", events=[], transcript = eshitganing.
"""

QUESTION_PROMPT = """Sen "Daromad" yordamchisisan. Biznes egasining savoliga o'zbek tilida (lotin) qisqa javob ber (1-4 gap).
QATTIQ QOIDA: faqat quyidagi FAKTLARdagi raqamlarni ishlat, aynan shu ko'rinishda. Yangi raqam o'ylab topma,
hech narsani qo'shma, ayirma, hisoblama. Kerakli fakt bo'lmasa — "bu haqda ma'lumot yo'q" de.
Summalarni "1 200 000 so'm" ko'rinishida yoz.

SAVOL: {question}

FAKTLAR (JSON):
{facts}
"""

# --- маскирование телефонов -------------------------------------------------------

PHONE_RE = re.compile(r"(?<!\d)(?:\+?998[\s\-()]*)?\(?\d{2}\)?[\s\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")


def mask_phones(text: str) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}

    def repl(m: re.Match) -> str:
        token = f"[PHONE_{len(mapping) + 1}]"
        mapping[token] = normalize_phone(m.group(0))
        return token

    return PHONE_RE.sub(repl, text), mapping


def unmask(value: str | None, mapping: dict[str, str]) -> str | None:
    if not value:
        return value
    for token, phone in mapping.items():
        value = value.replace(token, phone)
    return value


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return "+" + digits
    return None


# --- клиент ----------------------------------------------------------------------

_client = None


def _get_client():
    global _client
    if not config.GEMINI_API_KEY:
        raise AIUnavailable("Sun'iy intellekt sozlanmagan (GEMINI_API_KEY yo'q). Administratorga xabar bering.")
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


# Резервная цепочка моделей. gemini-2.5-flash недоступна новым ключам (Google: 404, советует 3.8-flash);
# flash-модели бывают перегружены (503), поэтому в конце — лёгкая flash-lite.
FALLBACK_MODELS = ("gemini-3.8-flash", "gemini-3.5-flash-lite")
CALL_TIMEOUT = 25        # секунд на одну попытку
RETRIES_PER_MODEL = 1    # повторов на временную ошибку перед переходом к следующей модели
COOLDOWN = 300           # после сбоя модель пропускается 5 минут, чтобы не ждать её таймаут каждый раз
_cooldown_until: dict[str, float] = {}


def _is_model_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "404" in msg or "not found" in msg or "not supported" in msg or "no longer available" in msg


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, asyncio.TimeoutError):
        return True
    msg = str(exc).lower()
    return any(s in msg for s in ("503", "unavailable", "429", "resource_exhausted", "overloaded", "deadline"))


def _model_chain() -> list[str]:
    chain = [config.GEMINI_MODEL]
    chain += [m for m in FALLBACK_MODELS if m not in chain]
    now = time.monotonic()
    ready = [m for m in chain if _cooldown_until.get(m, 0) <= now]
    return ready or chain   # если все «остывают» — пробуем все


async def _generate(contents, schema=None, temperature: float = 0.0) -> str:
    from google.genai import types

    client = _get_client()
    cfg = types.GenerateContentConfig(temperature=temperature)
    if schema is not None:
        cfg.response_mime_type = "application/json"
        cfg.response_schema = schema

    last_exc: Exception | None = None
    for model in _model_chain():
        for attempt in range(RETRIES_PER_MODEL + 1):
            try:
                resp = await asyncio.wait_for(
                    client.aio.models.generate_content(model=model, contents=contents, config=cfg), CALL_TIMEOUT)
            except Exception as exc:  # сеть, квота, неверная модель — бот не должен падать
                last_exc = exc
                what = "timeout" if isinstance(exc, asyncio.TimeoutError) else str(exc)[:160]
                if _is_model_error(exc):
                    log.error("Gemini model '%s' mavjud emas: %s. Maslahat: .env da GEMINI_MODEL=%s qilib qo'ying.",
                              model, what, FALLBACK_MODELS[0])
                    _cooldown_until[model] = time.monotonic() + COOLDOWN
                    break                      # к следующей модели
                if _is_transient(exc):
                    log.warning("Gemini '%s' vaqtincha band (%s)", model, what)
                    if attempt < RETRIES_PER_MODEL:
                        await asyncio.sleep(1.0)
                        continue
                    _cooldown_until[model] = time.monotonic() + COOLDOWN
                    break                      # к следующей модели
                log.error("Gemini xatosi (%s): %s", model, what)
                raise AIUnavailable("Hozir sun'iy intellekt bilan bog'lanib bo'lmadi. "
                                    "Birozdan keyin qayta urinib ko'ring.") from exc
            if model != config.GEMINI_MODEL:
                log.info("Gemini javobi zaxira model '%s' dan olindi", model)
            text = (resp.text or "").strip()
            if not text:
                raise AIUnavailable("Sun'iy intellekt bo'sh javob qaytardi. Qayta urinib ko'ring.")
            return text
    log.error("Gemini: barcha modellar ishlamadi (%s). Oxirgi xato: %s", ", ".join(_model_chain()), last_exc)
    raise AIUnavailable("Hozir sun'iy intellekt band. Bir daqiqadan keyin qayta urinib ko'ring.") from last_exc


def _week_table(today: date) -> str:
    lines = []
    for i in range(1, 8):
        d = today + timedelta(days=i)
        lines.append(f"- {WEEKDAYS_UZ[d.weekday()]} = {d.isoformat()}")
    return "\n".join(lines)


def build_prompt(today: date) -> str:
    return PROMPT.format(
        today=today.isoformat(), today_wd=WEEKDAYS_UZ[today.weekday()], week_table=_week_table(today),
        tomorrow=(today + timedelta(days=1)).isoformat(), after_tomorrow=(today + timedelta(days=2)).isoformat())


# --- сверка сумм парсером -----------------------------------------------------------

def check_amount(ai_amount: int, amount_text: str | None, transcript: str) -> tuple[int, bool]:
    """Сверить сумму ИИ с детерминированным парсером. -> (amount, needs_check)."""
    parsed = uz_numbers.parse_amount(amount_text)
    if parsed is not None and parsed >= 1000:
        if parsed != ai_amount:
            return parsed, True
        return ai_amount, False
    candidates = uz_numbers.find_amounts(transcript or "")
    return ai_amount, ai_amount not in candidates


def postprocess(raw: dict, mapping: dict[str, str]) -> dict:
    """Восстановить телефоны, сверить суммы. Валидацию типов/дат делает pipeline."""
    transcript = unmask(raw.get("transcript") or "", mapping)
    events = []
    for ev in raw.get("events") or []:
        ev = dict(ev)
        for k in ("person", "note", "amount_text"):
            ev[k] = unmask(ev.get(k), mapping)
        phone = unmask(ev.get("phone"), mapping)
        ev["phone"] = normalize_phone(phone) if phone else None
        amount, needs_check = check_amount(int(ev.get("amount") or 0), ev.get("amount_text"), transcript)
        ev["ai_amount"] = ev.get("amount")
        ev["amount"] = amount
        ev["needs_check"] = needs_check
        events.append(ev)
    return {
        "intent": raw.get("intent") if raw.get("intent") in ("record", "question") else "record",
        "events": events,
        "question": unmask(raw.get("question"), mapping),
        "question_date": raw.get("question_date"),
        "transcript": transcript,
    }


# --- публичные функции ------------------------------------------------------------

async def parse_input(audio: bytes | None = None, text: str | None = None,
                      mime_type: str = "audio/ogg", today: date | None = None) -> dict:
    from google.genai import types

    today = today or date.today()
    prompt = build_prompt(today)
    mapping: dict[str, str] = {}
    if audio is not None:
        contents = [types.Part.from_bytes(data=audio, mime_type=mime_type or "audio/ogg"), prompt]
    elif text:
        masked, mapping = mask_phones(text)
        contents = [prompt, f"Egasining xabari:\n{masked}"]
    else:
        raise ValueError("audio yoki text kerak")

    raw_text = await _generate(contents, schema=AIParsed)
    try:
        raw = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        log.error("Gemini JSON emas: %s", raw_text[:500])
        raise AIUnavailable("Javobni tushuna olmadim. Qayta aytib ko'ring.") from exc
    return postprocess(raw, mapping)


# "1 200 000" / "1,200,000" / "1200000" — группы строго по 3 цифры, чтобы "450 000, 21 kun" дало 450000 и 21
_NUM_RE = re.compile(r"\d{1,3}(?:[   .,]\d{3})+(?!\d)|\d+")


def _numbers_in(obj) -> set[int]:
    out: set[int] = set()
    if isinstance(obj, dict):
        for v in obj.values():
            out |= _numbers_in(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out |= _numbers_in(v)
    elif isinstance(obj, bool):
        pass
    elif isinstance(obj, (int, float)):
        out.add(int(obj))
    elif isinstance(obj, str):
        for m in _NUM_RE.finditer(obj):
            out.add(int(re.sub(r"\D", "", m.group(0))))
    return out


def answer_uses_only_facts(answer: str, facts: dict) -> bool:
    allowed = _numbers_in(facts)
    for m in _NUM_RE.finditer(answer):
        n = int(re.sub(r"\D", "", m.group(0)) or 0)
        if n <= 31:              # дни, числа месяца, порядковые
            continue
        if n not in allowed:
            return False
    return True


async def answer_question(question: str, facts: dict) -> str:
    masked_q, _ = mask_phones(question)
    prompt = QUESTION_PROMPT.format(question=masked_q, facts=json.dumps(facts, ensure_ascii=False, indent=1))
    return await _generate([prompt], temperature=0.2)


async def parse_photo(image_bytes: bytes) -> dict:
    """Распознавание чеков/скриншотов — фаза 3."""
    raise NotImplementedError("Rasm orqali kiritish keyingi bosqichda qo'shiladi.")
