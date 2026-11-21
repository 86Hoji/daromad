// Рекомендация из /api/recommendation: нехватка -> 1) напомнить должникам, 2) овердрафт; излишек -> вклад.
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type Deposit, type Forecast, type Overdraft, type Recommendation } from "../lib/api";
import { useLive } from "../lib/live";
import { capitalize, ddmm, money, untilLabel } from "../lib/format";
import { haptic } from "../lib/telegram";
import { IconArrowRight, IconBank, IconBell, IconShield, IconTrend } from "./icons";
import { Button, Row, Sheet, toast } from "./ui";

type Offer = Overdraft | Deposit;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function Step({ n, icon, title, children, tone, last }: { n: number; icon: ReactNode; title: string; children: ReactNode; tone?: "neg"; last?: boolean }) {
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
            tone === "neg" ? "bg-neg-soft text-neg" : "bg-surface-2 text-ink border border-line"
          }`}
        >
          {n}
        </div>
        {!last && <div className="mt-2 w-px flex-1 bg-line" />}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-6"}`}>
        <div className="mb-1.5 flex items-center gap-2 text-[15px] font-semibold">
          <span className="text-ink-2">{icon}</span>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

export function NextSteps({ rec, forecast }: { rec: Recommendation; forecast: Forecast | null }) {
  const nav = useNavigate();
  const { refresh } = useLive();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const today = forecast?.today ?? rec.horizon;
  const activeOverdraft = forecast?.events.find((e) => e.type === "overdraft_repay");

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

  let body: ReactNode;
  if (rec.kind === "shortage") {
    const od = rec.overdraft;
    body = (
      <div>
        <Step n={1} icon={<IconBell size={18} />} title="Qarzdorlarga eslating" tone="neg">
          <p className="mb-3 text-[14px] leading-relaxed text-ink-2">
            {rec.covers_by_debts
              ? `Qarzlar ${money(rec.gap)} yetishmovchilikni yopadi. Eng avval:`
              : `Qarzlar to'liq yopmaydi, lekin yordam beradi. Eng avval:`}
          </p>
          <div className="mb-3 divide-y divide-line rounded-2xl border border-line">
            {rec.debtors_to_remind.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-3.5 py-2.5 text-[14px]">
                <span className="font-medium">{d.person_name}</span>
                <span className="num text-ink-2">
                  {money(d.remaining)} · <span className={d.days_open > 14 ? "text-neg" : ""}>{d.days_open} kun</span>
                </span>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="h-11 w-full" onClick={() => nav("/qarzlar")}>
            Qarzlarga o'tish <IconArrowRight size={18} />
          </Button>
        </Step>
        <Step n={2} icon={<IconBank size={18} />} title="Agar qaytarishmasa — overdraft" last>
          <div className="mb-3 grid grid-cols-3 gap-2 text-[13px]">
            <Fact label="Summa" value={money(od.amount)} />
            <Fact label="Muddat" value={`${od.term_days} kun`} />
            <Fact label="Ortiqcha" value={money(od.cost)} />
          </div>
          <Button className="h-11 w-full" onClick={() => setOffer(od)} disabled={!!activeOverdraft}>
            Overdraft shartlari
          </Button>
        </Step>
      </div>
    );
  } else if (rec.kind === "surplus") {
    const dep = rec.deposit;
    body = (
      <div>
        <Step n={1} icon={<IconTrend size={18} />} title="Bo'sh pul ishlasin — omonat" last>
          <p className="mb-3 text-[14px] leading-relaxed text-ink-2">
            {capitalize(untilLabel(rec.horizon, today))} to'lovlardan keyin ham {money(rec.free_money)} qoladi.
          </p>
          <div className="mb-3 grid grid-cols-3 gap-2 text-[13px]">
            <Fact label="Summa" value={money(dep.amount)} />
            <Fact label="Muddat" value={`${dep.term_days} kun`} />
            <Fact label="Daromad" value={money(dep.income)} pos />
          </div>
          <Button className="h-11 w-full" onClick={() => setOffer(dep)}>
            Omonat shartlari
          </Button>
        </Step>
      </div>
    );
  } else {
    body = (
      <div className="flex items-start gap-3 rounded-2xl bg-pos-soft p-4 text-[14px] text-pos">
        <IconShield size={20} />
        <div>
          <div className="font-semibold">Hammasi joyida</div>
          <div className="mt-0.5 opacity-90">
            {capitalize(untilLabel(rec.horizon, today))} pul yetadi
            {activeOverdraft ? `. Overdraft ${ddmm(activeOverdraft.date)} da qaytariladi.` : "."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section>
      <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">Keyingi qadam</h3>
      {body}
      <OfferSheet offer={offer} today={today} busy={busy} onAccept={accept} onDecline={decline} onClose={() => setOffer(null)} />
    </section>
  );
}

function Fact({ label, value, pos }: { label: string; value: string; pos?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={`num mt-0.5 text-[13.5px] font-semibold ${pos ? "text-pos" : ""}`}>{value}</div>
    </div>
  );
}

function OfferSheet({
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
  if (!offer) return null;
  const end = addDays(today, offer.term_days);
  const isOd = offer.type === "overdraft";
  return (
    <Sheet open onClose={onClose} title={offer.name}>
      <div className="mb-1 text-[13px] text-ink-3">{isOd ? "Hisobingizga tushadi" : "Omonatga o'tadi"}</div>
      <div className="num mb-4 text-[34px] font-bold tracking-tight">{money(offer.amount)}</div>
      <div className="mb-4">
        <Row label="Muddat" value={`${offer.term_days} kun · ${ddmm(end)} gacha`} />
        <Row label="Yillik stavka" value={`${Math.round(offer.annual_rate * 100)}%`} />
        {offer.type === "overdraft" ? (
          <>
            <Row label="Ortiqcha to'lov" value={money(offer.cost)} />
            <Row label={`${ddmm(end)} da qaytarasiz`} value={money(offer.amount + offer.cost)} strong />
          </>
        ) : (
          <>
            <Row label="Daromad" value={<span className="text-pos">+{money(offer.income)}</span>} />
            <Row label={`${ddmm(end)} da qaytadi`} value={money(offer.amount + offer.income)} strong />
          </>
        )}
      </div>
      <div className={`mb-5 rounded-2xl p-3.5 text-[13px] leading-relaxed ${isOd ? "bg-neg-soft text-neg" : "bg-surface-2 text-ink-2"}`}>
        {offer.type === "overdraft" ? offer.risk_text : offer.early_withdrawal}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="ghost" onClick={onDecline} disabled={busy}>
          Bekor
        </Button>
        <Button onClick={onAccept} loading={busy}>
          Tasdiqlayman
        </Button>
      </div>
      <p className="mt-3 text-center text-[11px] text-ink-3">Demo: bank bilan haqiqiy integratsiya keyingi bosqichda</p>
    </Sheet>
  );
}
