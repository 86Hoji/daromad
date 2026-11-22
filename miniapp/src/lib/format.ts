// Форматирование по языку интерфейса: «1 200 000 сум» / «so'm» / «UZS», даты и дни недели.
import { getLang, pick, t, tMaybe } from "./i18n";

const WEEKDAYS_UZ = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"];
const WEEKDAYS: Record<string, string[]> = {
  uz: WEEKDAYS_UZ,
  ru: ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
// «до четверга», «к среде» — родительный падеж для «до …»
const WEEKDAYS_RU_GEN = ["понедельника", "вторника", "среды", "четверга", "пятницы", "субботы", "воскресенья"];
const WD_SHORT: Record<string, string[]> = {
  uz: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"],
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
};
const MONTHS: Record<string, string[]> = {
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  ru: ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** Для совместимости: узбекские названия (бэкенд и тексты бота). */
export const WEEKDAYS_UZ_LIST = WEEKDAYS_UZ;

const MINUS = "−";

/** 1200000 -> "1 200 000"; отрицательные — с типографским минусом. Разделитель — неразрывный узкий пробел не нужен:
 *  во всех трёх языках принято «1 200 000». */
export function num(n: number): string {
  const s = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? MINUS : "") + s;
}

/** Название валюты: сум / so'm / UZS. */
export function currency(): string {
  return pick({ ru: "сум", uz: "so'm", en: "UZS" });
}

export function money(n: number): string {
  return `${num(n)} ${currency()}`;
}

/** Компактно: 3 000 000 -> "3 млн" / "3 mln" / "3M", 450 000 -> "450 тыс." / "450 ming" / "450K". */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  const lang = getLang();
  if (a >= 1_000_000) {
    const v = a / 1_000_000;
    const s = v % 1 === 0 ? String(v) : lang === "en" ? v.toFixed(1) : v.toFixed(1).replace(".", ",");
    return lang === "en" ? `${sign}${s}M` : `${sign}${s} ${lang === "ru" ? "млн" : "mln"}`;
  }
  if (a >= 1000) {
    const k = Math.round(a / 1000);
    return lang === "en" ? `${sign}${k}K` : `${sign}${k} ${lang === "ru" ? "тыс." : "ming"}`;
  }
  return `${sign}${a}`;
}

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Пн=0 ... Вс=6, как в бэке. */
export function weekdayIndex(iso: string): number {
  return (parseDate(iso).getDay() + 6) % 7;
}

export function weekday(iso: string): string {
  return WEEKDAYS[getLang()][weekdayIndex(iso)];
}

export function weekdayShort(iso: string): string {
  return WD_SHORT[getLang()][weekdayIndex(iso)];
}

export function ddmm(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function longDate(iso: string): string {
  const d = parseDate(iso);
  const m = MONTHS[getLang()][d.getMonth()];
  return pick({ uz: `${d.getDate()}-${m}`, ru: `${d.getDate()} ${m}`, en: `${m} ${d.getDate()}` });
}

export function daysFromToday(iso: string, today: string): number {
  return Math.round((parseDate(iso).getTime() - parseDate(today).getTime()) / 86_400_000);
}

/** «payshanbagacha» / «до четверга» / «by Thursday»; «ertagacha» / «до завтра»; «26.11 gacha» / «до 26.11». */
export function untilLabel(iso: string, today: string): string {
  const n = daysFromToday(iso, today);
  const i = weekdayIndex(iso);
  if (n <= 0) return pick({ uz: "bugungacha", ru: "на сегодня", en: "for today" });
  if (n === 1) return pick({ uz: "ertagacha", ru: "до завтра", en: "by tomorrow" });
  if (n <= 6) return pick({ uz: `${WEEKDAYS_UZ[i]}gacha`, ru: `до ${WEEKDAYS_RU_GEN[i]}`, en: `by ${WEEKDAYS.en[i]}` });
  return pick({ uz: `${ddmm(iso)} gacha`, ru: `до ${ddmm(iso)}`, en: `by ${ddmm(iso)}` });
}

/** «payshanba» как обстоятельство времени: «в четверг» / «on Thursday» / «payshanba». */
export function onDay(iso: string): string {
  const i = weekdayIndex(iso);
  return pick({ uz: WEEKDAYS_UZ[i], ru: `в ${["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"][i]}`, en: `on ${WEEKDAYS.en[i]}` });
}

/** «N kun» / «N дн.» / «N d». */
export function daysShort(n: number): string {
  return pick({ uz: `${n} kun`, ru: `${n} дн.`, en: `${n} d` });
}

/** «N kun» с правильной формой для RU: 1 день, 2 дня, 5 дней. */
export function daysLong(n: number): string {
  const ru = ((): string => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "день";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "дня";
    return "дней";
  })();
  return pick({ uz: `${n} kun`, ru: `${n} ${ru}`, en: `${n} ${n === 1 ? "day" : "days"}` });
}

/** Склонение для RU: plural(3, ["клиент","клиента","клиентов"]). */
export function ruPlural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function timeHM(ts: string): string {
  return ts.slice(11, 16);
}

const TRUST: Record<string, string> = {
  voice: "so'zdan",
  text: "so'zdan",
  photo: "skrinshot",
  bank: "tasdiqlangan",
  link: "tasdiqlangan",
};

/** Метка доверия записи: «со слов» / «скриншот» / «подтверждено». Сравнивать с isConfirmed(), не со строкой. */
export function trustLabel(source: string | null | undefined): string {
  return t(TRUST[source ?? ""] ?? "so'zdan");
}

export const isConfirmed = (source: string | null | undefined) => source === "bank" || source === "link";

/** Узбекские ключи меток доверия (как в бэке: summary.trust_share). */
export const TRUST_LABEL = TRUST;

const CATEGORY: Record<string, string> = {
  tovar: "Tovar",
  ijara: "Ijara",
  maosh: "Maosh",
  kommunal: "Kommunal",
  transport: "Transport",
  boshqa: "Boshqa",
};

export function categoryLabel(cat: string | null | undefined): string {
  return cat ? t(CATEGORY[cat] ?? cat) : t("Boshqa");
}

/** Узбекские ключи категорий (для перебора). */
export const CATEGORY_LABEL = CATEGORY;

/** Заголовок события прогноза: служебные потоки (овердрафт/вклад) и известные названия платежей переводим,
 *  пользовательские названия («Akmal aka») оставляем как есть. */
export function eventTitle(e: { title: string }): string {
  return tMaybe(e.title);
}
