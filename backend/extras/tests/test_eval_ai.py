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


def test_run_eval_pause_default_read_at_call_time(monkeypatch):
    slept = []

    async def fake_sleep(s):
        slept.append(s)
    monkeypatch.setattr(eval_ai, "PAUSE_SECONDS", 0.25)
    monkeypatch.setattr(eval_ai.asyncio, "sleep", fake_sleep)

    async def fake(c, today):
        return {"intent": "record", "events": c["events"]}
    asyncio.run(eval_ai.run_eval([case([], id="a"), case([], id="b")], TODAY, fake))
    assert slept == [0.25]


def test_main_ai_timeout_falls_back_to_next_model(monkeypatch):
    import ai
    import config
    used = []

    async def slow_then_ok(**kw):
        used.append(config.GEMINI_MODEL)
        if config.GEMINI_MODEL == "slow":
            await asyncio.sleep(5)
        return {"intent": "record", "events": [], "transcript": "ok"}
    monkeypatch.delattr(ai, "FALLBACK_MODELS", raising=False)    # старый ai.py: модели перебирает eval
    monkeypatch.setattr(ai, "parse_input", slow_then_ok)
    monkeypatch.setattr(eval_ai, "MAIN_AI_TIMEOUT", 0.05)
    monkeypatch.setattr(config, "GEMINI_MODEL", config.GEMINI_MODEL)
    r = asyncio.run(eval_ai._main_ai(["slow", "fast"], text="x"))
    assert r["transcript"] == "ok" and used == ["slow", "fast"]


def test_main_ai_all_models_timeout_is_error(monkeypatch):
    import ai
    import config

    async def slow(**kw):
        await asyncio.sleep(5)
    monkeypatch.delattr(ai, "FALLBACK_MODELS", raising=False)    # старый ai.py: модели перебирает eval
    monkeypatch.setattr(ai, "parse_input", slow)
    monkeypatch.setattr(eval_ai, "MAIN_AI_TIMEOUT", 0.02)
    monkeypatch.setattr(config, "GEMINI_MODEL", config.GEMINI_MODEL)
    with pytest.raises(RuntimeError, match="timeout"):
        asyncio.run(eval_ai._main_ai(["m1", "m2"], text="x"))


# --- ТЗ: 10 фраз, samples/expected.json, точность по суммам ------------------------------

def test_spec_ten_phrases_present():
    _, cases = eval_ai.load_cases(private_path=None, expected_path=None)
    spec = [c for c in cases if c["id"].endswith("_spec")]
    assert len(spec) == 10
    assert sum(1 for c in spec if c["intent"] == "question") == 2
    assert spec[0]["input"].startswith("Bugun 2 million 300 ming sotdim") and len(spec[0]["events"]) == 3


def test_expected_json_template_matches_spec():
    import json as _json
    data = _json.loads(eval_ai.EXPECTED_PATH.read_text(encoding="utf-8"))
    assert len(data["files"]) == 10 and data["today"] == "2026-11-21"
    for name, exp in data["files"].items():
        c = {"id": name, "kind": "text", "input": "x", **exp}
        assert eval_ai.case_problems(c) == [], name


def test_expected_json_finds_files_by_stem(tmp_path):
    import json as _json
    (tmp_path / "voice01.m4a").write_bytes(b"x")                 # записали в m4a, в шаблоне .ogg
    (tmp_path / "nakl.jpg").write_bytes(b"x")
    exp = tmp_path / "expected.json"
    exp.write_text(_json.dumps({"files": {
        "voice01.ogg": {"intent": "record", "events": [{"type": "sale", "amount": 1000}]},
        "nakl.jpg": {"intent": "record", "events": []},
        "voice02.ogg": {"intent": "question", "events": []}}}), encoding="utf-8")
    cases, missing = eval_ai.expected_cases(exp, dirs=(tmp_path,))
    assert {c["kind"] for c in cases} == {"audio", "photo"} and missing == ["voice02.ogg"]
    assert any(c["file"].endswith("voice01.m4a") for c in cases)


def test_amount_accuracy_in_summary_and_report(capsys):
    rows = [{"id": "a", "kind": "text", "ok": True, "seconds": 1.0, "fields": {"amount": [3, 4]}, "got": []}]
    s = eval_ai.summarize(rows)
    assert s["amount_accuracy"] == 0.75
    eval_ai.print_report(rows, s, [case([ev("sale", 1_000)], id="a")])
    out = capsys.readouterr().out
    assert "Точность по суммам: 75%" in out and "ожидали:  sale 1 000" in out and "получили: —" in out


def test_due_date_null_means_no_deadline():
    exp = [ev("scheduled_payment", 3_240_000, due_date=None)]
    ok = {"intent": "record", "events": [ev("scheduled_payment", 3_240_000, due_date=None)]}
    bad = {"intent": "record", "events": [ev("scheduled_payment", 3_240_000, due_date="2026-11-28")]}
    assert eval_ai.score_case(case(exp, validate=False), ok, TODAY)["ok"]
    assert not eval_ai.score_case(case(exp, validate=False), bad, TODAY)["ok"]
    # без validate=False основной pipeline такой платёж не примет — это и проверяется
    assert "validate_event" in " ".join(eval_ai.score_case(case(exp), ok, TODAY)["errors"])


def test_main_ai_with_own_chain_called_once(monkeypatch):
    """Новый ai.py (FALLBACK_MODELS) сам перебирает модели — eval не должен делать это поверх."""
    import ai
    import config
    calls = []

    async def chain(**kw):
        calls.append(config.GEMINI_MODEL)
        return {"intent": "record", "events": [], "transcript": "ok"}
    monkeypatch.setattr(ai, "FALLBACK_MODELS", ("m2", "m3"), raising=False)
    monkeypatch.setattr(ai, "parse_input", chain)
    monkeypatch.setattr(config, "GEMINI_MODEL", config.GEMINI_MODEL)
    assert asyncio.run(eval_ai._main_ai(["primary", "lite"], text="x"))["transcript"] == "ok"
    assert calls == ["primary"]


def test_main_ai_own_chain_failure_is_error(monkeypatch):
    import ai
    import config

    async def down(**kw):
        raise ai.AIUnavailable("band")
    monkeypatch.setattr(ai, "FALLBACK_MODELS", ("m2",), raising=False)
    monkeypatch.setattr(ai, "parse_input", down)
    monkeypatch.setattr(config, "GEMINI_MODEL", config.GEMINI_MODEL)
    with pytest.raises(RuntimeError, match="main ai chain failed: band"):
        asyncio.run(eval_ai._main_ai(["primary"], text="x"))
