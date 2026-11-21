// Ввод: текст «Yozing…» или 🎤 (MediaRecorder -> WAV) -> /api/text | /api/voice -> лист «Yozib oldim».
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Draft, type ProcessResult } from "../lib/api";
import { useLive } from "../lib/live";
import { CATEGORY_LABEL, capitalize, ddmm, money, weekday } from "../lib/format";
import { micSupported, startRecording, type Recording } from "../lib/recorder";
import { haptic, inTelegram } from "../lib/telegram";
import { IconAlert, IconMic, IconSend, IconStop } from "./icons";
import { Badge, Button, Sheet, Spinner, toast } from "./ui";

export function Composer({ floating = false }: { floating?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "text" | "voice">(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!rec) return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [rec]);

  const handle = async (p: Promise<ProcessResult>, kind: "text" | "voice") => {
    setBusy(kind);
    setHint(null);
    try {
      const r = await p;
      setResult(r);
      if (kind === "text") setText("");
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiError ? e.message : "Xatolik yuz berdi", "neg");
    } finally {
      setBusy(null);
    }
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || busy) return;
    handle(api.text(t), "text");
  };

  const micHint = () =>
    setHint(inTelegram ? "Mikrofon bu yerda ishlamayapti — ovozli xabarni botga yuboring." : "Mikrofonga ruxsat bering yoki matn bilan yozing.");

  const toggleMic = async () => {
    if (busy) return;
    if (rec) {
      const r = rec;
      setRec(null);
      setBusy("voice");
      try {
        const wav = await r.stop();
        await handle(api.voice(wav), "voice");
      } catch {
        setBusy(null);
        micHint();
      }
      return;
    }
    if (!micSupported()) return micHint();
    try {
      setRec(await startRecording());
      haptic("light");
    } catch {
      micHint();
    }
  };

  const wrap = floating
    ? "fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-4 pb-3 lg:hidden"
    : "";

  return (
    <div className={wrap}>
      {hint && (
        <div className="fade-enter mb-2 flex items-start gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2 shadow-sm">
          <IconAlert size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{hint}</span>
          <button className="text-ink-3" onClick={() => setHint(null)} aria-label="Yopish">
            ✕
          </button>
        </div>
      )}
      <div className="flex items-center gap-2.5">
        <div className="flex h-14 flex-1 items-center rounded-[20px] border border-line bg-surface pl-4 pr-1.5 shadow-[0_6px_24px_rgba(11,18,32,0.08)]">
          {rec ? (
            <div className="flex flex-1 items-center gap-2.5 text-[15px] font-medium text-neg">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-neg" />
              Yozilmoqda… <span className="num text-ink-2">0:{String(seconds).padStart(2, "0")}</span>
            </div>
          ) : (
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder="Yozing… masalan, «Bugun 1 million sotdim»"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
              disabled={busy !== null}
              enterKeyHint="send"
            />
          )}
          {!rec && (
            <button
              onClick={sendText}
              disabled={!text.trim() || busy !== null}
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-2 transition disabled:opacity-30"
              aria-label="Yuborish"
            >
              {busy === "text" ? <Spinner /> : <IconSend size={20} />}
            </button>
          )}
        </div>
        <button
          onClick={toggleMic}
          disabled={busy !== null && !rec}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] shadow-[0_6px_24px_rgba(11,18,32,0.18)] transition active:scale-95 ${
            rec ? "bg-neg text-white" : "bg-btn text-btn-ink"
          }`}
          aria-label={rec ? "To'xtatish" : "Ovoz yozish"}
        >
          {busy === "voice" ? <Spinner /> : rec ? <IconStop size={22} /> : <IconMic size={22} />}
        </button>
      </div>
      <DraftSheet result={result} onClose={() => setResult(null)} onFix={() => inputRef.current?.focus()} />
    </div>
  );
}

const TYPE_LABEL: Record<Draft["type"], string> = {
  sale: "Sotuv",
  expense: "Xarajat",
  debt_given: "Qarzga berildi",
  debt_returned: "Qarz qaytdi",
  scheduled_payment: "Kutilayotgan to'lov",
};

function draftTitle(d: Draft): string {
  switch (d.type) {
    // тип уже написан в подписи над заголовком — здесь только суть
    case "sale":
      return d.note ? capitalize(d.note) : "Bugungi savdo";
    case "expense":
      return CATEGORY_LABEL[d.category ?? "boshqa"] ?? d.category ?? "Boshqa";
    case "debt_given":
      return `${d.person} qarzga oldi`;
    case "debt_returned":
      return `${d.person} qarzini qaytardi`;
    case "scheduled_payment":
      return `To'lov: ${d.note || d.person || "to'lov"}`;
  }
}

