// Экраны Mini App: Главная, Долги (+ карточка должника), Отчёты.
import { BellRing, Phone, PieChart, ScanLine } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChartCard } from "../features/ChartCard";
import { NudgeBanner } from "../features/DataQuality";
import { DebtList, maskPhone } from "../features/Debts";
import { FreeMoney } from "../features/FreeMoney";
import { NextSteps } from "../features/NextSteps";
import { useReminder } from "../features/Reminder";
import { CategoryBars, Totals, TrustScale } from "../features/Report";
import { useReport } from "../hooks/useData";
import { currency, daysShort, ddmm, money, moneyShort, ruPlural } from "../lib/format";
import { pick, t } from "../lib/i18n";
import { useLive } from "../lib/live";
import { haptic } from "../lib/telegram";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button } from "../ui/Button";
import { Rise } from "../ui/Rise";
import { Chip, ErrorState, Segmented, Skeleton } from "../ui/bits";
import { openAdd } from "./AddFlow";
import { tx } from "./i18n.tg";
import { Block, Header } from "./ui";
import { usePeriod } from "./usePeriod";

const clients = (n: number) => pick({ uz: `${n} ta mijoz`, ru: `${n} ${ruPlural(n, ["клиент", "клиента", "клиентов"])}`, en: `${n} ${n === 1 ? "customer" : "customers"}` });

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        haptic("light");
        onClick();
      }}
      className="layer flex min-h-[76px] flex-col items-center justify-center gap-1.5 px-1.5 py-2.5 text-center text-[13px] leading-tight font-medium active:scale-[0.97]"
    >
      {icon}
      {label}
    </button>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number | null; sub?: string; tone?: "neg" | "warn" }) {
  const color = tone === "neg" ? "text-neg-text" : tone === "warn" ? "text-warn-text" : "text-ink";
  return (
    <div className="layer flex min-h-[92px] flex-col justify-between p-3.5">
      <span className="text-[13px] text-ink-2">{label}</span>
      {value === null ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <span className={`display text-[22px] leading-tight font-bold tabular-nums ${color}`}>{moneyShort(value)}</span>
      )}
      <span className="truncate text-[12.5px] text-ink-3">{sub ?? currency()}</span>
    </div>
  );
}

