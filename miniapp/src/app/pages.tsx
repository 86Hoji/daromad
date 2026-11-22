// Экраны дашборда /app: Bosh, Qarzlar, Hisobot, Jurnal.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard } from "../features/ChartCard";
import { DebtList, DebtTable } from "../features/Debts";
import { LiveFeed } from "../features/Feed";
import { Formula, FreeMoney } from "../features/FreeMoney";
import { NextSteps } from "../features/NextSteps";
import { NudgeBanner } from "../features/DataQuality";
import { RecurringButton } from "../features/Recurring";
import { AuditList, CategoryBars, Totals, TrustScale } from "../features/Report";
import { useFeed, useReport } from "../hooks/useData";
import { useLive } from "../lib/live";
import { currency, daysShort, ddmm, isConfirmed, money, ruPlural } from "../lib/format";

const clients = (n: number) => pick({ uz: `${n} ta mijoz`, ru: `${n} ${ruPlural(n, ["клиент", "клиента", "клиентов"])}`, en: `${n} ${n === 1 ? "customer" : "customers"}` });
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Chip, ErrorState, Segmented, Skeleton } from "../ui/bits";
import { Rise } from "../ui/Rise";
import { pick, t } from "../lib/i18n";

function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight xl:text-[30px]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-[18px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

/** Строка доверия под цифрой: сколько данных подтверждено банком. */
function TrustLine({ share }: { share: Record<string, number> }) {
  const ok = Math.round((share["tasdiqlangan"] ?? 0) * 100);
  const shot = Math.round((share["skrinshot"] ?? 0) * 100);
  return (
    <Link to="/app/hisobot" className="flex w-full min-w-0 items-center gap-4 rounded-el bg-surface-2/70 px-4 py-3 transition hover:bg-surface-2">
      <span className="flex h-2 w-28 shrink-0 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        <span className="rounded-full bg-ink" style={{ width: `${ok}%` }} />
        {shot > 0 && <span className="rounded-full bg-brand" style={{ width: `${shot}%` }} />}
        <span className="flex-1 rounded-full bg-surface-3" />
      </span>
      <span className="text-[14px] text-ink-2">
        <span className="num font-semibold text-ink">{ok}%</span> {t("ma'lumot bank orqali tasdiqlangan · AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz")}
      </span>
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4 py-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-24 w-[80%]" />
        <Skeleton className="h-5 w-[70%]" />
        <Skeleton className="mt-6 h-12 w-full" />
      </div>
      <Skeleton className="h-[300px] rounded-panel" />
      <Skeleton className="h-[440px] rounded-panel xl:col-span-2" />
    </div>
  );
}

export function AppHome() {
  const { summary, forecast, rec, debts, error, refresh } = useLive();
  const feed = useFeed(10);
  if (!summary || !forecast || !rec) return error ? <ErrorState text={error} onRetry={refresh} /> : <HomeSkeleton />;
  const today = forecast.today;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:gap-7">
      {summary.nudge_date && (
        <div className="xl:col-span-2">
          <NudgeBanner date={summary.nudge_date} />
        </div>
      )}
      <Rise i={0} as="section" className="glass lift-2 flex flex-col p-7 xl:p-8" >
        <h2 className="sr-only">{t("Bo'sh pul")}</h2>
        <FreeMoney summary={summary} rec={rec} today={today} roll />
        <div className="mt-8">
          <Formula summary={summary} />
        </div>
        <div className="mt-auto flex flex-col items-start gap-2 pt-8">
          <TrustLine share={summary.trust_share} />
          <RecurringButton />
        </div>
      </Rise>

      <Rise i={1} className="glass lift-2 p-6 xl:p-7">
        <NextSteps rec={rec} forecast={forecast} />
      </Rise>

      <Rise i={2} className="xl:col-span-2">
        <ChartCard forecast={forecast} animate />
      </Rise>

      <Rise i={3} as="section" id="feed-panel" className="glass lift-1 p-6 xl:p-7">
        <PanelTitle right={<span className="text-[13px] text-ink-3">{t("yangilari tepada")}</span>}>
          <span id="feed-title">{t("Jonli lenta")}</span>
        </PanelTitle>
        <LiveFeed items={feed.items} fresh={feed.fresh} today={today} limit={6} />
      </Rise>

      <Rise i={4} as="section" className="glass lift-1 p-6 xl:p-7">
        <PanelTitle
          right={
            <Link to="/app/qarzlar" className="rounded-md text-[14px] font-medium text-brand-text hover:underline">
              {t("Barchasi")}
            </Link>
          }
        >
          <span id="debts-title">{t("Qarzlar")}</span>
        </PanelTitle>
        <div className="mb-2 flex items-baseline gap-2">
          <AnimatedNumber value={summary.total_receivable} roll className="display text-[30px] font-semibold text-warn-text" />
          <span className="text-[14px] text-ink-3">{currency()} · {clients(debts?.open_count ?? summary.top_debtors.length)}</span>
        </div>
        {debts ? <DebtList debts={debts.debts} limit={5} /> : <Skeleton className="h-40" />}
      </Rise>
    </div>
  );
}

