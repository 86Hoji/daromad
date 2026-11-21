import { useMemo, useState } from "react";
import { api, isNotFound, type DebtRow } from "../lib/api";
import { useLive } from "../lib/live";
import { money, num } from "../lib/format";
import { haptic } from "../lib/telegram";
import { IconBell, IconCheck } from "../components/icons";
import { AnimatedNumber, Badge, Button, Sheet, toast } from "../components/ui";
import { Loading } from "./Loading";

type SortKey = "amount" | "age";

function ageTone(days: number): string {
  if (days > 14) return "text-neg bg-neg-soft";
  if (days > 7) return "text-ink bg-surface-2 border border-line";
  return "text-ink-3 bg-surface-2";
}

function consent(d: DebtRow): { text: string; tone: "pos" | "neutral" } {
  if (!d.phone) return { text: "Telefon yo'q", tone: "neutral" };
  return d.sms_consent ? { text: "SMS roziligi bor", tone: "pos" } : { text: "Rozilik yo'q", tone: "neutral" };
}

function localPreview(d: DebtRow, business: string): string {
  return (
    `Assalomu alaykum, ${d.person_name}! «${business}» dan eslatma: ${num(d.remaining)} so'm qarzingiz bor. ` +
    `Imkoningiz bo'lsa, qaytarib bering. Rahmat!`
  );
}

export function Debts() {
  const { debts, summary, error } = useLive();
  const [sort, setSort] = useState<SortKey>("amount");
  const [sent, setSent] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<{ debt: DebtRow; text: string; demo: boolean } | null>(null);
  const [busy, setBusy] = useState<number | "send" | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const open = useMemo(() => {
    const list = (debts?.debts ?? []).filter((d) => d.status === "open");
    return list.sort((a, b) => (sort === "amount" ? b.remaining - a.remaining : b.days_open - a.days_open));
  }, [debts, sort]);
  const closed = (debts?.debts ?? []).filter((d) => d.status === "closed");

  if (!debts || !summary) return <Loading error={error} />;

  const openPreview = async (d: DebtRow) => {
    setBusy(d.id);
    try {
      const r = await api.remindPreview(d.id);
      setPreview({ debt: d, text: r.text, demo: Boolean(r.demo) });
    } catch (e) {
      // эндпоинт делает второй разработчик (backend/extras); пока его нет — превью собираем на фронте
      setPreview({ debt: d, text: localPreview(d, summary.shop.name), demo: true });
      if (!isNotFound(e)) toast("Server javob bermadi — demo ko'rinish", "neg");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!preview) return;
    setBusy("send");
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
      setBusy(null);
    }
  };

  return (
    <div className="pb-28 lg:pb-10">
      <section className="pt-2 pb-6 lg:pt-6">
        <div className="text-[14px] font-medium text-ink-2">Sizga qarz</div>
        <div className="mt-2 flex items-baseline gap-2 font-bold leading-none tracking-[-0.04em]">
          <AnimatedNumber value={debts.total_receivable} className="text-[48px] lg:text-[72px]" />
          <span className="text-[20px] font-semibold tracking-tight text-ink-3">so'm</span>
        </div>
        <p className="mt-3 text-[14px] text-ink-2">
          {debts.open_count} ta mijoz · eng uzog'i {Math.max(0, ...open.map((d) => d.days_open))} kun
        </p>
      </section>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">Qarzdorlar</h3>
        <div className="flex rounded-xl border border-line bg-surface p-0.5 text-[13px] font-medium">
          {(["amount", "age"] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`rounded-[10px] px-3 py-1.5 transition ${sort === k ? "bg-btn text-btn-ink" : "text-ink-2"}`}
            >
              {k === "amount" ? "Summa" : "Muddat"}
            </button>
          ))}
        </div>
      </div>

      <div className="card divide-y divide-line lg:grid lg:grid-cols-2 lg:divide-y-0">
        {open.map((d) => {
          const c = consent(d);
          return (
            <div key={d.id} className="flex items-center gap-3.5 px-4 py-4 lg:border-b lg:border-line lg:odd:border-r">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-bold text-ink-2">
                {d.person_name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15.5px] font-semibold">{d.person_name}</span>
                  <span className={`num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ageTone(d.days_open)}`}>
                    {d.days_open} kun
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                  {d.phone && <span className="num">{d.phone}</span>}
                  <Badge tone={c.tone}>{c.text}</Badge>
                  {sent[d.id] && (
                    <Badge tone="pos">
                      <IconCheck size={12} className="mr-0.5" /> yuborildi
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="num text-[16px] font-bold">{money(d.remaining)}</div>
                <button
                  onClick={() => openPreview(d)}
                  disabled={busy === d.id}
                  className="flex h-8 items-center gap-1.5 rounded-xl border border-line px-3 text-[13px] font-semibold text-ink transition active:scale-95 disabled:opacity-50"
                >
                  <IconBell size={14} /> Eslatish
                </button>
              </div>
            </div>
          );
        })}
        {open.length === 0 && <div className="px-4 py-10 text-center text-ink-2">Hozir sizga hech kim qarz emas</div>}
      </div>

      {closed.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowClosed((v) => !v)} className="text-[13.5px] font-medium text-ink-2">
            {showClosed ? "Yopilganlarni yashirish" : `Yopilgan qarzlar (${closed.length})`}
          </button>
          {showClosed && (
            <div className="card mt-3 divide-y divide-line">
              {closed.map((d) => (
                <div key={d.id} className="flex items-center justify-between px-4 py-3 text-[14px] text-ink-2">
                  <span>{d.person_name}</span>
                  <span className="num">
                    {money(d.amount)} · <span className="text-pos">qaytdi</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Sheet open={!!preview} onClose={() => setPreview(null)} title="SMS eslatma">
        {preview && (
          <>
            <div className="mb-2 flex items-center justify-between text-[13px] text-ink-3">
              <span>
                Kimga: <span className="font-semibold text-ink">{preview.debt.person_name}</span>
                {preview.debt.phone ? <span className="num"> · {preview.debt.phone}</span> : null}
              </span>
              {preview.demo && <Badge>demo</Badge>}
            </div>
            <div className="mb-4 rounded-2xl rounded-tl-md bg-surface-2 p-4 text-[15px] leading-relaxed">{preview.text}</div>
            {!preview.debt.sms_consent && (
              <p className="mb-4 text-[13px] text-ink-2">
                Mijozdan SMS roziligi olinmagan — matnni nusxalab, o'zingiz yuborishingiz mumkin.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Bekor
              </Button>
              <Button onClick={send} loading={busy === "send"}>
                Yuborish
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
