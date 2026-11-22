"""Несколько ключей Gemini: на 429 / квоту / 403 запрос уходит на следующий ключ."""
from __future__ import annotations

import logging
import re
from contextvars import ContextVar
from typing import Awaitable, Callable, TypeVar

import config

log = logging.getLogger("flowcast.keys")
T = TypeVar("T")

_current: ContextVar[str | None] = ContextVar("gemini_key", default=None)
_active: dict[str, str] = {}    # последний рабочий ключ; у TTS своя квота, поэтому отдельно по видам запросов
_SWITCH = re.compile(r"\b(429|403)\b|resource_exhausted|quota|permission_denied", re.I)


def keys() -> list[str]:
    many = config.GEMINI_API_KEYS
    return list(many) if many and many[0] == config.GEMINI_API_KEY else [config.GEMINI_API_KEY]


def current() -> str:
    return _current.get() or config.GEMINI_API_KEY


def should_switch(exc: BaseException) -> bool:
    return getattr(exc, "code", None) in (429, 403) or bool(_SWITCH.search(str(exc)))


async def run(scope: str, call: Callable[[], Awaitable[T]]) -> T:
    """Выполнить call(); внутри него current() — ключ текущей попытки. В лог идёт только номер ключа."""
    pool = keys()
    start = pool.index(_active[scope]) if _active.get(scope) in pool else 0
    errors: list[Exception] = []
    for key in pool[start:] + pool[:start]:
        token = _current.set(key)
        n = pool.index(key) + 1
        try:
            result = await call()
        except Exception as exc:
            if not should_switch(exc):
                raise
            errors.append(exc)
            log.warning("Gemini %s: key #%d quota/403", scope, n)
        else:
            _active[scope] = key
            log.info("Gemini %s: key #%d answered", scope, n)
            return result
        finally:
            _current.reset(token)
    # квота важнее 403: после неё вызывающий код ещё попробует запасную модель
    raise next((e for e in errors if "403" not in str(e)), errors[-1])
