"""Вся цепочка на НОВЫХ данных (не демо-сид): другие магазины, имена, форматы телефона, суммы.

Цель — убедиться, что код не «подогнан» под Alisher/Dilshod: preview -> remind -> pay -> confirm
через API для каждого долга, плюс случайная проверка текста SMS на тысячах комбинаций.
"""
import random
import re
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from extras import adapters, dev_app, payments, sms

SHOPS = {
    10: {"id": 10, "name": "Gʻayrat aka magazini", "owner_name": "Gʻayrat"},        # ʻ (U+02BB)
    11: {"id": 11, "name": "Продукты «Ширин»", "owner_name": "Ширин"},                  # кириллица + «»
    12: {"id": 12, "name": "Toshkent shahar Chilonzor tumani 7-mavze oziq-ovqat do'koni", "owner_name": "X"},
}
DEBTS = [
    # id, shop, person, phone (как ввели), amount, remaining
    (101, 10, "Shahzod", "+998 (93) 555-12-34", 1_000, 1_000),
    (102, 10, "Oʻgʻiloy opa", "93 555 12 35", 2_750_000, 2_750_000),
    (103, 11, "Шахзод Каримов", "998935551236", 12_345_678, 12_345_678),
    (104, 11, "Мухаммадали", "+998935551237", 999_999_999, 999_999_999),
    (105, 12, "Abdurahmonov Muhammadjon Ismoilovich", "998 93 555 12 38", 480_000, 130_000),  # частично погашен
    (106, 12, "", "998935551239", 75_500, 75_500),                                         # без имени
]


@pytest.fixture(autouse=True)
def new_world(monkeypatch, tmp_path):
    adapters.reset()
    monkeypatch.setattr(payments, "TOKENS_PATH", tmp_path / "tokens.json")
    monkeypatch.setattr(payments, "EXTRAS_DIR", tmp_path)
    monkeypatch.setattr(sms, "OUTBOX_PATH", tmp_path / "outbox.jsonl")
    monkeypatch.setattr(sms, "EXTRAS_DIR", tmp_path)
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://daromad-demo.up.railway.app")
    adapters._shops.update({k: dict(v) for k, v in SHOPS.items()})
    for did, shop, person, phone, amount, remaining in DEBTS:
        adapters._debts[did] = {"id": did, "shop_id": shop, "person_name": person, "phone": phone,
                                "sms_consent": True, "amount": amount, "remaining": remaining,
                                "status": "open", "created_at": "2026-11-20 09:00:00"}
    yield
    adapters.reset()


