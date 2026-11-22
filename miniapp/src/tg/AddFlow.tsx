// Кнопка [ + ]: лист действий «Сказать голосом» · «Сканировать чек / накладную» · «Ввести текстом».
// Голос и текст — существующий useVoiceInput (/api/voice, /api/text), фото — /api/photo. Результат у всех
// один: лист черновиков (DraftSheet) и подтверждение «To'g'ri». Без подтверждения ничего не записывается.
import { ChevronRight, Keyboard, Loader2, Mic, ScanLine, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DraftSheet } from "../features/Drafts";
import { LiveWave } from "../features/Voice";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { ApiError, type ProcessResult } from "../lib/api";
import { t } from "../lib/i18n";
import { haptic } from "../lib/telegram";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";
import { tx } from "./i18n.tg";
import { scanPhoto } from "./tgApi";

export type AddMode = "menu" | "voice" | "scan" | "text";
const EVENT = "flowcast:tg-add";

/** Открыть [ + ] или сразу нужное действие (быстрые кнопки на Главной). */
export function openAdd(mode: AddMode = "menu") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { mode } }));
}

// Лист закрывается с анимацией ~0.2 с; следующий открываем после неё, иначе закрывающийся лист
// спрячет нативную MainButton уже открытого.
const AFTER_SHEET = 260;

function Row({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-4 rounded-el px-2 py-3 text-left active:bg-surface-2">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium">{title}</span>
        <span className="block text-[13.5px] text-ink-3">{hint}</span>
      </span>
      <ChevronRight size={18} className="text-ink-3" aria-hidden />
    </button>
  );
}

