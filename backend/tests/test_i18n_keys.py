"""Все строки интерфейса (t("...")) переведены в ru.ts и en.ts — запускает miniapp/scripts/check_i18n.py."""
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[2] / "miniapp" / "src"


def test_frontend_dictionaries_cover_all_keys():
    r = subprocess.run([sys.executable, str(SRC.parent / "scripts" / "check_i18n.py"), "lib/locales/ru.ts", "lib/locales/en.ts"],
                       cwd=SRC, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout + r.stderr
