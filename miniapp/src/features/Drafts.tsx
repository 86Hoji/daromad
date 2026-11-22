// Распознанные события: карточки (лист «Yozib oldim» и песочница лендинга) и лист подтверждения.
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, HandCoins, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, ApiError, type Draft, type ProcessResult } from "../lib/api";
import { useLive } from "../lib/live";
import { capitalize, categoryLabel, ddmm, money, weekday } from "../lib/format";
import { haptic } from "../lib/telegram";
import { Chip } from "../ui/bits";
import { ListenButton } from "./Listen";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";
import { pick, t, tMaybe } from "../lib/i18n";

export const DRAFT_TYPE: Record<Draft["type"], { label: string; icon: typeof ArrowUpRight; sign: "+" | "−" | ""; tone: string }> = {
  sale: { label: "Sotuv", icon: ArrowDownLeft, sign: "+", tone: "text-pos-text" },
  expense: { label: "Xarajat", icon: ArrowUpRight, sign: "−", tone: "text-ink" },
  debt_given: { label: "Qarzga berildi", icon: HandCoins, sign: "", tone: "text-warn-text" },
  debt_returned: { label: "Qarz qaytdi", icon: Undo2, sign: "+", tone: "text-pos-text" },
  scheduled_payment: { label: "Kutilayotgan to'lov", icon: CalendarClock, sign: "−", tone: "text-ink" },
};

export function draftTitle(d: Draft): string {
  switch (d.type) {
    case "sale":
      return d.note ? capitalize(d.note) : t("Bugungi savdo");
    case "expense":
      return categoryLabel(d.category);
    case "debt_given":
      return pick({ uz: `${d.person ?? "Mijoz"} qarzga oldi`, ru: `${d.person ?? "Клиент"} взял в долг`, en: `${d.person ?? "Customer"} took on credit` });
    case "debt_returned":
      return pick({ uz: `${d.person ?? "Mijoz"} qarzini qaytardi`, ru: `${d.person ?? "Клиент"} вернул долг`, en: `${d.person ?? "Customer"} paid back` });
    case "scheduled_payment":
      return d.person || d.note || t("To'lov");
  }
}

function sub(d: Draft): string | null {
  if (d.type === "scheduled_payment" && d.due_date) return `${capitalize(weekday(d.due_date))}, ${ddmm(d.due_date)}`;
  if (d.type === "expense" && (d.note || d.person)) return d.note || d.person;
  if (d.type === "debt_given" && d.phone) return d.phone.replace(/^(\+998)(\d{2})\d{5}(\d{2})$/, "$1 $2 *** ** $3");
  return null;
}

/** fly — карточки влетают по одной с пружиной; fx — то же плюс витринная подложка (лендинг). */
export function DraftCards({ drafts, fx = false, fly = false }: { drafts: Draft[]; fx?: boolean; fly?: boolean }) {
  const spring = fx || fly;
  return (
    <ul className="space-y-2">
      <AnimatePresence initial>
        {drafts.map((d, i) => {
          const ty = DRAFT_TYPE[d.type];
          const Icon = ty.icon;
          const s = sub(d);
          return (
            <motion.li
              key={d.id}
              initial={spring ? { opacity: 0, y: 46, scale: 0.88, rotate: i % 2 ? -3 : 3 } : { opacity: 0, y: 10 }}
              animate={spring ? { opacity: 1, y: 0, scale: 1, rotate: 0 } : { opacity: 1, y: 0 }}
              transition={spring ? { type: "spring", stiffness: 240, damping: 19, delay: 0.12 + i * 0.2 } : { delay: i * 0.07, duration: 0.25 }}
              className={`flex items-center gap-3.5 rounded-el px-4 py-3.5 ${fx ? "bg-surface/85 shadow-[var(--elev-1)]" : "bg-surface-2"}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink-2">
                <Icon size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-ink-3">{t(ty.label)}</span>
                <span className="block truncate text-[15.5px] font-medium">{draftTitle(d)}</span>
                {s && <span className="num block truncate text-[13px] text-ink-3">{s}</span>}
              </span>
              <span className="flex flex-col items-end gap-1.5">
                <span className={`num text-[16px] font-semibold ${ty.tone}`}>
                  {ty.sign}
                  {money(d.amount)}
                </span>
                {d.needs_check ? (
                  <Chip tone="warn" icon={<AlertTriangle size={12} strokeWidth={2} />}>
                    {t("tekshiring")}
                  </Chip>
                ) : (
                  <Chip>{tMaybe(d.trust)}</Chip>
                )}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

/** Лист «Yozib oldim»: To'g'ri -> confirm, Tuzatish -> reject и фокус в поле ввода. */
export function DraftSheet({ result, onClose, onFix, autoListen = false }: { result: ProcessResult | null; onClose: () => void; onFix?: () => void; autoListen?: boolean }) {
  const { refresh } = useLive();
  const [busy, setBusy] = useState<null | "ok" | "fix">(null);
  const isQuestion = result?.intent === "question";
  const drafts = result?.drafts ?? [];
  const ids = drafts.map((d) => d.id);

  const confirm = async () => {
    setBusy("ok");
    try {
      const r = await api.confirm(ids);
      haptic(r.errors.length ? "warning" : "success");
      toast(r.errors.length ? r.errors[0] : t("Saqlandi"), r.errors.length ? "neg" : "pos");
      onClose();
      await refresh();
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiError ? e.message : t("Xatolik"), "neg");
    } finally {
      setBusy(null);
    }
  };

  const fix = async () => {
    setBusy("fix");
    try {
      await api.reject(ids);
      toast(t("Bekor qilindi — to'g'ri variantini yozing"));
      onClose();
      onFix?.();
    } finally {
      setBusy(null);
    }
  };

  if (isQuestion) {
    return (
      <Sheet open={!!result} onClose={onClose} title={t("Javob")} primary={{ label: t("Yopish"), onClick: onClose }}>
        <p className="text-[16px] leading-relaxed whitespace-pre-line">{result?.answer}</p>
        {result?.answer && <ListenButton className="mt-4" text={result.voice_text || result.answer} auto={autoListen} />}
      </Sheet>
    );
  }

  const has = drafts.length > 0;
  return (
    <Sheet
      open={!!result}
      onClose={onClose}
      title={has ? t("Yozib oldim") : t("Tushunmadim")}
      primary={has ? { label: t("To'g'ri"), onClick: confirm, loading: busy === "ok", disabled: busy === "fix" } : { label: t("Yopish"), onClick: onClose }}
      secondary={has ? { label: t("Tuzatish"), onClick: fix, loading: busy === "fix", disabled: busy === "ok" } : undefined}
    >
      {has ? <DraftCards drafts={drafts} fly /> : <p className="text-[15px] text-ink-2">{t("Summani va nima bo'lganini aytib ko'ring: «Bugun 1 million sotdim».")}</p>}
      {result && result.errors.length > 0 && (
        <div className="mt-3 flex gap-2 rounded-el bg-warn-soft p-3 text-[14px] text-warn-text">
          <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>{result.errors.join(" · ")}</span>
        </div>
      )}
    </Sheet>
  );
}
