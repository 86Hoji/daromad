// Песочница лендинга: POST /api/text -> карточки -> сразу reject (в базу ничего не попадает).
// Если сервер недоступен, примеры показываются из demo.ts.
import { MessageSquareText, Sparkles } from "lucide-react";
import { useState } from "react";
import { DraftCards } from "../features/Drafts";
import { api, ApiError, type ProcessResult } from "../lib/api";
import { Button } from "../ui/Button";
import { EXAMPLES } from "./demo";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; result: ProcessResult; offline: boolean }
  | { kind: "error"; text: string };

export function Sandbox() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = async (value: string) => {
    const t = value.trim();
    if (!t) return;
    setText(t);
    setState({ kind: "busy" });
    try {
      const r = await api.text(t);
      setState({ kind: "done", result: r, offline: false });
      const ids = r.drafts.map((d) => d.id);
      if (ids.length) api.reject(ids).catch(() => undefined);
    } catch (e) {
      const ex = EXAMPLES.find((x) => x.text === t);
      if (ex) {
        setState({ kind: "done", offline: true, result: { intent: "record", transcript: t, batch_id: null, drafts: ex.drafts, errors: [], answer: null } });
      } else {
        setState({
          kind: "error",
          text:
            e instanceof ApiError && e.status !== 0
              ? `Tushuna olmadim: ${e.message}`
              : "Server hozir javob bermayapti. Pastdagi namunalardan birini tanlang — ular serversiz ham ishlaydi.",
        });
      }
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <div>
        <form
          className="flex flex-col gap-2 rounded-panel bg-surface p-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <label htmlFor="sandbox-input" className="sr-only">
            Nima bo'ldi?
          </label>
          <input
            id="sandbox-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Masalan: bugun 1 million 200 ming sotdim"
            className="h-12 min-w-0 flex-1 rounded-el bg-transparent px-4 text-[16px] outline-none placeholder:text-ink-3"
            autoComplete="off"
            enterKeyHint="send"
          />
          <Button type="submit" size="md" loading={state.kind === "busy"} disabled={!text.trim()} icon={<Sparkles size={17} strokeWidth={1.75} />}>
            Tushunib ko'r
          </Button>
        </form>

        <p className="mt-6 mb-3 text-[14px] text-ink-3">Yoki namunani bosing:</p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.text}>
              <button
                type="button"
                onClick={() => run(ex.text)}
                disabled={state.kind === "busy"}
                className="rounded-full bg-surface px-4 py-2.5 text-left text-[14.5px] text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink disabled:opacity-50"
              >
                «{ex.text}»
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-[260px] rounded-panel bg-surface p-5 sm:p-6" aria-live="polite">
        {state.kind === "idle" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center text-ink-3">
            <MessageSquareText size={28} strokeWidth={1.5} aria-hidden />
            <p className="max-w-[300px] text-[15px]">Daromad gapni qanday yozuvlarga ajratishi shu yerda chiqadi</p>
          </div>
        )}
        {state.kind === "busy" && (
          <div className="space-y-2" aria-label="Tahlil qilinmoqda">
            <div className="skeleton h-[68px] rounded-el" />
            <div className="skeleton h-[68px] rounded-el opacity-70" />
          </div>
        )}
        {state.kind === "error" && <p className="py-6 text-[15px] text-neg-text">{state.text}</p>}
        {state.kind === "done" && <SandboxResult result={state.result} offline={state.offline} />}
      </div>
    </div>
  );
}

function SandboxResult({ result, offline }: { result: ProcessResult; offline: boolean }) {
  if (result.intent === "question")
    return (
      <div>
        <h3 className="mb-2 text-[15px] font-semibold">Javob</h3>
        <p className="text-[15.5px] leading-relaxed whitespace-pre-line text-ink-2">{result.answer}</p>
      </div>
    );
  if (!result.drafts.length)
    return <p className="py-6 text-[15px] text-ink-2">{result.errors[0] ?? "Bu gapda summa yoki voqea topilmadi. Boshqacha yozib ko'ring."}</p>;
  return (
    <div>
      <h3 className="mb-3 text-[15px] font-semibold">
        Yozib oldim · {result.drafts.length} ta yozuv
      </h3>
      <DraftCards drafts={result.drafts} />
      <p className="mt-4 text-[13.5px] text-ink-3">
        {offline ? "Namuna serversiz ko'rsatildi." : "Bu sinov — yozuvlar darhol bekor qilindi va saqlanmadi."} Ilovada shu yerda «To'g'ri» tugmasi bo'ladi.
      </p>
    </div>
  );
}
