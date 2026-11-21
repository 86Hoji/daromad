"""Детерминированный парсер денежных сумм на узбекском (латиница и кириллица) и русском.

    parse_amount("2 million 300 ming")      -> 2_300_000
    parse_amount("bir yarim million")        -> 1_500_000
    find_amounts("Alisher 150 ming, Bobur 1,5 mln") -> [150_000, 1_500_000]

Нужен, чтобы перепроверять суммы, которые вернул ИИ: код считает, ИИ только понимает речь.
"""
from __future__ import annotations

import math
import re

# --- словари -----------------------------------------------------------------

UNITS: dict[str, int] = {
    # узбекский, латиница
    "bir": 1, "ikki": 2, "uch": 3, "to'rt": 4, "tort": 4, "besh": 5, "olti": 6,
    "yetti": 7, "etti": 7, "sakkiz": 8, "to'qqiz": 9, "toqqiz": 9,
    "o'n": 10, "on": 10, "yigirma": 20, "o'ttiz": 30, "ottiz": 30, "qirq": 40,
    "ellik": 50, "oltmish": 60, "yetmish": 70, "etmish": 70, "sakson": 80,
    "to'qson": 90, "toqson": 90,
    # узбекский, кириллица (и упрощённое написание без ў/қ)
    "бир": 1, "икки": 2, "уч": 3, "тўрт": 4, "торт": 4, "беш": 5, "олти": 6,
    "етти": 7, "саккиз": 8, "тўққиз": 9, "токкиз": 9, "ўн": 10, "ун": 10,
    "йигирма": 20, "ўттиз": 30, "уттиз": 30, "қирқ": 40, "кирк": 40, "эллик": 50,
    "олтмиш": 60, "етмиш": 70, "саксон": 80, "тўқсон": 90, "туксон": 90,
    # русский
    "один": 1, "одна": 1, "одну": 1, "два": 2, "две": 2, "три": 3, "четыре": 4,
    "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10,
    "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13, "четырнадцать": 14,
    "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18,
    "девятнадцать": 19, "двадцать": 20, "тридцать": 30, "сорок": 40,
    "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80,
    "девяносто": 90, "сто": 100, "двести": 200, "триста": 300, "четыреста": 400,
    "пятьсот": 500, "шестьсот": 600, "семьсот": 700, "восемьсот": 800,
    "девятьсот": 900,
}

HUNDRED_WORDS = {"yuz", "юз"}  # "ikki yuz" = 2 * 100

MULTIPLIERS: dict[str, int] = {
    "ming": 1_000, "минг": 1_000,
    "тысяча": 1_000, "тысячи": 1_000, "тысяч": 1_000, "тыс": 1_000, "тыщ": 1_000, "тыщи": 1_000,
    "million": 1_000_000, "millon": 1_000_000, "milyon": 1_000_000, "mln": 1_000_000,
    "миллион": 1_000_000, "миллиона": 1_000_000, "миллионов": 1_000_000,
    "млн": 1_000_000, "лям": 1_000_000, "ляма": 1_000_000, "лямов": 1_000_000,
    "milliard": 1_000_000_000, "mlrd": 1_000_000_000, "миллиард": 1_000_000_000,
    "миллиарда": 1_000_000_000, "млрд": 1_000_000_000,
}

HALF_WORDS = {"yarim", "ярим"}            # "bir yarim" = 1.5, "yarim million" = 0.5 млн
ONE_AND_HALF = {"полтора", "полторы"}     # 1.5
RU_HALF_PREFIX = {"пол"}                  # "пол миллиона" = 0.5 млн
CONNECTORS = {"va", "ва", "и"}

# Узбекские аффиксы, которые могут прилипнуть к числу: "beshta", "mingga", "milliondan".
UZ_SUFFIXES = ("gacha", "tasi", "dan", "lik", "ta", "ga", "ni", "da",
               "гача", "таси", "дан", "лик", "та", "га", "ни", "да")

APOSTROPHES = "‘’ʻʼ`´′"


# --- нормализация и токены -----------------------------------------------------

def _normalize(text: str) -> str:
    t = text.lower().replace("ё", "е")
    for ch in APOSTROPHES:
        t = t.replace(ch, "'")
    t = t.replace(" ", " ").replace(" ", " ")
    # "2 300 000" / "150 000" -> слитно (группы по 3 цифры)
    t = re.sub(r"\b\d{1,3}(?: \d{3})+\b", lambda m: m.group(0).replace(" ", ""), t)
    # "2.300.000" / "2,300,000" / "150.000" -> слитно
    t = re.sub(r"\b\d{1,3}(?:[.,]\d{3})+\b(?![.,]\d)", lambda m: re.sub(r"[.,]", "", m.group(0)), t)
    # десятичная запятая "1,5" -> "1.5"
    t = re.sub(r"(\d),(\d)", r"\1.\2", t)
    # "150k" / "150к" / "1.5m" — только приклеенные к цифре (иначе "к четвергу" стал бы тысячей)
    t = re.sub(r"(\d)(?:k|к)\b", r"\1 ming", t)
    t = re.sub(r"(\d)m\b", r"\1 mln", t)
    return t


