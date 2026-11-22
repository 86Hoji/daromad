// Песочница лендинга (стеклянная консоль): POST /api/text -> карточки влетают по одной -> сразу reject
// (в базу ничего не попадает). До ввода показан разобранный пример. Без сервера — примеры из demo.ts.
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { DraftCards } from "../features/Drafts";
import { api, ApiError, type ProcessResult } from "../lib/api";
import { Button } from "../ui/Button";
import { EXAMPLES } from "./demo";
import { t } from "../lib/i18n";

type State =
  | { kind: "busy"; text: string }
  | { kind: "done"; result: ProcessResult; note: "sample" | "offline" | "live" }
  | { kind: "error"; text: string };

const asResult = (ex: (typeof EXAMPLES)[number]): ProcessResult => ({ intent: "record", transcript: t(ex.text), batch_id: null, drafts: ex.drafts, errors: [], answer: null });

const NOTE = {
  sample: "Namuna. O'z gapingizni yozib ko'ring.",
  offline: "Namuna serversiz ko'rsatildi.",
  live: "Bu sinov — yozuvlar darhol bekor qilindi va saqlanmadi.",
};

export function Sandbox() {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "done", result: asResult(EXAMPLES[0]), note: "sample" });
  const [runId, setRunId] = useState(0);

  const run = async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setText(v);
    setState({ kind: "busy", text: v });
    try {
      const r = await api.text(v);
      setRunId((n) => n + 1);
      setState({ kind: "done", result: r, note: "live" });
      const ids = r.drafts.map((d) => d.id);
      if (ids.length) api.reject(ids).catch(() => undefined);
    } catch (e) {
      const ex = EXAMPLES.find((x) => t(x.text) === v || x.text === v);
      if (ex) {
        setRunId((n) => n + 1);
        setState({ kind: "done", result: asResult(ex), note: "offline" });
      } else {
        setState({
          kind: "error",
          text:
            e instanceof ApiError && e.status !== 0
              ? `${t("Tushuna olmadim:")} ${e.message}`
              : t("Server hozir javob bermayapti. Namunalardan birini tanlang — ular serversiz ham ishlaydi."),
        });
      }
    }
  };

  const busy = state.kind === "busy";

  return (
    <div className="glass lift-3 grid grid-cols-1 gap-3 rounded-[34px] p-3 sm:p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex flex-col p-3 sm:p-5">
        <div className="flex items-center gap-2 text-[13.5px] text-ink-3">
          <span className="relative flex h-2 w-2">
            {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-pos opacity-60" />}
            <span className="relative h-2 w-2 rounded-full bg-pos" />
          </span>
          {t("Sinov konsoli · hech narsa saqlanmaydi")}
        </div>

        <form
          className="mt-5 rounded-[22px] bg-surface/75 p-2 shadow-[var(--elev-1)]"
          onSubmit={(e) => {
            e.preventDefault();
            run(text);
          }}
        >
          <label htmlFor="sandbox-input" className="sr-only">
            {t("Nima bo'ldi?")}
          </label>
          <textarea
            id="sandbox-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(text);
              }
            }}
            rows={3}
            placeholder={t("Masalan: bugun naqdga 1 million 200 ming sotdim, ijaraga 500 ming to'ladim")}
            className="block w-full resize-none bg-transparent px-3 pt-2 text-[17px] leading-snug outline-none placeholder:text-ink-3"
            autoComplete="off"
            enterKeyHint="send"
          />
          <div className="mt-1 flex justify-end">
            <Button type="submit" size="md" magnetic loading={busy} disabled={!text.trim()} icon={<Sparkles size={17} strokeWidth={1.75} />}>
              {t("Tushunib ko'r")}
            </Button>
          </div>
        </form>

        <p className="mt-6 mb-3 text-[13.5px] text-ink-3">{t("Yoki namunani bosing:")}</p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <li key={ex.text}>
              <button
                type="button"
                onClick={() => run(t(ex.text))}
                disabled={busy}
                className="btn-fx rounded-full bg-surface/60 px-4 py-2.5 text-left text-[14.5px] text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-50"
              >
                «{t(ex.text)}»
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-[340px] rounded-[26px] bg-surface/55 p-5 sm:p-7" aria-live="polite">
        {state.kind === "busy" && (
          <div aria-label={t("Tahlil qilinmoqda")}>
            <div className="text-[13px] text-ink-3">{t("Eshitganim")}</div>
            <p className="mt-1 text-[17px] leading-snug">«{state.text}»</p>
            <p className="text-shimmer display mt-8 text-[22px] font-semibold">{t("Tushunyapman…")}</p>
            <div className="mt-4 space-y-2">
              <div className="skeleton h-[72px] rounded-el" />
              <div className="skeleton h-[72px] rounded-el opacity-60" />
            </div>
          </div>
        )}
        {state.kind === "error" && <p className="py-6 text-[15px] text-neg-text">{state.text}</p>}
        {state.kind === "done" && <SandboxResult key={runId} result={state.result} note={state.note} />}
      </div>
    </div>
  );
}

function SandboxResult({ result, note }: { result: ProcessResult; note: keyof typeof NOTE }) {
  const reduce = useReducedMotion();
  const head = (
    <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="text-[13px] text-ink-3">{t("Eshitganim")}</div>
      <p className="mt-1 text-[17px] leading-snug">«{result.transcript}»</p>
    </motion.div>
  );
  if (result.intent === "question")
    return (
      <div>
        {head}
        <h3 className="mt-6 mb-2 text-[15px] font-semibold">{t("Javob")}</h3>
        <p className="text-[15.5px] leading-relaxed whitespace-pre-line text-ink-2">{result.answer}</p>
      </div>
    );
  if (!result.drafts.length)
    return (
      <div>
        {head}
        <p className="mt-6 text-[15px] text-ink-2">{result.errors[0] ?? t("Bu gapda summa yoki voqea topilmadi. Boshqacha yozib ko'ring.")}</p>
      </div>
    );
  return (
    <div>
      {head}
      <div className="mt-6 mb-3 flex items-baseline justify-between">
        <h3 className="display text-[20px] font-semibold tracking-[-0.02em]">{t("Yozib oldim")}</h3>
        <span className="text-[13.5px] text-ink-3">{t("{n} ta yozuv", { n: result.drafts.length })}</span>
      </div>
      <DraftCards drafts={result.drafts} fx />
      <p className="mt-5 text-[13.5px] text-ink-3">{t(NOTE[note])} {t("Ilovada shu yerda «To'g'ri» tugmasi bo'ladi.")}</p>
    </div>
  );
}
