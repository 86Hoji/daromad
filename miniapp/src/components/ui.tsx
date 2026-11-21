import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { num } from "../lib/format";

/** Сумма, которая плавно перетекает к новому значению (только при изменении). */
export function AnimatedNumber({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [bump, setBump] = useState(0);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    setBump((b) => b + 1);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 650);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span key={bump} className={`num inline-block ${bump ? "bump" : ""} ${className}`}>
      {num(Math.round(shown / 1000) * 1000)}
    </span>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center" role="dialog" aria-modal="true">
      <div className="fade-enter absolute inset-0 bg-[#05080d]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="sheet-enter relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-surface px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] lg:rounded-[28px] lg:p-7">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line lg:hidden" />
        {title && <h2 className="mb-4 text-[19px] font-semibold tracking-tight">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger"; loading?: boolean };

export function Button({ variant = "primary", loading, className = "", children, disabled, ...rest }: BtnProps) {
  const base =
    "inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100";
  const styles = {
    primary: "bg-btn text-btn-ink",
    ghost: "bg-surface-2 text-ink border border-line",
    danger: "bg-neg text-white",
  }[variant];
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-label="Yuklanmoqda"
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pos" | "neg" }) {
  const t = {
    neutral: "bg-surface-2 text-ink-2 border border-line",
    pos: "bg-pos-soft text-pos",
    neg: "bg-neg-soft text-neg",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="text-[14px] text-ink-2">{label}</span>
      <span className={`num text-right text-[15px] ${strong ? "font-bold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">{children}</h3>
      {right}
    </div>
  );
}

// --- toast ---------------------------------------------------------------------------

let pushToast: ((t: { text: string; tone?: "pos" | "neg" | "neutral" }) => void) | null = null;

export function toast(text: string, tone: "pos" | "neg" | "neutral" = "neutral") {
  pushToast?.({ text, tone });
}

export function ToastHost() {
  const [item, setItem] = useState<{ text: string; tone?: string; id: number } | null>(null);
  useEffect(() => {
    pushToast = (t) => setItem({ ...t, id: Date.now() });
    return () => {
      pushToast = null;
    };
  }, []);
  useEffect(() => {
    if (!item) return;
    const id = window.setTimeout(() => setItem(null), 2800);
    return () => window.clearTimeout(id);
  }, [item]);
  if (!item) return null;
  const dot = item.tone === "pos" ? "bg-pos" : item.tone === "neg" ? "bg-neg" : "bg-ink-3";
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
      <div key={item.id} className="sheet-enter flex items-center gap-2.5 rounded-2xl bg-btn px-4 py-3 text-[14px] font-medium text-btn-ink shadow-lg">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {item.text}
      </div>
    </div>,
    document.body,
  );
}
