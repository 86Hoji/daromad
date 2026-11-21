"""Настройки из backend/.env (одно место для всего конфига)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "").strip()
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "").strip() or "gemini-flash-latest"
WEBAPP_URL: str = os.getenv("WEBAPP_URL", "").strip()
DEV_SHOP_ID: int = int(os.getenv("DEV_SHOP_ID", "1") or 1)
DB_PATH: Path = Path(os.getenv("DAROMAD_DB", "") or (BASE_DIR / "data" / "daromad.db"))

# голосовые ответы (TTS)
GEMINI_TTS_MODEL: str = os.getenv("GEMINI_TTS_MODEL", "").strip() or "gemini-3.8-flash-tts"
GEMINI_TTS_VOICE: str = os.getenv("GEMINI_TTS_VOICE", "").strip() or "Fola"
VOICE_REPLIES: bool = os.getenv("VOICE_REPLIES", "1").strip() not in ("0", "false", "no", "")

# POST /api/demo/reset (кнопка «Demo reset» в /app): только для DEV_SHOP_ID и только при DEMO_RESET=1
DEMO_RESET: bool = os.getenv("DEMO_RESET", "0").strip() in ("1", "true", "yes")


def env(name: str, default: str = "") -> str:
    """Чтение настройки в момент вызова (а не при импорте) — модули extras и тесты меняют их через окружение."""
    return os.getenv(name, default).strip()


# --- SMS-напоминания и оплата по ссылке (backend/extras) ----------------------------------
# Значения читаются через env() при каждом вызове; здесь — документация и значения по умолчанию.
#   SMS_PROVIDER      mock (SMS пишется в backend/data/outbox.jsonl) | eskiz (настоящая отправка)
#   ESKIZ_EMAIL, ESKIZ_PASSWORD, ESKIZ_FROM   — аккаунт Eskiz.uz (только в .env, не в git)
#   ESKIZ_TEST_MODE   1 = тестовый аккаунт Eskiz: уходит «Bu Eskiz dan test», владелец видит настоящий текст
#   SMS_ALLOWLIST, SMS_ALLOW_ANY — защита от SMS незнакомцам в режиме eskiz
#   PUBLIC_BASE_URL   адрес фронтенда: ссылка в SMS = {PUBLIC_BASE_URL}/pay/{token}
ESKIZ_TEST_MODE_DEFAULT = "1"


def _digits_phone(raw: str) -> str:
    d = "".join(ch for ch in raw if ch.isdigit())
    if len(d) == 9:
        d = "998" + d
    return "+" + d if len(d) == 12 and d.startswith("998") else ""


# Номер демо-должника (Alisher в seed.py): свой или командный, чтобы демо-SMS не ушло незнакомцу.
DEMO_DEBTOR_PHONE: str = _digits_phone(os.getenv("DEMO_DEBTOR_PHONE", ""))


def public_base_url() -> str:
    """PUBLIC_BASE_URL, иначе WEBAPP_URL без /tg, иначе локальный Vite."""
    url = env("PUBLIC_BASE_URL")
    if not url and env("WEBAPP_URL"):
        url = env("WEBAPP_URL").rstrip("/")
        url = url[:-3] if url.endswith("/tg") else url
    return (url or "http://localhost:5173").rstrip("/")
