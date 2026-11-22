// Единый паттерн показателя: подпись 13px сверху, значение 22–28px (Unbounded), единица — тем же базисом,
// опционально: дельта-чип (▲ 12% / ▼ 8%) и мини-спарклайн. Используется на лендинге, в /app и /tg.
import type { ReactNode } from "react";
import { currency, money, moneyShort, num } from "../lib/format";
import { t } from "../lib/i18n";

export type Fmt = "full" | "short" | "pct" | "plain";

/** Значение + единица. full: «−350 000 сум», short: «1,1 млн» (единица уже в числе), pct: «42%». */
export function Amount({ value, fmt = "short", unit = true, className = "", unitClass = "" }: { value: number; fmt?: Fmt; unit?: boolean; className?: string; unitClass?: string }) {
  const text = fmt === "full" ? num(value) : fmt === "short" ? moneyShort(value) : fmt === "pct" ? `${Math.round(value)}` : num(value);
  const u = fmt === "pct" ? "%" : fmt === "full" && unit ? currency() : null;
  return (
    <span className={`num inline-flex items-baseline gap-[0.25em] whitespace-nowrap ${className}`} title={fmt === "pct" ? undefined : money(value)}>
      <span>{text}</span>
      {u && <span className={`font-sans text-[0.55em] font-medium tracking-normal text-ink-3 ${unitClass}`}>{u}</span>}
    </span>
  );
}

/** Дельта к прошлому периоду. good — «рост хорошо» (выручка) или «рост плохо» (расходы). */
export function Delta({ pct, good = "up", className = "" }: { pct: number | null | undefined; good?: "up" | "down"; className?: string }) {
  if (pct == null || !isFinite(pct)) return null;
  const r = Math.round(pct);
  if (r === 0) return <span className={`num inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-[12px] font-medium text-ink-3 ${className}`}>0%</span>;
  const up = r > 0;
  const ok = (up && good === "up") || (!up && good === "down");
  return (
    <span
      className={`num inline-flex h-6 items-center gap-0.5 rounded-full px-2 text-[12px] font-medium ${ok ? "bg-pos-soft text-pos-text" : "bg-neg-soft text-neg-text"} ${className}`}
      aria-label={t("o'tgan davrga nisbatan {pct}%", { pct: `${up ? "+" : "−"}${Math.abs(r)}` })}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {Math.abs(r)}%
    </span>
  );
}

/** Мини-спарклайн 72×24: только форма, без осей. */
export function Spark({ data, tone = "ink", className = "" }: { data: number[]; tone?: "ink" | "pos" | "neg" | "warn"; className?: string }) {
  if (data.length < 2) return null;
  const w = 72;
  const h = 24;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`);
  const color = { ink: "var(--ink-3)", pos: "var(--pos)", neg: "var(--neg)", warn: "var(--warn)" }[tone];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`shrink-0 overflow-visible ${className}`} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r={2.25} fill={color} />
    </svg>
  );
}

/** Показатель: подпись → значение → (дельта + спарклайн). */
export function Stat({
  label,
  value,
  fmt = "short",
  tone,
  delta,
  good,
  spark,
  sparkTone,
  hint,
  size = "md",
  className = "",
  children,
}: {
  label: ReactNode;
  value: number;
  fmt?: Fmt;
  tone?: "pos" | "neg" | "warn";
  delta?: number | null;
  good?: "up" | "down";
  spark?: number[];
  sparkTone?: "ink" | "pos" | "neg" | "warn";
  hint?: ReactNode;
  size?: "sm" | "md";
  className?: string;
  children?: ReactNode;
}) {
  const color = tone === "pos" ? "text-pos-text" : tone === "neg" ? "text-neg-text" : tone === "warn" ? "text-warn-text" : "text-ink";
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="truncate text-[13px] leading-5 text-ink-3">{label}</div>
      <Amount value={value} fmt={fmt} className={`display mt-1 block font-semibold leading-tight ${size === "sm" ? "text-[20px]" : "text-[22px] xl:text-[26px]"} ${color}`} />
      {(delta != null || (spark && spark.length > 1) || hint) && (
        <div className="mt-2 flex h-6 items-center justify-between gap-2">
          {delta != null ? <Delta pct={delta} good={good} /> : hint ? <span className="truncate text-[12.5px] text-ink-3">{hint}</span> : <span />}
          {spark && <Spark data={spark} tone={sparkTone} />}
        </div>
      )}
      {children}
    </div>
  );
}