export function AddFlow() {
  const v = useVoiceInput();
  const [menu, setMenu] = useState(false);
  const [voice, setVoice] = useState(false);
  const [typing, setTyping] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoResult, setPhotoResult] = useState<ProcessResult | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  // актуальные функции для подписок на события (подписка одна на всё время жизни)
  const actions = useRef({ voice: () => {}, scan: () => {}, text: (_prefill?: string) => {} });

  const later = (fn: () => void) => timers.current.push(window.setTimeout(fn, AFTER_SHEET));
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  // Следующий лист открываем только после того, как меню [ + ] закрылось: два листа одновременно
  // по очереди запоминают и восстанавливают блокировку прокрутки body, и страница оставалась
  // с overflow: hidden (не листалась колесом / пальцем).
  const afterMenu = (fn: () => void) => {
    if (menu) {
      setMenu(false);
      later(fn);
    } else fn();
  };
  const startVoice = () => {
    if (!v.recording) v.toggleMic(); // микрофон — сразу, в том же нажатии
    afterMenu(() => setVoice(true));
  };
  const startScan = () => {
    setMenu(false);
    file.current?.click(); // в том же нажатии — иначе браузер не откроет камеру
  };
  const startText = (prefill?: string) => {
    if (prefill) v.setText(prefill);
    afterMenu(() => setTyping(true));
  };
  actions.current = { voice: startVoice, scan: startScan, text: startText };

  useEffect(() => {
    const onAdd = (e: Event) => {
      const mode = (e as CustomEvent<{ mode?: AddMode }>).detail?.mode ?? "menu";
      haptic("light");
      if (mode === "voice") actions.current.voice();
      else if (mode === "scan") actions.current.scan();
      else if (mode === "text") actions.current.text();
      else setMenu(true);
    };
    // «Дописать» из баннера пропущенного дня (features/DataQuality: openWrite)
    const onWrite = (e: Event) => actions.current.text((e as CustomEvent<{ prefill?: string }>).detail?.prefill ?? "");
    window.addEventListener(EVENT, onAdd);
    window.addEventListener("flowcast:write", onWrite);
    return () => {
      window.removeEventListener(EVENT, onAdd);
      window.removeEventListener("flowcast:write", onWrite);
    };
  }, []);

  // курсор в поле, когда лист текста открылся. Ждём, пока закроется меню [ + ]: закрываясь,
  // оно возвращает фокус на кнопку «+» (а новый лист при открытии ставит фокус на себя)
  useEffect(() => {
    if (!typing) return;
    const id = window.setTimeout(() => input.current?.focus(), AFTER_SHEET + 120);
    return () => window.clearTimeout(id);
  }, [typing]);

  // обработчики закрытия стабильны: Sheet перезапускает эффект (фокус на себя) при новом onClose,
  // и курсор уходил бы из поля ввода после первой буквы
  const vr = useRef(v);
  vr.current = v;
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeText = useCallback(() => setTyping(false), []);
  const closeVoice = useCallback(() => {
    vr.current.cancel();
    vr.current.setHint(null);
    setVoice(false);
  }, []);
  const closeDrafts = useCallback(() => {
    vr.current.clearResult();
    setPhotoResult(null);
  }, []);

  const finishVoice = () => {
    haptic("medium");
    setVoice(false);
    v.toggleMic(); // остановить запись -> /api/voice -> лист черновиков
  };

  const sendText = () => {
    if (!v.text.trim()) return;
    haptic("medium");
    setTyping(false);
    v.sendText();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // тот же файл можно выбрать ещё раз
    if (!f) return;
    setPhotoBusy(true);
    try {
      setPhotoResult(await scanPhoto(f));
      haptic("success");
    } catch (err) {
      haptic("error");
      const status = err instanceof ApiError ? err.status : 0;
      toast(
        status === 413 ? tx("photoTooLarge") : status === 0 ? t("Server bilan aloqa yo'q") : err instanceof ApiError && status === 503 ? err.message : tx("photoFailed"),
        "neg",
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const result = v.result ?? photoResult;
  const anyOpen = menu || voice || typing || result !== null;

  // страховка: все листы закрыты и диалогов на странице нет — блокировки прокрутки быть не должно
  useEffect(() => {
    if (anyOpen) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"]') && document.body.style.overflow === "hidden") document.body.style.overflow = "";
    }, AFTER_SHEET + 60);
    return () => window.clearTimeout(id);
  }, [anyOpen]);

  const busy = photoBusy ? tx("busyPhoto") : v.busy === "voice" ? tx("busyVoice") : v.busy === "text" ? tx("busyText") : null;

  return (
    <>
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} tabIndex={-1} aria-hidden />

      <Sheet open={menu} onClose={closeMenu} title={tx("addTitle")}>
        <div className="-mx-2 -mt-2">
          <Row icon={<Mic size={22} strokeWidth={1.75} />} title={tx("addVoice")} hint={tx("addVoiceHint")} onClick={startVoice} />
          <Row icon={<ScanLine size={22} strokeWidth={1.75} />} title={tx("addScan")} hint={tx("addScanHint")} onClick={startScan} />
          <Row icon={<Keyboard size={22} strokeWidth={1.75} />} title={tx("addText")} hint={tx("addTextHint")} onClick={() => startText()} />
        </div>
      </Sheet>

      <Sheet
        open={voice}
        onClose={closeVoice}
        title={v.hint ? tx("addVoice") : tx("listening")}
        primary={v.hint ? undefined : { label: tx("done"), onClick: finishVoice, disabled: !v.recording }}
        secondary={
          v.hint
            ? {
                label: tx("typeInstead"),
                onClick: () => {
                  closeVoice();
                  later(() => setTyping(true));
                },
              }
            : { label: t("Bekor"), onClick: closeVoice }
        }
      >
        {v.hint ? (
          <p className="text-[15px] leading-relaxed text-ink-2">{v.hint}</p>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <span className="num text-[28px] font-semibold text-neg-text">0:{String(v.seconds).padStart(2, "0")}</span>
            <LiveWave levels={v.levels} className="h-12 w-full text-ink" />
            <p className="text-center text-[14px] text-ink-3">{tx("listenHint")}</p>
          </div>
        )}
      </Sheet>

      <Sheet
        open={typing}
        onClose={closeText}
        title={tx("addText")}
        primary={{ label: t("Yuborish"), onClick: sendText, disabled: !v.text.trim() }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
        >
          <label htmlFor="tg-add-text" className="sr-only">
            {t("Nima bo'ldi?")}
          </label>
          <input
            id="tg-add-text"
            ref={input}
            value={v.text}
            onChange={(e) => v.setText(e.target.value)}
            placeholder={t("Bugun naqdga 1 million sotdim")}
            className="h-14 w-full rounded-el bg-surface-2 px-4 text-[16px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-ink/20"
            enterKeyHint="send"
            autoComplete="off"
          />
        </form>
      </Sheet>

      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            className="fixed inset-x-0 z-40 flex justify-center px-4"
            style={{ bottom: "calc(var(--tg-tabbar-h) + 14px + env(safe-area-inset-bottom))" }}
          >
            <span className="flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[14px] font-medium text-bg shadow-float">
              <Loader2 size={16} className="animate-spin" />
              {busy}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <DraftSheet
        result={result}
        autoListen={!!v.result && v.resultVia === "voice"}
        onClose={closeDrafts}
        onFix={() => later(() => setTyping(true))}
      />

      {/* подсказка о микрофоне, если лист голоса уже закрыт */}
      <AnimatePresence>
        {v.hint && !voice && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="status"
            className="fixed inset-x-0 z-40 px-4"
            style={{ bottom: "calc(var(--tg-tabbar-h) + 14px + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto flex max-w-[560px] items-start gap-2 rounded-el bg-surface px-4 py-3 text-[14px] text-ink-2 shadow-float">
              <span className="flex-1">{v.hint}</span>
              <button onClick={() => v.setHint(null)} aria-label={t("Yopish")} className="text-ink-3">
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
