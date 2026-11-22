// Главная цифра «Bo'sh pul» + одна фраза-объяснение + мини-раскладка.
import type { Recommendation, Summary } from "../lib/api";
import { capitalize, currency, ddmm, money, moneyShort, num, onDay, untilLabel } from "../lib/format";
import { pick, t } from "../lib/i18n";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { ReliabilityLine } from "./DataQuality";

/** Одна фраза, почему цифра такая. Без цифр, которые не посчитал код. */
export function explain(summary: Summary, rec: Recommendation | null, today: string): string {
  const pay = summary.payments[0];
  const when = pay ? capitalize(onDay(pay.due_date)) : capitalize(untilLabel(summary.horizon, today));
  const who = pay ? (pay.counterparty || pay.title) : null;
  const until = capitalize(untilLabel(summary.horizon, today));
  if (rec?.kind === "shortage") {
    const amt = pay ? moneyShort(pay.amount) : "";
    const base = who
      ? pick({ uz: `${when} ${who}ga ${amt} to'lov`, ru: `${when} платёж ${amt} (${who})`, en: `${when}: ${amt} payment to ${who}` })
      : pick({ uz: `${when} to'lov`, ru: `${when} платёж`, en: `${when}: a payment` });
    return rec.covers_by_debts
      ? `${base} — ${t("qarzlar qaytsa, pul yetadi.")}`
      : `${base} — ${t("qarzlar to'liq yopmaydi, {gap} yetmaydi.", { gap: moneyShort(rec.gap) })}`;
  }
  if (rec?.kind === "surplus") return t("To'lovlardan keyin ham {amount} qoladi — u ishlashi mumkin.", { amount: moneyShort(rec.free_money) });
  return who
    ? pick({ uz: `${when} ${who}ga to'lovdan keyin ham pul yetadi.`, ru: `${when} после платежа (${who}) денег хватит.`, en: `${when}, after paying ${who}, you still have enough.` })
    : pick({ uz: `${until} pul yetadi.`, ru: `${until} денег хватит.`, en: `${until} you have enough.` });
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
        {t("Bo'sh pul")} · {untilLabel(summary.horizon, today)}, {ddmm(summary.horizon)}
      </div>
      <div
        className={`display mt-4 flex items-baseline gap-[0.18em] leading-none font-bold ${neg ? "text-neg-text" : "text-ink"}`}
        style={{ fontSize: heroSize(summary.free_money, big ? 96 : 54, big ? 44 : 34) }}
      >
        <AnimatedNumber value={summary.free_money} roll={roll} />
        <span className="font-sans text-[0.28em] font-medium tracking-normal text-ink-3">{currency()}</span>
      </div>
      <ReliabilityLine rel={summary.reliability} className="mt-3" />
      <p className={`mt-4 max-w-[52ch] text-ink-2 ${big ? "text-[18px]" : "text-[15px]"}`}>{explain(summary, rec, today)}</p>
    </div>
  );
}

/** Раскладка как формула: hisobda + kutilgan − to'lovlar = bo'sh pul. Код считает — человек видит как. */
export function Formula({ summary }: { summary: Summary }) {
  const net = summary.expected_sales - summary.expected_expenses;
  const parts: { label: string; v: string; op?: string; cls?: string; hint?: string }[] = [
    { label: t("Hisobda"), v: moneyShort(summary.cash_now) },
    { label: t("Kutilgan sotuv"), v: moneyShort(Math.abs(net)), op: net >= 0 ? "+" : "−", hint: t("xarajatdan keyin") },
    { label: t("To'lovlar"), v: moneyShort(summary.payments_due), op: "−" },
    { label: t("Bo'sh pul"), v: moneyShort(summary.free_money), op: "=", cls: summary.free_money < 0 ? "text-neg-text" : "text-pos-text" },
  ];
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      {parts.map((p) => (
        <div key={p.label} className="flex items-end gap-3.5">
          {p.op && (
            <span className="display pb-1 text-[22px] font-medium text-ink-3" aria-hidden>
              {p.op}
            </span>
          )}
          <div>
            <div className="text-[13px] leading-5 text-ink-3">{p.label}</div>
            <div className={`display num mt-1 text-[20px] leading-tight font-semibold whitespace-nowrap xl:text-[22px] ${p.cls ?? ""}`}>{p.v}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Breakdown({ summary, dense = false }: { summary: Summary; dense?: boolean }) {
  const items = [
    { label: t("Hisobda"), value: summary.cash_now, tone: "" },
    { label: t("Kutilgan sotuv"), value: summary.expected_sales - summary.expected_expenses, tone: "", sign: true, hint: t("xarajatlardan keyin") },
    { label: t("To'lovlar"), value: -summary.payments_due, tone: "" },
    { label: t("Sizga qarz"), value: summary.total_receivable, tone: "text-warn-text" },
  ];
  return (
    <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 ${dense ? "" : "sm:grid-cols-4"}`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[13px] leading-5 text-ink-3">{it.label}</dt>
          <dd className={`display num mt-1 truncate text-[20px] leading-tight font-semibold ${it.tone}`} title={money(it.value)}>
            {it.sign && it.value > 0 ? "+" : ""}
            {moneyShort(it.value)}
          </dd>
          {it.hint && <dd className="text-[12px] text-ink-3">{it.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
