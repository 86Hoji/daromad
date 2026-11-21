// Главная цифра «Bo'sh pul» + одна фраза-объяснение + мини-раскладка.
import type { Recommendation, Summary } from "../lib/api";
import { capitalize, ddmm, money, moneyShort, num, untilLabel, weekday } from "../lib/format";
import { AnimatedNumber } from "../ui/AnimatedNumber";

/** Одна фраза, почему цифра такая. Без цифр, которые не посчитал код. */
export function explain(summary: Summary, rec: Recommendation | null, today: string): string {
  const pay = summary.payments[0];
  const when = pay ? capitalize(weekday(pay.due_date)) : capitalize(untilLabel(summary.horizon, today));
  const who = pay ? (pay.counterparty || pay.title) : null;
  if (rec?.kind === "shortage") {
    const base = who ? `${when} ${who}ga ${moneyShort(pay!.amount)} to'lov` : `${when} to'lov`;
    return rec.covers_by_debts
      ? `${base} — qarzlar qaytsa, pul yetadi.`
      : `${base} — qarzlar to'liq yopmaydi, ${moneyShort(rec.gap)} yetmaydi.`;
  }
  if (rec?.kind === "surplus") return `To'lovlardan keyin ham ${moneyShort(rec.free_money)} qoladi — u ishlashi mumkin.`;
  return who ? `${when} ${who}ga to'lovdan keyin ham pul yetadi.` : `${capitalize(untilLabel(summary.horizon, today))} pul yetadi.`;
}

/** Размер цифры от ширины контейнера и длины числа (cqw), чтобы «−12 350 000» тоже влезало. */
function heroSize(value: number, maxPx: number, minPx: number): string {
  const chars = num(value).length;
  return `clamp(${minPx}px, ${(100 / (chars * 0.78 + 1.1)).toFixed(1)}cqw, ${maxPx}px)`;
}

export function FreeMoney({
  summary,
  rec,
  today,
  size = "app",
}: {
  summary: Summary;
  rec: Recommendation | null;
  today: string;
  size?: "app" | "tg";
}) {
  const neg = summary.free_money < 0;
  const big = size === "app";
  return (
    <div className="@container">
      <div className="flex items-center gap-2 text-[15px] text-ink-2">
        <span className={`h-2 w-2 rounded-full ${neg ? "bg-neg" : "bg-pos"}`} aria-hidden />
        Bo'sh pul · {untilLabel(summary.horizon, today)}, {ddmm(summary.horizon)}
      </div>
      <div
        className={`display mt-3 flex items-baseline gap-[0.18em] leading-[0.95] font-bold ${neg ? "text-neg-text" : "text-ink"}`}
        style={{ fontSize: heroSize(summary.free_money, big ? 112 : 54, big ? 40 : 34) }}
      >
        <AnimatedNumber value={summary.free_money} />
        <span className="font-sans text-[0.28em] font-medium tracking-normal text-ink-3">so'm</span>
      </div>
      <p className={`mt-4 max-w-[52ch] text-ink-2 ${big ? "text-[17px]" : "text-[15px]"}`}>{explain(summary, rec, today)}</p>
    </div>
  );
}

export function Breakdown({ summary, dense = false }: { summary: Summary; dense?: boolean }) {
  const items = [
    { label: "Hisobda", value: summary.cash_now, tone: "" },
    { label: "Kutilgan sotuv", value: summary.expected_sales - summary.expected_expenses, tone: "", sign: true, hint: "xarajatlardan keyin" },
    { label: "To'lovlar", value: -summary.payments_due, tone: "" },
    { label: "Sizga qarz", value: summary.total_receivable, tone: "text-warn-text" },
  ];
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 ${dense ? "" : "sm:grid-cols-4"}`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[13px] text-ink-3">{it.label}</dt>
          <dd className={`num mt-1 truncate text-[17px] font-semibold ${it.tone}`} title={money(it.value)}>
            {it.sign && it.value > 0 ? "+" : ""}
            {moneyShort(it.value)}
          </dd>
          {it.hint && <dd className="text-[12px] text-ink-3">{it.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
