// «Pul chizig'i»: факт (сплошная) + прогноз (пунктир), ниже нуля — красная заливка, маркеры платежей.
import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { FcEvent, Forecast } from "../lib/api";
import { usePalette, type Palette } from "../lib/colors";
import { capitalize, ddmm, money, moneyShort, weekday } from "../lib/format";

interface Point {
  date: string;
  v: number;
  fact: number | null;
  plan: number | null;
  events: FcEvent[];
  isToday: boolean;
}

const OUTFLOW_TYPES = new Set(["scheduled_payment", "overdraft_repay", "deposit_out"]);

/** Доля высоты (сверху), где проходит ноль, для вертикального градиента. */
function zeroOffset(values: number[]): number {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

function eventLabel(e: FcEvent): string {
  const who = e.counterparty && e.counterparty !== "Bank" ? e.counterparty : e.title;
  return `${who} ${moneyShort(Math.abs(e.amount))}`;
}

export function MoneyChart({ data, height = 240, compact = false }: { data: Forecast; height?: number; compact?: boolean }) {
  const pal = usePalette();

  const points = useMemo<Point[]>(() => {
    const hist: Point[] = data.history.map((h) => ({
      date: h.date,
      v: h.balance,
      fact: h.balance,
      plan: h.date === data.today ? h.balance : null,
      events: [],
      isToday: h.date === data.today,
    }));
    const fc: Point[] = data.forecast.map((f) => ({
      date: f.date,
      v: f.balance,
      fact: null,
      plan: f.balance,
      events: f.events,
      isToday: false,
    }));
    return [...hist, ...fc];
  }, [data]);

  const values = points.map((p) => p.v);
  const areaOff = zeroOffset([...values, 0]);
  const factOff = zeroOffset(points.filter((p) => p.fact !== null).map((p) => p.fact as number));
  const planOff = zeroOffset(points.filter((p) => p.plan !== null).map((p) => p.plan as number));

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const pad = (max - min) * 0.18 || 100_000;
  const markers = points.filter((p) => p.events.length > 0);
  // подписи не должны налезать: подписываем крупнейшее событие в окне ±3 дня, остальное — точка + тултип
  const labelled = useMemo(() => {
    const idx = (p: Point) => points.indexOf(p);
    const weight = (p: Point) => Math.max(...p.events.map((e) => Math.abs(e.amount)));
    const chosen: Point[] = [];
    for (const p of [...markers].sort((a, b) => weight(b) - weight(a))) {
      if (chosen.every((c) => Math.abs(idx(c) - idx(p)) > 3)) chosen.push(p);
    }
    return new Set(chosen.map((p) => p.date));
  }, [points, markers]);

  return (
    <div style={{ height }} className="w-full select-none">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 28, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="dm-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={pal.pos} stopOpacity={0.14} />
              <stop offset={areaOff} stopColor={pal.pos} stopOpacity={0.02} />
              <stop offset={areaOff} stopColor={pal.neg} stopOpacity={0.12} />
              <stop offset="1" stopColor={pal.neg} stopOpacity={0.32} />
            </linearGradient>
            <linearGradient id="dm-fact" x1="0" y1="0" x2="0" y2="1">
              <stop offset={factOff} stopColor={pal.ink} />
              <stop offset={factOff} stopColor={pal.neg} />
            </linearGradient>
            <linearGradient id="dm-plan" x1="0" y1="0" x2="0" y2="1">
              <stop offset={planOff} stopColor={pal.ink2} />
              <stop offset={planOff} stopColor={pal.neg} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="date"
            tickFormatter={ddmm}
            tick={{ fill: pal.ink3, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={compact ? 6 : 3}
            minTickGap={8}
          />
          <YAxis
            domain={[min - pad * 0.6, max + pad]}
            // свой тик: штатный Text переносит «764 ming» на две строки
            tick={({ x, y, payload }: { x: number; y: number; payload: { value: number } }) => (
              <text x={x} y={y} dy={4} textAnchor="end" fill={pal.ink3} fontSize={11}>
                {moneyShort(payload.value)}
              </text>
            )}
            tickLine={false}
            axisLine={false}
            width={66}
            tickCount={5}
          />

          <ReferenceLine y={0} stroke={pal.ink3} strokeOpacity={0.5} />
          <ReferenceLine
            x={data.today}
            stroke={pal.ink3}
            strokeDasharray="2 4"
            label={{ value: "Bugun", position: "insideTopLeft", fill: pal.ink2, fontSize: 11, fontWeight: 600, dy: -22 }}
          />

          <Area type="monotone" dataKey="v" baseValue={0} stroke="none" fill="url(#dm-area)" isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="fact"
            stroke="url(#dm-fact)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="plan"
            stroke="url(#dm-plan)"
            strokeWidth={2.25}
            strokeDasharray="5 5"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />

          {markers.map((p) => (
            <ReferenceDot
              key={p.date}
              x={p.date}
              y={p.v}
              r={0}
              ifOverflow="extendDomain"
              shape={(props: { cx?: number; cy?: number }) => (
                <Marker
                  {...props}
                  point={p}
                  pal={pal}
                  showLabel={labelled.has(p.date)}
                  anchor={points.indexOf(p) >= points.length - 3 ? "end" : "middle"}
                />
              )}
            />
          ))}

          <Tooltip content={<ChartTooltip />} cursor={{ stroke: pal.ink3, strokeDasharray: "2 3" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Marker({
  cx = 0,
  cy = 0,
  point,
  pal,
  showLabel,
  anchor,
}: {
  cx?: number;
  cy?: number;
  point: Point;
  pal: Palette;
  showLabel: boolean;
  anchor: "middle" | "end";
}) {
  const out = point.events.some((e) => OUTFLOW_TYPES.has(e.type));
  const color = point.v < 0 ? pal.neg : out ? pal.ink : pal.pos;
  const main = [...point.events].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  const more = point.events.length > 1 ? ` +${point.events.length - 1}` : "";
  return (
    <g>
      <circle cx={cx} cy={cy} r={4.5} fill={pal.surface} stroke={color} strokeWidth={2.5} />
      {showLabel && (
        <text
          x={anchor === "end" ? cx + 6 : cx}
          y={cy - 12}
          textAnchor={anchor}
          fontSize={11}
          fontWeight={700}
          fill={color}
          paintOrder="stroke"
          stroke={pal.surface}
          strokeWidth={4}
        >
          {out ? "▼" : "▲"} {eventLabel(main)}
          {more}
        </text>
      )}
    </g>
  );
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const isPlan = p.fact === null;
  return (
    <div className="rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[13px] shadow-lg">
      <div className="mb-1 font-medium text-ink-2">
        {capitalize(weekday(p.date))}, {ddmm(p.date)} · {p.isToday ? "bugun" : isPlan ? "prognoz" : "fakt"}
      </div>
      <div className={`num text-[15px] font-bold ${p.v < 0 ? "text-neg" : "text-ink"}`}>{money(p.v)}</div>
      {p.events.map((e) => (
        <div key={`${e.type}-${e.id}`} className="num mt-1 text-ink-2">
          {OUTFLOW_TYPES.has(e.type) ? "▼" : "▲"} {e.counterparty && e.counterparty !== "Bank" ? e.counterparty : e.title}:{" "}
          {money(Math.abs(e.amount))}
        </div>
      ))}
      {isPlan && <div className="mt-1 text-[11px] text-ink-3">To'lovlardan keyin, ertalabki qoldiq</div>}
    </div>
  );
}
