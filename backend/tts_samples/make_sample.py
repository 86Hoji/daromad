r"""Реальный образец голосового ответа: «Kim menga qarz?» для демо-бизнеса -> tts_samples/kim_menga_qarz.{ogg,txt}.
Запуск из backend/:  C:\venvs\daromad\Scripts\python.exe tts_samples\make_sample.py"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config  # noqa: E402
import pipeline  # noqa: E402
import tts  # noqa: E402

OUT = Path(__file__).resolve().parent


async def main() -> None:
    q = "Kim menga qarz?"
    answer, facts = await pipeline.answer_full(config.DEV_SHOP_ID, q)
    spoken = pipeline.voice_text(q, answer, facts)
    print("javob:", answer, "\novoz uchun:", spoken, sep="\n")
    data = await tts.synthesize(spoken, fmt="ogg")
    if not data:
        sys.exit("TTS ishlamadi (kalit, model yoki tarmoq)")
    ext = "ogg" if tts.audio_mime(data) == "audio/ogg" else "wav"
    (OUT / f"kim_menga_qarz.{ext}").write_bytes(data)
    (OUT / "kim_menga_qarz.txt").write_text(f"{answer}\n\n--- ovoz uchun ---\n{spoken}\n", encoding="utf-8")
    print("saqlandi:", OUT / f"kim_menga_qarz.{ext}", len(data), "bayt")


asyncio.run(main())
