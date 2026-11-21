// Форматирование: «1 200 000 so'm», даты и дни недели на узбекском.

export const WEEKDAYS = ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"];
const WD_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

const MINUS = "−";

/** 1200000 -> "1 200 000"; отрицательные — с типографским минусом. */
export function num(n: number): string {
  const s = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? MINUS : "") + s;
}

export function money(n: number): string {
  return `${num(n)} so'm`;
}

/** Компактно для подписей графика: 3 000 000 -> "3 mln", 450 000 -> "450 ming". */
export function moneyShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  if (a >= 1_000_000) {
    const v = a / 1_000_000;
    return `${sign}${v % 1 === 0 ? v : v.toFixed(1).replace(".", ",")} mln`;
  }
  if (a >= 1000) return `${sign}${Math.round(a / 1000)} ming`;
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
  return WEEKDAYS[weekdayIndex(iso)];
}

export function weekdayShort(iso: string): string {
  return WD_SHORT[weekdayIndex(iso)];
}

export function ddmm(iso: string): string {
  const d = parseDate(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function longDate(iso: string): string {
  const d = parseDate(iso);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

export function daysFromToday(iso: string, today: string): number {
  return Math.round((parseDate(iso).getTime() - parseDate(today).getTime()) / 86_400_000);
}

/** «payshanbagacha», «ertagacha», «bugungacha», «26.11 gacha». */
export function untilLabel(iso: string, today: string): string {
  const n = daysFromToday(iso, today);
  if (n <= 0) return "bugungacha";
  if (n === 1) return "ertagacha";
  if (n <= 6) return `${weekday(iso)}gacha`;
  return `${ddmm(iso)} gacha`;
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function timeHM(ts: string): string {
  return ts.slice(11, 16);
}

export const TRUST_LABEL: Record<string, string> = {
  voice: "so'zdan",
  text: "so'zdan",
  photo: "skrinshot",
  bank: "tasdiqlangan",
  link: "tasdiqlangan",
};

export const CATEGORY_LABEL: Record<string, string> = {
  tovar: "Tovar",
  ijara: "Ijara",
  maosh: "Maosh",
  kommunal: "Kommunal",
  transport: "Transport",
  boshqa: "Boshqa",
};
