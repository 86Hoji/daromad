// Напоминание должнику: превью SMS -> отправка (backend/extras: /api/debts/{id}/remind[/preview]).
// Демо-режим (ничего не уходит) — только если эндпоинта нет совсем (404 без кода ошибки).
import { Check, ExternalLink, FlaskConical, MessageSquareText } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { api, errorCode, isMissingEndpoint, type DebtRow, type Debtor, type RemindPreview, type RemindReason } from "../lib/api";
import { useLive } from "../lib/live";
import { ddmm, num } from "../lib/format";
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

interface PreviewState {
  debt: Target;
  text: string | null;
  phone: string | null;
  canSend: boolean;
  reason: RemindReason | null;
  nextAt: string | null;
  mode: RemindPreview["sms_mode"];
  demo: boolean;
  /** после отправки: ссылка на оплату (в тестовом режиме SMS не доходит — открываем страницу сами) */
  sentUrl?: string | null;
  testSent?: boolean;
}

const ReminderCtx = createContext<Ctx | null>(null);

/** Понятное сообщение для каждого кода отказа extras. */
export function reasonText(reason: RemindReason | string | null | undefined, nextAt?: string | null): string {
  switch (reason) {
    case "no_consent":
      return "Mijoz SMS olishga rozilik bermagan. Avval roziligini so'rang.";
    case "no_phone":
      return "Mijozning telefon raqami yo'q yoki noto'g'ri.";
    case "too_soon":
      return nextAt ? `Eslatma yaqinda yuborilgan. Keyingisi — ${ddmm(nextAt.slice(0, 10))} dan keyin.` : "Eslatma yaqinda yuborilgan. 3 kundan keyin qayta urinib ko'ring.";
    case "debt_closed":
      return "Bu qarz allaqachon yopilgan.";
    case "token_expired":
      return "To'lov havolasining muddati o'tgan. Yangi eslatma yuboring.";
    case "not_found":
      return "Qarz topilmadi.";
    case "sms_failed":
      return "SMS yuborilmadi. Birozdan keyin qayta urinib ko'ring.";
    case "phone_not_allowed":
      return "Bu raqamga SMS yuborish ruxsat etilmagan (demo himoyasi).";
    case "link_not_public":
    case "link_too_long":
      return "To'lov havolasi sozlanmagan (PUBLIC_BASE_URL). Administratorga xabar bering.";
    default:
      return "Yuborib bo'lmadi.";
  }
}

function localText(d: Target, business: string): string {
  return `Assalomu alaykum, ${d.person_name}! «${business}» da ${num(d.remaining)} so'm qarzingiz bor. To'lash: …`;
}

/** Один лист напоминания на всё приложение: открывается из шагов, таблицы долгов и превью. */
export function ReminderProvider({ children }: { children: ReactNode }) {
  const { summary, debts, refresh } = useLive();
  const [preview, setPreview] = useState<PreviewState | null>(null);
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
        setPreview({
          debt: t, text: r.sms_text, phone: r.phone ?? t.phone ?? null, canSend: r.can_send, reason: r.reason,
          nextAt: r.next_allowed_at, mode: r.sms_mode, demo: false,
        });
      } catch (e) {
        if (isMissingEndpoint(e)) {
          setPreview({
            debt: t, text: localText(t, summary?.shop.name ?? "Biznes"), phone: t.phone ?? null, canSend: true,
            reason: null, nextAt: null, mode: "mock", demo: true,
          });
        } else {
          haptic("error");
          toast(errorCode(e) ? reasonText(errorCode(e)) : "Server javob bermadi", "neg");
        }
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
      let test = false;
      let url: string | null = null;
      if (!preview.demo) {
        const r = await api.remindSend(id);
        test = r.sms_test_mode;
        url = r.pay_url;
      }
      setSent((s) => ({ ...s, [id]: true }));
      haptic("success");
      toast(preview.demo ? "Eslatma yuborildi (demo)" : test ? "Eslatma yuborildi · Eskiz test rejimi" : "Eslatma yuborildi", "pos");
      refresh();
      // настоящее SMS дойдёт до должника само; в тестовых режимах показываем ссылку, чтобы открыть оплату
      if (url && preview.mode !== "live") setPreview({ ...preview, sentUrl: url, testSent: test });
      else setPreview(null);
    } catch (e) {
      haptic("error");
      const code = errorCode(e);
      if (code) setPreview((p) => (p ? { ...p, canSend: false, reason: code as RemindReason } : p));
      toast(reasonText(code), "neg");
    } finally {
      setSending(false);
    }
  };

  const d = preview?.debt;
  const blocked = preview && !preview.canSend;
  const done = !!preview?.sentUrl;
  const modeNote =
    preview?.demo || preview?.mode === "mock"
      ? "Sinov rejimi: SMS haqiqatda yuborilmaydi, to'lov havolasi ishlaydi"
      : preview?.mode === "eskiz_test"
        ? "Eskiz test rejimi: telefonga «Bu Eskiz dan test» boradi, siz haqiqiy matnni ko'ryapsiz"
        : undefined;

  return (
    <ReminderCtx.Provider value={{ open, sent, busyId }}>
      {children}
      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title={d ? `${d.person_name}ga eslatma` : ""}
        primary={blocked || done ? { label: "Yopish", onClick: () => setPreview(null) } : { label: "Eslatish", onClick: send, loading: sending }}
        secondary={blocked || done ? undefined : { label: "Bekor", onClick: () => setPreview(null) }}
        footnote={blocked || done ? undefined : modeNote}
      >
        {d && preview && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
              <span className="num">{preview.phone ?? "Telefon yo'q"}</span>
              {preview.phone && <Chip tone={d.sms_consent ? "pos" : "neutral"}>{d.sms_consent ? "SMS roziligi bor" : "Rozilik yo'q"}</Chip>}
              <Chip tone={d.days_open > 14 ? "warn" : "neutral"}>{d.days_open} kun</Chip>
              {!blocked && modeNote && (
                <Chip className="gap-1">
                  <FlaskConical size={12} strokeWidth={1.75} aria-hidden /> test
                </Chip>
              )}
            </div>
            {done ? (
              <div className="rounded-el bg-pos-soft p-4 text-[15px] leading-relaxed" role="status">
                <p className="flex items-center gap-2 font-medium text-pos-text">
                  <Check size={18} strokeWidth={2} aria-hidden /> Eslatma yuborildi
                </p>
                <p className="mt-1 text-ink-2">
                  {preview.testSent ? "Eskiz test rejimi: telefonga test matni bordi." : "Sinov rejimi: SMS telefonga bormaydi."} To'lov sahifasini mijoz
                  ko'zi bilan oching:
                </p>
                <a
                  href={preview.sentUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-[14.5px] font-medium text-ink hover:bg-surface-2"
                >
                  To'lov sahifasini ochish <ExternalLink size={15} strokeWidth={1.75} aria-hidden />
                </a>
              </div>
            ) : blocked ? (
              <p className="rounded-el bg-warn-soft p-4 text-[15px] leading-relaxed text-warn-text" role="status">
                {reasonText(preview.reason, preview.nextAt)}
              </p>
            ) : (
              <div className="flex gap-3 rounded-el bg-surface-2 p-4 text-[15px] leading-relaxed">
                <MessageSquareText size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                <p className="min-w-0 [overflow-wrap:anywhere]">{preview.text}</p>
              </div>
            )}
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
