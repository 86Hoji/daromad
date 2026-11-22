"""Языки бота и бэкенда: определение языка, русские ответы, Accept-Language в веб-API. Gemini не вызывается."""
import asyncio

import ai
import bot
import db
import pipeline
import seed
import texts


def test_detect_lang():
    assert texts.detect_lang("Сегодня продал на 2 миллиона") == "ru"
    assert texts.detect_lang("Кто мне должен?") == "ru"
    assert texts.detect_lang("bugun 2 million sotdim") == "uz"
    assert texts.detect_lang("Бугун 2 миллион сотдим") == "uz"
    assert texts.detect_lang("Ким менга қарз?") == "uz"
    assert texts.detect_lang("1 500 000") is None
    assert texts.detect_lang("") is None


def test_norm_lang_and_translate():
    assert texts.norm_lang("ru-RU,ru;q=0.9") == "ru"
    assert texts.norm_lang("en") == "uz"
    assert texts.norm_lang(None) == "uz"
    assert texts._("Saqlandi", "ru") == "Сохранено"
    assert texts._("Saqlandi", "uz") == "Saqlandi"
    assert texts._("nima bu", "ru") == "nima bu"            # нет перевода -> исходная строка
    assert texts.fmt_money(1_234_567, "ru") == "1 235 000 сум"
    assert texts.days(1, "ru") == "1 день" and texts.days(3, "ru") == "3 дня" and texts.days(5, "ru") == "5 дней"


def test_ru_keys_have_same_placeholders():
    import re
    for k, v in texts.RU.items():
        assert set(re.findall(r"{(\w+)}", k)) == set(re.findall(r"{(\w+)}", v)), k


def test_postprocess_language_from_ai_or_heuristic():
    raw = {"intent": "record", "events": [], "transcript": "Сегодня продал на миллион"}
    assert ai.postprocess(dict(raw, language="uz"), {})["language"] == "uz"
    assert ai.postprocess(raw, {})["language"] == "ru"            # AI не вернул -> эвристика


def _fake_parse(language, intent="record", events=None, transcript="x"):
    async def fake(audio=None, text=None, mime_type=None, today=None):
        return {"intent": intent, "events": events or [], "question": transcript if intent == "question" else None,
                "question_date": None, "transcript": transcript, "language": language}
    return fake


def test_russian_errors_and_fallback_answer(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(ai, "parse_input", _fake_parse("ru"))
    res = asyncio.run(pipeline.process(1, text="что-то"))
    assert res["language"] == "ru"
    assert res["errors"] == ["Не нашёл ни одной записи. Например: «Сегодня продал на 2 миллиона»."]

    async def no_ai(question, facts, lang="uz"):
        raise ai.AIUnavailable("down")
    monkeypatch.setattr(ai, "answer_question", no_ai)
    monkeypatch.setattr(ai, "parse_input", _fake_parse("ru", intent="question", transcript="Кто мне должен?"))
    res = asyncio.run(pipeline.process(1, text="Кто мне должен?"))
    assert res["answer"].startswith("Вам должны всего")
    assert "сум" in res["answer"] and "kun" not in res["answer"]


def test_ai_answer_gets_language(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    seen = {}

    async def fake_answer(question, facts, lang="uz"):
        seen["lang"] = lang
        return "Ок."
    monkeypatch.setattr(ai, "answer_question", fake_answer)
    monkeypatch.setattr(ai, "parse_input", _fake_parse("ru", intent="question", transcript="Сколько продал?"))
    asyncio.run(pipeline.process(1, text="Сколько продал?"))
    assert seen["lang"] == "ru"


def test_uzbek_default_and_ui_lang_fallback(tmp_db, monkeypatch):
    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(ai, "parse_input", _fake_parse(None, transcript="1 500 000"))
    # язык не определился -> язык интерфейса (web), иначе узбекский
    assert asyncio.run(pipeline.process(1, text="1 500 000", lang="ru"))["language"] == "ru"
    assert asyncio.run(pipeline.process(1, text="1 500 000"))["language"] == "uz"


def test_bot_remembers_language_per_shop(tmp_db):
    seed.seed(reset=True, shop_id=1)
    db.execute("UPDATE shops SET tg_user_id=55 WHERE id=1")
    shop = db.get_shop(1)
    assert bot.user_lang(55, shop) == "uz"
    bot.remember_lang(55, "ru", shop)
    assert db.get_shop(1)["lang"] == "ru"
    bot.remember_lang(55, None, db.get_shop(1))                      # цифры без слов — язык не меняем
    assert bot.user_lang(55) == "ru"
    text, _ = bot.recommendation_message(1, "ru")
    assert "сум" in text and "so'm" not in text
    assert "сум" in bot.status_text(db.get_shop(1), "ru")


def test_owner_payment_text_in_russian(tmp_db):
    seed.seed(reset=True, shop_id=1)
    db.set_shop_lang(1, "ru")
    out = bot.owner_payment_text(1, "Alisher to'ladi ✅ 450 000 so'm")
    assert "Alisher оплатил(а) ✅ 450 000 сум" in out and "по ссылке" in out


def test_web_text_uses_accept_language(tmp_db, monkeypatch):
    from fastapi.testclient import TestClient
    import config
    import api
    from fastapi import FastAPI

    seed.seed(reset=True, shop_id=1)
    monkeypatch.setattr(config, "BOT_TOKEN", "")

    async def down(**kw):
        raise ai.AIUnavailable("Hozir sun'iy intellekt band. Bir daqiqadan keyin qayta urinib ko'ring.")
    monkeypatch.setattr(ai, "parse_input", down)
    app = FastAPI()
    app.include_router(api.router)
    r = TestClient(app).post("/api/text", json={"text": "привет"}, headers={"Accept-Language": "ru"})
    assert r.status_code == 503
    assert r.json()["detail"] == "ИИ сейчас перегружен. Попробуйте через минуту."
