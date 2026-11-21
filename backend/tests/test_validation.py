import hashlib
import hmac
import json
import time
from datetime import date, timedelta
from urllib.parse import urlencode

import pytest

import ai
import api
import pipeline

TODAY = date(2026, 11, 21)


@pytest.mark.parametrize("ev, ok", [
    ({"type": "sale", "amount": 2_300_000}, True),
    ({"type": "sale", "amount": 0}, False),
    ({"type": "sale", "amount": -5}, False),
    ({"type": "sale", "amount": 1_000_000_000}, False),
    ({"type": "refund", "amount": 1000}, False),
    ({"type": "debt_given", "amount": 150_000}, False),                      # нет имени
    ({"type": "debt_given", "amount": 150_000, "person": "Alisher"}, True),
    ({"type": "scheduled_payment", "amount": 3_000_000}, False),             # нет даты
    ({"type": "scheduled_payment", "amount": 3_000_000, "due_date": "2026-11-20"}, False),  # прошлое
    ({"type": "scheduled_payment", "amount": 3_000_000, "due_date": "2026-11-26"}, True),
    ({"type": "scheduled_payment", "amount": 3_000_000, "due_date": "2026-11-21"}, True),   # сегодня — можно
])
def test_validate_event(ev, ok):
    norm, err = pipeline.validate_event(ev, TODAY)
    assert (norm is not None) is ok
    assert (err is None) is ok


def test_validate_category_defaults():
    assert pipeline.validate_event({"type": "sale", "amount": 1000}, TODAY)[0]["category"] == "tovar"
    assert pipeline.validate_event({"type": "expense", "amount": 1000, "category": "xyz"}, TODAY)[0]["category"] == "boshqa"
    assert pipeline.validate_event({"type": "expense", "amount": 1000, "category": "Transport"}, TODAY)[0]["category"] == "transport"


def test_mask_and_unmask_phones():
    text = "Alisher 150 ming qarz oldi, telefoni +998 90 123-45-67, Bobur 93 555 77 88"
    masked, mapping = ai.mask_phones(text)
    assert "123" not in masked and "[PHONE_1]" in masked and "[PHONE_2]" in masked
    assert "150 ming" in masked                    # суммы не трогаем
    assert mapping["[PHONE_1]"] == "+998901234567"
    assert mapping["[PHONE_2]"] == "+998935557788"
    assert ai.unmask("tel [PHONE_2]", mapping) == "tel +998935557788"


def test_check_amount_prefers_parser():
    t = "Bugun 2 million 300 ming sotdim"
    assert ai.check_amount(2_300_000, "2 million 300 ming", t) == (2_300_000, False)
    assert ai.check_amount(2_030_000, "2 million 300 ming", t) == (2_300_000, True)     # ИИ ошибся
    assert ai.check_amount(2_300_000, None, t) == (2_300_000, False)                    # нашли в transcript
    assert ai.check_amount(5_000_000, None, t) == (5_000_000, True)                     # не нашли -> проверить


def test_postprocess_restores_phone_and_flags():
    raw = {"intent": "record", "transcript": "Alisher 150 ming qarz oldi [PHONE_1]",
           "events": [{"type": "debt_given", "amount": 15_000, "amount_text": "150 ming",
                       "person": "Alisher", "phone": "[PHONE_1]"}]}
    out = ai.postprocess(raw, {"[PHONE_1]": "+998901234567"})
    ev = out["events"][0]
    assert ev["phone"] == "+998901234567"
    assert ev["amount"] == 150_000 and ev["needs_check"] is True
    assert "+998901234567" in out["transcript"]


def test_answer_number_guard():
    facts = {"jami": 1_200_000, "qarzdorlar": [{"ism": "Alisher", "qarz": 450_000, "kun": 21}]}
    assert ai.answer_uses_only_facts("Sizga 1 200 000 so'm qarz bor, eng ko'p Alisher — 450 000, 21 kun.", facts)
    assert not ai.answer_uses_only_facts("Sizga 1 300 000 so'm qarz bor.", facts)


def _signed_init_data(token: str, user_id: int, auth_date: int | None = None) -> str:
    fields = {"auth_date": str(auth_date or int(time.time())), "query_id": "AAE",
              "user": json.dumps({"id": user_id, "first_name": "Dilshod"}, separators=(",", ":"))}
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_init_data_validation():
    token = "123456:TEST"
    data = api.validate_init_data(_signed_init_data(token, 42), token)
    assert data["user"]["id"] == 42
    with pytest.raises(ValueError):
        api.validate_init_data(_signed_init_data(token, 42), "123456:OTHER")
    with pytest.raises(ValueError):
        api.validate_init_data(_signed_init_data(token, 42, auth_date=int(time.time()) - 3 * 86400), token)
    tampered = _signed_init_data(token, 42).replace("Dilshod", "Hacker")
    with pytest.raises(ValueError):
        api.validate_init_data(tampered, token)


def test_names_match():
    assert pipeline.names_match("Nigora opa", "nigora")
    assert pipeline.names_match("Alisher", "alisher aka")
    assert not pipeline.names_match("Bobur", "Jasur")


def test_week_table_in_prompt():
    p = ai.build_prompt(TODAY)
    assert "payshanba = 2026-11-26" in p
    assert (TODAY + timedelta(days=1)).isoformat() in p
