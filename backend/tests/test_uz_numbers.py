import pytest

from uz_numbers import find_amounts, parse_amount


@pytest.mark.parametrize("text, expected", [
    ("150 ming", 150_000),
    ("150ming", 150_000),
    ("2 million 300 ming", 2_300_000),
    ("bir yarim million", 1_500_000),
    ("yarim million", 500_000),
    ("1,5 mln", 1_500_000),
    ("1.5 million", 1_500_000),
    ("ikki yuz ellik ming", 250_000),
    ("uch million", 3_000_000),
    ("sakkiz yuz ming", 800_000),
    ("o'n besh ming", 15_000),
    ("o‘n besh ming", 15_000),          # типографский апостроф
    ("ikki yarim ming", 2_500),
    ("150 000 so'm", 150_000),
    ("2 300 000", 2_300_000),
    ("2.300.000", 2_300_000),
    ("150k", 150_000),
    ("150к", 150_000),
    ("mingga", None),                  # множитель без числа — не сумма
    ("2 million va 300 ming", 2_300_000),
    ("milliondan", None),
    # узбекская кириллица
    ("бир ярим миллион", 1_500_000),
    ("тўрт юз минг", 400_000),
    ("икки миллион", 2_000_000),
    # русский
    ("два миллиона триста тысяч", 2_300_000),
    ("сто пятьдесят тысяч", 150_000),
    ("полтора миллиона", 1_500_000),
    ("пол миллиона", 500_000),
    ("3 млн", 3_000_000),
    ("двести тысяч", 200_000),
])
def test_parse_amount(text, expected):
    assert parse_amount(text) == expected


def test_spec_phrase_finds_three_amounts():
    text = "Bugun 2 million 300 ming sotdim, Alisher 150 ming qarz oldi, payshanba kuni yetkazib beruvchiga 3 million"
    assert find_amounts(text) == [2_300_000, 150_000, 3_000_000]


def test_uchun_is_not_three():
    assert find_amounts("Akmal uchun 3 million") == [3_000_000]


def test_two_separate_amounts_same_multiplier():
    assert find_amounts("150 ming 200 ming") == [150_000, 200_000]


def test_russian_k_preposition_is_not_thousand():
    assert find_amounts("3 миллиона к четвергу") == [3_000_000]


def test_mixed_language():
    assert find_amounts("Сегодня продал на 2 млн 300 ming, Bobur yarim million qarz oldi") == [2_300_000, 500_000]


def test_empty():
    assert parse_amount("") is None
    assert parse_amount(None) is None
    assert find_amounts("salom, qalaysiz?") == []
