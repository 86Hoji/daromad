// Качество данных: «посчитано по N% данных» рядом с главной цифрой, вопрос про пропущенный день,
// шаг «Дополните данные» вместо банковских предложений, когда данных мало (< 50%).
import { Info, NotebookPen, X } from "lucide-react";
import { useId, useState } from "react";
import type { Reliability } from "../lib/api";
import { ddmm } from "../lib/format";
import { t } from "../lib/i18n";

/** Открыть ввод текстом (VoiceOverlay в /app, композер в /tg) с подсказкой в поле. */
export function openWrite(prefill = "") {
  window.dispatchEvent(new CustomEvent("flowcast:write", { detail: { prefill } }));
}

export function ReliabilityLine({ rel, className = "" }: { rel?: Reliability; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!rel) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-describedby={id}
        aria-expanded={open}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-[13.5px] font-medium transition ${
          rel.low ? "bg-warn-soft text-warn-text" : "bg-surface-2 text-ink-2 hover:text-ink"
        }`}
      >
        <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span className={`absolute inset-y-0 left-0 rounded-full ${rel.low ? "bg-warn" : "bg-ink"}`} style={{ width: `${rel.percent}%` }} />
        </span>
        {t("{pct}% ma'lumot asosida hisoblandi", { pct: rel.percent })}
        <Info size={14} strokeWidth={1.9} className="opacity-70" aria-hidden />
      </button>
      <div
        id={id}
        role="tooltip"
        className={`absolute top-full left-0 z-20 mt-2 w-[min(320px,80vw)] rounded-el bg-ink p-3.5 text-[13px] leading-relaxed text-bg shadow-[var(--elev-3)] transition ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
      >
        <div className="mb-1.5 font-semibold">{t("Prognozga qanchalik ishonsa bo'ladi")}</div>
        <ul className="space-y-0.5">
          <li>{t("Tasdiqlangan pul (bank, havola): {v}", { v: pct(rel.confirmed_share) })}</li>
          <li>{t("Yozuvlar muntazamligi: {v}", { v: pct(rel.regularity) })}</li>
          <li>{t("So'nggi {n} kunda naqd yozuvsiz kunlar: {m}", { n: rel.window_days, m: rel.missing_days })}</li>
        </ul>
        {rel.low && <div className="mt-2 text-warn">{t("50% dan kam — bank takliflari yashirilgan.")}</div>}
      </div>
    </div>
  );
}

const DISMISS_KEY = "flowcast:nudge-dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** «За вчера нет записей по наличным. Дописать?» — ничего не дописывает сам, только открывает ввод. */
export function NudgeBanner({ date, compact = false }: { date?: string | null; compact?: boolean }) {
  const [hidden, setHidden] = useState(() => readDismissed() === date);
  if (!date || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, date);
    } catch {
      /* приватный режим */
    }
  };
  return (
    <div role="status" className={`flex items-center gap-3 rounded-el bg-warn-soft text-warn-text ${compact ? "px-3.5 py-3" : "px-5 py-3.5"}`}>
      <NotebookPen size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className={`min-w-0 flex-1 ${compact ? "text-[14px]" : "text-[15px]"}`}>
        {t("Kecha naqd pul bo'yicha yozuv yo'q. Yozib qo'yamizmi?")} <span className="num opacity-75">({ddmm(date)})</span>
      </span>
      <button
        onClick={() => openWrite(t("Kecha naqdga "))}
        className="btn-fx h-10 shrink-0 rounded-full bg-warn-text px-4 text-[14px] font-semibold text-bg hover:opacity-90"
      >
        {t("Yozib qo'yish")}
      </button>
      <button onClick={dismiss} aria-label={t("Yopish")} className="flex h-10 w-8 shrink-0 items-center justify-center opacity-70 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
}

/** Вместо оффера банка при надёжности < 50%. */
export function FillDataNote({ rel }: { rel?: number }) {
  return (
    <div className="mt-1">
      <p className="text-[14.5px] text-ink-2">
        {t("Hisob {pct}% ma'lumotga asoslangan — bank takliflari uchun bu kam. Naqd savdo va xarajatlarni yozib boring.", { pct: rel ?? 0 })}
      </p>
      <button
        onClick={() => openWrite()}
        className="mt-3 flex h-11 items-center gap-2 rounded-el bg-surface-2 px-4 text-[15px] font-medium hover:bg-surface-3"
      >
        <NotebookPen size={17} strokeWidth={1.75} aria-hidden />
        {t("Ma'lumotni to'ldirish")}
      </button>
    </div>
  );
}
