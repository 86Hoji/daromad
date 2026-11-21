// Мелкие примитивы: чипы, сегменты, скелетоны, логотип, переключатель темы.
import { BRAND } from "../lib/brand";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { getThemePref, setThemePref, type ThemePref } from "../lib/telegram";

export type Tone = "neutral" | "pos" | "neg" | "warn" | "brand";

const CHIP: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  pos: "bg-pos-soft text-pos-text",
  neg: "bg-neg-soft text-neg-text",
  warn: "bg-warn-soft text-warn-text",
  brand: "bg-brand-soft text-brand-text",
};

export function Chip({ tone = "neutral", children, className = "", icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap ${CHIP[tone]} ${className}`}>
      {icon}
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-el bg-surface-2 p-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-[9px] px-3.5 text-[14px] font-medium transition ${
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(11_20_48/0.08)]" : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Знак: три полосы голоса переходят в линию денег. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <g fill="none" stroke="var(--brand-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 13.5v5M10.5 10v12M14 12.5v7" />
        <path d="M17.5 16h3.5l4-5.5" />
      </g>
    </svg>
  );
}

export function Logo({ className = "", size = 28, light = false }: { className?: string; size?: number; light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      <span className={`font-display text-[17px] font-semibold tracking-[-0.02em] ${light ? "text-white" : "text-ink"}`}>{BRAND}</span>
    </span>
  );
}

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: "Tizim mavzusi", light: "Yorug' mavzu", dark: "Qorong'i mavzu" };

export function ThemeToggle({ className = "", withLabel = false }: { className?: string; withLabel?: boolean }) {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  useEffect(() => setThemePref(pref), [pref]);
  const Icon = THEME_ICON[pref];
  return (
    <button
      onClick={() => setPref(THEME_NEXT[pref])}
      aria-label={`${THEME_LABEL[pref]} — almashtirish`}
      title={THEME_LABEL[pref]}
      className={`inline-flex h-10 items-center gap-2 rounded-el px-2.5 text-[14px] text-ink-3 transition hover:bg-surface-2 hover:text-ink ${className}`}
    >
      <Icon size={18} strokeWidth={1.75} />
      {withLabel && <span>{THEME_LABEL[pref]}</span>}
    </button>
  );
}

/** Точка «jonli» + время последнего обновления. */
export function LiveDot({ at, error }: { at: Date | null; error?: string | null }) {
  const t = at ? at.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-3" aria-live="off">
      <span className="relative flex h-2 w-2">
        {!error && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink-3 opacity-50 motion-reduce:hidden" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${error ? "bg-neg" : "bg-ink-3"}`} />
      </span>
      {error ? "aloqa yo'q" : <span className="num">jonli · {t}</span>}
    </span>
  );
}

/** Понятная ошибка на узбекском с кнопкой повтора. */
export function ErrorState({ text, onRetry }: { text?: string | null; onRetry?: () => void }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-6">
      <div className="text-[17px] font-semibold">Ma'lumotni yuklab bo'lmadi</div>
      <p className="max-w-[46ch] text-[15px] text-ink-2">
        Server bilan aloqa yo'q. Internetni tekshiring yoki birozdan keyin qayta urinib ko'ring.
        {text ? <span className="mt-1 block text-[13px] text-ink-3">{text}</span> : null}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="h-10 rounded-el bg-surface-2 px-4 text-[14px] font-medium hover:bg-surface-3">
          Qayta urinish
        </button>
      )}
    </div>
  );
}