export function AppDebts() {
  const { debts, error, refresh } = useLive();
  const [showClosed, setShowClosed] = useState(false);
  if (!debts) return error ? <ErrorState text={error} onRetry={refresh} /> : <Skeleton className="h-96 rounded-panel" />;
  const open = debts.debts.filter((d) => d.status === "open");
  const closed = debts.debts.filter((d) => d.status === "closed");
  const oldest = Math.max(0, ...open.map((d) => d.days_open));
  return (
    <>
      <PageTitle title={t("Qarzlar")} sub={`${clients(debts.open_count)} · ${t("eng uzog'i {n}", { n: daysShort(oldest) })}`} />
      <div className="mb-6 flex items-baseline gap-3">
        <AnimatedNumber value={debts.total_receivable} className="display text-[48px] leading-none font-bold text-warn-text xl:text-[64px]" />
        <span className="text-[18px] text-ink-3">{currency()} · {t("sizga qarz")}</span>
      </div>
      <section className="glass p-4 sm:p-6">
        <DebtTable debts={debts.debts} />
      </section>
      {closed.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowClosed((v) => !v)} className="rounded-md text-[15px] font-medium text-ink-2 hover:text-ink" aria-expanded={showClosed}>
            {showClosed ? t("Yopilganlarni yashirish") : t("Yopilgan qarzlar ({n})", { n: closed.length })}
          </button>
          {showClosed && (
            <ul className="glass mt-3 divide-y divide-line px-6">
              {closed.map((d) => (
                <li key={d.id} className="flex justify-between py-3 text-[15px] text-ink-2">
                  <span>{d.person_name}</span>
                  <span className="num">
                    {money(d.amount)} · <span className="text-pos-text">{t("qaytdi")}</span>
                    {isConfirmed(d.close_source) && (
                      <Chip tone="pos" className="ml-2">
                        {d.close_source === "link" ? `${t("havola orqali")} · ` : ""}{t("tasdiqlangan")}
                      </Chip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export function AppReport() {
  const { summary } = useLive();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const { entries, error } = useReport(period, 1);
  return (
    <>
      <PageTitle
        title={t("Hisobot")}
        sub={entries ? `${ddmm(entries.from)} — ${ddmm(entries.to)}` : undefined}
        right={
          <Segmented
            label={t("Davr")}
            value={period}
            onChange={setPeriod}
            options={[
              { value: "week", label: t("Hafta") },
              { value: "month", label: t("Oy") },
            ]}
          />
        }
      />
      {!entries || !summary ? (
        error ? (
          <ErrorState text={error} />
        ) : (
          <Skeleton className="h-96 rounded-panel" />
        )
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="glass p-6 xl:col-span-2 xl:p-7">
            <Totals entries={entries} />
          </section>
          <section className="glass p-6 xl:p-7">
            <PanelTitle>{t("Xarajatlar toifalar bo'yicha")}</PanelTitle>
            <CategoryBars data={entries.by_category.expense} />
          </section>
          <section className="glass p-6 xl:p-7">
            <PanelTitle>{t("Ma'lumot ishonchliligi")}</PanelTitle>
            <TrustScale share={summary.trust_share} />
            <p className="mt-5 text-[14px] text-ink-3">{t("AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz. Bank orqali o'tgan yozuvlar — tasdiqlangan.")}</p>
          </section>
        </div>
      )}
    </>
  );
}

export function AppJournal() {
  const [all, setAll] = useState(false);
  const { audit, error } = useReport("week", 60);
  return (
    <>
      <PageTitle
        title={t("Jurnal")}
        sub={t("Har bir harakat: kim, qachon, nima")}
        right={
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            {t("AI va bekor qilinganlarni ko'rsatish")}
          </label>
        }
      />
      <section className="panel max-w-[820px] p-6 xl:p-7">
        {audit ? <AuditList items={audit} showService={all} /> : error ? <ErrorState text={error} /> : <Skeleton className="h-80" />}
      </section>
    </>
  );
}
