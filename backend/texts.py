"""Тексты бота и бэкенда на двух языках: узбекский (по умолчанию) и русский.

Схема как в gettext и во фронтенде: ключ — исходная строка на узбекском, `_(s, lang, **kw)` возвращает
русский перевод, если lang == "ru" и перевод есть, иначе исходную строку. Подстановки — str.format.

Язык ответа: бот отвечает на том языке, на котором владелец написал или сказал последнее сообщение
(AI возвращает language, для текста есть эвристика detect_lang). По умолчанию — узбекский.
"""
from __future__ import annotations

import re
from datetime import date, datetime

LANGS = ("uz", "ru")
DEFAULT_LANG = "uz"

WEEKDAYS = {
    "uz": ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"],
    "ru": ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"],
}
# «в четверг», «до четверга»
_RU_ACC = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]
_RU_GEN = ["понедельника", "вторника", "среды", "четверга", "пятницы", "субботы", "воскресенья"]


def norm_lang(lang: str | None) -> str:
    """'ru', 'ru-RU', 'ru,en;q=0.9' -> 'ru'; всё остальное (uz, en, None) -> 'uz'."""
    code = (lang or "").strip().lower()[:2]
    return "ru" if code == "ru" else DEFAULT_LANG


# --- определение языка текста -------------------------------------------------------

_CYR = re.compile(r"[а-яёўқғҳ]", re.I)
_UZ_CYR_LETTERS = re.compile(r"[ўқғҳ]", re.I)
_RU_WORDS = {
    "сегодня", "вчера", "завтра", "продал", "продала", "продали", "выручка", "заплатил", "заплатила", "потратил",
    "потратила", "купил", "купила", "долг", "долга", "долги", "должен", "должна", "должны", "вернул", "вернула",
    "взял", "взяла", "тысяч", "тысячи", "тысяча", "миллион", "миллиона", "миллионов", "полтора", "кто", "мне",
    "сколько", "хватит", "хватает", "денег", "деньги", "аренда", "аренду", "зарплата", "зарплату", "товар",
    "за", "на", "в", "и", "не", "что", "это", "мой", "моя", "мои", "у", "до", "по", "надо", "нужно", "четверг",
    "пятницу", "среду", "понедельник", "вторник", "субботу", "воскресенье", "каждый", "каждое", "числа", "месяц",
    "привет", "здравствуйте", "спасибо", "рублей", "сум", "сумов", "наличными", "наличные",
}
_UZ_WORDS = {
    "бугун", "кеча", "эртага", "сотдим", "сотдик", "минг", "миллион", "сўм", "сум", "қарз", "карз", "берди",
    "олди", "тўладим", "туладим", "харажат", "ким", "менга", "қанча", "канча", "етадими", "пул", "ижара",
    "маош", "товар", "учун", "кун", "куни", "ва", "билан", "ҳар", "хар", "ой", "сана", "санада",
}


def detect_lang(text: str | None) -> str | None:
    """'ru' / 'uz' по тексту; None — если букв нет (одни цифры, эмодзи). Латиница -> узбекский."""
    if not text:
        return None
    letters = re.findall(r"[^\W\d_]", text)
    if not letters:
        return None
    if not _CYR.search(text):
        return "uz"
    if _UZ_CYR_LETTERS.search(text):
        return "uz"
    words = re.findall(r"[а-яё]+", text.lower())
    ru = sum(1 for w in words if w in _RU_WORDS or w.endswith(("ал", "ала", "или", "ого", "ему", "ться", "ешь")))
    uz = sum(1 for w in words if w in _UZ_WORDS or w.endswith(("дим", "ди", "ган", "моқ", "лар", "ни", "га")))
    return "ru" if ru >= uz else "uz"


# --- форматирование ----------------------------------------------------------------

def currency(lang: str) -> str:
    return "сум" if lang == "ru" else "so'm"


