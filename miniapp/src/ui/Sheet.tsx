// Лист подтверждения: на телефоне выезжает снизу, на десктопе — модалка по центру.
// Главное действие в Telegram уходит в нативную MainButton, здесь остаётся только вторичное.
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { hasMainButton, useTgMainButton } from "../hooks/useTelegram";
import { haptic } from "../lib/telegram";
import { Button } from "./Button";

export interface SheetAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

function useWide() {
  const q = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  primary,
  secondary,
  footnote,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  primary?: SheetAction;
  secondary?: SheetAction;
  footnote?: ReactNode;
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <SheetBody onClose={onClose} title={title} primary={primary} secondary={secondary} footnote={footnote}>
          {children}
        </SheetBody>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SheetBody({
  onClose,
  title,
  children,
  primary,
  secondary,
  footnote,
}: {
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  primary?: SheetAction;
  secondary?: SheetAction;
  footnote?: ReactNode;
}) {
  const wide = useWide();
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const native = hasMainButton();

  useTgMainButton(
    primary && native
      ? {
          text: primary.label,
          loading: primary.loading,
          disabled: primary.disabled,
          onClick: () => {
            haptic("medium");
            primary.onClick();
          },
        }
      : null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  const enter = reduce ? { opacity: 0 } : wide ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" };
  const shown = reduce ? { opacity: 1 } : wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true">
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />
      <motion.div
        ref={panel}
        tabIndex={-1}
        initial={enter}
        animate={shown}
        exit={{ ...enter, transition: { duration: 0.16 } }}
        transition={reduce ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
        className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-panel bg-surface px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-float outline-none md:max-w-[480px] md:rounded-panel md:p-7"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-surface-3 md:hidden" aria-hidden />
        <div className="mb-5 flex items-start justify-between gap-4">
          {title ? <h2 className="text-[20px] leading-tight font-semibold tracking-tight">{title}</h2> : <span />}
          <button
            onClick={onClose}
            aria-label="Yopish"
            className="-mt-1 -mr-2 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink md:inline-flex"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {children}
        {(primary || secondary) && (
          <div className={`mt-6 grid gap-3 ${primary && secondary && !native ? "grid-cols-2" : "grid-cols-1"}`}>
            {secondary && (
              <Button variant="secondary" size="lg" onClick={secondary.onClick} disabled={secondary.disabled} loading={secondary.loading}>
                {secondary.label}
              </Button>
            )}
            {primary && !native && (
              <Button size="lg" onClick={primary.onClick} disabled={primary.disabled} loading={primary.loading}>
                {primary.label}
              </Button>
            )}
          </div>
        )}
        {footnote && <p className="mt-3 text-center text-[12.5px] text-ink-3">{footnote}</p>}
      </motion.div>
    </div>
  );
}
