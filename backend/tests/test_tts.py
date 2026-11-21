"""TTS: форматы, конвертация PCM -> OGG/Opus на фейковых байтах, сокращение для голоса, таймаут/кэш, /api/tts."""
import asyncio
import io
import math
import struct
import wave

import pytest

import config
import pipeline
import tts

RATE = 24000


def fake_pcm(seconds: float = 1.0, extra: int = 37) -> bytes:
    n = int(RATE * seconds) + extra  # некратно размеру кадра Opus
    return b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 330 * i / RATE))) for i in range(n))


@pytest.fixture(autouse=True)
def clean_cache():
    tts._cache.clear()
    yield
    tts._cache.clear()


def test_parse_audio_mime_type():
    assert tts.parse_audio_mime_type("audio/L16;rate=24000") == {"bits_per_sample": 16, "rate": 24000}
    assert tts.parse_audio_mime_type("audio/L24; rate=16000") == {"bits_per_sample": 24, "rate": 16000}
    assert tts.parse_audio_mime_type("audio/L16") == {"bits_per_sample": 16, "rate": 24000}


def test_convert_to_wav_header_and_roundtrip():
    pcm = fake_pcm(0.2)
    wav = tts.convert_to_wav(pcm, "audio/L16;rate=24000")
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, RATE)
        assert w.readframes(w.getnframes()) == pcm
    assert tts.wav_to_pcm(wav) == (pcm, "audio/L16;rate=24000")


def test_pcm_to_ogg_opus_fake_bytes():
    import av

    pcm = fake_pcm(1.5)
    ogg = tts.pcm_to_ogg_opus(pcm)
    assert ogg[:4] == b"OggS" and tts.audio_mime(ogg) == "audio/ogg"
    with av.open(io.BytesIO(ogg)) as c:
        assert c.streams.audio[0].codec_context.name == "opus"
        seconds = sum(f.samples / f.sample_rate for f in c.decode(audio=0))
    assert 1.45 < seconds < 1.65


def test_encode_falls_back_to_wav(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no opus")

    monkeypatch.setattr(tts, "pcm_to_ogg_opus", boom)
    data = tts.encode(fake_pcm(0.1), "audio/L16;rate=24000", fmt="ogg")
    assert data[:4] == b"RIFF" and tts.audio_mime(data) == "audio/wav"


def test_for_voice_shortens_lists():
    text = ("Sizga jami 1 200 000 so'm qarz bor:\n• Alisher — 450 000 so'm\n• Nigora opa — 300 000 so'm\n"
            "• Bobur — 150 000 so'm\n• Malika — 120 000 so'm\n• Jasur — 100 000 so'm")
    out = tts.for_voice(text)
    assert out.startswith("Sizga jami 1 200 000 so'm qarz bor:")
    assert "Bobur" in out and "Malika" not in out and "va yana 2 ta" in out
    assert tts.for_voice("<b>Salom</b> 👋") == "Salom."


def test_voice_text_debts_top3_and_total():
    facts = {"jami_qarzdorlik": 1_200_000, "qarzdorlar": [
        {"ism": "Bobur", "qarz": 150_000}, {"ism": "Alisher", "qarz": 450_000}, {"ism": "Jasur", "qarz": 100_000},
        {"ism": "Nigora opa", "qarz": 300_000}, {"ism": "Sardor", "qarz": 80_000}]}
    out = pipeline.voice_text("Kim menga qarz?", "uzun javob", facts)
    assert out.startswith("Sizga jami 1 200 000 so'm qarz bor.")
    assert out.index("Alisher") < out.index("Nigora opa") < out.index("Bobur")
    assert "Jasur" not in out and "va yana 2 kishi" in out
    # не про долги — обычное сокращение текста ответа
    assert pipeline.voice_text("Bugun qancha sotdim?", "Sotuv: bugun 2 300 000 so'm", facts) == "Sotuv: bugun 2 300 000 so'm."


def test_synthesize_without_key_is_silent(monkeypatch):
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")
    assert asyncio.run(tts.synthesize("Salom")) is None


def test_synthesize_timeout_is_silent(monkeypatch):
    async def slow(text):
        await asyncio.sleep(1)

    monkeypatch.setattr(config, "GEMINI_API_KEY", "x")
    monkeypatch.setattr(tts, "TIMEOUT", 0.05)
    monkeypatch.setattr(tts, "_generate", slow)
    assert asyncio.run(tts.synthesize("Salom")) is None


def test_synthesize_ogg_and_cache(monkeypatch):
    calls = []

    async def fake(text):
        calls.append(text)
        return fake_pcm(0.3), "audio/L16;rate=24000"

    monkeypatch.setattr(config, "GEMINI_API_KEY", "x")
    monkeypatch.setattr(tts, "_generate", fake)
    a = asyncio.run(tts.synthesize("Kim menga qarz?"))
    b = asyncio.run(tts.synthesize("Kim menga qarz?", fmt="wav"))
    assert a[:4] == b"OggS" and b[:4] == b"RIFF"
    assert len(calls) == 1  # второй раз — из кэша


def test_api_tts(tmp_db, monkeypatch):
    from fastapi.testclient import TestClient

    import seed
    from main import app

    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(config, "DEV_SHOP_ID", 1)
    client = TestClient(app)

    async def none(text, fmt="ogg"):
        return None

    monkeypatch.setattr(tts, "synthesize", none)
    assert client.post("/api/tts", json={"text": "Salom"}).status_code == 503

    async def wav(text, fmt="ogg"):
        return tts.convert_to_wav(fake_pcm(0.1), "audio/L16;rate=24000")

    monkeypatch.setattr(tts, "synthesize", wav)
    r = client.post("/api/tts", json={"text": "Salom"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content[:4] == b"RIFF"
    assert client.post("/api/tts", json={"text": ""}).status_code == 422