def fmt_money(x: float | int, lang: str) -> str:
    """Округлённо до 1000: «1 200 000 so'm» / «1 200 000 сум»."""
    return f"{int(round(x / 1000.0)) * 1000:,}".replace(",", " ") + " " + currency(lang)


def weekday(d: date, lang: str) -> str:
    return WEEKDAYS[lang if lang in WEEKDAYS else DEFAULT_LANG][d.weekday()]


def on_day(d: date, lang: str) -> str:
    """«payshanba» / «в четверг»."""
    return f"в {_RU_ACC[d.weekday()]}" if lang == "ru" else WEEKDAYS["uz"][d.weekday()]


def until_day(iso: str, lang: str, today: date | None = None) -> str:
    """«Payshanbagacha» / «До четверга»; «Ertagacha» / «До завтра»; «26.11 gacha» / «До 26.11»."""
    today = today or date.today()
    d = datetime.strptime(iso[:10], "%Y-%m-%d").date()
    delta = (d - today).days
    if lang == "ru":
        if delta <= 0:
            return "На сегодня"
        if delta == 1:
            return "До завтра"
        if delta <= 6:
            return f"До {_RU_GEN[d.weekday()]}"
        return f"До {d.strftime('%d.%m')}"
    if delta <= 0:
        return "Bugunga"
    if delta == 1:
        return "Ertagacha"
    if delta <= 6:
        return WEEKDAYS["uz"][d.weekday()].capitalize() + "gacha"
    return d.strftime("%d.%m") + " gacha"


_RU_DAT_PL = ["по понедельникам", "по вторникам", "по средам", "по четвергам", "по пятницам", "по субботам",
               "по воскресеньям"]


def recurring_when(period: str, day: int, lang: str) -> str:
    """«har oy 5-sanada» / «каждый месяц 5-го числа»; «har shanba» / «по субботам»."""
    day = int(day)
    if period == "weekly":
        return _RU_DAT_PL[day] if lang == "ru" else f"har {WEEKDAYS['uz'][day]}"
    return f"каждый месяц {day}-го числа" if lang == "ru" else f"har oy {day}-sanada"


def ru_plural(n: int, one: str, few: str, many: str) -> str:
    m10, m100 = n % 10, n % 100
    if m10 == 1 and m100 != 11:
        return one
    if 2 <= m10 <= 4 and not 12 <= m100 <= 14:
        return few
    return many


def days(n: int, lang: str) -> str:
    return f"{n} {ru_plural(n, 'день', 'дня', 'дней')}" if lang == "ru" else f"{n} kun"


# --- перевод ----------------------------------------------------------------------

def _(s: str, lang: str | None = None, **kw) -> str:
    out = RU.get(s, s) if lang == "ru" else s
    return out.format(**kw) if kw else out


def tr_list(items: list[str], lang: str | None) -> list[str]:
    return [_(x, lang) for x in items]


