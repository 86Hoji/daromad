"""Проверка точности ИИ на эталонных примерах: текст, голос, фото.

Запуск из backend/ (нужен GEMINI_API_KEY в extras/.env или backend/.env):
    extras/.venv/bin/python -m extras.eval_ai                  # все примеры
    extras/.venv/bin/python -m extras.eval_ai --only photo     # text | audio | photo
    extras/.venv/bin/python -m extras.eval_ai --ids t01_sale,p03_payme

Примеры:
  extras/eval_cases.json      — фразы текстом (в т.ч. 10 фраз из ТЗ), синтетический голос и фото;
  extras/samples/expected.json — «имя файла -> ожидаемые события» для настоящих записей команды:
                                 файл ищется в samples/ и samples/private/ (в .gitignore) по имени без
                                 расширения (.ogg/.m4a/.mp3/.wav, .jpg/.png/...); каких файлов нет — пропускаются;
  extras/samples/private/cases.json — дополнительные примеры того же формата, что eval_cases.json.
Голос идёт через основной ai.parse_input (он уже есть в репо), фото — через vision.aparse_photo.
Отчёт: таблица «ожидали / получили» в консоли, точность по суммам в %, и extras/eval_report.json.

Пример засчитан, если совпали intent и каждое событие: тип, сумма (точно), а если указаны
в эталоне — person (с учётом опа/ака и кириллицы), due_date, category; лишних событий нет;
и событие проходит ту же проверку кодом, что и в боте (pipeline.validate_event).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from datetime import date
from pathlib import Path
from typing import Awaitable, Callable

EXTRAS_DIR = Path(__file__).resolve().parent
CASES_PATH = EXTRAS_DIR / "eval_cases.json"
PRIVATE_CASES_PATH = EXTRAS_DIR / "samples" / "private" / "cases.json"
EXPECTED_PATH = EXTRAS_DIR / "samples" / "expected.json"
SAMPLE_DIRS = (EXTRAS_DIR / "samples", EXTRAS_DIR / "samples" / "private")
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".pdf")
REPORT_PATH = EXTRAS_DIR / "eval_report.json"
KINDS = ("text", "audio", "photo")
FIELDS = ("type", "amount", "person", "due_date", "category")
AUDIO_MIME = {".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
              ".mp3": "audio/mp3", ".m4a": "audio/aac", ".aac": "audio/aac", ".flac": "audio/flac",
              ".aiff": "audio/aiff"}
PAUSE_SECONDS = 1.0          # между запросами, чтобы не упереться в лимит бесплатного уровня
MAIN_AI_TIMEOUT = 30         # старый ai.py без своей цепочки моделей: ждём одну модель не дольше этого
MAIN_CHAIN_TIMEOUT = 180     # новый ai.py (FALLBACK_MODELS): сам перебирает модели, ждём всю его цепочку


# --- примеры ----------------------------------------------------------------------------

def _find_sample(name: str, dirs=SAMPLE_DIRS) -> Path | None:
    """Файл из expected.json: точное имя, иначе то же имя с другим расширением."""
    stem = Path(name).stem
    for d in dirs:
        if (d / name).is_file():
            return d / name
        for ext in (*AUDIO_MIME, *PHOTO_EXT):
            if (d / (stem + ext)).is_file():
                return d / (stem + ext)
    return None


def expected_cases(path: Path = EXPECTED_PATH, dirs=SAMPLE_DIRS) -> tuple[list[dict], list[str]]:
    """samples/expected.json -> (примеры для найденных файлов, имена ненайденных)."""
    if not path.exists():
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    cases, missing = [], []
    for name, exp in (data.get("files") or {}).items():
        f = _find_sample(name, dirs)
        if f is None:
            missing.append(name)
            continue
        kind = "photo" if f.suffix.lower() in PHOTO_EXT else "audio"
        rel = str(f.relative_to(EXTRAS_DIR)) if f.is_relative_to(EXTRAS_DIR) else str(f)
        cases.append({"id": f"file:{f.name}", "kind": kind, "file": rel,
                      "intent": exp.get("intent", "record"), "events": exp.get("events", [])})
    return cases, missing


def load_cases(path: Path = CASES_PATH, private_path: Path | None = PRIVATE_CASES_PATH,
               expected_path: Path | None = EXPECTED_PATH) -> tuple[date, list[dict]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    today = date.fromisoformat(data["today"])
    cases = list(data["cases"])
    if private_path and private_path.exists():
        extra = json.loads(private_path.read_text(encoding="utf-8"))
        cases += extra.get("cases", []) if isinstance(extra, dict) else extra
    if expected_path:
        cases += expected_cases(expected_path)[0]
    return today, cases


def case_problems(case: dict) -> list[str]:
    """Ошибки в описании примера (чтобы опечатка в JSON не выглядела как ошибка ИИ)."""
    import pipeline
    p = []
    if not case.get("id"):
        p.append("id is required")
    if case.get("kind") not in KINDS:
        p.append(f"kind must be one of {KINDS}")
    if case.get("kind") == "text" and not case.get("input"):
        p.append("text case needs input")
    if case.get("kind") in ("audio", "photo"):
        f = case.get("file")
        if not f or not (EXTRAS_DIR / f).exists():
            p.append(f"file not found: {f}")
    if case.get("intent") not in ("record", "question"):
        p.append("intent must be record|question")
    for ev in case.get("events", []):
        if ev.get("type") not in pipeline.EVENT_TYPES:
            p.append(f"bad event type {ev.get('type')!r}")
        if not isinstance(ev.get("amount"), int) or ev["amount"] <= 0:
            p.append("event amount must be positive int")
    return p


# --- сравнение --------------------------------------------------------------------------

def _latin(s: str) -> str:
    from . import sms
    return sms.to_sms_latin(s or "")


def person_ok(expected, got: str | None) -> bool:
    import pipeline
    options = expected if isinstance(expected, list) else [expected]
    return any(pipeline.names_match(_latin(e), _latin(got or "")) for e in options)


def match_events(expected: list[dict], got: list[dict]) -> list[tuple[dict, dict | None]]:
    """Пары (эталон, найденное). Сначала по типу+сумме, потом по типу, иначе None."""
    free = list(range(len(got)))
    pairs = []
    for exp in expected:
        pick = next((i for i in free if got[i].get("type") == exp["type"]
                     and got[i].get("amount") == exp["amount"]), None)
        if pick is None:
            pick = next((i for i in free if got[i].get("type") == exp["type"]), None)
        if pick is not None:
            free.remove(pick)
        pairs.append((exp, got[pick] if pick is not None else None))
    return pairs


def score_case(case: dict, result: dict, today: date) -> dict:
    """-> {ok, intent_ok, fields: {field: [ok, total]}, errors: [...], extra, needs_check}."""
    import pipeline
    errors: list[str] = []
    fields = {f: [0, 0] for f in FIELDS}
    intent_ok = result.get("intent") == case["intent"]
    if not intent_ok:
        errors.append(f"intent {result.get('intent')!r} != {case['intent']!r}")
    got = list(result.get("events") or [])
    pairs = match_events(case.get("events", []), got)
    for exp, ev in pairs:
        for f in FIELDS:
            if f in exp:
                fields[f][1] += 1
        if ev is None:
            errors.append(f"missing {exp['type']} {exp['amount']}")
            continue
        checks = {"type": ev.get("type") == exp["type"], "amount": ev.get("amount") == exp["amount"]}
        if "person" in exp:
            checks["person"] = person_ok(exp["person"], ev.get("person"))
        if "due_date" in exp:                     # null в эталоне = «срока нет», ИИ должен вернуть null
            got_due = str(ev["due_date"])[:10] if ev.get("due_date") else None
            checks["due_date"] = got_due == exp["due_date"]
        if "category" in exp:
            checks["category"] = (ev.get("category") or "").lower() == exp["category"]
        for f, ok in checks.items():
            fields[f][0] += int(ok)
            if not ok:
                errors.append(f"{exp['type']}.{f}: got {ev.get(f)!r}, want {exp.get(f)!r}")
        _, verr = pipeline.validate_event(ev, today) if case.get("validate", True) else (None, None)
        if verr:
            errors.append(f"{exp['type']}: rejected by validate_event: {verr}")
    used = [ev for _, ev in pairs if ev is not None]
    extra = [e for e in got if all(e is not u for u in used)]
    if extra:
        errors.append(f"{len(extra)} extra event(s): " + ", ".join(f"{e.get('type')} {e.get('amount')}" for e in extra))
    return {"ok": not errors, "intent_ok": intent_ok, "fields": fields, "errors": errors, "extra": len(extra),
            "needs_check": sum(1 for e in got if e.get("needs_check"))}


def summarize(rows: list[dict]) -> dict:
    out: dict = {"total": len(rows), "passed": sum(1 for r in rows if r["ok"]),
                 "errors": sum(1 for r in rows if r.get("crash"))}
    out["accuracy"] = round(out["passed"] / out["total"], 3) if rows else 0.0
    by_kind = {}
    for k in KINDS:
        rs = [r for r in rows if r["kind"] == k]
        if rs:
            by_kind[k] = {"passed": sum(1 for r in rs if r["ok"]), "total": len(rs),
                          "avg_seconds": round(sum(r["seconds"] for r in rs) / len(rs), 2)}
    out["by_kind"] = by_kind
    fields = {f: [0, 0] for f in FIELDS}
    for r in rows:
        for f, (ok, tot) in r.get("fields", {}).items():
            fields[f][0] += ok
            fields[f][1] += tot
    out["fields"] = {f: f"{ok}/{tot}" for f, (ok, tot) in fields.items() if tot}
    ok, tot = fields["amount"]
    out["amount_accuracy"] = round(ok / tot, 3) if tot else None     # «точность по суммам» для слайда
    return out


# --- вызов ИИ ---------------------------------------------------------------------------

Runner = Callable[[dict, date], Awaitable[dict]]


def _setup_main_ai() -> list[str]:
    """Основной ai.py берёт ключ из backend/.env; если там пусто — из extras/.env. -> список моделей."""
    import ai
    import config
    from . import vision
    key, models = vision._settings()
    if not config.GEMINI_API_KEY and key:
        config.GEMINI_API_KEY = key
        ai._client = None
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY yo'q: extras/.env ga yozing")
    return models


async def _main_ai(models: list[str], **kwargs) -> dict:
    """ai.parse_input. Если у основного ai.py своя цепочка моделей (FALLBACK_MODELS) — один вызов,
    как в боте; иначе перебираем модели сами."""
    import ai
    import config
    if hasattr(ai, "FALLBACK_MODELS"):
        config.GEMINI_MODEL = models[0]
        try:
            return await asyncio.wait_for(ai.parse_input(**kwargs), MAIN_CHAIN_TIMEOUT)
        except (ai.AIUnavailable, asyncio.TimeoutError) as exc:
            raise RuntimeError(f"main ai chain failed: {exc if str(exc) else 'timeout'}") from exc
    last = None
    for m in models:
        config.GEMINI_MODEL = m
        try:
            return await asyncio.wait_for(ai.parse_input(**kwargs), MAIN_AI_TIMEOUT)
        except (ai.AIUnavailable, asyncio.TimeoutError) as exc:
            last = exc if str(exc) else f"{m}: timeout"
            logging.getLogger("extras.eval").warning("model %s failed, trying next", m)
    raise RuntimeError(f"all models failed: {last}")


def default_runner() -> Runner:
    models: list[str] = []

    async def run(case: dict, today: date) -> dict:
        from . import vision
        kind = case["kind"]
        if kind == "photo":
            data = (EXTRAS_DIR / case["file"]).read_bytes()
            r = await vision.aparse_photo(data, vision.detect_mime(data, case["file"]), today)
            if str(r.get("transcript", "")).startswith("error:"):
                raise RuntimeError(r["transcript"])
            return r
        if not models:
            models.extend(_setup_main_ai())
        if kind == "audio":
            path = EXTRAS_DIR / case["file"]
            mime = case.get("mime") or AUDIO_MIME.get(path.suffix.lower(), "audio/ogg")
            return await _main_ai(models, audio=path.read_bytes(), mime_type=mime, today=today)
        return await _main_ai(models, text=case["input"], today=today)

    return run


async def run_eval(cases: list[dict], today: date, runner: Runner, pause: float | None = None) -> list[dict]:
    pause = PAUSE_SECONDS if pause is None else pause
    rows = []
    for i, case in enumerate(cases):
        if i and pause:
            await asyncio.sleep(pause)
        row = {"id": case.get("id"), "kind": case.get("kind")}
        problems = case_problems(case)
        if problems:
            rows.append({**row, "ok": False, "crash": True, "seconds": 0.0,
                         "errors": ["bad case: " + "; ".join(problems)]})
            continue
        t0 = time.monotonic()
        try:
            result = await runner(case, today)
        except Exception as exc:  # сбой сети/модели — считаем провалом, идём дальше
            rows.append({**row, "ok": False, "crash": True, "seconds": round(time.monotonic() - t0, 2),
                         "errors": [f"crash: {str(exc)[:200]}"]})
            continue
        score = score_case(case, result, today)
        rows.append({**row, **score, "seconds": round(time.monotonic() - t0, 2),
                     "transcript": (result.get("transcript") or "")[:200],
                     "got": [{k: e.get(k) for k in ("type", "amount", "person", "due_date", "category", "needs_check")}
                             for e in result.get("events") or []]})
    return rows


def _events_short(events: list[dict] | None) -> str:
    if not events:
        return "—"
    parts = []
    for e in events:
        s = f"{e.get('type')} {e.get('amount'):,}".replace(",", " ")
        if e.get("person"):
            s += f" {e['person'][0] if isinstance(e['person'], list) else e['person']}"
        if e.get("due_date"):
            s += f" {e['due_date']}"
        parts.append(s)
    return "; ".join(parts)


def print_report(rows: list[dict], summary: dict, cases: list[dict] | None = None) -> None:
    expected = {c.get("id"): c for c in cases or []}
    for r in rows:
        mark = "OK  " if r["ok"] else ("ERR " if r.get("crash") else "FAIL")
        print(f"{mark} {str(r['id']):<26} {r['seconds']:>5.1f}s")
        c = expected.get(r["id"])
        if c is not None:
            want = "вопрос" if c.get("intent") == "question" else _events_short(c.get("events"))
            print(f"       ожидали:  {want}")
        if not r.get("crash"):
            print(f"       получили: {_events_short(r.get('got'))}")
        if r.get("errors"):
            print(f"       ошибки:   " + "; ".join(r["errors"]))
    print()
    print(f"Итого: {summary['passed']}/{summary['total']} ({summary['accuracy']:.0%}), сбоев: {summary['errors']}")
    for k, v in summary["by_kind"].items():
        print(f"  {k:<6} {v['passed']}/{v['total']}  ~{v['avg_seconds']}s на пример")
    if summary["fields"]:
        print("  поля: " + ", ".join(f"{f} {v}" for f, v in summary["fields"].items()))
    if summary.get("amount_accuracy") is not None:
        note = f", без {summary['errors']} сбоев связи" if summary["errors"] else ""
        print(f"Точность по суммам: {summary['amount_accuracy']:.0%} ({summary['fields']['amount']}{note})")


def main(argv: list[str] | None = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="python -m extras.eval_ai")
    ap.add_argument("--only", choices=KINDS)
    ap.add_argument("--ids", help="через запятую")
    args = ap.parse_args(argv)

    today, cases = load_cases()
    _, missing = expected_cases()
    if missing:
        print(f"samples/expected.json: нет файлов ({len(missing)}): {', '.join(missing)} — пропущены\n")
    if args.only:
        cases = [c for c in cases if c.get("kind") == args.only]
    if args.ids:
        want = set(args.ids.split(","))
        cases = [c for c in cases if c.get("id") in want]
    if not cases:
        print("Нет примеров")
        return 2
    rows = asyncio.run(run_eval(cases, today, default_runner()))
    summary = summarize(rows)
    print_report(rows, summary, cases)
    REPORT_PATH.write_text(json.dumps({"today": today.isoformat(), "summary": summary, "rows": rows},
                                      ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nОтчёт: {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    sys.exit(main())
