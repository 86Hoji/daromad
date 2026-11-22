// Тексты новой оболочки Mini App (/tg). Все три языка рядом, без общих словарей lib/locales/*:
// сайт правится параллельно, а test_i18n_keys проверяет только строки, переданные в функцию t.
// Вызов: tx("intro1Title"), подстановки: tx("continueAs", { name: "Alisher" }).
import { getLang } from "../lib/i18n";

type Tri = { ru: string; uz: string; en: string };

const TX = {
  // --- знакомство ---
  skip: { ru: "Пропустить", uz: "O'tkazib yuborish", en: "Skip" },
  next: { ru: "Далее", uz: "Keyingisi", en: "Next" },
  start: { ru: "Начать", uz: "Boshlash", en: "Start" },
  intro1Title: { ru: "Говорите — Flowcast ведёт учёт", uz: "Gapiring — Flowcast hisobni yuritadi", en: "Just talk — Flowcast keeps the books" },
  intro1Text: {
    ru: "Продажи, расходы и долги — голосом, текстом или фото чека. Безнал подтягивается сам.",
    uz: "Savdo, xarajat va qarzlar — ovoz, matn yoki chek surati bilan. Naqdsiz tushum o'zi keladi.",
    en: "Sales, expenses and debts by voice, text or a photo of a receipt. Card payments come in on their own.",
  },
  intro2Title: { ru: "Знайте заранее, хватит ли денег", uz: "Pul yetishini oldindan biling", en: "Know in advance if the money will last" },
  intro2Text: {
    ru: "Свободные деньги до следующего платежа. Если в четверг не хватит — скажем заранее и подскажем, что сделать.",
    uz: "Keyingi to'lovgacha bo'sh pul. Payshanba kuni yetmasa — oldindan aytamiz va nima qilishni maslahat beramiz.",
    en: "Free money until the next payment. If Thursday falls short, we warn you early and suggest what to do.",
  },
  intro3Title: { ru: "Ничего без вашего «Да»", uz: "«Ha» demaguningizcha hech narsa", en: "Nothing without your “Yes”" },
  intro3Text: {
    ru: "Записи, SMS должникам и предложения банка — только после вашего подтверждения.",
    uz: "Yozuvlar, qarzdorlarga SMS va bank takliflari — faqat siz tasdiqlaganingizdan keyin.",
    en: "Entries, SMS to debtors and bank offers happen only after you confirm.",
  },
  authTitle: { ru: "Вход через Telegram", uz: "Telegram orqali kirish", en: "Sign in with Telegram" },
  authText: {
    ru: "Пароль не нужен: Telegram уже знает, кто вы.",
    uz: "Parol kerak emas: Telegram sizni allaqachon taniydi.",
    en: "No password needed: Telegram already knows who you are.",
  },
  continueAs: { ru: "Продолжить как {name}", uz: "{name} sifatida davom etish", en: "Continue as {name}" },
  bizTitle: { ru: "Ваш бизнес", uz: "Biznesingiz", en: "Your business" },
  bizText: {
    ru: "Для показа открыт демо-бизнес с данными за последние недели.",
    uz: "Namoyish uchun so'nggi haftalar ma'lumotlari bilan demo biznes ochiladi.",
    en: "For the demo we open a sample business with the last few weeks of data.",
  },
  demoBiz: { ru: "демо-бизнес", uz: "demo biznes", en: "demo business" },
  introSay: { ru: "«Сегодня продал за наличные на 1 млн»", uz: "«Bugun naqdga 1 million sotdim»", en: "“Sold 1 million in cash today”" },
  introSaved: { ru: "Продажа · наличные", uz: "Savdo · naqd", en: "Sale · cash" },
  introFree: { ru: "Свободные деньги · четверг", uz: "Bo'sh pul · payshanba", en: "Free money · Thursday" },
  introShort: { ru: "Не хватит — напомните должникам", uz: "Yetmaydi — qarzdorlarga eslating", en: "Short — remind your debtors" },
  yes: { ru: "Да", uz: "Ha", en: "Yes" },
  no: { ru: "Нет", uz: "Yo'q", en: "No" },

  // --- навигация ---
  navHome: { ru: "Главная", uz: "Bosh sahifa", en: "Home" },
  navOps: { ru: "Операции", uz: "Amallar", en: "Activity" },
  navDebts: { ru: "Долги", uz: "Qarzlar", en: "Debts" },
  navMore: { ru: "Ещё", uz: "Yana", en: "More" },
  add: { ru: "Добавить", uz: "Qo'shish", en: "Add" },

  // --- лист [ + ] ---
  addTitle: { ru: "Что записать?", uz: "Nimani yozamiz?", en: "What to record?" },
  addVoice: { ru: "Сказать голосом", uz: "Ovoz bilan aytish", en: "Say it" },
  addVoiceHint: { ru: "Продажи, расходы, долги — одной фразой", uz: "Savdo, xarajat, qarz — bitta gapda", en: "Sales, expenses, debts — in one sentence" },
  addScan: { ru: "Сканировать чек / накладную", uz: "Chek / nakladnoyni skanerlash", en: "Scan a receipt / invoice" },
  addScanHint: { ru: "Камера или фото, суммы проверит код", uz: "Kamera yoki rasm, summalarni kod tekshiradi", en: "Camera or photo; amounts are checked by code" },
  addText: { ru: "Ввести текстом", uz: "Matn bilan yozish", en: "Type it" },
  addTextHint: { ru: "Если говорить неудобно", uz: "Gapirish noqulay bo'lsa", en: "When you can't talk" },
  listening: { ru: "Слушаю…", uz: "Eshityapman…", en: "Listening…" },
  listenHint: {
    ru: "Например: «Сегодня продал на 1 млн, Jamshid взял в долг 200 тыс.»",
    uz: "Masalan: «Bugun 1 millionga sotdim, Jamshid 200 ming qarz oldi»",
    en: "For example: “Sold 1 million today, Jamshid took 200K on credit”",
  },
  done: { ru: "Готово", uz: "Tayyor", en: "Done" },
  typeInstead: { ru: "Ввести текстом", uz: "Matn bilan yozish", en: "Type instead" },
  busyVoice: { ru: "Распознаю голос…", uz: "Ovozni tanyapman…", en: "Recognising speech…" },
  busyText: { ru: "Разбираю запись…", uz: "Yozuvni tahlil qilyapman…", en: "Reading your note…" },
  busyPhoto: { ru: "Читаю фото…", uz: "Rasmni o'qiyapman…", en: "Reading the photo…" },
  photoTooLarge: { ru: "Фото слишком большое — снимите ещё раз", uz: "Rasm juda katta — qayta suratga oling", en: "The photo is too large — take it again" },
  photoFailed: { ru: "Не удалось отправить фото", uz: "Rasmni yuborib bo'lmadi", en: "Couldn't send the photo" },

  // --- Главная ---
  qaScan: { ru: "Сканировать", uz: "Skanerlash", en: "Scan" },
  qaRemind: { ru: "Напомнить должникам", uz: "Qarzdorlarga eslatish", en: "Remind debtors" },
  qaReport: { ru: "Отчёт", uz: "Hisobot", en: "Report" },
  kpiTitle: { ru: "Итоги", uz: "Natijalar", en: "Totals" },
  days7: { ru: "7 дней", uz: "7 kun", en: "7 days" },
  days30: { ru: "30 дней", uz: "30 kun", en: "30 days" },
  kpiSales: { ru: "Выручка", uz: "Tushum", en: "Revenue" },
  kpiExpenses: { ru: "Расходы", uz: "Xarajatlar", en: "Expenses" },
  kpiProfit: { ru: "Прибыль", uz: "Foyda", en: "Profit" },
  kpiOwed: { ru: "Вам должны", uz: "Sizga qarz", en: "Owed to you" },

  // --- Операции ---
  opsTitle: { ru: "Операции", uz: "Amallar", en: "Activity" },
  opsPeriod: { ru: "за 30 дней", uz: "30 kunda", en: "last 30 days" },
  fAll: { ru: "Все", uz: "Hammasi", en: "All" },
  fCash: { ru: "Наличные", uz: "Naqd", en: "Cash" },
  fCashless: { ru: "Безнал", uz: "Naqdsiz", en: "Cashless" },
  fAnySource: { ru: "Любой источник", uz: "Har qanday manba", en: "Any source" },
  srcVoice: { ru: "Голос", uz: "Ovoz", en: "Voice" },
  srcText: { ru: "Текст", uz: "Matn", en: "Text" },
  srcPhoto: { ru: "Фото", uz: "Rasm", en: "Photo" },
  srcBank: { ru: "Из платежей", uz: "To'lovlardan", en: "From payments" },
  opsEmpty: { ru: "Нет записей под этот фильтр", uz: "Bu filtr bo'yicha yozuv yo'q", en: "No entries for this filter" },
  today: { ru: "Сегодня", uz: "Bugun", en: "Today" },
  yesterday: { ru: "Вчера", uz: "Kecha", en: "Yesterday" },
  sale: { ru: "Продажа", uz: "Savdo", en: "Sale" },

  // --- Ещё ---
  moreTitle: { ru: "Ещё", uz: "Yana", en: "More" },
  mReports: { ru: "Отчёты", uz: "Hisobotlar", en: "Reports" },
  mReportsHint: { ru: "Выручка, расходы по категориям, надёжность", uz: "Tushum, toifalar bo'yicha xarajat, ishonchlilik", en: "Revenue, expenses by category, reliability" },
  mRecurring: { ru: "Регулярные платежи", uz: "Doimiy to'lovlar", en: "Recurring payments" },
  mRecurringHint: { ru: "Аренда, зарплата, коммунальные", uz: "Ijara, maosh, kommunal", en: "Rent, salaries, utilities" },
  mJournal: { ru: "Журнал", uz: "Jurnal", en: "Log" },
  mJournalHint: { ru: "Кто что сделал и когда", uz: "Kim nima qildi va qachon", en: "Who did what and when" },
  mSettings: { ru: "Настройки", uz: "Sozlamalar", en: "Settings" },
  mSettingsHint: { ru: "Язык, тема, знакомство", uz: "Til, mavzu, tanishuv", en: "Language, theme, intro" },
  introAgain: { ru: "Пройти знакомство заново", uz: "Tanishuvni qayta ko'rish", en: "Replay the intro" },
  back: { ru: "Назад", uz: "Orqaga", en: "Back" },
  openDemo: { ru: "Открыть демо-бизнес", uz: "Demo biznesni ochish", en: "Open the demo business" },
} satisfies Record<string, Tri>;

export type TxKey = keyof typeof TX;

export function tx(key: TxKey, vars?: Record<string, string | number>): string {
  let s = TX[key][getLang()];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
