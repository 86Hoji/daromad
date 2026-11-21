// Голосовой ввод дашборда: компактная плавающая кнопка микрофона (+ клавиатура).
// При записи — полноэкранный стеклянный оверлей: живая волна по громкости микрофона -> «Tushunyapman…»
// -> расшифровка печатается -> карточки событий вылетают с пружиной -> «To'g'ri» -> карточки улетают
// в «Jonli lenta», цифры и график пересчитываются (одометр + анимация линии).
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, HandCoins, Info, Keyboard, Mic, Square, Undo2, X } from "lucide-react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { api, ApiError, type Draft, type ProcessResult } from "../lib/api";
import { CATEGORY_LABEL, capitalize, ddmm, money, weekday } from "../lib/format";
import { useMagnet } from "../lib/fx";
import { useLive } from "../lib/live";
import { ListenButton } from "../features/Listen";
import { Button } from "../ui/Button";
import { Chip } from "../ui/bits";
import { toast } from "../ui/Toast";

const TYPE: Record<Draft["type"], { label: string; icon: typeof ArrowUpRight; sign: string; tone: string }> = {
  sale: { label: "Sotuv", icon: ArrowDownLeft, sign: "+", tone: "text-pos-text" },
  expense: { label: "Xarajat", icon: ArrowUpRight, sign: "−", tone: "text-ink" },
  debt_given: { label: "Qarzga berildi", icon: HandCoins, sign: "", tone: "text-warn-text" },
  debt_returned: { label: "Qarz qaytdi", icon: Undo2, sign: "+", tone: "text-pos-text" },
  scheduled_payment: { label: "Kutilayotgan to'lov", icon: CalendarClock, sign: "−", tone: "text-ink" },
};

function draftTitle(d: Draft): string {
  switch (d.type) {
    case "sale":
      return d.note ? capitalize(d.note) : "Bugungi savdo";
    case "expense":
      return CATEGORY_LABEL[d.category ?? "boshqa"] ?? d.category ?? "Boshqa";
    case "debt_given":
      return `${d.person ?? "Mijoz"} qarzga oldi`;
    case "debt_returned":
      return `${d.person ?? "Mijoz"} qarzini qaytardi`;
    case "scheduled_payment":
      return d.due_date ? `${d.person || d.note || "To'lov"} · ${capitalize(weekday(d.due_date))}, ${ddmm(d.due_date)}` : d.person || d.note || "To'lov";
  }
}

/** Печать по буквам. */
function useTyped(text: string, on: boolean, speed = 22) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return setN(0);
    if (reduce) return setN(text.length);
    setN(0);
    const id = window.setInterval(() => setN((x) => (x >= text.length ? (window.clearInterval(id), x) : x + 1)), speed);
    return () => window.clearInterval(id);
  }, [text, on, reduce, speed]);
  return text.slice(0, n);
}

/** Большая волна по реальной громкости: 28 уровней, зеркально. */
function BigWave({ levels, idle }: { levels: number[]; idle?: boolean }) {
  const bars = [...levels.slice().reverse(), ...levels];
  return (
    <div className="flex h-40 items-center justify-center gap-[5px]" aria-hidden>
      {bars.map((lv, i) => {
        const h = idle ? 10 + 18 * Math.abs(Math.sin(i * 0.5)) : 6 + Math.min(1, lv * 3.2) * 94;
        return (
          <span
            key={i}
            className={`w-[5px] rounded-full ${idle ? "wave-bar bg-ink-3/60" : "bg-ink"}`}
            style={{ height: `${h}%`, transition: "height 90ms linear", animationDelay: idle ? `${(i % 14) * 0.07}s` : undefined }}
          />
        );
      })}
    </div>
  );
}

