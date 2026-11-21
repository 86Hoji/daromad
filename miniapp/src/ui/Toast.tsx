import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

type Tone = "pos" | "neg" | "info";
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

let push: ((t: ToastItem) => void) | null = null;
let seq = 0;

export function toast(text: string, tone: Tone = "info") {
  push?.({ id: ++seq, text, tone });
}

const ICON = { pos: CircleCheck, neg: CircleAlert, info: Info };
const COLOR = { pos: "text-pos", neg: "text-neg", info: "text-brand-text" };

/** Тосты сверху по центру; озвучиваются скринридером (aria-live). */
export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((xs) => [...xs.slice(-2), t]);
      window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3200);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(12px+env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
              className="pointer-events-auto flex max-w-[440px] items-center gap-2.5 rounded-full bg-surface py-2.5 pr-5 pl-3.5 text-[14.5px] font-medium shadow-float"
            >
              <Icon size={18} strokeWidth={1.75} className={COLOR[t.tone]} />
              {t.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