_TOKEN_RE = re.compile(r"\d+(?:\.\d+)?|[^\W\d_]+(?:'[^\W\d_]+)*")


def _tokens(text: str) -> list[str]:
    # regex сам режет слипшееся "150ming" на "150" и "ming"
    return [m.group(0) for m in _TOKEN_RE.finditer(_normalize(text))]


def _lookup(word: str, table) -> str | None:
    """Найти слово в словаре точно или после отсечения узбекского аффикса."""
    if word in table:
        return word
    for suf in UZ_SUFFIXES:
        if word.endswith(suf) and len(word) > len(suf) + 1:
            base = word[: -len(suf)]
            if base in table:
                return base
    return None


def _classify(tok: str):
    """-> (kind, value): num | unit | hundred | mult | half | onehalf | ruhalf | conn | other"""
    if tok[0].isdigit():
        return "num", float(tok)
    if tok in CONNECTORS:
        return "conn", None
    if tok in ONE_AND_HALF:
        return "onehalf", 1.5
    if tok in RU_HALF_PREFIX:
        return "ruhalf", 0.5
    w = _lookup(tok, MULTIPLIERS)
    if w is not None:
        return "mult", MULTIPLIERS[w]
    if _lookup(tok, HUNDRED_WORDS) is not None:
        return "hundred", 100
    if _lookup(tok, HALF_WORDS) is not None:
        return "half", 0.5
    w = _lookup(tok, UNITS)
    if w is not None:
        return "unit", UNITS[w]
    return "other", None


# --- разбор ----------------------------------------------------------------------

class _Acc:
    """Накопитель одного числа: total (уже умноженные группы) + small (текущая группа < 1000)."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.total = 0.0
        self.small = 0.0
        self.has = False          # есть ли хоть одна цифра/числительное
        self.small_from_digits = False
        self.last_mult = math.inf  # последний применённый множитель в этом числе

    def value(self) -> int | None:
        if not self.has:
            return None
        v = self.total + self.small
        return int(round(v)) if v > 0 else None


def _can_add_unit(small: float, v: int) -> bool:
    if small == 0:
        return True
    if small != int(small):
        return False
    s = int(small)
    if v < 100 and s % 100 == 0:          # "ikki yuz" + "ellik", "двести" + "пятьдесят"
        return True
    if v < 10 and s % 10 == 0 and s % 100 >= 10:  # "yigirma" + "besh"
        return True
    return False


def find_amounts(text: str) -> list[int]:
    """Все числа/суммы, найденные в тексте, в порядке появления."""
    toks = _tokens(text)
    out: list[int] = []
    acc = _Acc()

    def close() -> None:
        v = acc.value()
        if v is not None:
            out.append(v)
        acc.reset()

    i = 0
    while i < len(toks):
        kind, val = _classify(toks[i])
        nxt_kind = _classify(toks[i + 1])[0] if i + 1 < len(toks) else None

        if kind == "num":
            if acc.small or (acc.has and acc.last_mult == math.inf):
                close()
            acc.small = val
            acc.small_from_digits = True
            acc.has = True
        elif kind == "unit":
            if acc.small_from_digits or not _can_add_unit(acc.small, val):
                close()
            acc.small += val
            acc.has = True
        elif kind == "hundred":
            if acc.small_from_digits or acc.small >= 10:
                close()
            acc.small = (acc.small or 1) * 100
            acc.has = True
        elif kind == "onehalf":
            if acc.small:
                close()
            acc.small = 1.5
            acc.has = True
        elif kind == "ruhalf":
            if nxt_kind == "mult":
                if acc.small:
                    close()
                acc.small = 0.5
                acc.has = True
            else:
                close()
        elif kind == "half":
            if acc.small and acc.small == int(acc.small) and acc.small < 1000:
                acc.small += 0.5          # "bir yarim", "ikki yarim"
            elif not acc.small and nxt_kind == "mult":
                acc.small = 0.5           # "yarim million"
                acc.has = True
            else:
                close()
        elif kind == "mult":
            if not acc.has:
                # одиночное "ming"/"million" без числа — не сумма
                pass
            else:
                if val >= acc.last_mult:
                    # "150 ming 200 ming": новое число начинается
                    small = acc.small
                    acc.small = 0
                    close()
                    acc.small = small
                    acc.has = small > 0
                acc.total += (acc.small or 1) * val
                acc.small = 0
                acc.small_from_digits = False
                acc.last_mult = val
        elif kind == "conn":
            # "2 million va 300 ming" — связка внутри числа, если дальше идёт число
            if not (acc.has and nxt_kind in {"num", "unit", "hundred"} and acc.last_mult != math.inf):
                close()
        else:
            close()
        i += 1
    close()
    return out


def parse_amount(text: str | None) -> int | None:
    """Первая сумма во фрагменте текста или None."""
    if not text:
        return None
    found = find_amounts(text)
    return found[0] if found else None
