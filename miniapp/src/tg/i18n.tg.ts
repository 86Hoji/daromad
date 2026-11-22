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
  openDemo: { ru: "Открыть демо-бизнес", uz: "Demo biznesni ochish", en: "Open the demo business" },
} satisfies Record<string, Tri>;

export type TxKey = keyof typeof TX;

export function tx(key: TxKey, vars?: Record<string, string | number>): string {
  let s = TX[key][getLang()];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
