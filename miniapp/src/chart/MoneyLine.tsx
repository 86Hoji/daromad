// «Pul chizig'i»: остаток по дням. Без сглаживания (stepAfter), прошлое — сплошная линия,
// будущее — пунктир Lapis + полоса неопределённости (low/high), всё ниже нуля — Pomegranate.
// События — «булавки» под осью X: крупнейшее подписано всегда, остальные — точки с тултипом.
import { motion } from "motion/react";
import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Customized,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { FcEvent, Forecast } from "../lib/api";
import { usePalette, type Palette } from "../lib/colors";
import { capitalize, ddmm, money, moneyShort, num, weekday } from "../lib/format";

interface Point {
  date: string;
  v: number;
  fact: number | null;
  plan: number | null;
  band: [number, number] | null;
  events: FcEvent[];
  kind: "fact" | "today" | "plan";
}

const OUTFLOW = new Set(["scheduled_payment", "overdraft_repay", "deposit_out", "owner_draw"]);
const TYPE_SHORT: Record<string, string> = {
  overdraft_in: "Overdraft",
  overdraft_repay: "Overdraft",
  deposit_out: "Omonat",
  deposit_return: "Omonat",
};

export const isOutflow = (e: FcEvent) => OUTFLOW.has(e.type) || e.amount < 0;

export function eventWho(e: FcEvent): string {
  if (e.counterparty && e.counterparty !== "Bank") return e.counterparty;
  return TYPE_SHORT[e.type] ?? e.title;
}

export function eventShort(e: FcEvent): string {
  return `${eventWho(e)} ${isOutflow(e) ? "−" : "+"}${moneyShort(Math.abs(e.amount))}`;
}

