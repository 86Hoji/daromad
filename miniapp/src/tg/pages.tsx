// Экраны Mini App: Bosh, Qarzlar (+ карточка должника с BackButton), Hisobot.
import { BRAND } from "../lib/brand";
import { BellRing, ChevronLeft, Phone } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChartCard } from "../features/ChartCard";
import { DebtList, maskPhone } from "../features/Debts";
import { FreeMoney } from "../features/FreeMoney";
import { NextSteps } from "../features/NextSteps";
import { useReminder } from "../features/Reminder";
import { AuditList, CategoryBars, Totals, TrustScale } from "../features/Report";
import { useReport } from "../hooks/useData";
import { useTgBackButton } from "../hooks/useTelegram";
import { useLive } from "../lib/live";
import { ddmm, money } from "../lib/format";
import { inTelegram } from "../lib/telegram";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Rise } from "../ui/Rise";
import { Button } from "../ui/Button";
import { Chip, ErrorState, LiveDot, Segmented, Skeleton } from "../ui/bits";

function Header({ title }: { title?: string }) {
  const { summary, updatedAt, error } = useLive();
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="truncate text-[17px] font-semibold">{title ?? summary?.shop.name ?? BRAND}</h1>
      <LiveDot at={updatedAt} error={error} />
    </div>
  );
}

/** Плоский слой с каскадным появлением (без стекла и backdrop-filter). */
function Block({ children, className = "", i = 0 }: { children: React.ReactNode; className?: string; i?: number }) {
  return (
    <Rise as="section" i={i} className={`layer p-4 ${className}`}>
      {children}
    </Rise>
  );
}

export function TgHome() {
  const { summary, forecast, rec, error, refresh } = useLive();
  if (!summary || !forecast || !rec)
    return (
      <>
        <Header />
        {error ? (
          <ErrorState text={error} onRetry={refresh} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-14 w-60" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="mt-4 h-56 rounded-panel" />
            <Skeleton className="h-40 rounded-panel" />
          </div>
        )}
      </>
    );
  return (
    <>
      <Header />
      <Rise className="px-1 pb-5">
        <FreeMoney summary={summary} rec={rec} today={forecast.today} size="tg" roll />
      </Rise>
      <Rise i={1}>
        <ChartCard forecast={forecast} compact animate />
      </Rise>
      <Block className="mt-3" i={2}>
        <NextSteps rec={rec} forecast={forecast} variant="tg" />
      </Block>
    </>
  );
}

export function TgDebts() {
  const { debts, error, refresh } = useLive();
  const nav = useNavigate();
  if (!debts)
    return (
      <>
        <Header title="Qarzlar" />
        {error ? <ErrorState text={error} onRetry={refresh} /> : <Skeleton className="h-72 rounded-panel" />}
      </>
    );
  const oldest = Math.max(0, ...debts.debts.filter((d) => d.status === "open").map((d) => d.days_open));
  return (
    <>
      <Header title="Qarzlar" />
      <div className="px-1 pb-4">
        <div className="text-[14px] text-ink-2">Sizga qarz</div>
        <div className="mt-1 flex items-baseline gap-2">
          <AnimatedNumber value={debts.total_receivable} roll className="display text-[40px] leading-none font-bold text-warn-text" />
          <span className="text-[15px] text-ink-3">so'm</span>
        </div>
        <p className="mt-2 text-[14px] text-ink-3">
          {debts.open_count} ta mijoz · eng uzog'i {oldest} kun
        </p>
      </div>
      <Block className="py-1" i={1}>
        <DebtList debts={debts.debts} onOpen={(d) => nav(`/tg/qarzlar/${d.id}`)} />
      </Block>
    </>
  );
}

export function TgDebtDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { debts } = useLive();
  const reminder = useReminder();
  useTgBackButton(() => nav("/tg/qarzlar"));
  const d = debts?.debts.find((x) => String(x.id) === id);

  return (
    <>
      {!inTelegram && (
        <button onClick={() => nav("/tg/qarzlar")} className="mb-3 -ml-2 flex h-10 items-center gap-1 rounded-el px-2 text-[15px] text-brand-text">
          <ChevronLeft size={20} /> Qarzlar
        </button>
      )}
      {!d ? (
        <Skeleton className="h-60 rounded-panel" />
      ) : (
        <>
          <div className="px-1 pb-5">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-[18px] font-semibold text-ink-2">{d.person_name[0]?.toUpperCase()}</span>
              <div>
                <h1 className="text-[20px] font-semibold">{d.person_name}</h1>
                <div className="text-[14px] text-ink-3">qarzga oldi · {d.created_at ? ddmm(d.created_at) : ""}</div>
              </div>
            </div>
            <div className="display mt-5 text-[40px] leading-none font-bold">{money(d.remaining)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={d.days_open > 14 ? "warn" : "neutral"}>{d.days_open} kun</Chip>
              {d.phone ? <Chip tone={d.sms_consent ? "pos" : "neutral"}>{d.sms_consent ? "SMS roziligi bor" : "Rozilik yo'q"}</Chip> : <Chip>Telefon yo'q</Chip>}
              {reminder.sent[d.id] && <Chip tone="brand">eslatildi</Chip>}
            </div>
          </div>
          <Block>
            <dl className="divide-y divide-line text-[15px]">
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">Berilgan</dt>
                <dd className="num">{money(d.amount)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">Qoldi</dt>
                <dd className="num font-semibold">{money(d.remaining)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">Telefon</dt>
                <dd className="num flex items-center gap-1.5">
                  <Phone size={14} strokeWidth={1.75} className="text-ink-3" />
                  {maskPhone(d.phone) ?? "—"}
                </dd>
              </div>
            </dl>
          </Block>
          <Button size="lg" className="mt-4 w-full" icon={<BellRing size={18} strokeWidth={1.75} />} loading={reminder.busyId === d.id} onClick={() => reminder.open(d)}>
            Eslatma tayyorlash
          </Button>
        </>
      )}
    </>
  );
}

export function TgReport() {
  const { summary } = useLive();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const { entries, audit, error } = useReport(period, 20);
  return (
    <>
      <Header title="Hisobot" />
      <div className="mb-4 flex items-center justify-between">
        <span className="num text-[14px] text-ink-3">{entries ? `${ddmm(entries.from)} — ${ddmm(entries.to)}` : ""}</span>
        <Segmented
          label="Davr"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "week", label: "Hafta" },
            { value: "month", label: "Oy" },
          ]}
        />
      </div>
      {!entries || !summary ? (
        error ? (
          <ErrorState text={error} />
        ) : (
          <Skeleton className="h-80 rounded-panel" />
        )
      ) : (
        <div className="space-y-3">
          <Block>
            <Totals entries={entries} dense />
          </Block>
          <Block i={1}>
            <h2 className="mb-4 text-[16px] font-semibold">Xarajatlar</h2>
            <CategoryBars data={entries.by_category.expense} />
          </Block>
          <Block i={2}>
            <h2 className="mb-4 text-[16px] font-semibold">Ma'lumot ishonchliligi</h2>
            <TrustScale share={summary.trust_share} />
          </Block>
          <Block i={3}>
            <h2 className="mb-1 text-[16px] font-semibold">Jurnal</h2>
            {audit && <AuditList items={audit} limit={8} />}
          </Block>
        </div>
      )}
    </>
  );
}
