// Панель «Pul chizig'i»: заголовок со статусом, легенда, график.
import { ChartSkeleton, MoneyLine } from "../chart/MoneyLine";
import type { Forecast } from "../lib/api";
import { capitalize, ddmm, moneyShort, weekday } from "../lib/format";

export function chartStatus(f: Forecast): { text: string; bad: boolean } {
  const red = f.forecast.find((d) => d.balance < 0);
  if (!red) return { text: `Keyingi ${f.forecast.length} kunda minusga tushmaysiz`, bad: false };
  const worst = f.forecast.reduce((a, b) => (b.balance < a.balance ? b : a));
  return { text: `${capitalize(weekday(red.date))}, ${ddmm(red.date)} — ${moneyShort(-worst.balance)} yetmaydi`, bad: true };
}

function Legend({ compact }: { compact?: boolean }) {
  const item = "inline-flex items-center gap-2";
  return (
    <ul className={`flex flex-wrap items-center gap-x-5 gap-y-1.5 text-ink-3 ${compact ? "text-[12px]" : "text-[13px]"}`} aria-label="Belgilar">
      <li className={item}>
        <span className="h-[2.5px] w-5 rounded-full bg-[var(--chart-past)]" /> fakt
      </li>
      <li className={item}>
        <span className="w-5 border-t-[2.5px] border-dashed border-[var(--chart-future)]" /> prognoz
      </li>
      <li className={item}>
        <span className="h-3 w-5 rounded-[4px] bg-[var(--chart-band)] opacity-25" /> oraliq
      </li>
      <li className={item}>
        <span className="h-3 w-5 rounded-[4px] bg-neg opacity-30" /> minus
      </li>
    </ul>
  );
}

export function ChartCard({ forecast, compact = false, height }: { forecast: Forecast | null; compact?: boolean; height?: number }) {
  const h = height ?? (compact ? 244 : 380);
  const status = forecast ? chartStatus(forecast) : null;
  return (
    <section className={`panel ${compact ? "p-4 pb-2" : "p-6 pb-3 xl:p-7 xl:pb-4"}`} aria-labelledby="chart-title">
      <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${compact ? "mb-1" : "mb-3"}`}>
        <div>
          <h2 id="chart-title" className={`font-semibold tracking-tight ${compact ? "text-[16px]" : "text-[18px]"}`}>
            Pul chizig'i
          </h2>
          {status && <p className={`${compact ? "text-[13.5px]" : "text-[15px]"} ${status.bad ? "text-neg-text" : "text-pos-text"}`}>{status.text}</p>}
        </div>
        {!compact && <Legend />}
      </div>
      {forecast ? <MoneyLine data={forecast} height={h} compact={compact} /> : <ChartSkeleton height={h} />}
    </section>
  );
}
