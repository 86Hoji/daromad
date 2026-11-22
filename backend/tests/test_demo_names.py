"""Блок 6: демо-владелец Alisher, бизнес «Alisher Savdo», главный должник Jamshid. Свободные деньги — −350 000."""
import db
import logic
import seed
from tests.test_logic import TODAY


def test_demo_names_and_free_money(tmp_db):
    fm = seed.seed(reset=True, today=TODAY, shop_id=1)
    shop = db.get_shop(1)
    assert shop["name"] == "Alisher Savdo" and shop["owner_name"] == "Alisher"
    j = db.query_one("SELECT * FROM debts WHERE shop_id=1 AND person_name='Jamshid'")
    assert j["remaining"] == 450_000 and j["phone"] and j["sms_consent"] == 1
    assert next(d for d in logic.open_debts(1, TODAY) if d["person_name"] == "Jamshid")["days_open"] == 21
    assert not db.query("SELECT 1 FROM debts WHERE shop_id=1 AND person_name='Alisher'")
    assert fm["free_money"] == -350_000


def test_demo_debtor_phone_env(tmp_db, monkeypatch):
    monkeypatch.setenv("DEMO_DEBTOR_PHONE", "90 111 22 33")
    fm = seed.seed(reset=True, today=TODAY, shop_id=1)
    j = db.query_one("SELECT * FROM debts WHERE shop_id=1 AND person_name='Jamshid'")
    assert j["phone"] == "+998901112233" and j["sms_consent"] == 1
    assert fm["free_money"] == -350_000
