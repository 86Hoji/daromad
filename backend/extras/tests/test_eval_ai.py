"""eval_ai.py: эталоны корректны, сравнение честное — на фейковом ИИ, без сети."""
import asyncio
import json
from datetime import date

import pytest

from extras import eval_ai

TODAY = date(2026, 11, 21)


def ev(type_, amount, **kw):
    return {"type": type_, "amount": amount, **kw}


def case(events, intent="record", **kw):
    return {"id": "c", "kind": "text", "input": "x", "intent": intent, "events": events, **kw}


# --- эталонный файл ---------------------------------------------------------------------

def test_cases_file_is_valid():
    today, cases = eval_ai.load_cases(private_path=None)
    assert today == TODAY and today.weekday() == 5           # суббота: payshanba = 26.11
    assert len(cases) >= 20
    assert {c["kind"] for c in cases} == {"text", "audio", "photo"}
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids))
    for c in cases:
        assert eval_ai.case_problems(c) == [], c["id"]


def test_private_cases_are_appended(tmp_path):
    p = tmp_path / "cases.json"
    p.write_text(json.dumps({"cases": [case([ev("sale", 1000)], id="priv")]}), encoding="utf-8")
    _, cases = eval_ai.load_cases(private_path=p)
    assert cases[-1]["id"] == "priv"


def test_bad_case_is_reported_not_crashing():
    bad = {"id": "b", "kind": "photo", "file": "nope.png", "intent": "x", "events": [ev("gift", -1)]}
    probs = eval_ai.case_problems(bad)
    assert any("file not found" in p for p in probs) and any("intent" in p for p in probs)
    assert any("bad event type" in p for p in probs) and any("positive" in p for p in probs)


# --- сравнение --------------------------------------------------------------------------

def test_exact_match_ok():
    s = eval_ai.score_case(case([ev("sale", 2_300_000)]), {"intent": "record", "events": [ev("sale", 2_300_000)]}, TODAY)
    assert s["ok"] and s["fields"]["amount"] == [1, 1]


def test_wrong_amount_fails():
    s = eval_ai.score_case(case([ev("sale", 2_300_000)]), {"intent": "record", "events": [ev("sale", 2_030_000)]}, TODAY)
    assert not s["ok"] and s["fields"]["amount"] == [0, 1] and "amount" in s["errors"][0]


def test_wrong_intent_fails():
    s = eval_ai.score_case(case([], intent="question"), {"intent": "record", "events": []}, TODAY)
    assert not s["ok"] and not s["intent_ok"]


def test_missing_and_extra_events_fail():
    s = eval_ai.score_case(case([ev("sale", 1000)]), {"intent": "record", "events": []}, TODAY)
    assert not s["ok"] and "missing" in s["errors"][0]
    s = eval_ai.score_case(case([]), {"intent": "record", "events": [ev("sale", 5000)]}, TODAY)
    assert not s["ok"] and s["extra"] == 1


def test_order_does_not_matter():
    exp = [ev("sale", 1_200_000), ev("expense", 200_000, category="ijara")]
    got = [ev("expense", 200_000, category="ijara"), ev("sale", 1_200_000)]
    assert eval_ai.score_case(case(exp), {"intent": "record", "events": got}, TODAY)["ok"]


def test_same_type_two_events_matched_by_amount():
    exp = [ev("debt_given", 100_000, person="Ali"), ev("debt_given", 250_000, person="Bobur")]
    got = [ev("debt_given", 250_000, person="Bobur"), ev("debt_given", 100_000, person="Ali")]
    assert eval_ai.score_case(case(exp), {"intent": "record", "events": got}, TODAY)["ok"]


@pytest.mark.parametrize("expected,got,ok", [
    ("Nigora", "Nigora opa", True), ("Alisher", "ALISHER K.", True),
    (["Алишер", "Alisher"], "Alisher", True), ("Alisher", "Алишер", True),
    ("Bobur", "Dilnoza", False), ("Alisher", None, False)])
def test_person_matching(expected, got, ok):
    assert eval_ai.person_ok(expected, got) is ok


def test_due_date_and_category_checked():
    exp = [ev("scheduled_payment", 3_000_000, due_date="2026-11-26")]
    bad = [ev("scheduled_payment", 3_000_000, due_date="2026-11-27")]
    assert not eval_ai.score_case(case(exp), {"intent": "record", "events": bad}, TODAY)["ok"]
    exp = [ev("expense", 40_000, category="transport")]
    bad = [ev("expense", 40_000, category="boshqa")]
    assert not eval_ai.score_case(case(exp), {"intent": "record", "events": bad}, TODAY)["ok"]


def test_validate_event_failure_counts():
    exp = [ev("debt_given", 150_000)]                      # эталон без person, но бот без имени не примет
    s = eval_ai.score_case(case(exp), {"intent": "record", "events": [ev("debt_given", 150_000)]}, TODAY)
    assert not s["ok"] and "validate_event" in s["errors"][0]


# --- прогон -----------------------------------------------------------------------------

def test_run_eval_with_fake_runner_and_crash():
    cases = [case([ev("sale", 1000)], id="ok1"), case([ev("sale", 1000)], id="boom"),
             {"id": "bad", "kind": "zzz", "intent": "record", "events": []}]

    async def fake(c, today):
        if c["id"] == "boom":
            raise RuntimeError("503 overloaded")
        return {"intent": "record", "events": [ev("sale", 1000)], "transcript": "t"}

    rows = asyncio.run(eval_ai.run_eval(cases, TODAY, fake, pause=0))
    assert [r["ok"] for r in rows] == [True, False, False]
    assert rows[1]["crash"] and "503" in rows[1]["errors"][0]
    assert rows[2]["crash"] and "bad case" in rows[2]["errors"][0]
    s = eval_ai.summarize(rows)
    assert s["passed"] == 1 and s["total"] == 3 and s["errors"] == 2 and s["accuracy"] == 0.333


def test_summary_by_kind_and_fields():
    rows = [{"id": "a", "kind": "text", "ok": True, "seconds": 1.0, "fields": {"amount": [1, 1]}},
            {"id": "b", "kind": "photo", "ok": False, "seconds": 3.0, "fields": {"amount": [0, 1]}}]
    s = eval_ai.summarize(rows)
    assert s["by_kind"]["text"]["passed"] == 1 and s["by_kind"]["photo"]["avg_seconds"] == 3.0
    assert s["fields"] == {"amount": "1/2"}


def test_main_filters_and_writes_report(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(eval_ai, "REPORT_PATH", tmp_path / "r.json")
    monkeypatch.setattr(eval_ai, "PAUSE_SECONDS", 0)

    async def fake(c, today):
        return {"intent": c["intent"], "events": c["events"], "transcript": ""}
    monkeypatch.setattr(eval_ai, "default_runner", lambda: fake)
    assert eval_ai.main(["--ids", "t01_sale,t09_ru_question"]) == 0
    rep = json.loads((tmp_path / "r.json").read_text(encoding="utf-8"))
    assert rep["summary"]["passed"] == 2 and rep["summary"]["total"] == 2
    assert "Итого: 2/2" in capsys.readouterr().out
    assert eval_ai.main(["--ids", "nope"]) == 2