function draftSub(d: Draft): string | null {
  if (d.type === "scheduled_payment" && d.due_date) return `${capitalize(weekday(d.due_date))}, ${ddmm(d.due_date)}`;
  if (d.type === "expense" && (d.note || d.person)) return d.note || d.person;
  if (d.type === "debt_given" && d.phone) return d.phone.replace(/^(\+998)(\d{2})\d{5}(\d{2})$/, "$1 $2 *** ** $3");
  return null;
}

function DraftSheet({ result, onClose, onFix }: { result: ProcessResult | null; onClose: () => void; onFix: () => void }) {
  const { refresh } = useLive();
  const [busy, setBusy] = useState<null | "ok" | "fix">(null);
  if (!result) return null;

  if (result.intent === "question") {
    return (
      <Sheet open onClose={onClose} title="Javob">
        <p className="mb-5 whitespace-pre-line text-[16px] leading-relaxed">{result.answer}</p>
        <Button className="w-full" onClick={onClose}>
          Yopish
        </Button>
      </Sheet>
    );
  }

  const ids = result.drafts.map((d) => d.id);
  const confirm = async () => {
    setBusy("ok");
    try {
      const r = await api.confirm(ids);
      haptic("success");
      toast(r.errors.length ? r.errors[0] : "Saqlandi", r.errors.length ? "neg" : "pos");
      onClose();
      await refresh();
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiError ? e.message : "Xatolik", "neg");
    } finally {
      setBusy(null);
    }
  };
  const fix = async () => {
    setBusy("fix");
    try {
      await api.reject(ids);
      toast("Bekor qilindi — to'g'ri variantini yozing");
      onClose();
      onFix();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onClose={onClose} title={result.drafts.length ? "Yozib oldim:" : "Tushunmadim"}>
      {result.drafts.length > 0 && (
        <div className="mb-4 divide-y divide-line rounded-2xl border border-line">
          {result.drafts.map((d) => {
            const sub = draftSub(d);
            const out = d.type === "expense" || d.type === "scheduled_payment" || d.type === "debt_given";
            return (
              <div key={d.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{TYPE_LABEL[d.type]}</div>
                    <div className="mt-0.5 truncate text-[15px] font-semibold">{draftTitle(d)}</div>
                    {sub && <div className="mt-0.5 text-[13px] text-ink-2">{sub}</div>}
                  </div>
                  <div className="text-right">
                    <div className={`num text-[16px] font-bold ${out ? "" : "text-pos"}`}>
                      {out ? "" : "+"}
                      {money(d.amount)}
                    </div>
                    <div className="mt-1">
                      <Badge tone={d.trust === "tasdiqlangan" ? "pos" : "neutral"}>{d.trust}</Badge>
                    </div>
                  </div>
                </div>
                {d.needs_check && (
                  <div className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-neg">
                    <IconAlert size={14} /> Summani tekshiring
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {result.errors.length > 0 && (
        <div className="mb-4 space-y-1.5 rounded-2xl bg-neg-soft p-3.5 text-[13.5px] text-neg">
          {result.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
      {result.drafts.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={fix} loading={busy === "fix"} disabled={busy !== null}>
            Tuzatish
          </Button>
          <Button onClick={confirm} loading={busy === "ok"} disabled={busy !== null}>
            To'g'ri
          </Button>
        </div>
      ) : (
        <Button className="w-full" onClick={onClose}>
          Qayta yozaman
        </Button>
      )}
    </Sheet>
  );
}
