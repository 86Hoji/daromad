// Офлайн-данные лендинга: если бэкенд недоступен, «Pul chizig'i» и песочница всё равно показывают пример.
import type { Draft, Forecast, ForecastDay } from "../lib/api";
import { WEEKDAYS } from "../lib/format";

const HISTORY = [1406000, 1866000, 2436000, 2957000, 349000, 942000, 1182000, 390000, 976000, 1478000, 311000, 717000, 487000, 487000];
// [balance, low, high] на 14 дней вперёд; на 5-й день — платёж Акмалу 3 млн
const PLAN: [number, number, number][] = [
  [487000, 487000, 487000],
  [1117000, 1026000, 1196000],
  [1644000, 1338000, 1891000],
  [2174000, 1670000, 2510000],
  [-350000, -1000000, 141000],
  [87000, -660000, 670000],
  [616000, -380000, 1334000],
  [636000, -535000, 1470000],
  [1266000, 3000, 2179000],
  [1793000, 315000, 2874000],
  [2323000, 648000, 3494000],
  [2799000, 977000, 4124000],
  [3236000, 1316000, 4653000],
  [3765000, 1596000, 5317000],
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

export function demoForecast(): Forecast {
  const now = new Date();
  const today = iso(now);
  const history = HISTORY.map((balance, i) => ({ date: iso(shift(now, i - HISTORY.length + 1)), balance }));
  const pay = { id: -1, type: "scheduled_payment", title: "Akmal — tovar uchun", counterparty: "Akmal", amount: 3000000 };
  const forecast: ForecastDay[] = PLAN.map(([balance, low, high], i) => {
    const d = shift(now, i + 1);
    return {
      date: iso(d),
      weekday: WEEKDAYS[(d.getDay() + 6) % 7],
      balance,
      low,
      high,
      expected_sales: 0,
      expected_expenses: 0,
      events: i === 4 ? [pay] : [],
      red: balance < 0,
    };
  });
  return { today, cash_now: 487000, history, forecast, events: [{ ...pay, date: forecast[4].date }] };
}

function draft(id: number, p: Partial<Draft> & Pick<Draft, "type" | "amount">): Draft {
  return { id, batch_id: "demo", source: "text", trust: "so'zdan", person: null, phone: null, category: null, due_date: null, note: null, needs_check: false, ...p };
}

/** Примеры для песочницы и для шага «Tasdiqlang». */
export const EXAMPLES: { text: string; drafts: Draft[] }[] = [
  {
    text: "Bugun 2 million 300 ming sotdim, transportga 90 ming ketdi",
    drafts: [draft(-11, { type: "sale", amount: 2300000 }), draft(-12, { type: "expense", amount: 90000, category: "transport" })],
  },
  {
    text: "Alisher 450 ming qarzga oldi",
    drafts: [draft(-21, { type: "debt_given", amount: 450000, person: "Alisher" })],
  },
  {
    text: "Payshanba kuni Akmalga tovar uchun 3 million to'lashim kerak",
    drafts: [draft(-31, { type: "scheduled_payment", amount: 3000000, person: "Akmal", due_date: iso(shift(new Date(), 5)) })],
  },
  {
    text: "Nigora opa 300 ming qarzini qaytardi",
    drafts: [draft(-41, { type: "debt_returned", amount: 300000, person: "Nigora opa" })],
  },
];
