// Панель «Pul chizig'i»: заголовок со статусом, легенда, график.
import { ChartSkeleton, MoneyLine } from "../chart/MoneyLine";
import type { Forecast } from "../lib/api";
import { capitalize, ddmm, moneyShort, weekday } from "../lib/format";
import { t } from "../lib/i18n";

export function chartStatus(f: Forecast): { text: string; bad: boolean } {
  const red = f.forecast.find((d) => d.balance < 0);
  if (!red) return { text: t("Keyingi {n} kunda minusga tushmaysiz", { n: f.forecast.length }), bad: false };
  const worst = f.forecast.reduce((a, b) => (b.balance < a.balance ? b : a));
  return { text: t("{day}, {date} — {amount} yetmaydi", { day: capitalize(weekday(red.date)), date: ddmm(red.date), amount: moneyShort(-worst.balance) }), bad: true };
}

export function ChartCard({
  forecast,
  compact = false,
  height,
  animate = false,
  surface,
}: {
  forecast: Forecast | null;
  compact?: boolean;
  height?: number;
  animate?: boolean;
  /** подложка: плотное стекло (/app), плоский слой (/tg) */
  surface?: string;
}) {
  const h = height ?? (compact ? 244 : 380);
  const status = forecast ? chartStatus(forecast) : null;
  return (
    <section className={`${surface ?? (compact ? "layer" : "glass glass-dense lift-1")} ${compact ? "p-4 pb-2" : "p-6 pb-3 xl:p-7 xl:pb-4"}`} aria-labelledby="chart-title">
      <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${compact ? "mb-1" : "mb-3"}`}>
        <div>
          <h2 id="chart-title" className={`font-semibold tracking-tight ${compact ? "text-[16px]" : "text-[18px]"}`}>
            {t("Pul chizig'i")}
          </h2>
          {status && <p className={`${compact ? "text-[13.5px]" : "text-[15px]"} ${status.bad ? "text-neg-text" : "text-pos-text"}`}>{status.text}</p>}
        </div>
      </div>
      {forecast ? <MoneyLine data={forecast} height={h} compact={compact} animate={animate} /> : <ChartSkeleton height={h} />}
    </section>
  );
}
