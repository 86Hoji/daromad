// Оболочка Mini App /tg: плотная, нативная для Telegram. Нижние табы + круглая кнопка микрофона.
import { Home, Keyboard, PieChart, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { DraftSheet } from "../features/Drafts";
import { ReminderProvider } from "../features/Reminder";
import { LiveWave, MicButton } from "../features/Voice";
import { useVoiceInput } from "../hooks/useVoiceInput";
import { LiveProvider } from "../lib/live";
import { haptic } from "../lib/telegram";
import { t } from "../lib/i18n";

const TABS = [
  { to: "/tg", label: "Bosh", icon: Home, end: true },
  { to: "/tg/qarzlar", label: "Qarzlar", icon: Users },
  { to: "/tg/hisobot", label: "Hisobot", icon: PieChart },
];

const TAB_H = 60;

function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("Bo'limlar")}
    >
      <div className="mx-auto grid max-w-[560px] grid-cols-3" style={{ height: TAB_H }}>
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => haptic("light")}
            className={({ isActive }) => `flex flex-col items-center justify-center gap-0.5 text-[11.5px] font-medium ${isActive ? "text-brand-text" : "text-ink-3"}`}
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2 : 1.6} />
                {t(label)}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Микрофон справа снизу; текстовое поле раскрывается по тапу на «Aa». */
function TgComposer() {
  const v = useVoiceInput();
  const [typing, setTyping] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  const bottom = `calc(${TAB_H + 14}px + env(safe-area-inset-bottom))`;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 z-30 px-4" style={{ bottom }}>
        <div className="mx-auto flex max-w-[560px] flex-col items-end gap-2">
          <AnimatePresence>
            {v.hint && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="status"
                className="pointer-events-auto flex w-full items-start gap-2 rounded-el bg-surface px-4 py-3 text-[14px] text-ink-2 shadow-float"
              >
                <span className="flex-1">{v.hint}</span>
                <button onClick={() => v.setHint(null)} aria-label={t("Yopish")} className="text-ink-3">
                  <X size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="pointer-events-auto flex w-full items-center justify-end gap-2.5">
            <AnimatePresence initial={false}>
              {(typing || v.recording) && (
                <motion.form
                  key="bar"
                  initial={{ opacity: 0, scaleX: 0.6 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0, scaleX: 0.6, transition: { duration: 0.12 } }}
                  style={{ originX: 1 }}
                  className="flex h-14 flex-1 items-center gap-2 rounded-full bg-surface pr-2 pl-5 shadow-float"
                  onSubmit={(e) => {
                    e.preventDefault();
                    v.sendText();
                  }}
                >
                  {v.recording ? (
                    <>
                      <span className="num text-[14px] font-medium text-neg-text">0:{String(v.seconds).padStart(2, "0")}</span>
                      <LiveWave levels={v.levels} className="h-7 flex-1 text-neg" />
                      <button type="button" onClick={v.cancel} className="px-2 text-[14px] text-ink-3">
                        {t("Bekor")}
                      </button>
                    </>
                  ) : (
                    <>
                      <label htmlFor="tg-input" className="sr-only">
                        {t("Nima bo'ldi?")}
                      </label>
                      <input
                        id="tg-input"
                        ref={input}
                        value={v.text}
                        onChange={(e) => v.setText(e.target.value)}
                        placeholder={t("Bugun naqdga 1 million sotdim")}
                        className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
                        enterKeyHint="send"
                        disabled={v.busy !== null}
                        autoComplete="off"
                      />
                      <button
                        type={v.text.trim() ? "submit" : "button"}
                        onClick={v.text.trim() ? undefined : () => setTyping(false)}
                        className="flex h-10 min-w-10 items-center justify-center rounded-full bg-surface-2 px-3 text-[14px] font-medium"
                        aria-label={v.text.trim() ? t("Yuborish") : t("Yopish")}
                      >
                        {v.busy === "text" ? "…" : v.text.trim() ? t("Yuborish") : <X size={16} />}
                      </button>
                    </>
                  )}
                </motion.form>
              )}
            </AnimatePresence>
            {!typing && !v.recording && (
              <button
                onClick={() => setTyping(true)}
                aria-label={t("Matn bilan yozish")}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-2 shadow-float active:scale-95"
              >
                <Keyboard size={20} strokeWidth={1.75} />
              </button>
            )}
            <MicButton v={v} size={60} />
          </div>
        </div>
      </div>
      <DraftSheet
        result={v.result}
        autoListen={v.resultVia === "voice"}
        onClose={() => {
          v.clearResult();
          setTyping(false);
        }}
        onFix={() => setTyping(true)}
      />
    </>
  );
}

export function TgLayout() {
  return (
    <LiveProvider>
      <ReminderProvider>
        <div className="min-h-dvh bg-bg">
          {/* нижний резерв: табы + кнопка микрофона + safe-area — контент не уходит под них */}
          <main className="mx-auto max-w-[560px] px-4 pt-3" style={{ paddingBottom: `calc(${TAB_H + 96}px + env(safe-area-inset-bottom))` }}>
            <Outlet />
          </main>
          {/* мягкая подложка под плавающими кнопками — контент не «врезается» в них */}
          <div
            className="pointer-events-none fixed inset-x-0 z-20 h-28 bg-gradient-to-t from-bg to-transparent"
            style={{ bottom: `calc(${TAB_H}px + env(safe-area-inset-bottom))` }}
            aria-hidden
          />
          <TgComposer />
          <TabBar />
        </div>
      </ReminderProvider>
    </LiveProvider>
  );
}
