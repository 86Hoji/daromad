import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import db  # noqa: E402


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    """Отдельная пустая БД на каждый тест."""
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    return tmp_path / "test.db"
