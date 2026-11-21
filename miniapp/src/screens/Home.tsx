import { Composer } from "../components/Composer";
import { MoneyChart } from "../components/MoneyChart";
import { NextSteps } from "../components/NextSteps";
import { AnimatedNumber } from "../components/ui";
import { useLive } from "../lib/live";
import { capitalize, ddmm, money, moneyShort, num, untilLabel, weekday } from "../lib/format";
import { Loading } from "./Loading";

/** Цифры Inter ≈ 0.6em, «so'm» с отступом ≈ 0.85em. Не больше 112px и не меньше 40px. */
function heroSize(value: number): string {
  const chars = num(value).length;
  return `clamp(40px, ${(100 / (chars * 0.6 + 0.85)).toFixed(1)}cqw, 112px)`;
}

export function Home() {
  const { summary, forecast, rec, error } = useLive();
  if (!summary || !forecast || !rec) return <Loading error={error} />;

  const today = forecast.today;
  const neg = summary.free_money < 0;
  const pay = summary.payments[0];
  const covers = rec.kind === "shortage" && rec.covers_by_debts;
  const upcoming = forecast.events.slice(0, 4);

  return (
    <div className="pb-[170px] lg:pb-10">
      <div className="lg:grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)] lg:gap-10">
        {/* ---- левая колонка: цифра + шаги + ввод ---- */}
        <div className="lg:flex lg:flex-col">
          <section className="pt-2 pb-7 lg:pt-6">
            <div className="flex items-center gap-2 text-[14px] font-medium text-ink-2">
              <span className={`h-2 w-2 rounded-full ${neg ? "bg-neg" : "bg-pos"}`} />
              Bo'sh pul · {untilLabel(summary.horizon, today)}, {ddmm(summary.horizon)}
            </div>
            {/* размер цифры — от ширины колонки и длины числа, чтобы «−12 350 000 so'm» тоже влезало */}
            <div className="@container mt-3">
              <div
                className={`flex items-baseline gap-[0.12em] font-bold leading-none tracking-[-0.045em] ${neg ? "text-neg" : "text-ink"}`}
                style={{ fontSize: heroSize(summary.free_money) }}
              >
                <AnimatedNumber value={summary.free_money} />
                <span className="text-[0.32em] font-semibold tracking-tight text-ink-3">so'm</span>
              </div>
            </div>

            <div className="mt-5 space-y-2 text-[15px] leading-snug">
              {pay ? (
                <p className="text-ink-2">
                  <span className="font-semibold text-ink">{pay.counterparty || pay.title}</span> — {money(pay.amount)} to'lov,{" "}
                  {weekday(pay.due_date)}
                </p>
              ) : (
                <p className="text-ink-2">Yaqin 7 kunda rejalashtirilgan to'lov yo'q</p>
              )}
              {summary.total_receivable > 0 && (
                <p className="text-ink-2">
                  Sizga qarz: <span className="num font-semibold text-ink">{money(summary.total_receivable)}</span>
                  {covers && <span className="font-medium text-pos"> — agar qaytarishsa, yetadi</span>}
                </p>
              )}
            </div>

            <dl className="mt-6 grid grid-cols-3 border-y border-line py-4 text-[12px]">
              <Stat label="Hisobda hozir" value={moneyShort(summary.cash_now)} />
              <Stat label="Kutilgan sotuv" value={`+${moneyShort(summary.expected_sales)}`} />
              <Stat label="To'lovlar" value={summary.payments_due ? `−${moneyShort(summary.payments_due)}` : "0"} />
            </dl>
          </section>

          {/* график на мобильном — сразу после цифры */}
          <ChartCard className="lg:hidden" />

          <div className="mt-8 lg:mt-2">
            <NextSteps rec={rec} forecast={forecast} />
          </div>

          <div className="mt-auto hidden pt-8 lg:block">
            <Composer />
          </div>
        </div>

        {/* ---- правая колонка (десктоп): большой график + ближайшие события ---- */}
        <div className="hidden lg:block lg:pt-6">
          <ChartCard tall />
          {upcoming.length > 0 && (
            <div className="card mt-6 p-6">
              <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">Kelgusi harakatlar</h3>
              <div className="divide-y divide-line">
                {upcoming.map((e) => (
                  <div key={`${e.type}-${e.id}`} className="flex items-center justify-between py-3 text-[15px]">
                    <div>
                      <div className="font-medium">{e.counterparty && e.counterparty !== "Bank" ? e.counterparty : e.title}</div>
                      <div className="text-[13px] text-ink-3">
                        {capitalize(weekday(e.date))}, {ddmm(e.date)} · {e.title}
                      </div>
                    </div>
                    <div className={`num font-semibold ${e.amount > 0 && e.type !== "scheduled_payment" ? "text-pos" : ""}`}>
                      {e.type === "scheduled_payment" ? "−" : e.amount > 0 ? "+" : "−"}
                      {money(Math.abs(e.amount))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Composer floating />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-line px-3 first:pl-0 last:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="num mt-1 text-[15px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

function ChartCard({ className = "", tall = false }: { className?: string; tall?: boolean }) {
  const { forecast } = useLive();
  if (!forecast) return null;
  const red = forecast.forecast.filter((d) => d.red);
  return (
    <section className={`card px-3 pt-5 pb-3 sm:px-5 ${className}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-2">
        <div>
          <h3 className="text-[16px] font-semibold tracking-tight">Pul chizig'i</h3>
          <p className="text-[12.5px] text-ink-3">
            {red.length
              ? `${capitalize(weekday(red[0].date))}, ${ddmm(red[0].date)} — pul yetmaydi`
              : "Keyingi 14 kunda minusga tushmaysiz"}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-ink" /> fakt
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-ink-2" /> prognoz
          </span>
        </div>
      </div>
      <MoneyChart data={forecast} height={tall ? 400 : 250} compact={!tall} />
    </section>
  );
}
