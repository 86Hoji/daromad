// Напоминание должнику: превью SMS -> отправка. Пока backend/extras нет (404) — демо, ничего не уходит.
import { MessageSquareText } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, isNotFound, type DebtRow, type Debtor } from "../lib/api";
import { useLive } from "../lib/live";
import { num } from "../lib/format";
import { haptic } from "../lib/telegram";
import { Chip } from "../ui/bits";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";

type Target = Pick<DebtRow, "id" | "person_name" | "remaining" | "days_open"> & { phone?: string | null; sms_consent?: boolean };

interface Ctx {
  open: (d: Target | Debtor) => void;
  sent: Record<number, boolean>;
  busyId: number | null;
}

const ReminderCtx = createContext<Ctx | null>(null);

function localText(d: Target, business: string): string {
  return (
    `Assalomu alaykum, ${d.person_name}! «${business}» dan eslatma: ${num(d.remaining)} so'm qarzingiz bor. ` +
    `Imkoningiz bo'lsa, qaytarib bering. Rahmat!`
  );
}

/** Один лист напоминания на всё приложение: открывается из шагов, таблицы долгов и превью. */
export function ReminderProvider({ children }: { children: ReactNode }) {
  const { summary, debts } = useLive();
  const [preview, setPreview] = useState<{ debt: Target; text: string; demo: boolean } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Record<number, boolean>>({});

  const open = useCallback(
    async (d: Target | Debtor) => {
      // у Debtor из сводки нет телефона — берём полную строку из /api/debts
      const full = debts?.debts.find((x) => x.id === d.id);
      const t: Target = { ...d, phone: full?.phone ?? null, sms_consent: full?.sms_consent ?? false };
      setBusyId(d.id);
      try {
        const r = await api.remindPreview(d.id);
        setPreview({ debt: t, text: r.text, demo: Boolean(r.demo) });
      } catch (e) {
        setPreview({ debt: t, text: localText(t, summary?.shop.name ?? "Biznes"), demo: true });
        if (!isNotFound(e)) toast("Server javob bermadi — demo ko'rinish", "neg");
      } finally {
        setBusyId(null);
      }
    },
    [debts, summary],
  );

  const send = async () => {
    if (!preview) return;
    setSending(true);
    const id = preview.debt.id;
    try {
      if (!preview.demo) await api.remindSend(id);
      setSent((s) => ({ ...s, [id]: true }));
      haptic("success");
      toast(preview.demo ? "Eslatma yuborildi (demo)" : "Eslatma yuborildi", "pos");
      setPreview(null);
    } catch (e) {
      if (isNotFound(e)) {
        setSent((s) => ({ ...s, [id]: true }));
        toast("Eslatma yuborildi (demo)", "pos");
        setPreview(null);
      } else {
        haptic("error");
        toast("Yuborib bo'lmadi", "neg");
      }
    } finally {
      setSending(false);
    }
  };

  const d = preview?.debt;
  const masked = d?.phone ? d.phone.replace(/^(\+998)(\d{2})\d{5}(\d{2})$/, "$1 $2 *** ** $3") : null;

  return (
    <ReminderCtx.Provider value={{ open, sent, busyId }}>
      {children}
      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={d ? `${d.person_name}ga eslatma` : ""}
        primary={{ label: "Eslatish", onClick: send, loading: sending }}
        secondary={{ label: "Bekor", onClick: () => setPreview(null) }}
        footnote={preview?.demo ? "Demo: SMS yuborilmaydi, bu faqat ko'rinish" : undefined}
      >
        {d && preview && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
              <span className="num">{masked ?? "Telefon yo'q"}</span>
              {d.phone && <Chip tone={d.sms_consent ? "pos" : "neutral"}>{d.sms_consent ? "SMS roziligi bor" : "Rozilik yo'q"}</Chip>}
              <Chip tone={d.days_open > 14 ? "warn" : "neutral"}>{d.days_open} kun</Chip>
            </div>
            <div className="flex gap-3 rounded-el bg-surface-2 p-4 text-[15px] leading-relaxed">
              <MessageSquareText size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
              <p>{preview.text}</p>
            </div>
          </>
        )}
      </Sheet>
    </ReminderCtx.Provider>
  );
}

export function useReminder(): Ctx {
  const v = useContext(ReminderCtx);
  if (!v) throw new Error("useReminder outside ReminderProvider");
  return v;
}
