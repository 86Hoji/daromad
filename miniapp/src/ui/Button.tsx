import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet" | "danger" | "light";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-hover",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3",
  quiet: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-neg text-white hover:brightness-95",
  // на тёмных секциях лендинга
  light: "bg-white/10 text-white hover:bg-white/15",
};

const SIZE: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[14px] gap-1.5 rounded-[10px]",
  md: "h-11 px-5 text-[15px] gap-2 rounded-el",
  lg: "h-14 px-7 text-[16px] gap-2.5 rounded-[14px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-[background-color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 className="animate-spin" size={size === "sm" ? 16 : 18} strokeWidth={2} /> : icon}
      {children}
    </button>
  );
}

/** Круглая/квадратная кнопка-иконка с обязательной подписью для скринридеров. */
export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-el text-ink-2 transition hover:bg-surface-2 hover:text-ink active:scale-95 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
