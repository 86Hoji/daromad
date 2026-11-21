// Экраны дашборда /app: Bosh, Qarzlar, Hisobot, Jurnal.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChartCard } from "../features/ChartCard";
import { DebtList, DebtTable } from "../features/Debts";
import { LiveFeed } from "../features/Feed";
import { Formula, FreeMoney } from "../features/FreeMoney";
import { NextSteps } from "../features/NextSteps";
import { AuditList, CategoryBars, Totals, TrustScale } from "../features/Report";
import { useFeed, useReport } from "../hooks/useData";
import { useLive } from "../lib/live";
import { ddmm, money } from "../lib/format";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { ErrorState, Segmented, Skeleton } from "../ui/bits";

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
    <Link to="/app/hisobot" className="mt-auto flex items-center gap-4 rounded-el bg-surface/70 px-4 py-3 transition hover:bg-surface">
      <span className="flex h-2 w-28 shrink-0 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        <span className="rounded-full bg-pos" style={{ width: `${ok}%` }} />
        {shot > 0 && <span className="rounded-full bg-brand" style={{ width: `${shot}%` }} />}
        <span className="flex-1 rounded-full bg-surface-3" />
      </span>
      <span className="text-[14px] text-ink-2">
        <span className="num font-semibold text-ink">{ok}%</span> ma'lumot bank orqali tasdiqlangan · AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz
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
      {/* цифра — прямо на фоне, без панели: она главная */}
      <section className="flex flex-col gap-9 py-2 xl:pr-4" aria-label="Bo'sh pul">
        <FreeMoney summary={summary} rec={rec} today={today} />
        <Formula summary={summary} />
        <TrustLine share={summary.trust_share} />
      </section>

      <div className="panel p-6 xl:p-7">
        <NextSteps rec={rec} forecast={forecast} />
      </div>

      <div className="xl:col-span-2">
        <ChartCard forecast={forecast} />
      </div>

      <section className="panel p-6 xl:p-7" aria-labelledby="feed-title">
        <PanelTitle right={<span className="text-[13px] text-ink-3">yangilari tepada</span>}>
          <span id="feed-title">Jonli lenta</span>
        </PanelTitle>
        <LiveFeed items={feed.items} fresh={feed.fresh} today={today} limit={6} />
      </section>

      <section className="panel p-6 xl:p-7" aria-labelledby="debts-title">
        <PanelTitle
          right={
            <Link to="/app/qarzlar" className="rounded-md text-[14px] font-medium text-brand-text hover:underline">
              Barchasi
            </Link>
          }
        >
          <span id="debts-title">Qarzlar</span>
        </PanelTitle>
        <div className="mb-2 flex items-baseline gap-2">
          <AnimatedNumber value={summary.total_receivable} className="display text-[30px] font-semibold text-warn-text" />
          <span className="text-[14px] text-ink-3">so'm · {debts?.open_count ?? summary.top_debtors.length} ta mijoz</span>
        </div>
        {debts ? <DebtList debts={debts.debts} limit={5} /> : <Skeleton className="h-40" />}
      </section>
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
      <PageTitle title="Qarzlar" sub={`${debts.open_count} ta mijoz · eng uzog'i ${oldest} kun`} />
      <div className="mb-6 flex items-baseline gap-3">
        <AnimatedNumber value={debts.total_receivable} className="display text-[48px] leading-none font-bold text-warn-text xl:text-[64px]" />
        <span className="text-[18px] text-ink-3">so'm sizga qarz</span>
      </div>
      <section className="panel p-4 sm:p-6">
        <DebtTable debts={debts.debts} />
      </section>
      {closed.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowClosed((v) => !v)} className="rounded-md text-[15px] font-medium text-ink-2 hover:text-ink" aria-expanded={showClosed}>
            {showClosed ? "Yopilganlarni yashirish" : `Yopilgan qarzlar (${closed.length})`}
          </button>
          {showClosed && (
            <ul className="panel mt-3 divide-y divide-line px-6">
              {closed.map((d) => (
                <li key={d.id} className="flex justify-between py-3 text-[15px] text-ink-2">
                  <span>{d.person_name}</span>
                  <span className="num">
                    {money(d.amount)} · <span className="text-pos-text">qaytdi</span>
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
        title="Hisobot"
        sub={entries ? `${ddmm(entries.from)} — ${ddmm(entries.to)}` : undefined}
        right={
          <Segmented
            label="Davr"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "week", label: "Hafta" },
              { value: "month", label: "Oy" },
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
          <section className="panel p-6 xl:col-span-2 xl:p-7">
            <Totals entries={entries} />
          </section>
          <section className="panel p-6 xl:p-7">
            <PanelTitle>Xarajatlar toifalar bo'yicha</PanelTitle>
            <CategoryBars data={entries.by_category.expense} />
          </section>
          <section className="panel p-6 xl:p-7">
            <PanelTitle>Ma'lumot ishonchliligi</PanelTitle>
            <TrustScale share={summary.trust_share} />
            <p className="mt-5 text-[14px] text-ink-3">AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz. Bank orqali o'tgan yozuvlar — tasdiqlangan.</p>
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
        title="Jurnal"
        sub="Har bir harakat: kim, qachon, nima"
        right={
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-ink-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />
            AI va bekor qilinganlarni ko'rsatish
          </label>
        }
      />
      <section className="panel max-w-[820px] p-6 xl:p-7">
        {audit ? <AuditList items={audit} showService={all} /> : error ? <ErrorState text={error} /> : <Skeleton className="h-80" />}
      </section>
    </>
  );
}
