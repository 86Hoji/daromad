"""Время Ташкента для всех модулей extras — независимо от часового пояса сервера.

На Railway/Render сервер живёт в UTC: datetime.now() там на 5 часов меньше, и «сегодня» до 05:00
по Ташкенту было бы вчерашним днём. В Узбекистане нет перехода на летнее время, поэтому
фиксированный UTC+5 точен и не требует tzdata (её нет в Windows-Python по умолчанию).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

TASHKENT = timezone(timedelta(hours=5), "Asia/Tashkent")


def now() -> datetime:
    """Текущее время Ташкента без tzinfo (так оно хранится в строках YYYY-MM-DD HH:MM:SS), без микросекунд."""
    return datetime.now(TASHKENT).replace(tzinfo=None, microsecond=0)


def today() -> date:
    return now().date()


def stamp() -> str:
    return now().strftime("%Y-%m-%d %H:%M:%S")
