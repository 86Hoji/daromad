// Общие куски экранов Mini App: шапка (с «Назад» на вложенных экранах) и плоский блок.
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTgBackButton } from "../hooks/useTelegram";
import { BRAND } from "../lib/brand";
import { useLive } from "../lib/live";
import { haptic, inTelegram } from "../lib/telegram";
import { Rise } from "../ui/Rise";
import { LiveDot } from "../ui/bits";
import { tx } from "./i18n.tg";

/** Шапка экрана. back — путь «назад»: в Telegram это нативная BackButton, в браузере — своя кнопка. */
export function Header({ title, back, right }: { title?: string; back?: string; right?: ReactNode }) {
  const { summary, updatedAt, error } = useLive();
  const nav = useNavigate();
  useTgBackButton(
    back
      ? () => {
          haptic("light");
          nav(back);
        }
      : null,
  );
  return (
    <div className="mb-4">
      {back && !inTelegram && (
        <button onClick={() => nav(back)} className="mb-1 -ml-2 flex h-9 items-center gap-0.5 rounded-el px-2 text-[15px] text-ink-2 active:text-ink">
          <ChevronLeft size={20} /> {tx("back")}
        </button>
      )}
      <div className="flex min-h-10 items-center justify-between gap-3">
        <h1 className="truncate text-[20px] font-semibold tracking-tight">{title ?? summary?.shop.name ?? BRAND}</h1>
        <span className="flex shrink-0 items-center gap-1">
          {right}
          <LiveDot at={updatedAt} error={error} />
        </span>
      </div>
    </div>
  );
}

/** Плоский слой с каскадным появлением (без стекла и backdrop-filter). */
export function Block({ children, className = "", i = 0 }: { children: ReactNode; className?: string; i?: number }) {
  return (
    <Rise as="section" i={i} className={`layer p-4 ${className}`}>
      {children}
    </Rise>
  );
}
