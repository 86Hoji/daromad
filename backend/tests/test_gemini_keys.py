"""Переключение ключей Gemini: текст (parse и ответы), фото, TTS. Только подделки, без сети."""
import asyncio
from types import SimpleNamespace

import pytest

import ai
import config
import gemini_keys
import tts
from extras import vision


@pytest.mark.parametrize("error", ["429 RESOURCE_EXHAUSTED", "quota exceeded", "403 PERMISSION_DENIED"])
def test_switches_to_next_key(monkeypatch, error):
    monkeypatch.setattr(config, "GEMINI_API_KEYS", ["k1", "k2"])
    monkeypatch.setattr(config, "GEMINI_API_KEY", "k1")
    monkeypatch.setattr(gemini_keys, "_active", {})
    used = []

    def answer(value):
        used.append(gemini_keys.current())
        if used[-1] == "k1":
            raise RuntimeError(error)
        return value

    async def generate(**kw):
        return answer(SimpleNamespace(text="ok"))

    async def photo(*a):
        return answer("{}")

    async def speech(text):
        return answer((b"pcm", "audio/L16;rate=24000"))

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
    monkeypatch.setattr(ai, "_get_client", lambda: client)
    monkeypatch.setattr(vision, "_call_gemini", photo)
    monkeypatch.setattr(tts, "_generate", speech)
    monkeypatch.setattr(tts, "_disk_get", lambda k: None)
    monkeypatch.setattr(tts, "_disk_put", lambda *a: None)
    monkeypatch.setattr(tts, "_cache", type(tts._cache)())

    assert asyncio.run(ai._generate(["x"])) == "ok"
    assert asyncio.run(vision._call_with_failover(b"i", "image/png", "p", "m", "k1")) == "{}"
    assert asyncio.run(tts.synthesize_pcm("salom"))
    assert used == ["k1", "k2"] * 3


def test_single_key_fallback(monkeypatch):
    monkeypatch.setattr(config, "GEMINI_API_KEYS", [])
    monkeypatch.setattr(config, "GEMINI_API_KEY", "single")
    assert gemini_keys.keys() == ["single"]
