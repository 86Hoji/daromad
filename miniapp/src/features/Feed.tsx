// «Jonli lenta»: последние записи. Новые (например, из бота) въезжают сверху с подсветкой источника.
import { Building2, Image, Keyboard, Mic } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Entry } from "../lib/api";
import { CATEGORY_LABEL, ddmm, money } from "../lib/format";
import { Skeleton } from "../ui/bits";

const SOURCE: Record<string, { label: string; icon: typeof Mic }> = {
  voice: { label: "ovoz", icon: Mic },
  text: { label: "matn", icon: Keyboard },
  photo: { label: "skrinshot", icon: Image },
  bank: { label: "bank", icon: Building2 },
  link: { label: "havola", icon: Building2 },
};

export function LiveFeed({ items, fresh, today, limit = 8 }: { items: Entry[] | null; fresh: Set<number>; today: string; limit?: number }) {
  const reduce = useReducedMotion();
  if (!items)
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  if (items.length === 0) return <p className="py-6 text-ink-2">Hali yozuv yo'q. Mikrofonni bosing va ayting: «Bugun 1 million sotdim».</p>;
  return (
    <ul className="-mx-3">
      <AnimatePresence initial={false}>
        {items.slice(0, limit).map((e) => {
          const s = SOURCE[e.source] ?? SOURCE.text;
          const Icon = s.icon;
          const isNew = fresh.has(e.id);
          const sale = e.kind === "sale";
          return (
            <motion.li
              key={e.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className={`flex items-center gap-3 rounded-el px-3 py-2.5 transition-colors duration-700 ${isNew ? "bg-brand-soft" : ""}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isNew ? "bg-brand text-white" : "bg-surface-2 text-ink-3"}`}
                title={s.label}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {sale ? "Sotuv" : CATEGORY_LABEL[e.category] ?? e.category}
                  {e.note ? <span className="font-normal text-ink-3"> · {e.note}</span> : null}
                </span>
                <span className="text-[13px] text-ink-3">
                  {e.date === today ? "bugun" : ddmm(e.date)} · {s.label}
                  {isNew && <span className="ml-1.5 font-medium text-brand-text">yangi</span>}
                </span>
              </span>
              <span className={`num text-[15px] font-semibold ${sale ? "text-pos-text" : "text-ink"}`}>
                {sale ? "+" : "−"}
                {money(e.amount)}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
