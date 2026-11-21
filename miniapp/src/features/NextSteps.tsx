// «Keyingi qadam» из /api/recommendation:
// нехватка -> 1) напомнить должникам, 2) овердрафт, если долгов не хватит; излишек -> вклад.
import { BellRing, ChevronRight, Landmark, ShieldCheck, Sprout } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type Deposit, type Forecast, type Overdraft, type Recommendation } from "../lib/api";
import { useLive } from "../lib/live";
import { capitalize, ddmm, money, moneyShort, untilLabel } from "../lib/format";
import { haptic } from "../lib/telegram";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";
import { useReminder } from "./Reminder";

type Offer = Overdraft | Deposit;

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function StepNo({ n, tone }: { n: number; tone: "warn" | "brand" | "pos" }) {
  const cls = tone === "warn" ? "bg-warn-soft text-warn-text" : tone === "pos" ? "bg-pos-soft text-pos-text" : "bg-brand-soft text-brand-text";
  return <span className={`display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${cls}`}>{n}</span>;
}

function Step({ n, tone, icon, title, children, last }: { n: number; tone: "warn" | "brand" | "pos"; icon: ReactNode; title: string; children?: ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <StepNo n={n} tone={tone} />
        {!last && <span className="mt-2 w-px flex-1 bg-line" aria-hidden />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-6"}`}>
        <h3 className="flex items-center gap-2 pt-1 text-[16px] font-semibold">
          <span className="text-ink-3" aria-hidden>
            {icon}
          </span>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export function useOfferFlow() {
  const { refresh } = useLive();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      const r = await api.acceptOffer(offer.type, offer.amount, offer.term_days);
      haptic("success");
      toast(`${r.bank}: ${offer.type === "overdraft" ? "overdraft" : "omonat"} rasmiylashtirildi`, "pos");
      setOffer(null);
      await refresh();
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiError ? e.message : "Xatolik", "neg");
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    if (!offer) return;
    const o = offer;
    setOffer(null);
    try {
      await api.declineOffer(o.type, o.amount, o.term_days);
      toast("Taklif rad etildi");
    } catch {
      /* отказ — не критично */
    }
  };
  return { offer, setOffer, busy, accept, decline };
}

export function NextSteps({ rec, forecast, variant = "app" }: { rec: Recommendation; forecast: Forecast | null; variant?: "app" | "tg" }) {
  const nav = useNavigate();
  const reminder = useReminder();
  const flow = useOfferFlow();
  const today = forecast?.today ?? rec.horizon;
  const activeOverdraft = forecast?.events.find((e) => e.type === "overdraft_repay");
  const tg = variant === "tg";

  let body: ReactNode;
  if (rec.kind === "shortage") {
    const od = rec.overdraft;
    // топ-3 по сумме; debtors_to_remind — минимальный набор под нехватку, он идёт первым
    const seen = new Set<number>();
    const top = [...rec.debtors_to_remind, ...rec.top_debtors].filter((d) => !seen.has(d.id) && seen.add(d.id)).slice(0, 3);
    body = (
      <>
        <Step n={1} tone="warn" icon={<BellRing size={18} strokeWidth={1.75} />} title="Qarzdorlarga eslating">
          <p className="mt-1 text-[14.5px] text-ink-2">
            {rec.covers_by_debts ? `Qaytsa, ${moneyShort(rec.gap)} kamomad yopiladi.` : `Qarzlar kamomadning bir qismini yopadi.`}
          </p>
          {tg ? (
            <button
              onClick={() => nav("/tg/qarzlar")}
              className="mt-3 flex w-full items-center justify-between rounded-el bg-surface-2 px-4 py-3 text-left active:bg-surface-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{top.map((d) => d.person_name).join(", ")}</span>
                <span className="num text-[13px] text-ink-3">{moneyShort(top.reduce((s, d) => s + d.remaining, 0))} · eng uzog'i {Math.max(...top.map((d) => d.days_open))} kun</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-3" />
            </button>
          ) : (
            <ul className="mt-3 space-y-1">
              {top.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-el py-1">
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium">{d.person_name}</span>
                    <span className={`num shrink-0 text-[13px] ${d.days_open > 14 ? "text-warn-text" : "text-ink-3"}`}>{d.days_open} kun</span>
                  </span>
                  <span className="num text-[15px] font-semibold">{moneyShort(d.remaining)}</span>
                  <Button
                    size="sm"
                    variant={reminder.sent[d.id] ? "quiet" : "secondary"}
                    loading={reminder.busyId === d.id}
                    onClick={() => reminder.open(d)}
                  >
                    {reminder.sent[d.id] ? "Yuborildi" : "Eslatish"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Step>
        <Step n={2} tone="brand" icon={<Landmark size={18} strokeWidth={1.75} />} title={rec.covers_by_debts ? "Qaytmasa — overdraft" : "Yetmasa — overdraft"} last>
          <p className="num mt-1 text-[14.5px] text-ink-2">
            {money(od.amount)} · {od.term_days} kun · ortiqcha {money(od.cost)}
          </p>
          {tg ? (
            <button
              onClick={() => flow.setOffer(od)}
              disabled={!!activeOverdraft}
              className="mt-3 flex w-full items-center justify-between rounded-el bg-surface-2 px-4 py-3 text-left text-[15px] font-medium active:bg-surface-3 disabled:opacity-50"
            >
              Shartlarni ko'rish
              <ChevronRight size={18} className="text-ink-3" />
            </button>
          ) : (
            <Button className="mt-3" variant="primary" onClick={() => flow.setOffer(od)} disabled={!!activeOverdraft}>
              Shartlarni ko'rish
            </Button>
          )}
        </Step>
      </>
    );
  } else if (rec.kind === "surplus") {
    const dep = rec.deposit;
    body = (
      <Step n={1} tone="pos" icon={<Sprout size={18} strokeWidth={1.75} />} title="Bo'sh pul ishlasin — omonat" last>
        <p className="num mt-1 text-[14.5px] text-ink-2">
          {money(dep.amount)} · {dep.term_days} kun · daromad <span className="text-pos-text">+{money(dep.income)}</span>
        </p>
        <Button className="mt-3" onClick={() => flow.setOffer(dep)}>
          Shartlarni ko'rish
        </Button>
      </Step>
    );
  } else {
    body = (
      <div className="flex items-start gap-3 rounded-el bg-pos-soft p-4 text-pos-text">
        <ShieldCheck size={22} strokeWidth={1.75} className="shrink-0" />
        <div>
          <div className="text-[16px] font-semibold">Hammasi joyida</div>
          <div className="mt-0.5 text-[14.5px]">
            {capitalize(untilLabel(rec.horizon, today))} pul yetadi
            {activeOverdraft ? `. Overdraft ${ddmm(activeOverdraft.date)} da qaytariladi.` : "."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="next-steps">
      <h2 id="next-steps" className="mb-4 text-[18px] font-semibold tracking-tight">
        Keyingi qadam
      </h2>
      {body}
      <OfferSheet offer={flow.offer} today={today} busy={flow.busy} onAccept={flow.accept} onDecline={flow.decline} onClose={() => flow.setOffer(null)} />
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className={`num text-right ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

export function OfferSheet({
  offer,
  today,
  busy,
  onAccept,
  onDecline,
  onClose,
}: {
  offer: Offer | null;
  today: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  const end = offer ? addDays(today, offer.term_days) : today;
  const isOd = offer?.type === "overdraft";
  return (
    <Sheet
      open={!!offer}
      onClose={onClose}
      title={offer?.name}
      primary={{ label: "Tasdiqlayman", onClick: onAccept, loading: busy }}
      secondary={{ label: "Bekor", onClick: onDecline, disabled: busy }}
      footnote="Demo: bank bilan haqiqiy integratsiya keyingi bosqichda"
    >
      {offer && (
        <>
          <div className="text-[14px] text-ink-3">{isOd ? "Hisobingizga tushadi" : "Omonatga o'tadi"}</div>
          <div className="display mt-1 mb-4 text-[34px] font-bold">{money(offer.amount)}</div>
          <div className="divide-y divide-line">
            <Row label="Muddat" value={`${offer.term_days} kun · ${ddmm(end)} gacha`} />
            <Row label="Yillik stavka" value={`${Math.round(offer.annual_rate * 100)}%`} />
            {offer.type === "overdraft" ? (
              <>
                <Row label="Ortiqcha to'lov" value={money(offer.cost)} />
                <Row label={`${ddmm(end)} da qaytarasiz`} value={money(offer.amount + offer.cost)} strong />
              </>
            ) : (
              <>
                <Row label="Daromad" value={<span className="text-pos-text">+{money(offer.income)}</span>} />
                <Row label={`${ddmm(end)} da qaytadi`} value={money(offer.amount + offer.income)} strong />
              </>
            )}
          </div>
          <p className={`mt-4 rounded-el p-4 text-[14px] leading-relaxed ${isOd ? "bg-neg-soft text-neg-text" : "bg-surface-2 text-ink-2"}`}>
            {offer.type === "overdraft" ? offer.risk_text : offer.early_withdrawal}
          </p>
        </>
      )}
    </Sheet>
  );
}
