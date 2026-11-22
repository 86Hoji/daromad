"""check_i18n.py [LOCALE...] — запуск из miniapp/src: собирает ключи t("...") и косвенные ключи, показывает отсутствующие в словарях. Без аргументов — список ключей."""
import glob
import json
import re
import sys

pat = re.compile(r'\bt(?:Maybe)?\(\s*"((?:[^"\\]|\\.)*)"')
keys = {}
for f in glob.glob("**/*.ts*", recursive=True):
    if "locales" in f:
        continue
    s = open(f, encoding="utf-8").read()
    for m in pat.finditer(s):
        keys.setdefault(json.loads('"' + m.group(1) + '"'), f)

# косвенные ключи: строки из констант, которые рендерятся через t(x.field)
INDIRECT_FILES = {
    "landing/Sections.tsx": [r'(?:title|text|kind|src|note|level): "((?:[^"\\]|\\.)*)"', r'\["h-[^"]*", "[^"]*", "([^"]*)"\]', r'^  "?([a-z\']+)"?: \{ chip'],
    "landing/facts.ts": [r'(?:title|text|source): "((?:[^"\\]|\\.)*)"'],
    "landing/demo.ts": [r'text: "((?:[^"\\]|\\.)*)"', r'title: "((?:[^"\\]|\\.)*)"'],
    "landing/Sandbox.tsx": [r'(?:sample|offline|live): "((?:[^"\\]|\\.)*)"'],
    "screens/Pay.tsx": [r'\["((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\]'],
    "features/Report.tsx": [r'label: "([^"]*)"', r'hint: "([^"]*)"', r'^  [a-z_]+: "((?:[^"\\]|\\.)*)",'],
    "features/Drafts.tsx": [r'label: "((?:[^"\\]|\\.)*)"'],
    "features/Feed.tsx": [r'label: "((?:[^"\\]|\\.)*)"'],
    "app/AppLayout.tsx": [r'label: "([^"]*)"'],
    "tg/TgLayout.tsx": [r'label: "([^"]*)"'],
    "chart/MoneyLine.tsx": [r'^  [a-z_]+: "([^"]*)",'],
    "lib/format.ts": [r'^  [a-z]+: "((?:[^"\\]|\\.)*)",'],
    "lib/brand.ts": [r'BRAND_TAGLINE = "([^"]*)"'],
    "landing/HeroScene.tsx": [r'PHRASE_KEY = "([^"]*)"'],
}
for f, pats in INDIRECT_FILES.items():
    s = open(f, encoding="utf-8").read()
    for p in pats:
        for m in re.finditer(p, s, re.M):
            for g in m.groups():
                if g:
                    keys.setdefault(json.loads('"' + g + '"'), f + " (indirect)")

# бэкенд-строки, которые показываются через t()/tMaybe()
EXTRA = [
    "Biznes overdrafti", "Omonat «Bo'sh pul»",
    "Overdraft — bu qarz. Muddatida qaytarilmasa, kechiktirilgan har bir kun uchun qo'shimcha foiz olinadi va kredit tarixingiz yomonlashadi.",
    "Muddatidan oldin yechilsa, foiz yillik 5% gacha kamayadi.",
    "Overdraft tushumi", "Overdraftni qaytarish", "Omonatga o'tkazish", "Omonat qaytishi", "Egasi oldi",
    "Akmal — tovar uchun", "Ijara", "Ijara to'lovi", "Kommunal to'lovlar", "Maosh", "Tovar uchun",
]
for k in EXTRA:
    keys.setdefault(k, "backend")

skip = {"", "0", "%", "Bank"}
keys = {k: v for k, v in keys.items() if k not in skip}

failed = False
if len(sys.argv) > 1:
    for loc in sys.argv[1:]:
        s = open(loc, encoding="utf-8").read()
        have = set(json.loads('"' + m.group(1) + '"') for m in re.finditer(r'^\s*"((?:[^"\\]|\\.)*)":', s, re.M))
        missing = [k for k in keys if k not in have]
        extra = [k for k in have if k not in keys]
        print(f"== {loc}: {len(have)} keys, missing {len(missing)}, unused {len(extra)}")
        if missing:
            failed = True
        for k in sorted(missing):
            print("  MISSING", json.dumps(k, ensure_ascii=False), "<-", keys[k])
        for k in sorted(extra):
            print("  UNUSED", json.dumps(k, ensure_ascii=False))
else:
    for k in sorted(keys):
        print(json.dumps(k, ensure_ascii=False), "  #", keys[k])
    print(len(keys), "keys", file=sys.stderr)

sys.exit(1 if failed else 0)