def money(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def norm(phone: str) -> str:
    return ("998" + re.sub(r"\D", "", phone))[-12:]


@pytest.mark.parametrize("did,shop,person,phone,amount,remaining", DEBTS, ids=[str(d[0]) for d in DEBTS])
def test_full_chain_on_new_debt(did, shop, person, phone, amount, remaining, capsys):
    c = TestClient(dev_app.app)
    p = c.post(f"/api/debts/{did}/remind/preview").json()
    assert p["can_send"] is True, p
    text = p["sms_text"]
    assert len(text) <= 160 and text.isascii(), text                 # одно SMS латиницей (GSM-7)
    assert f"{money(remaining)} so'm" in text                         # остаток, не исходная сумма
    assert p["pay_url"] in text and p["pay_url"].startswith("https://daromad-demo.up.railway.app/pay/")
    assert p["phone"] == f"+{norm(phone)[:5]} *** ** {norm(phone)[-2:]}"

    r = c.post(f"/api/debts/{did}/remind").json()
    assert r["status"] == "sent" and r["sms_text"] == text and r["pay_url"] == p["pay_url"]
    [out] = sms.read_outbox()
    assert out["phone"] == norm(phone) and out["text"] == text
    assert c.post(f"/api/debts/{did}/remind").json()["error"] == "too_soon"

    tok = r["pay_url"].rsplit("/", 1)[1]
    info = c.get(f"/api/pay/{tok}").json()
    assert info["amount"] == remaining and info["status"] == "open" and "phone" not in info
    assert info["shop_name"] == SHOPS[shop]["name"] and info["person_name"] == person

    first = c.post(f"/api/pay/{tok}/confirm").json()
    second = c.post(f"/api/pay/{tok}/confirm").json()
    assert first["already_paid"] is False and second["already_paid"] is True
    assert adapters.get_debt(did)["status"] == "closed" and adapters.get_debt(did)["remaining"] == 0
    assert [x["amount"] for x in adapters.payments] == [remaining]   # списано ровно один раз
    assert adapters.notifications[-1]["text"] == f"{person or 'Mijoz'} to'ladi ✅ {money(remaining)} so'm"
    assert f"to'ladi ✅ {money(remaining)} so'm" in capsys.readouterr().out
    assert c.post(f"/api/debts/{did}/remind").json()["error"] == "debt_closed"


def test_shop_and_person_names_transliterated_and_quotes_safe():
    c = TestClient(dev_app.app)
    t_uz = c.post("/api/debts/102/remind/preview").json()["sms_text"]
    t_ru = c.post("/api/debts/103/remind/preview").json()["sms_text"]
    assert "G'ayrat aka" in t_uz                                         # магазин узнаваем, не «G'ay.»
    assert "Produkti Shir" in t_ru and t_ru.isascii()                   # кириллица -> латиница, «» убраны
    short = sms.build_reminder_text("Продукты «Ширин»", "Шахзод Каримов", 12_345_678, "http://x.uz/pay/" + "t" * 43)
    assert "Shaxzod" in short and "Produkti Shirin" in short and short.isascii()


def test_all_new_debts_in_parallel_one_sms_each():
    from concurrent.futures import ThreadPoolExecutor
    c = TestClient(dev_app.app)
    ids = [d[0] for d in DEBTS] * 3                                   # каждый долг — 3 нажатия сразу
    with ThreadPoolExecutor(12) as ex:
        codes = list(ex.map(lambda i: c.post(f"/api/debts/{i}/remind").json().get("status", "x"), ids))
    assert codes.count("sent") == len(DEBTS)
    assert sorted(o["phone"] for o in sms.read_outbox()) == sorted(norm(d[3]) for d in DEBTS)


def test_sms_text_random_fuzz():
    """3000 случайных комбинаций: всегда <= 160, ASCII, ссылка целиком, сумма с пробелами."""
    rnd = random.Random(20261121)
    names = ["", "Ali", "Oʻgʻiloy", "Шахзод", "Abdurahmonov Muhammadjon Ismoilovich", "Nigora opa",
             "Д'Артаньян", "Ёқубжон", "x" * 70, "Mr. \"Quote\" «Test»"]
    shops = ["", "Do'kon", "Продукты «Ширин»", "Gʻayrat aka magazini", "S" * 120, "Ўзбекистон савдо"]
    refused = 0
    for _ in range(3000):
        amount = rnd.choice([1, 999, 1_000, 45_500, rnd.randint(1, 999_999_999), 999_999_999])
        url = "https://" + "a" * rnd.randint(5, 60) + ".app/pay/" + "x" * 43
        try:
            t = sms.build_reminder_text(rnd.choice(shops), rnd.choice(names), amount, url)
        except ValueError:
            refused += 1
            assert len(url) > 120                                     # отказ только когда ссылка не влезает
            continue
        assert len(t) <= 160 and t.isascii() and url in t
        assert f"{money(amount)} so'm" in t
    assert refused == 0


def test_expiry_is_counted_from_send_not_preview():
    c = TestClient(dev_app.app)
    p = c.post("/api/debts/101/remind/preview").json()
    tok = p["pay_url"].rsplit("/", 1)[1]
    created = payments.load_tokens()[tok]["created_at"]
    r = c.post("/api/debts/101/remind").json()
    sent = datetime.strptime(r["sent_at"], payments.TIME_FMT)
    assert payments.load_tokens()[tok]["expires_at"] == payments._fmt(sent + payments.TOKEN_TTL)
    assert created <= r["sent_at"]
