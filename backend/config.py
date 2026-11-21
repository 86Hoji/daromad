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
