"""Голосовые ответы: Gemini TTS -> PCM (audio/L16;rate=24000) -> OGG/Opus для Telegram sendVoice
(или WAV, если кодирование в Opus недоступно). Ошибки и таймауты не роняют ответ: вызывающий шлёт только текст.

Сборка чанков, parse_audio_mime_type и convert_to_wav — как в стандартном примере AI Studio для TTS.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import re
import struct
from collections import OrderedDict

import config

log = logging.getLogger("flowcast.tts")

STYLE = "O'zbek tilida, xotirjam va aniq o'qing: "
TIMEOUT = 10.0
MAX_CHARS = 1200
_CACHE_SIZE = 64
# хэш текста -> (pcm, mime) ; конвертация в OGG/WAV дешёвая, кэшируем исходный звук
_cache: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()


# --- форматы (как в примере AI Studio) -------------------------------------------

def parse_audio_mime_type(mime_type: str) -> dict[str, int]:
    """«audio/L16;rate=24000» -> {"bits_per_sample": 16, "rate": 24000}."""
    bits_per_sample = 16
    rate = 24000
    for param in mime_type.split(";"):
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate = int(param.split("=", 1)[1])
            except (ValueError, IndexError):
                pass
        elif param.startswith("audio/L"):
            try:
                bits_per_sample = int(param.split("L", 1)[1])
            except (ValueError, IndexError):
                pass
    return {"bits_per_sample": bits_per_sample, "rate": rate}


def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    """Добавляет WAV-заголовок к сырому PCM."""
    p = parse_audio_mime_type(mime_type)
    bits_per_sample, sample_rate = p["bits_per_sample"], p["rate"]
    num_channels = 1
    data_size = len(audio_data)
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    chunk_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", chunk_size, b"WAVE", b"fmt ", 16, 1, num_channels,
        sample_rate, byte_rate, block_align, bits_per_sample, b"data", data_size,
    )
    return header + audio_data


def pcm_to_ogg_opus(pcm: bytes, mime_type: str = "audio/L16;rate=24000") -> bytes:
    """PCM s16le mono -> OGG/Opus (PyAV). Бросает исключение, если кодек недоступен."""
    import av

    rate = parse_audio_mime_type(mime_type)["rate"]
    if len(pcm) % 2:
        pcm = pcm[:-1]
    out = io.BytesIO()
    with av.open(out, mode="w", format="ogg") as container:
        stream = container.add_stream("libopus", rate=rate)
        stream.layout = "mono"
        stream.bit_rate = 32000
        stream.codec_context.open()
        step = stream.codec_context.frame_size or 960
        total = len(pcm) // 2
        for start in range(0, total, step):
            chunk = pcm[start * 2:(start + step) * 2]
            n = len(chunk) // 2
            if n < step:  # последний кадр добиваем тишиной — Opus принимает только кадры фиксированного размера
                chunk += b"\x00\x00" * (step - n)
            frame = av.AudioFrame(format="s16", layout="mono", samples=step)
            frame.planes[0].update(chunk)
            frame.sample_rate = rate
            frame.pts = start
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    return out.getvalue()


def wav_to_pcm(data: bytes) -> tuple[bytes, str]:
    """Модель может отдать уже WAV (audio/wav) — снимаем заголовок, остаётся PCM s16le."""
    import wave

    with wave.open(io.BytesIO(data)) as w:
        return w.readframes(w.getnframes()), f"audio/L{w.getsampwidth() * 8};rate={w.getframerate()}"


def audio_mime(data: bytes) -> str:
    return "audio/ogg" if data[:4] == b"OggS" else "audio/wav"


# --- текст для озвучки --------------------------------------------------------------

_BULLET = re.compile(r"^\s*(?:[•\-\*·–]|\d+[.)])\s*")
_TAGS = re.compile(r"<[^>]+>")
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")


def for_voice(text: str, top: int = 3) -> str:
    """Короче для уха: списки — топ-3 и «yana N ta», без HTML и эмодзи. Итоговая сумма обычно в первой строке
    («Sizga jami … qarz bor:») и сохраняется."""
    text = _EMOJI.sub("", _TAGS.sub("", text))
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    head, items, tail = [], [], []
    for ln in lines:
        if _BULLET.match(ln):
            items.append(_BULLET.sub("", ln))
        elif items:
            tail.append(ln)
        else:
            head.append(ln)
    parts = head[:]
    if items:
        shown = items[:top]
        rest = len(items) - len(shown)
        parts.append("; ".join(shown) + ("." if not rest else f"; va yana {rest} ta."))
    parts += tail
    out = " ".join(p if p.endswith((".", "!", "?", ":", ";")) else p + "." for p in parts)
    return re.sub(r"\s+", " ", out).strip()[:MAX_CHARS]


# --- синтез ------------------------------------------------------------------------

def _key(text: str) -> str:
    return hashlib.sha256(f"{config.GEMINI_TTS_MODEL}|{config.GEMINI_TTS_VOICE}|{text}".encode()).hexdigest()


_client = None


def _get_client():
    # speech_config есть только в v1beta (SDK по умолчанию ходит в v1 -> 400 «Unknown name speechConfig»)
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(api_key=config.GEMINI_API_KEY, http_options=types.HttpOptions(api_version="v1beta"))
    return _client


async def _generate(text: str) -> tuple[bytes, str]:
    from google.genai import types

    client = _get_client()
    cfg = types.GenerateContentConfig(
        response_modalities=["audio"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=config.GEMINI_TTS_VOICE))),
    )
    contents = [types.Content(role="user", parts=[types.Part.from_text(text=STYLE + text)])]
    pcm = bytearray()
    mime = "audio/L16;rate=24000"
    stream = await client.aio.models.generate_content_stream(model=config.GEMINI_TTS_MODEL, contents=contents, config=cfg)
    async for chunk in stream:
        if not chunk.candidates or not chunk.candidates[0].content or not chunk.candidates[0].content.parts:
            continue
        part = chunk.candidates[0].content.parts[0]
        if part.inline_data and part.inline_data.data:
            data, m = part.inline_data.data, (part.inline_data.mime_type or mime)
            if data[:4] == b"RIFF":
                data, m = wav_to_pcm(data)
            pcm += data
            mime = m
    if not pcm:
        raise RuntimeError("TTS: bo'sh javob")
    return bytes(pcm), mime


async def synthesize_pcm(text: str) -> tuple[bytes, str] | None:
    """(pcm, mime) или None. Таймаут 10 с, кэш по хэшу текста."""
    text = (text or "").strip()[:MAX_CHARS]
    if not text or not config.GEMINI_API_KEY:
        return None
    k = _key(text)
    if k in _cache:
        _cache.move_to_end(k)
        return _cache[k]
    try:
        res = await asyncio.wait_for(_generate(text), TIMEOUT)
    except Exception as exc:  # сеть, квота, таймаут, нет модели — молча без голоса
        log.warning("TTS ishlamadi: %s", exc)
        return None
    _cache[k] = res
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return res


def encode(pcm: bytes, mime: str, fmt: str = "ogg") -> bytes:
    if fmt == "ogg":
        try:
            return pcm_to_ogg_opus(pcm, mime)
        except Exception as exc:
            log.warning("OGG/Opus kodlash ishlamadi, WAV: %s", exc)
    return convert_to_wav(pcm, mime)


async def synthesize(text: str, fmt: str = "ogg") -> bytes | None:
    """Текст -> OGG/Opus (для sendVoice) или WAV (fmt="wav" либо если Opus недоступен). None — только текст."""
    res = await synthesize_pcm(text)
    if not res:
        return None
    return encode(*res, fmt=fmt)
