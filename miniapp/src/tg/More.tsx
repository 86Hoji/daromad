// «Ещё»: Отчёты, Регулярные платежи, Журнал, Настройки (язык, тема, «Пройти знакомство заново»).
import { ChevronRight, History, PieChart, Repeat, RotateCcw, Settings2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { RecurringSheet, useRecurring } from "../features/Recurring";
import { AuditList } from "../features/Report";
import { api, type AuditItem } from "../lib/api";
import { LANG_NAME, LANGS, t, useLang } from "../lib/i18n";
import { useLive } from "../lib/live";
import { haptic } from "../lib/telegram";
import { ErrorState, Skeleton, ThemeToggle } from "../ui/bits";
import { tx } from "./i18n.tg";
import { restartIntro } from "./Onboarding";
import { Block, Header } from "./ui";

function Item({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={() => {
        haptic("light");
        onClick();
      }}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left active:bg-surface-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-medium">{title}</span>
        <span className="block truncate text-[13.5px] text-ink-3">{hint}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />
    </button>
  );
}

export function TgMore() {
  const nav = useNavigate();
  const [recurring, setRecurring] = useState(false);
  const { items, load } = useRecurring();
  return (
    <>
      <Header title={tx("moreTitle")} />
      <div className="layer divide-y divide-line overflow-hidden p-0">
        <Item icon={<PieChart size={19} strokeWidth={1.8} />} title={tx("mReports")} hint={tx("mReportsHint")} onClick={() => nav("/tg/hisobot")} />
        <Item icon={<Repeat size={19} strokeWidth={1.8} />} title={tx("mRecurring")} hint={tx("mRecurringHint")} onClick={() => setRecurring(true)} />
        <Item icon={<History size={19} strokeWidth={1.8} />} title={tx("mJournal")} hint={tx("mJournalHint")} onClick={() => nav("/tg/jurnal")} />
        <Item icon={<Settings2 size={19} strokeWidth={1.8} />} title={tx("mSettings")} hint={tx("mSettingsHint")} onClick={() => nav("/tg/sozlamalar")} />
      </div>
      <RecurringSheet open={recurring} onClose={() => setRecurring(false)} items={items} reload={load} />
    </>
  );
}

export function TgJournal() {
  const { tick } = useLive();
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .audit(60)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [tick]);
  return (
    <>
      <Header title={tx("mJournal")} back="/tg/yana" />
      {items ? (
        <Block className="py-2">
          <AuditList items={items} limit={40} />
        </Block>
      ) : error ? (
        <ErrorState text={error} />
      ) : (
        <Skeleton className="h-80 rounded-panel" />
      )}
    </>
  );
}

export function TgSettings() {
  const { lang, setLang } = useLang();
  return (
    <>
      <Header title={tx("mSettings")} back="/tg/yana" />
      <div className="mb-2 px-1 text-[13px] text-ink-3">{t("Til")}</div>
      <div role="radiogroup" aria-label={t("Til")} className="layer divide-y divide-line overflow-hidden p-0">
        {LANGS.map((l) => (
          <button
            key={l}
            role="radio"
            aria-checked={lang === l}
            onClick={() => {
              haptic("light");
              setLang(l);
            }}
            className="flex w-full items-center justify-between px-4 py-3.5 text-left text-[16px]"
          >
            {LANG_NAME[l]}
            <span className={`h-5 w-5 rounded-full border-2 ${lang === l ? "border-ink bg-ink shadow-[inset_0_0_0_3px_var(--surface)]" : "border-line"}`} aria-hidden />
          </button>
        ))}
      </div>
      <div className="layer mt-4 flex items-center justify-between px-4 py-3">
        <span className="text-[16px]">{t("Mavzu")}</span>
        <ThemeToggle />
      </div>
      <button
        onClick={() => {
          haptic("medium");
          restartIntro();
        }}
        className="layer mt-4 flex w-full items-center gap-3 px-4 py-3.5 text-left text-[16px] active:bg-surface-2"
      >
        <RotateCcw size={18} strokeWidth={1.8} className="text-ink-3" />
        {tx("introAgain")}
      </button>
    </>
  );
}
