// Операции: подтверждённые записи за 30 дней, по дням с итогом дня; фильтры наличные / безнал и источник.
// Наличные — то, что записал владелец (голос, текст, фото); безнал — пришло из платежей (bank, link).
import { Building2, Image, Keyboard, Mic } from "lucide-react";
import { useMemo, useState } from "react";
import { categoryLabel, ddmm, moneyShort, weekdayShort } from "../lib/format";
import { ErrorState, Skeleton } from "../ui/bits";
import { tx, type TxKey } from "./i18n.tg";
import type { PeriodResp } from "./tgApi";
import { Block, Header } from "./ui";
import { usePeriod } from "./usePeriod";

type Kind = "all" | "cash" | "cashless";
type Source = "any" | "voice" | "text" | "photo" | "bank";
type Row = PeriodResp["entries"][number];

const CASHLESS = new Set(["bank", "link"]);
const SOURCE_ICON: Record<string, typeof Mic> = { voice: Mic, text: Keyboard, photo: Image, bank: Building2, link: Building2 };
const SOURCE_LABEL: Record<string, TxKey> = { voice: "srcVoice", text: "srcText", photo: "srcPhoto", bank: "srcBank", link: "srcBank" };
const KINDS: { value: Kind; label: TxKey }[] = [
  { value: "all", label: "fAll" },
  { value: "cash", label: "fCash" },
  { value: "cashless", label: "fCashless" },
];
const SOURCES: { value: Source; label: TxKey }[] = [
  { value: "any", label: "fAnySource" },
  { value: "voice", label: "srcVoice" },
  { value: "text", label: "srcText" },
  { value: "photo", label: "srcPhoto" },
  { value: "bank", label: "srcBank" },
];

const signed = (n: number) => (n > 0 ? `+${moneyShort(n)}` : moneyShort(n));

function dayLabel(iso: string, today: string): string {
  if (iso === today) return tx("today");
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (iso === yIso) return tx("yesterday");
  return `${ddmm(iso)}, ${weekdayShort(iso)}`;
}

function matches(e: Row, kind: Kind, source: Source): boolean {
  const cashless = CASHLESS.has(e.source);
  if (kind === "cash" && cashless) return false;
  if (kind === "cashless" && !cashless) return false;
  if (source === "any") return true;
  if (source === "bank") return cashless;
  return e.source === source;
}

function EntryRow({ e }: { e: Row }) {
  const Icon = SOURCE_ICON[e.source] ?? Keyboard;
  const sale = e.kind === "sale";
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3">
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">
          {sale ? tx("sale") : categoryLabel(e.category)}
          {e.note ? <span className="font-normal text-ink-3"> · {e.note}</span> : null}
        </span>
        <span className="text-[13px] text-ink-3">{tx(SOURCE_LABEL[e.source] ?? "srcText")}</span>
      </span>
      <span className={`num shrink-0 text-[15px] font-semibold tabular-nums ${sale ? "text-pos-text" : "text-ink"}`}>
        {sale ? "+" : "−"}
        {moneyShort(e.amount)}
      </span>
    </li>
  );
}

export function TgOps() {
  const { data, error } = usePeriod(30);
  const [kind, setKind] = useState<Kind>("all");
  const [source, setSource] = useState<Source>("any");

  const days = useMemo(() => {
    if (!data) return null;
    const groups = new Map<string, Row[]>();
    for (const e of data.entries) if (matches(e, kind, source)) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
    return [...groups.entries()].map(([date, items]) => ({
      date,
      items,
      total: items.reduce((s, e) => s + (e.kind === "sale" ? e.amount : -e.amount), 0),
    }));
  }, [data, kind, source]);

  return (
    <>
      <Header title={tx("opsTitle")} />
      {data && (
        <p className="-mt-2 mb-4 text-[14px] text-ink-3">
          {tx("opsPeriod")} · <span className="num text-pos-text">+{moneyShort(data.sales)}</span> · <span className="num">−{moneyShort(data.expenses)}</span>
        </p>
      )}
      <div role="radiogroup" aria-label={tx("opsTitle")} className="mb-2.5 grid grid-cols-3 rounded-el bg-surface-2 p-1">
        {KINDS.map((k) => (
          <button
            key={k.value}
            role="radio"
            aria-checked={kind === k.value}
            onClick={() => setKind(k.value)}
            className={`h-8 rounded-[9px] text-[14px] font-medium transition ${
              kind === k.value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(11_20_48/0.08)]" : "text-ink-3"
            }`}
          >
            {tx(k.label)}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label={tx("fAnySource")} className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SOURCES.map((s) => (
          <button
            key={s.value}
            role="radio"
            aria-checked={source === s.value}
            onClick={() => setSource(s.value)}
            className={`h-8 shrink-0 rounded-full px-3.5 text-[13.5px] font-medium transition ${
              source === s.value ? "bg-ink text-bg" : "bg-surface-2 text-ink-2"
            }`}
          >
            {tx(s.label)}
          </button>
        ))}
      </div>

      {!days ? (
        error ? (
          <ErrorState text={error} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-panel" />
            <Skeleton className="h-40 rounded-panel" />
          </div>
        )
      ) : days.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-ink-3">{tx("opsEmpty")}</p>
      ) : (
        <div className="space-y-3">
          {days.map((d, i) => (
            <Block key={d.date} i={Math.min(i, 4)} className="py-2">
              <div className="flex items-baseline justify-between border-b border-line pt-1 pb-2">
                <h2 className="text-[14px] font-semibold">{dayLabel(d.date, data!.to)}</h2>
                <span className={`num text-[14px] font-semibold tabular-nums ${d.total < 0 ? "text-neg-text" : "text-ink-2"}`}>{signed(d.total)}</span>
              </div>
              <ul className="divide-y divide-line">
                {d.items.map((e) => (
                  <EntryRow key={e.id} e={e} />
                ))}
              </ul>
            </Block>
          ))}
        </div>
      )}
    </>
  );
}
