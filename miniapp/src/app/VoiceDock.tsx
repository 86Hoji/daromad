// Голосовой док дашборда: большая кнопка микрофона с живой волной + поле текста. Снизу по центру.
import { ArrowUp, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { DraftSheet } from "../features/Drafts";
import { LiveWave, MicButton } from "../features/Voice";
import { useVoiceInput } from "../hooks/useVoiceInput";

export function VoiceDock() {
  const v = useVoiceInput();
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:px-6 xl:left-[248px]">
      <div className="pointer-events-auto mx-auto max-w-[720px]">
        <AnimatePresence>
          {v.hint && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-2 flex items-start gap-2.5 glass rounded-el px-4 py-3 text-[14px] text-ink-2"
              role="status"
            >
              <Info size={17} strokeWidth={1.75} className="mt-0.5 shrink-0 text-brand-text" />
              <span className="flex-1">{v.hint}</span>
              <button onClick={() => v.setHint(null)} aria-label="Yopish" className="text-ink-3 hover:text-ink">
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3 glass rounded-full p-2 pl-6">
          {v.recording ? (
            <div className="flex h-12 flex-1 items-center gap-4" aria-live="polite">
              <span className="num text-[15px] font-medium text-neg-text">0:{String(v.seconds).padStart(2, "0")}</span>
              <LiveWave levels={v.levels} className="h-8 flex-1 text-neg" />
              <button onClick={v.cancel} className="text-[14px] text-ink-3 hover:text-ink">
                Bekor
              </button>
            </div>
          ) : (
            <form
              className="flex h-12 flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                v.sendText();
              }}
            >
              <label htmlFor="dock-input" className="sr-only">
                Nima bo'ldi? Yozing yoki gapiring
              </label>
              <input
                id="dock-input"
                ref={input}
                value={v.text}
                onChange={(e) => v.setText(e.target.value)}
                placeholder="Gapiring yoki yozing: «Bugun 1 million sotdim»"
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
                disabled={v.busy !== null}
                enterKeyHint="send"
                autoComplete="off"
              />
              {v.text.trim() && (
                <button
                  type="submit"
                  disabled={v.busy !== null}
                  aria-label="Yuborish"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink transition hover:bg-surface-3 disabled:opacity-40"
                >
                  {v.busy === "text" ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" /> : <ArrowUp size={18} />}
                </button>
              )}
            </form>
          )}
          <MicButton v={v} size={56} />
        </div>
      </div>
      <DraftSheet result={v.result} onClose={v.clearResult} onFix={() => input.current?.focus()} />
    </div>
  );
}