export function TgHome() {
  const { summary, forecast, rec, debts, error, refresh } = useLive();
  const nav = useNavigate();
  const [days, setDays] = useState<7 | 30>(7);
  const { data: period } = usePeriod(days);

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
            <Skeleton className="mt-4 h-24 rounded-panel" />
            <Skeleton className="h-56 rounded-panel" />
          </div>
        )}
      </>
    );

  return (
    <>
      <Header />
      {summary.nudge_date && (
        <div className="mb-4">
          <NudgeBanner date={summary.nudge_date} compact />
        </div>
      )}
      <Rise className="px-1 pb-4">
        <FreeMoney summary={summary} rec={rec} today={forecast.today} size="tg" roll />
      </Rise>

      <Rise i={1} className="mb-5 grid grid-cols-3 gap-2.5">
        <QuickAction icon={<ScanLine size={20} strokeWidth={1.8} />} label={tx("qaScan")} onClick={() => openAdd("scan")} />
        <QuickAction icon={<BellRing size={20} strokeWidth={1.8} />} label={tx("qaRemind")} onClick={() => nav("/tg/qarzlar")} />
        <QuickAction icon={<PieChart size={20} strokeWidth={1.8} />} label={tx("qaReport")} onClick={() => nav("/tg/hisobot")} />
      </Rise>

      <Rise i={2} as="section" className="mb-3">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">{tx("kpiTitle")}</h2>
          <Segmented
            label={tx("kpiTitle")}
            value={days === 7 ? "7" : "30"}
            onChange={(v) => setDays(v === "7" ? 7 : 30)}
            options={[
              { value: "7", label: tx("days7") },
              { value: "30", label: tx("days30") },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Kpi label={tx("kpiSales")} value={period?.sales ?? null} />
          <Kpi label={tx("kpiExpenses")} value={period?.expenses ?? null} />
          <Kpi label={tx("kpiProfit")} value={period?.profit ?? null} tone={period && period.profit < 0 ? "neg" : undefined} />
          <Kpi label={tx("kpiOwed")} value={summary.total_receivable} sub={debts ? clients(debts.open_count) : undefined} tone="warn" />
        </div>
      </Rise>

      <Rise i={3}>
        <ChartCard forecast={forecast} compact animate />
      </Rise>
      <Block className="mt-3" i={4}>
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
        <Header title={tx("navDebts")} />
        {error ? <ErrorState text={error} onRetry={refresh} /> : <Skeleton className="h-72 rounded-panel" />}
      </>
    );
  const oldest = Math.max(0, ...debts.debts.filter((d) => d.status === "open").map((d) => d.days_open));
  return (
    <>
      <Header title={tx("navDebts")} />
      <div className="px-1 pb-4">
        <div className="text-[14px] text-ink-2">{t("Sizga qarz")}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <AnimatedNumber value={debts.total_receivable} roll className="display text-[40px] leading-none font-bold text-warn-text" />
          <span className="text-[15px] text-ink-3">{currency()}</span>
        </div>
        <p className="mt-2 text-[14px] text-ink-3">
          {clients(debts.open_count)} · {t("eng uzog'i {n}", { n: daysShort(oldest) })}
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
  const { debts } = useLive();
  const reminder = useReminder();
  const d = debts?.debts.find((x) => String(x.id) === id);

  return (
    <>
      <Header title={d?.person_name ?? tx("navDebts")} back="/tg/qarzlar" />
      {!d ? (
        <Skeleton className="h-60 rounded-panel" />
      ) : (
        <>
          <div className="px-1 pb-5">
            <div className="text-[14px] text-ink-3">
              {t("qarzga oldi")} · {d.created_at ? ddmm(d.created_at) : ""}
            </div>
            <div className="display mt-3 text-[40px] leading-none font-bold">{money(d.remaining)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={d.days_open > 14 ? "warn" : "neutral"}>{daysShort(d.days_open)}</Chip>
              {d.phone ? <Chip tone={d.sms_consent ? "pos" : "neutral"}>{d.sms_consent ? t("SMS roziligi bor") : t("Rozilik yo'q")}</Chip> : <Chip>{t("Telefon yo'q")}</Chip>}
              {reminder.sent[d.id] && <Chip tone="brand">{t("eslatildi")}</Chip>}
            </div>
          </div>
          <Block>
            <dl className="divide-y divide-line text-[15px]">
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">{t("Berilgan")}</dt>
                <dd className="num">{money(d.amount)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">{t("Qoldi")}</dt>
                <dd className="num font-semibold">{money(d.remaining)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">{t("Telefon")}</dt>
                <dd className="num flex items-center gap-1.5">
                  <Phone size={14} strokeWidth={1.75} className="text-ink-3" />
                  {maskPhone(d.phone) ?? "—"}
                </dd>
              </div>
            </dl>
          </Block>
          {d.status === "open" && (
            <Button size="lg" className="mt-4 w-full" icon={<BellRing size={18} strokeWidth={1.75} />} loading={reminder.busyId === d.id} onClick={() => reminder.open(d)}>
              {t("Eslatma tayyorlash")}
            </Button>
          )}
        </>
      )}
    </>
  );
}

export function TgReport() {
  const { summary } = useLive();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const { entries, error } = useReport(period, 1);
  return (
    <>
      <Header title={tx("mReports")} back="/tg/yana" />
      <div className="mb-4 flex items-center justify-between">
        <span className="num text-[14px] text-ink-3">{entries ? `${ddmm(entries.from)} — ${ddmm(entries.to)}` : ""}</span>
        <Segmented
          label={t("Davr")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "week", label: t("Hafta") },
            { value: "month", label: t("Oy") },
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
            <h2 className="mb-4 text-[16px] font-semibold">{t("Xarajatlar")}</h2>
            <CategoryBars data={entries.by_category.expense} />
          </Block>
          <Block i={2}>
            <h2 className="mb-4 text-[16px] font-semibold">{t("Ma'lumot ishonchliligi")}</h2>
            <TrustScale share={summary.trust_share} />
          </Block>
        </div>
      )}
    </>
  );
}