RU: dict[str, str] = {
    # --- pipeline: ошибки разбора -----------------------------------------------------
    "Summani tushunmadim — iltimos, summani aniqroq ayting.": "Не понял сумму — пожалуйста, назовите её точнее.",
    "Kim qarz olgani/qaytargani aniq emas — ismini ayting.": "Непонятно, кто взял или вернул долг — назовите имя.",
    "To'lov qaysi kuni ekanini ayting (masalan, «payshanba kuni»).": "Скажите, в какой день платёж (например, «в четверг»).",
    "Hech qanday yozuv topmadim. Masalan: «Bugun 2 million sotdim».": "Не нашёл ни одной записи. Например: «Сегодня продал на 2 миллиона».",
    "Rasmni o'qib bo'lmadi. Aniqroq suratga olib qayta yuboring yoki ovoz bilan ayting.":
        "Не получилось прочитать фото. Сфотографируйте чётче или скажите голосом.",
    "Rasmda summa topilmadi. Chek, nakladnoy yoki Payme/Click skrinshotini yuboring.":
        "На фото не нашлось суммы. Пришлите чек, накладную или скриншот Payme/Click.",
    "Javobni tushuna olmadim. Qayta aytib ko'ring.": "Не смог разобрать ответ. Попробуйте сказать ещё раз.",
    "Sun'iy intellekt sozlanmagan (GEMINI_API_KEY yo'q). Administratorga xabar bering.":
        "Искусственный интеллект не настроен (нет GEMINI_API_KEY). Сообщите администратору.",
    "Hozir sun'iy intellekt bilan bog'lanib bo'lmadi. Birozdan keyin qayta urinib ko'ring.":
        "Сейчас не удаётся связаться с ИИ. Попробуйте чуть позже.",
    "Sun'iy intellekt bo'sh javob qaytardi. Qayta urinib ko'ring.": "ИИ вернул пустой ответ. Попробуйте ещё раз.",
    "Hozir sun'iy intellekt band. Bir daqiqadan keyin qayta urinib ko'ring.": "ИИ сейчас перегружен. Попробуйте через минуту.",

    "Bo'sh audio fayl": "Пустой аудиофайл",
    "Audio juda katta (20 MB gacha)": "Аудио слишком большое (до 20 МБ)",
    "Bunday kutilayotgan yozuvlar yo'q": "Таких ожидающих записей нет",
    "Qarz topilmadi": "Долг не найден",
    "Qarz qolgan summadan katta": "Сумма больше остатка долга",

    # --- fallback-ответы на вопросы ---------------------------------------------------
    "Hozir sizga hech kim qarz emas.": "Сейчас вам никто не должен.",
    "Sizga jami {total} qarz bor:": "Вам должны всего {total}:",
    "Ha, {date} gacha yetadi: bo'sh pul {free}.": "Да, до {date} хватит: свободных денег {free}.",
    "Yo'q, {date} gacha {gap} yetmaydi.": "Нет, до {date} не хватит {gap}.",
    "Sotuv: bugun {today}, shu hafta {week}, shu oy {month}.": "Продажи: сегодня {today}, за неделю {week}, за месяц {month}.",
    "Xarajat: bugun {today}, shu hafta {week}, shu oy {month}.": "Расходы: сегодня {today}, за неделю {week}, за месяц {month}.",
    "Hisobingizda hozir {cash}. {date} gacha bo'sh pul: {free}.": "Сейчас на счёте {cash}. Свободных денег до {date}: {free}.",
    "Sizga jami {total} qarz bor. Eng kattalari: {names}": "Вам должны всего {total}. Самые крупные: {names}",
    ", va yana {n} kishi.": ", и ещё {n} чел.",
    "va yana {n} ta.": "и ещё {n}.",

    # --- бот: форматирование записей -------------------------------------------------
    "Sotuv": "Продажа",
    "Xarajat": "Расход",
    "{person} qarzga oldi": "{person} взял(а) в долг",
    "{person} qarzini qaytardi": "{person} вернул(а) долг",
    "To'lov": "Платёж",
    "to'lov": "платёж",
    "summani tekshiring": "проверьте сумму",
    "Yozib oldim:": "Записал:",
    "so'zdan": "со слов",
    "skrinshot": "скриншот",
    "tasdiqlangan": "подтверждено",
    "tovar": "товар", "ijara": "аренда", "maosh": "зарплата", "kommunal": "коммуналка",
    "transport": "транспорт", "boshqa": "другое",

    # --- бот: рекомендации и статус ---------------------------------------------------
    "{label} <b>{gap}</b> yetmaydi.": "{label} не хватит <b>{gap}</b>.",
    " Sizga {receivable} qarz bor, eng ko'p — {name} ({amount}, {days}).": " Вам должны {receivable}, больше всех — {name} ({amount}, {days}).",
    "Qarzlar yetishmovchilikni yopadi — avval qarzdorlarga eslatma yuboring.": "Долги закроют нехватку — сначала напомните должникам.",
    "Qarzlar yetmaydi — eslatmadan keyin bank overdrafti variant bo'lishi mumkin.": "Долгов не хватит — после напоминаний можно взять банковский овердрафт.",
    "📨 Qarzdorlarga eslatma": "📨 Напомнить должникам",
    "🏦 Overdraft shartlari": "🏦 Условия овердрафта",
    "🏦 Omonat shartlari": "🏦 Условия вклада",
    "✅ {label} ham yetadi, bo'sh pul: <b>{free}</b>.\n{amount}ni omonatga qo'ysangiz, {days}da ~{income} daromad.":
        "✅ {label} денег хватит, свободно: <b>{free}</b>.\nЕсли положить {amount} на вклад, за {days} доход ~{income}.",
    "✅ {label} yetadi. Bo'sh pul: <b>{free}</b>.": "✅ {label} хватит. Свободные деньги: <b>{free}</b>.",
    "Hisobingizda: <b>{cash}</b>": "На счёте: <b>{cash}</b>",
    "{label} bo'sh pul: <b>{free}</b>": "{label} свободно: <b>{free}</b>",
    "To'lovlar: ": "Платежи: ",
    "Sizga qarz: {total}": "Вам должны: {total}",
    "Hozir sizga hech kim qarz emas. 👍": "Сейчас вам никто не должен. 👍",
    "Sizga jami <b>{total}</b> qarz bor:": "Вам должны всего <b>{total}</b>:",
    "Ma'lumot ishonchliligi: {pct}%": "Надёжность данных: {pct}%",
    "Hisob {pct}% ma'lumotga asoslangan": "Посчитано по {pct}% данных",
    "Doimiy to'lov": "Регулярный платёж",
    "Kecha naqd pul bo'yicha yozuv yo'q. Yozib qo'yamizmi?": "За вчера нет записей по наличным. Дописать?",
    "✍️ Yozib qo'yish": "✍️ Дописать",
    "Kechagi naqd savdo va xarajatlarni yozing yoki ovoz bilan ayting. Masalan: «Kecha naqdga 1 million 200 ming sotdim, 150 ming paketga ketdi».":
        "Напишите или скажите голосом вчерашние продажи и расходы наличными. Например: «Вчера продал за наличные на 1 миллион 200 тысяч, 150 тысяч ушло на пакеты».",
    "Ma'lumot kam — bank takliflari yashirildi. Naqd savdo va xarajatlarni yozib boring.":
        "Данных мало — банковские предложения скрыты. Дополните данные: записывайте наличные продажи и расходы.",
    "Davr noto'g'ri: har oy yoki har hafta.": "Неверный период: каждый месяц или каждую неделю.",
    "Kunni ko'rsating.": "Укажите день.",
    "Oy kuni 1 dan 31 gacha bo'lishi kerak.": "День месяца должен быть от 1 до 31.",
    "Hafta kuni noto'g'ri.": "Неверный день недели.",
    "Sana kelajakda bo'lishi mumkin emas.": "Дата не может быть в будущем.",
    "Faqat oxirgi 30 kun uchun yozish mumkin.": "Дописать можно только за последние 30 дней.",
    "Doimiy to'lov topilmadi": "Регулярный платёж не найден",
    "kecha": "вчера",

    # --- бот: /start, онбординг, помощь ------------------------------------------------
    "Assalomu alaykum! Men <b>Flowcast</b> — kichik va mikro biznes uchun ovozli moliyaviy yordamchiman. "
    "Savdo, xarajat va qarzlarni ovoz bilan yozing — men bo'sh pulingizni oldindan hisoblab, kerak bo'lsa ogohlantiraman.":
        "Здравствуйте! Я <b>Flowcast</b> — голосовой финансовый помощник для малого и микробизнеса. "
        "Записывайте продажи, расходы и долги голосом — я заранее посчитаю свободные деньги и предупрежу, если их не хватит.",
    "Menga ovozli yoki matnli xabar yuboring, masalan:\n"
    "• «Bugun naqdga 2 million 300 ming sotdim»\n"
    "• «Alisher 150 ming qarz oldi»\n"
    "• «Payshanba kuni yetkazib beruvchiga 3 million»\n"
    "• «Har oy 5-sanada ijara 3 million»\n"
    "• «Kim menga qarz?»  • «Payshanbagacha yetadimi?»\n\n"
    "Karta va QR to'lovlari o'zi tushadi — ovoz va rasm naqd savdo, xarajat va qarzlar uchun.\n"
    "/holat — hisob holati va bo'sh pul, /qarzlar — qarzdorlar.":
        "Отправьте мне голосовое или текст, например:\n"
        "• «Сегодня продал за наличные на 2 300 000»\n"
        "• «Алишер взял в долг 150 тысяч»\n"
        "• «В четверг поставщику 3 миллиона»\n"
        "• «Каждый месяц 5-го аренда 3 миллиона»\n"
        "• «Кто мне должен?»  • «До четверга хватит?»\n\n"
        "Оплаты картой и по QR подтягиваются сами — голос и фото нужны для наличных продаж, расходов и долгов.\n"
        "/holat — состояние счёта и свободные деньги, /qarzlar — должники.",
    "Assalomu alaykum! 👋": "Здравствуйте! 👋",
    "Demo biznes «{name}» tayyor. Uni ulaysizmi yoki o'z biznesingizni qo'shasizmi?":
        "Демо-бизнес «{name}» готов. Подключить его или добавить свой бизнес?",
    "🧪 Demo biznesni ulash": "🧪 Подключить демо-бизнес",
    "➕ O'z biznesimni qo'shish": "➕ Добавить свой бизнес",
    "Biznesingiz nomi?": "Как называется ваш бизнес?",
    "Sizda biznes allaqachon qo'shilgan.": "У вас уже добавлен бизнес.",
    "Demo biznes band.": "Демо-бизнес уже занят.",
    "Ulandi!": "Подключено!",
    "✅ Demo biznes ulandi.": "✅ Демо-бизнес подключён.",
    "Biznesingiz nomini yozing, masalan: «Dilshod Biznes».": "Напишите название бизнеса, например: «Dilshod Biznes».",
    "Hozir hisobingizda qancha pul bor? (masalan: «2 million» yoki «1 500 000»)":
        "Сколько сейчас денег на счёте? (например: «2 миллиона» или «1 500 000»)",
    "Summani tushunmadim. Raqam bilan yozing, masalan: 1 500 000": "Не понял сумму. Напишите цифрами, например: 1 500 000",
    "Biznesingiz allaqachon qo'shilgan. /holat": "Ваш бизнес уже добавлен. /holat",
    "✅ «{name}» qo'shildi, hisobingizda {amount}.": "✅ «{name}» добавлен, на счёте {amount}.",
    "Hisobim": "Мой счёт",
    "Avval /start bosing.": "Сначала нажмите /start.",
    "Avval /start bosib, biznesingizni qo'shing.": "Сначала нажмите /start и добавьте бизнес.",

    # --- бот: конвейер ----------------------------------------------------------------
    "⏳ Tinglayapman...": "⏳ Слушаю...",
    "⏳ Rasmni o'qiyapman...": "⏳ Читаю фото...",
    "⏳ O'qiyapman...": "⏳ Читаю...",
    "😔 Kutilmagan xato. Qayta urinib ko'ring.": "😔 Неожиданная ошибка. Попробуйте ещё раз.",
    "Iltimos, aniqroq qilib qayta yuboring.": "Пожалуйста, отправьте ещё раз и поточнее.",
    "✅ To'g'ri": "✅ Верно",
    "✏️ Tuzatish": "✏️ Исправить",
    "Chek, nakladnoy yoki skrinshot rasmini yuboring (JPG, PNG yoki PDF).": "Пришлите фото чека, накладной или скриншот (JPG, PNG или PDF).",
    "Javob": "Ответ",

    # --- бот: подтверждение -----------------------------------------------------------
    "Bu yozuv allaqachon ko'rib chiqilgan.": "Эта запись уже обработана.",
    "Saqlandi ✅": "Сохранено ✅",
    "Saqlandi": "Сохранено",
    "📞 {person} ({phone}) SMS eslatmaga rozimi?": "📞 {person} ({phone}) согласен(на) на SMS-напоминания?",
    "Ha": "Да",
    "Yo'q": "Нет",
    "Bekor qilindi": "Отменено",
    "To'g'ri variantini ovoz yoki matn bilan qayta yuboring.": "Отправьте правильный вариант голосом или текстом.",
    "Topilmadi": "Не найдено",
    "rozi ✅": "согласен ✅",
    "rozi emas": "не согласен",
    "Javob: <b>{answer}</b>": "Ответ: <b>{answer}</b>",

    # --- бот: напоминания и офферы ----------------------------------------------------
    "Qarzdorlar yo'q.": "Должников нет.",
    "📨 <b>Eslatma matnlari</b> (nusxalab yuboring):": "📨 <b>Тексты напоминаний</b> (скопируйте и отправьте):",
    " — SMS roziligi bor: ilovada «Eslatish» SMS va to'lov havolasini yuboradi":
        " — есть согласие на SMS: кнопка «Напомнить» в приложении отправит SMS со ссылкой на оплату",
    "Hozir yetishmovchilik yo'q — overdraft kerak emas. ✅": "Сейчас нехватки нет — овердрафт не нужен. ✅",
    "Summa: <b>{amount}</b>": "Сумма: <b>{amount}</b>",
    "Muddat: {days}, yillik {rate}%": "Срок: {days}, {rate}% годовых",
    "Ortiqcha to'lov: <b>~{cost}</b>": "Переплата: <b>~{cost}</b>",
    "✅ Qabul qilaman": "✅ Принимаю",
    "❌ Kerak emas": "❌ Не нужно",
    "Hozir omonat uchun bo'sh pul yo'q.": "Сейчас нет свободных денег для вклада.",
    "Summa: <b>{amount}</b>, {days}, yillik {rate}%": "Сумма: <b>{amount}</b>, {days}, {rate}% годовых",
    "Daromad: <b>~{income}</b>": "Доход: <b>~{income}</b>",
    "✅ {bank}: {amount} hisobingizga tushdi, {date} gacha {total} qaytariladi.":
        "✅ {bank}: {amount} поступили на счёт, до {date} нужно вернуть {total}.",
    "✅ {bank}: {amount} omonatga qo'yildi, {date} da {total} qaytadi.": "✅ {bank}: {amount} положены на вклад, {date} вернётся {total}.",
    "Bu taklif allaqachon qabul qilingan.": "Это предложение уже принято.",
    "Rad etildi.": "Отклонено.",
    "Biznes overdrafti": "Бизнес-овердрафт",
    "Omonat «Bo'sh pul»": "Вклад «Свободные деньги»",
    "Overdraft — bu qarz. Muddatida qaytarilmasa, kechiktirilgan har bir kun uchun qo'shimcha foiz olinadi va kredit tarixingiz yomonlashadi.":
        "Овердрафт — это долг. Если не вернуть вовремя, за каждый день просрочки начисляются проценты, а кредитная история портится.",
    "Muddatidan oldin yechilsa, foiz yillik 5% gacha kamayadi.": "Если забрать деньги раньше срока, ставка снизится до 5% годовых.",

    # --- уведомление об оплате по ссылке ----------------------------------------------
    "Bo'sh pul endi: <b>{free}</b>": "Свободные деньги теперь: <b>{free}</b>",
    "havola orqali · tasdiqlangan": "по ссылке · подтверждено",
    "{name} to'ladi ✅ {amount}": "{name} оплатил(а) ✅ {amount}",
}
