// «Eshitish»: озвучка ответа через /api/tts (Gemini TTS). Если вопрос задан голосом — автопроигрывание.
// TTS недоступен (503) или браузер запретил автозвук — кнопка просто тихо исчезает / ждёт нажатия.
import { Loader2, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { haptic } from "../lib/telegram";
import { t } from "../lib/i18n";

type State = "idle" | "loading" | "playing" | "off";

export function ListenButton({ text, auto = false, className = "" }: { text: string; auto?: boolean; className?: string }) {
  const [state, setState] = useState<State>("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setState("idle");
  }, []);

  const play = useCallback(
    async (isAuto = false) => {
      try {
        if (!audio.current) {
          setState("loading");
          const blob = await api.tts(text);
          url.current = URL.createObjectURL(blob);
          const a = new Audio(url.current);
          a.onended = () => setState("idle");
          audio.current = a;
        }
        setState("playing");
        await audio.current.play();
        if (!isAuto) haptic("light");
      } catch (e) {
        // NotAllowedError — автозвук заблокирован: звук уже загружен, ждём нажатия
        if (e instanceof DOMException && e.name === "NotAllowedError") setState("idle");
        else setState("off");
      }
    },
    [text],
  );

  useEffect(() => {
    if (auto) play(true);
  }, [auto, play]);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  if (state === "off") return null;
  const playing = state === "playing";
  return (
    <button
      type="button"
      onClick={() => (playing ? stop() : play())}
      disabled={state === "loading"}
      aria-label={playing ? t("Ovozni to'xtatish") : t("Javobni eshitish")}
      className={`btn-fx inline-flex h-11 items-center gap-2 rounded-full bg-surface-2 pr-4 pl-3 text-[15px] font-medium text-ink hover:bg-surface-3 disabled:opacity-70 ${className}`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-brand-ink">
        {state === "loading" ? <Loader2 size={15} className="animate-spin" /> : playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </span>
      {playing ? (
        <span className="flex h-4 items-end gap-[3px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="w-[3px] animate-pulse rounded-full bg-ink" style={{ height: `${40 + ((i * 37) % 60)}%`, animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      ) : null}
      {playing ? t("To'xtatish") : t("Eshitish")}
    </button>
  );
}
