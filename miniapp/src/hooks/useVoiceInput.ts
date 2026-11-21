// Общая логика ввода для голосового дока (/app) и кнопки микрофона (/tg):
// текст -> /api/text, голос (WAV) -> /api/voice, результат -> лист «Yozib oldim».
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ProcessResult } from "../lib/api";
import { micSupported, startRecording, type Recording } from "../lib/recorder";
import { haptic, inTelegram } from "../lib/telegram";
import { toast } from "../ui/Toast";

const WAVE_LEN = 28;

export function useVoiceInput() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "text" | "voice">(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(WAVE_LEN).fill(0));
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const rec = useRef<Recording | null>(null);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => () => rec.current?.cancel(), []);

  const run = useCallback(async (p: Promise<ProcessResult>, kind: "text" | "voice") => {
    setBusy(kind);
    setHint(null);
    try {
      const r = await p;
      setResult(r);
      if (kind === "text") setText("");
      if (r.intent === "record" && r.drafts.length === 0 && r.errors.length === 0) {
        toast("Hech narsa topilmadi — boshqacha aytib ko'ring", "info");
      }
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiError ? e.message : "Xatolik yuz berdi", "neg");
    } finally {
      setBusy(null);
    }
  }, []);

  const sendText = useCallback(
    (value?: string) => {
      const t = (value ?? text).trim();
      if (!t || busy) return;
      run(api.text(t), "text");
    },
    [text, busy, run],
  );

  const micHint = () =>
    setHint(
      inTelegram
        ? "Mikrofon bu yerda ishlamayapti — ovozli xabarni botga yuboring."
        : "Mikrofonga ruxsat bering yoki matn bilan yozing. Ovozli xabarni botga ham yuborish mumkin.",
    );

  const stop = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setRecording(false);
    setLevels(Array(WAVE_LEN).fill(0));
    setBusy("voice");
    try {
      const wav = await r.stop();
      await run(api.voice(wav), "voice");
    } catch {
      setBusy(null);
      micHint();
    }
  }, [run]);

  const start = useCallback(async () => {
    if (busy || rec.current) return;
    if (!micSupported()) return micHint();
    try {
      rec.current = await startRecording((lv) => setLevels((xs) => [...xs.slice(1), lv]));
      setRecording(true);
      haptic("light");
    } catch {
      micHint();
    }
  }, [busy]);

  const cancel = useCallback(() => {
    rec.current?.cancel();
    rec.current = null;
    setRecording(false);
    setLevels(Array(WAVE_LEN).fill(0));
  }, []);

  return {
    text,
    setText,
    busy,
    recording,
    seconds,
    levels,
    hint,
    setHint,
    result,
    clearResult: () => setResult(null),
    sendText,
    toggleMic: () => (recording ? stop() : start()),
    cancel,
    micAvailable: micSupported(),
  };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
