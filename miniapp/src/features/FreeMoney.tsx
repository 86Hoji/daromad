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
  roll = false,
}: {
  summary: Summary;
  rec: Recommendation | null;
  today: string;
  size?: "app" | "tg";
  /** цифра прокручивается одометром при появлении */
  roll?: boolean;
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
        className={`display mt-4 flex items-baseline gap-[0.18em] leading-none font-bold ${neg ? "text-neg-text" : "text-ink"}`}
        style={{ fontSize: heroSize(summary.free_money, big ? 96 : 54, big ? 44 : 34) }}
      >
        <AnimatedNumber value={summary.free_money} roll={roll} />
        <span className="font-sans text-[0.28em] font-medium tracking-normal text-ink-3">so'm</span>
      </div>
      <p className={`mt-4 max-w-[52ch] text-ink-2 ${big ? "text-[18px]" : "text-[15px]"}`}>{explain(summary, rec, today)}</p>
    </div>
  );
}

/** Раскладка как формула: hisobda + kutilgan − to'lovlar = bo'sh pul. Код считает — человек видит как. */
export function Formula({ summary }: { summary: Summary }) {
  const net = summary.expected_sales - summary.expected_expenses;
  const parts: { label: string; v: string; op?: string; cls?: string; hint?: string }[] = [
    { label: "Hisobda", v: moneyShort(summary.cash_now) },
    { label: "Kutilgan sotuv", v: moneyShort(Math.abs(net)), op: net >= 0 ? "+" : "−", hint: "xarajatdan keyin" },
    { label: "To'lovlar", v: moneyShort(summary.payments_due), op: "−" },
    { label: "Bo'sh pul", v: moneyShort(summary.free_money), op: "=", cls: summary.free_money < 0 ? "text-neg-text" : "text-pos-text" },
  ];
  return (
    <div className="flex flex-wrap items-end gap-x-3.5 gap-y-3">
      {parts.map((p) => (
        <div key={p.label} className="flex items-end gap-3.5">
          {p.op && (
            <span className="display pb-1 text-[22px] font-medium text-ink-3" aria-hidden>
              {p.op}
            </span>
          )}
          <div>
            <div className="text-[13px] text-ink-3">{p.label}</div>
            <div className={`num text-[19px] font-semibold ${p.cls ?? ""}`}>{p.v}</div>
          </div>
        </div>
      ))}
      <div className="ml-auto border-l border-line pl-4">
        <div className="text-[13px] text-ink-3">Sizga qarz</div>
        <div className="num text-[19px] font-semibold text-warn-text">{moneyShort(summary.total_receivable)}</div>
      </div>
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
