// Кнопка микрофона с живой волной и строка подсказки. Мотив бренда: голос -> линия денег.
import { Loader2, Mic, Square } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { VoiceInput } from "../hooks/useVoiceInput";

/** Полосы волны по реальной громкости (AnalyserNode). */
export function LiveWave({ levels, className = "", color = "currentColor" }: { levels: number[]; className?: string; color?: string }) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden>
      {levels.map((lv, i) => (
        <span key={i} className="w-[3px] rounded-full transition-[height] duration-75" style={{ height: `${Math.max(12, Math.min(100, 12 + lv * 160))}%`, background: color }} />
      ))}
    </span>
  );
}

export function MicButton({ v, size = 64, className = "" }: { v: VoiceInput; size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const loud = Math.max(...v.levels.slice(-4));
  return (
    <button
      type="button"
      onClick={v.toggleMic}
      disabled={v.busy !== null && !v.recording}
      aria-label={v.recording ? "Yozishni to'xtatish va yuborish" : "Ovoz yozish"}
      aria-pressed={v.recording}
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full shadow-float transition-colors duration-150 active:scale-95 disabled:opacity-60 ${
        v.recording ? "bg-neg text-white" : "bg-brand text-brand-ink hover:bg-brand-hover"
      } ${className}`}
      style={{ width: size, height: size }}
    >
      {v.recording && !reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-neg"
          animate={{ scale: 1 + loud * 0.45, opacity: 0.25 }}
          transition={{ duration: 0.08 }}
          aria-hidden
        />
      )}
      <span className="relative">
        {v.busy === "voice" ? (
          <Loader2 size={size * 0.36} className="animate-spin" />
        ) : v.recording ? (
          <Square size={size * 0.3} fill="currentColor" strokeWidth={0} />
        ) : (
          <Mic size={size * 0.38} strokeWidth={1.75} />
        )}
      </span>
    </button>
  );
}
