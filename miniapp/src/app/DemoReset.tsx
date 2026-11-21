// «Demo reset»: Ctrl+Shift+R в /app (или кнопка в dev-режиме / с ?reset в адресе) -> POST /api/demo/reset.
// Бэкенд пускает только при DEMO_RESET=1 и только для демо-бизнеса; иначе — тост с причиной.
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useLive } from "../lib/live";
import { toast } from "../ui/Toast";

const showButton = import.meta.env.DEV || new URLSearchParams(window.location.search).has("reset");

export function useDemoReset(hotkey = false) {
  const { refresh } = useLive();
  const [busy, setBusy] = useState(false);
  const reset = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.demoReset();
      await refresh();
      toast("Demo ma'lumotlar qayta tiklandi", "pos");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      toast(status === 404 ? "Demo reset o'chirilgan (DEMO_RESET=1 kerak)" : e instanceof ApiError ? e.message : "Xatolik", "neg");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyR") {
        e.preventDefault(); // вместо жёсткой перезагрузки страницы
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey, reset]);

  return { reset, busy };
}

export function DemoResetButton() {
  const { reset, busy } = useDemoReset();
  if (!showButton) return null;
  return (
    <button
      type="button"
      onClick={reset}
      disabled={busy}
      title="Demo reset (Ctrl+Shift+R)"
      className="inline-flex h-9 items-center gap-1.5 rounded-el px-2.5 text-[13px] text-ink-3 transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
    >
      <RotateCcw size={15} strokeWidth={1.75} className={busy ? "animate-spin" : ""} />
      Demo reset
    </button>
  );
}

/** Горячая клавиша Ctrl+Shift+R — работает всегда, даже когда кнопка скрыта. */
export function DemoResetHotkey() {
  useDemoReset(true);
  return null;
}