/** «Красивые» деления, обязательно с нулём. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = Math.max(hi - lo, 1);
  const raw = span / Math.max(count - 1, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= last + step / 2; t += step) ticks.push(Math.round(t));
  return ticks;
}

export function MoneyLine({
  data,
  height = 340,
  compact = false,
  className = "",
}: {
  data: Forecast;
  height?: number;
  compact?: boolean;
  className?: string;
}) {
  const pal = usePalette();

  const points = useMemo<Point[]>(() => {
    const hist: Point[] = data.history.map((h) => {
      const today = h.date === data.today;
      return {
        date: h.date,
        v: h.balance,
        fact: h.balance,
        plan: today ? h.balance : null,
        band: today ? [h.balance, h.balance] : null,
        events: [],
        kind: today ? "today" : "fact",
      };
    });
    const fc: Point[] = data.forecast.map((f) => ({
      date: f.date,
      v: f.balance,
      fact: null,
      plan: f.balance,
      band: [Math.min(f.low ?? f.balance, f.balance), Math.max(f.high ?? f.balance, f.balance)],
      events: f.events,
      kind: "plan",
    }));
    return [...hist, ...fc];
  }, [data]);

  // --- шкала Y: считаем сами, чтобы знать, где ноль (для градиентов в пикселях) ------
  const lows = points.map((p) => (p.band ? p.band[0] : p.v));
  const highs = points.map((p) => (p.band ? p.band[1] : p.v));
  const ticks = niceTicks(Math.min(0, ...lows), Math.max(0, ...highs), compact ? 4 : 5);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const MARGIN_TOP = compact ? 22 : 30;
  const X_H = compact ? 46 : 60;
  const plotTop = MARGIN_TOP;
  const plotBottom = height - X_H;
  const zeroY = plotTop + ((yMax - 0) / (yMax - yMin || 1)) * (plotBottom - plotTop);

  // --- деления X: от «сегодня» с шагом k дней --------------------------------------------
  const todayIdx = points.findIndex((p) => p.kind === "today");
  const step = compact ? 7 : 3;
  const xTicks = points.filter((_, i) => (i - todayIdx) % step === 0).map((p) => p.date);

  // --- булавки: крупнейшее событие подписано всегда, остальные — если есть место ---------
  const pins = useMemo(() => {
    const withEv = points.map((p, i) => ({ p, i })).filter(({ p }) => p.events.length > 0);
    const weight = (p: Point) => Math.max(...p.events.map((e) => Math.abs(e.amount)));
    const order = [...withEv].sort((a, b) => weight(b.p) - weight(a.p));
    const labelled = new Set<number>();
    const gap = compact ? 99 : 4;
    for (const x of order) {
      if (labelled.size === 0 || [...labelled].every((j) => Math.abs(j - x.i) > gap)) labelled.add(x.i);
    }
    return withEv.map(({ p, i }) => ({ p, i, label: labelled.has(i) }));
  }, [points, compact]);

  // самая глубокая точка нехватки в прогнозе — подписываем суммой
  const low = useMemo(() => {
    const fut = points.filter((p) => p.kind === "plan" && p.v < 0);
    return fut.length ? fut.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  }, [points]);

  const minPoint = points.reduce((a, b) => (b.v < a.v ? b : a));
  const summary = `Pul chizig'i. Bugun ${money(data.cash_now)}. ${
    minPoint.v < 0 ? `Eng past nuqta ${ddmm(minPoint.date)}: ${money(minPoint.v)}.` : "Keyingi kunlarda minusga tushmaydi."
  }`;

  const off = Math.min(1, Math.max(0, (zeroY - plotTop) / (plotBottom - plotTop || 1)));

  return (
    <motion.div
      role="img"
      aria-label={summary}
      className={`w-full select-none ${className}`}
      style={{ height }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: MARGIN_TOP, right: compact ? 8 : 16, bottom: 0, left: 0 }}>
          <defs>
            {/* все градиенты в пикселях: ноль — граница цвета, даже если линия горизонтальна */}
            <linearGradient id="ml-past" gradientUnits="userSpaceOnUse" x1="0" y1={plotTop} x2="0" y2={plotBottom}>
              <stop offset={off} stopColor={pal.past} />
              <stop offset={off} stopColor={pal.neg} />
            </linearGradient>
            <linearGradient id="ml-future" gradientUnits="userSpaceOnUse" x1="0" y1={plotTop} x2="0" y2={plotBottom}>
              <stop offset={off} stopColor={pal.future} />
              <stop offset={off} stopColor={pal.neg} />
            </linearGradient>
            <linearGradient id="ml-red" gradientUnits="userSpaceOnUse" x1="0" y1={plotTop} x2="0" y2={plotBottom}>
              <stop offset={off} stopColor={pal.neg} stopOpacity={0} />
              <stop offset={off} stopColor={pal.neg} stopOpacity={0.24} />
              <stop offset={1} stopColor={pal.neg} stopOpacity={0.12} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="date"
            scale="point"
            padding={{ left: 6, right: 6 }}
            ticks={xTicks}
            interval={0}
            height={X_H}
            tickLine={false}
            axisLine={false}
            tick={(p: { x: number; y: number; payload: { value: string } }) => (
              <text x={p.x} y={plotBottom + X_H - 10} textAnchor="middle" fontSize={compact ? 11 : 12} fill={p.payload.value === data.today ? pal.ink : pal.ink3} fontWeight={p.payload.value === data.today ? 600 : 400}>
                {ddmm(p.payload.value)}
              </text>
            )}
          />
          <YAxis
            domain={[yMin, yMax]}
            ticks={ticks}
            width={compact ? 54 : 66}
            tickLine={false}
            axisLine={false}
            tick={(p: { x: number; y: number; payload: { value: number } }) => (
              <text x={p.x} y={p.y} dy={4} textAnchor="end" fontSize={compact ? 11 : 12} fill={p.payload.value === 0 ? pal.ink2 : pal.ink3} fontWeight={p.payload.value === 0 ? 600 : 400}>
                {moneyShort(p.payload.value)}
              </text>
            )}
          />

          {/* полоса неопределённости — под всем остальным */}
          <Area type="stepAfter" dataKey="band" stroke="none" fill={pal.band} fillOpacity={0.13} isAnimationActive={false} activeDot={false} connectNulls={false} />
          {/* красная зона: всё, что ниже нуля */}
          <Area type="stepAfter" dataKey="v" baseValue={0} stroke="none" fill="url(#ml-red)" isAnimationActive={false} activeDot={false} />

          <ReferenceLine y={0} stroke={pal.ink3} strokeOpacity={0.55} strokeWidth={1} />
          <ReferenceLine
            x={data.today}
            stroke={pal.ink3}
            strokeDasharray="3 4"
            label={(p: { viewBox?: { x: number; y: number } }) => {
              const x = p.viewBox?.x ?? 0;
              return (
                <g>
                  <rect x={x - 26} y={plotTop - (compact ? 20 : 24)} width={52} height={compact ? 18 : 20} rx={10} fill={pal.surface2} />
                  <text x={x} y={plotTop - (compact ? 7 : 10)} textAnchor="middle" fontSize={compact ? 11 : 12} fontWeight={600} fill={pal.ink}>
                    Bugun
                  </text>
                </g>
              );
            }}
          />

          <Line type="stepAfter" dataKey="fact" stroke="url(#ml-past)" strokeWidth={compact ? 2 : 2.5} dot={false} activeDot={{ r: 4, fill: pal.surface, stroke: pal.past, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="plan" stroke="url(#ml-future)" strokeWidth={compact ? 2 : 2.5} strokeDasharray="6 5" dot={false} activeDot={{ r: 4, fill: pal.surface, stroke: pal.future, strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />

          <Customized component={(props: CustomizedProps) => <Pins {...props} pins={pins} low={low} pal={pal} plotBottom={plotBottom} compact={compact} />} />

          <Tooltip content={<ChartTooltip />} cursor={{ stroke: pal.ink3, strokeOpacity: 0.4, strokeDasharray: "2 3" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

interface AxisLike {
  scale: ((v: unknown) => number) & { bandwidth?: () => number };
}
interface CustomizedProps {
  xAxisMap?: Record<string, AxisLike>;
  yAxisMap?: Record<string, AxisLike>;
}

function Pins({
  xAxisMap,
  yAxisMap,
  pins,
  low,
  pal,
  plotBottom,
  compact,
}: CustomizedProps & {
  pins: { p: Point; i: number; label: boolean }[];
  low: Point | null;
  pal: Palette;
  plotBottom: number;
  compact: boolean;
}) {
  const xa = xAxisMap && Object.values(xAxisMap)[0];
  const ya = yAxisMap && Object.values(yAxisMap)[0];
  if (!xa || !ya) return null;
  const X = (d: string) => xa.scale(d);
  const Y = (v: number) => ya.scale(v);
  const pinY = plotBottom + 10;

  return (
    <g>
      {pins.map(({ p, label }) => {
        const out = p.events.some(isOutflow);
        const color = out ? (p.v < 0 ? pal.neg : pal.ink2) : pal.pos;
        const main = [...p.events].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
        const x = X(p.date);
        const y = Y(p.v);
        const more = p.events.length > 1 ? ` +${p.events.length - 1}` : "";
        return (
          <g key={p.date}>
            <line x1={x} x2={x} y1={y + 5} y2={pinY - 5} stroke={color} strokeOpacity={0.35} strokeDasharray="2 3" />
            <circle cx={x} cy={y} r={4.5} fill={pal.surface} stroke={color} strokeWidth={2.25} />
            <circle cx={x} cy={pinY} r={label ? 5 : 3.5} fill={color} />
            {label && (
              <text x={x} y={pinY + 18} textAnchor="middle" fontSize={compact ? 11 : 12} fontWeight={600} fill={color === pal.ink2 ? pal.ink : color}>
                {eventShort(main)}
                {more}
              </text>
            )}
          </g>
        );
      })}
      {low && (
        <text x={X(low.date)} y={Math.min(Y(low.v) + 22, plotBottom - 6)} textAnchor="middle" fontSize={compact ? 12 : 14} fontWeight={700} fill={pal.negText} style={{ fontFamily: "var(--font-display)" }} paintOrder="stroke" stroke={pal.surface} strokeWidth={4}>
          {num(low.v)}
        </text>
      )}
    </g>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const label = p.kind === "today" ? "bugun" : p.kind === "plan" ? "prognoz" : "fakt";
  const spread = p.kind === "plan" && p.band && p.band[1] - p.band[0] >= 1000;
  return (
    <div className="min-w-[200px] rounded-el bg-surface px-4 py-3 text-[13.5px] shadow-float">
      <div className="mb-1 text-ink-3">
        {capitalize(weekday(p.date))}, {ddmm(p.date)} · {label}
      </div>
      <div className={`display text-[18px] font-semibold ${p.v < 0 ? "text-neg-text" : "text-ink"}`}>{money(p.v)}</div>
      {spread && p.band && (
        <div className="num mt-0.5 text-[12.5px] text-ink-3">
          taxminan {moneyShort(p.band[0])} — {moneyShort(p.band[1])}
        </div>
      )}
      {p.events.map((e) => (
        <div key={`${e.type}-${e.id}`} className="num mt-1.5 flex justify-between gap-4 text-ink-2">
          <span>{eventWho(e)}</span>
          <span className={isOutflow(e) ? "text-ink" : "text-pos-text"}>
            {isOutflow(e) ? "−" : "+"}
            {num(Math.abs(e.amount))}
          </span>
        </div>
      ))}
      {p.kind === "plan" && <div className="mt-1.5 text-[11.5px] text-ink-3">To'lovlardan keyin, ertalabki qoldiq</div>}
    </div>
  );
}

/** Скелетон графика — мотив «голос»: пульсирующие полосы, которые станут линией. */
export function ChartSkeleton({ height = 340 }: { height?: number }) {
  return (
    <div className="flex w-full items-end justify-center gap-[5px] px-8" style={{ height }} aria-label="Grafik yuklanmoqda" role="status">
      {Array.from({ length: 36 }).map((_, i) => (
        <span
          key={i}
          className="wave-bar w-[4px] rounded-full bg-surface-3"
          style={{ height: `${30 + 40 * Math.abs(Math.sin(i * 0.55))}%`, animationDelay: `${(i % 12) * 0.08}s` }}
        />
      ))}
    </div>
  );
}
