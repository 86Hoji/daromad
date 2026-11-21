"""SQLite: схема и небольшие хелперы. Соединение открывается на каждый вызов."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    owner_name TEXT,
    opening_cash INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    kind TEXT NOT NULL CHECK (kind IN ('sale','expense')),
    amount INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'boshqa',
    note TEXT,
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'text',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed')),
    is_scheduled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_entries_shop_date ON entries(shop_id, date);
CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    person_name TEXT NOT NULL,
    phone TEXT,
    sms_consent INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    closed_at TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    close_source TEXT
);
CREATE TABLE IF NOT EXISTS debt_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER NOT NULL REFERENCES debts(id),
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'voice',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    title TEXT NOT NULL,
    counterparty TEXT,
    amount INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'voice',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid'))
);
CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    type TEXT NOT NULL CHECK (type IN ('overdraft','deposit')),
    amount INTEGER NOT NULL,
    term_days INTEGER NOT NULL,
    cost_or_income INTEGER NOT NULL,
    risk_text TEXT,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined')),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER,
    actor TEXT NOT NULL CHECK (actor IN ('owner','system','ai')),
    action TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL
);
-- Черновики: распознанные, но ещё не подтверждённые события.
CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    batch_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    source TEXT NOT NULL,
    needs_check INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_drafts_batch ON drafts(batch_id);
"""

TRUST_LABELS = {
    "voice": "so'zdan",
    "text": "so'zdan",
    "photo": "skrinshot",
    "bank": "tasdiqlangan",
    "link": "tasdiqlangan",
}


def trust_label(source: str | None) -> str:
    return TRUST_LABELS.get(source or "", "so'zdan")


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def db_path() -> Path:
    return config.DB_PATH


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def query(sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
    with connect() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def scalar(sql: str, params: tuple | list = ()) -> Any:
    with connect() as conn:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row else None


def execute(sql: str, params: tuple | list = ()) -> int:
    """Выполнить запрос, вернуть lastrowid."""
    with connect() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


def audit(shop_id: int | None, actor: str, action: str, payload: Any = None) -> None:
    execute(
        "INSERT INTO audit_log (shop_id, actor, action, payload_json, created_at) VALUES (?,?,?,?,?)",
        (shop_id, actor, action, json.dumps(payload, ensure_ascii=False, default=str), now_str()),
    )


# --- shops -----------------------------------------------------------------

def get_shop(shop_id: int) -> dict | None:
    return query_one("SELECT * FROM shops WHERE id = ?", (shop_id,))


def get_shop_by_tg(tg_user_id: int) -> dict | None:
    return query_one("SELECT * FROM shops WHERE tg_user_id = ?", (tg_user_id,))


def create_shop(tg_user_id: int | None, name: str, owner_name: str | None, opening_cash: int) -> int:
    shop_id = execute(
        "INSERT INTO shops (tg_user_id, name, owner_name, opening_cash, created_at) VALUES (?,?,?,?,?)",
        (tg_user_id, name, owner_name, opening_cash, now_str()),
    )
    audit(shop_id, "owner", "shop_created", {"name": name, "opening_cash": opening_cash})
    return shop_id