export function VoiceOverlay() {
  const v = useVoiceInput();
  const { refresh } = useLive();
  const reduce = useReducedMotion();
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState<null | "ok" | "fix">(null);
  const [flying, setFlying] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mic = useRef<HTMLButtonElement>(null);
  const cards = useRef<(HTMLLIElement | null)[]>([]);
  useMagnet(mic, true, 0.35, 14);

  const r: ProcessResult | null = v.result;
  const open = typing || v.recording || v.busy !== null || r !== null;
  const phase: "type" | "rec" | "think" | "result" = v.recording ? "rec" : v.busy ? "think" : r ? "result" : "type";
  const typed = useTyped(r?.transcript ?? "", phase === "result");
  const drafts = r?.intent === "record" ? r.drafts : [];

  const close = () => {
    if (v.recording) v.cancel();
    v.clearResult();
    setTyping(false);
    setFlying(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, v.recording]);

  useEffect(() => {
    if (phase === "type" && typing) input.current?.focus();
  }, [phase, typing]);

  const confirm = async () => {
    if (!r) return;
    setSaving("ok");
    try {
      const res = await api.confirm(drafts.map((d) => d.id));
      if (res.errors.length) toast(res.errors[0], "neg");
      // карточки улетают в «Jonli lenta»
      const feed = document.getElementById("feed-panel")?.getBoundingClientRect();
      setFlying(true);
      const refreshing = refresh();
      if (feed && !reduce) {
        await Promise.all(
          cards.current.filter(Boolean).map((el, i) => {
            const b = el!.getBoundingClientRect();
            const dx = feed.left + 40 - b.left;
            const dy = feed.top + 70 - b.top;
            return animate(el!, { x: dx, y: dy, scale: 0.4, opacity: 0 }, { duration: 0.75, delay: i * 0.09, ease: [0.55, 0, 0.2, 1] });
          }),
        );
      }
      await refreshing;
      toast("Saqlandi", "pos");
      close();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Xatolik", "neg");
      setFlying(false);
    } finally {
      setSaving(null);
    }
  };

  const fix = async () => {
    if (!r) return;
    setSaving("fix");
    try {
      if (drafts.length) await api.reject(drafts.map((d) => d.id));
      v.clearResult();
      setTyping(true);
      toast("Bekor qilindi — to'g'ri variantini yozing yoki ayting");
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {/* плавающие кнопки */}
      <div className="fixed right-5 bottom-[calc(20px+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-3 xl:right-8">
        <AnimatePresence>
          {v.hint && !open && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className="glass lift-2 flex max-w-[340px] items-start gap-2.5 rounded-el px-4 py-3 text-[14px] text-ink-2"
            >
              <Info size={17} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <span className="flex-1">{v.hint}</span>
              <button onClick={() => v.setHint(null)} aria-label="Yopish" className="text-ink-3 hover:text-ink">
                <X size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTyping(true)}
            aria-label="Matn bilan yozish"
            title="Matn bilan yozish"
            className="glass lift-2 btn-fx flex h-12 w-12 items-center justify-center rounded-full text-ink-2 hover:text-ink"
          >
            <Keyboard size={19} strokeWidth={1.75} />
          </button>
          <button
            ref={mic}
            onClick={v.toggleMic}
            disabled={v.busy !== null}
            aria-label="Ovoz yozish"
            title="Gapiring"
            className="btn-fx relative flex h-16 w-16 items-center justify-center rounded-full bg-brand text-brand-ink shadow-[var(--elev-3)] hover:bg-brand-hover disabled:opacity-60"
          >
            {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-[0.12] [animation-duration:2.4s]" aria-hidden />}
            <Mic size={24} strokeWidth={1.75} className="relative" />
          </button>
        </div>
      </div>

      {/* полноэкранный стеклянный оверлей */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="veil"
            className="veil fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: flying ? 0.0 : 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
            transition={{ duration: flying ? 0.9 : 0.3, delay: flying ? 0.35 : 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="Ovozli kiritish"
          >
            <button onClick={close} aria-label="Yopish" className="glass btn-fx absolute top-5 right-5 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink">
              <X size={19} />
            </button>

            <div className="w-full max-w-[680px]">
              <AnimatePresence mode="wait">
                {phase === "rec" && (
                  <motion.div key="rec" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className="text-center">
                    <p className="text-[17px] text-ink-2">Gapiring — tugatgach to'xtating</p>
                    <div className="num mt-2 text-[15px] font-medium text-neg-text">0:{String(v.seconds).padStart(2, "0")}</div>
                    <div className="mt-6">
                      <BigWave levels={v.levels} />
                    </div>
                    <div className="mt-8 flex items-center justify-center gap-4">
                      <Button variant="secondary" size="lg" onClick={v.cancel}>
                        Bekor
                      </Button>
                      <button
                        onClick={v.toggleMic}
                        autoFocus
                        aria-label="To'xtatish va yuborish"
                        className="btn-fx flex h-20 w-20 items-center justify-center rounded-full bg-neg text-white shadow-[var(--elev-3)]"
                      >
                        <Square size={24} fill="currentColor" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {phase === "think" && (
                  <motion.div key="think" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center" aria-live="polite">
                    <BigWave levels={v.levels} idle />
                    <p className="text-shimmer display mt-6 text-[clamp(28px,4vw,44px)] font-semibold">Tushunyapman…</p>
                  </motion.div>
                )}

                {phase === "type" && (
                  <motion.form
                    key="type"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      v.sendText();
                    }}
                  >
                    <label htmlFor="ov-input" className="display block text-center text-[clamp(26px,3.6vw,40px)] font-semibold tracking-tight">
                      Nima bo'ldi?
                    </label>
                    <div className="glass lift-3 mt-7 flex items-center gap-2 rounded-full p-2 pl-6">
                      <input
                        id="ov-input"
                        ref={input}
                        value={v.text}
                        onChange={(e) => v.setText(e.target.value)}
                        placeholder="Bugun 1 million 200 ming sotdim"
                        className="h-12 min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-ink-3"
                        autoComplete="off"
                        enterKeyHint="send"
                      />
                      <Button type="submit" size="md" className="rounded-full" disabled={!v.text.trim()}>
                        Yuborish
                      </Button>
                    </div>
                    <p className="mt-4 text-center text-[14px] text-ink-3">Savdo, xarajat, qarz yoki kelgusi to'lov — bitta gapda bir nechtasi ham bo'ladi</p>
                  </motion.form>
                )}

                {phase === "result" && r && (
                  <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <p className="text-center text-[14px] text-ink-3">Eshitganim</p>
                    <p className="display mt-2 min-h-[2.4em] text-center text-[clamp(20px,2.6vw,28px)] leading-snug font-medium tracking-tight">
                      «{typed}
                      <span className="opacity-40">{typed.length < r.transcript.length ? "▍" : ""}</span>»
                    </p>

                    {r.intent === "question" ? (
                      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass lift-3 mt-8 p-6">
                        <p className="text-[17px] leading-relaxed whitespace-pre-line">{r.answer}</p>
                        <div className="mt-5 flex flex-wrap items-center gap-3">
                          <Button onClick={close}>Yopish</Button>
                          {r.answer && <ListenButton text={r.voice_text || r.answer} auto={v.resultVia === "voice"} />}
                        </div>
                      </motion.div>
                    ) : drafts.length === 0 ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-8 text-center">
                        <p className="text-[16px] text-ink-2">{r.errors[0] ?? "Summa yoki voqea topilmadi — boshqacha aytib ko'ring."}</p>
                        <Button className="mt-5" variant="secondary" onClick={() => (v.clearResult(), setTyping(true))}>
                          Qayta yozish
                        </Button>
                      </motion.div>
                    ) : (
                      <>
                        <ul className="mt-8 space-y-3">
                          {drafts.map((d, i) => {
                            const t = TYPE[d.type];
                            const Icon = t.icon;
                            return (
                              <motion.li
                                key={d.id}
                                ref={(el) => {
                                  cards.current[i] = el;
                                }}
                                initial={reduce ? false : { opacity: 0, y: 46, scale: 0.9, rotate: i % 2 ? 1.5 : -1.5 }}
                                animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
                                transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.35 + Math.min(r.transcript.length * 0.022, 1.2) + i * 0.16 }}
                                className="glass lift-3 flex items-center gap-4 px-5 py-4"
                              >
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                                  <Icon size={19} strokeWidth={1.75} aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] text-ink-3">{t.label}</span>
                                  <span className="block truncate text-[17px] font-medium">{draftTitle(d)}</span>
                                </span>
                                <span className="flex flex-col items-end gap-1.5">
                                  <span className={`display text-[19px] font-semibold ${t.tone}`}>
                                    {t.sign}
                                    {money(d.amount)}
                                  </span>
                                  {d.needs_check ? (
                                    <Chip tone="warn" icon={<AlertTriangle size={12} strokeWidth={2} />}>
                                      tekshiring
                                    </Chip>
                                  ) : (
                                    <Chip>{d.trust}</Chip>
                                  )}
                                </span>
                              </motion.li>
                            );
                          })}
                        </ul>
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: flying ? 0 : 1, y: 0 }}
                          transition={{ delay: flying ? 0 : 0.6 + Math.min(r.transcript.length * 0.022, 1.2) + drafts.length * 0.16 }}
                          className="mt-7 flex items-center justify-center gap-3"
                        >
                          <Button variant="secondary" size="lg" onClick={fix} loading={saving === "fix"} disabled={saving === "ok"}>
                            Tuzatish
                          </Button>
                          <Button size="lg" magnetic onClick={confirm} loading={saving === "ok"} disabled={saving === "fix"} autoFocus>
                            To'g'ri, saqlash
                          </Button>
                        </motion.div>
                        <p className="mt-4 text-center text-[13px] text-ink-3">AI tushundi, summalarni kod tekshirdi. Siz tasdiqlamaguningizcha hech narsa saqlanmaydi.</p>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
