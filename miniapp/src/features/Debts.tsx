// Долги: сортируемая таблица (дашборд), компактный список (Mini App, превью).
import { ArrowDown, ArrowUp, Check, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { DebtRow } from "../lib/api";
import { money, moneyShort } from "../lib/format";
import { Button } from "../ui/Button";
import { Chip } from "../ui/bits";
import { useReminder } from "./Reminder";

export type DebtSort = "remaining" | "days_open" | "person_name";

/** Возраст долга -> тон: до недели спокойно, до двух — внимание, дальше — Saffron. */
export function ageTone(days: number): "neutral" | "warn" {
  return days > 14 ? "warn" : "neutral";
}

export const maskPhone = (p: string | null) => (p ? p.replace(/^(\+998)(\d{2})\d{5}(\d{2})$/, "$1 $2 *** ** $3") : null);

export function useSortedDebts(debts: DebtRow[] | undefined, initial: DebtSort = "remaining") {
  const [sort, setSort] = useState<DebtSort>(initial);
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const open = useMemo(() => {
    const list = (debts ?? []).filter((d) => d.status === "open");
    const k = dir === "desc" ? -1 : 1;
    return list.sort((a, b) => {
      if (sort === "person_name") return k * -a.person_name.localeCompare(b.person_name);
      return k * (a[sort] - b[sort]);
    });
  }, [debts, sort, dir]);
  const toggle = (s: DebtSort) => {
    if (s === sort) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(s);
      setDir(s === "person_name" ? "asc" : "desc");
    }
  };
  return { open, sort, dir, toggle, setSort };
}

function Consent({ d }: { d: DebtRow }) {
  if (!d.phone) return <span className="text-ink-3">Telefon yo'q</span>;
  return d.sms_consent ? <Chip tone="pos">SMS roziligi bor</Chip> : <Chip>Rozilik yo'q</Chip>;
}

function SortHead({ label, k, s, className = "" }: { label: string; k: DebtSort; s: ReturnType<typeof useSortedDebts>; className?: string }) {
  const active = s.sort === k;
  const Icon = s.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th scope="col" className={`py-3 font-medium ${className}`} aria-sort={active ? (s.dir === "desc" ? "descending" : "ascending") : "none"}>
      <button onClick={() => s.toggle(k)} className={`inline-flex items-center gap-1 rounded-md hover:text-ink ${active ? "text-ink" : ""}`}>
        {label}
        {active && <Icon size={14} strokeWidth={2} />}
      </button>
    </th>
  );
}

export function DebtTable({ debts }: { debts: DebtRow[] }) {
  const s = useSortedDebts(debts);
  const reminder = useReminder();
  if (s.open.length === 0) return <p className="py-10 text-center text-ink-2">Hozir sizga hech kim qarz emas.</p>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[15px]">
        <thead className="text-[13px] text-ink-3">
          <tr>
            <SortHead label="Mijoz" k="person_name" s={s} className="pl-2" />
            <SortHead label="Muddat" k="days_open" s={s} />
            <th scope="col" className="py-3 font-medium">
              Aloqa
            </th>
            <SortHead label="Summa" k="remaining" s={s} className="text-right" />
            <th scope="col" className="w-[132px] py-3 pr-2" />
          </tr>
        </thead>
        <tbody>
          {s.open.map((d) => (
            <tr key={d.id} className="group">
              <td className="border-t border-line py-3.5 pl-2">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-[14px] font-semibold text-ink-2">{d.person_name[0]?.toUpperCase()}</span>
                  <span className="font-medium">{d.person_name}</span>
                </span>
              </td>
              <td className="border-t border-line py-3.5">
                <Chip tone={ageTone(d.days_open)}>{d.days_open} kun</Chip>
              </td>
              <td className="border-t border-line py-3.5 text-[14px]">
                <span className="flex flex-wrap items-center gap-2">
                  {d.phone && <span className="num text-ink-2">{maskPhone(d.phone)}</span>}
                  <Consent d={d} />
                </span>
              </td>
              <td className="num border-t border-line py-3.5 text-right font-semibold">{money(d.remaining)}</td>
              <td className="border-t border-line py-3.5 pr-2 text-right">
                <Button
                  size="sm"
                  variant={reminder.sent[d.id] ? "quiet" : "secondary"}
                  icon={reminder.sent[d.id] ? <Check size={15} /> : undefined}
                  loading={reminder.busyId === d.id}
                  onClick={() => reminder.open(d)}
                >
                  {reminder.sent[d.id] ? "Yuborildi" : "Eslatish"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Компактный список: превью на дашборде и экран Qarzlar в Mini App. */
export function DebtList({ debts, limit, onOpen }: { debts: DebtRow[]; limit?: number; onOpen?: (d: DebtRow) => void }) {
  const reminder = useReminder();
  const list = debts.filter((d) => d.status === "open").sort((a, b) => b.remaining - a.remaining).slice(0, limit);
  if (list.length === 0) return <p className="py-6 text-center text-ink-2">Hozir sizga hech kim qarz emas.</p>;
  return (
    <ul className="divide-y divide-line">
      {list.map((d) => (
        <li key={d.id}>
          <button
            onClick={() => (onOpen ? onOpen(d) : reminder.open(d))}
            className="flex w-full items-center gap-3 py-3 text-left transition active:opacity-70"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-semibold text-ink-2">{d.person_name[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15.5px] font-medium">{d.person_name}</span>
              <span className={`num text-[13px] ${d.days_open > 14 ? "text-warn-text" : "text-ink-3"}`}>
                {d.days_open} kun{reminder.sent[d.id] ? " · eslatildi" : ""}
              </span>
            </span>
            <span className="num text-[15.5px] font-semibold">{moneyShort(d.remaining)}</span>
            {onOpen && <ChevronRight size={18} className="text-ink-3" aria-hidden />}
          </button>
        </li>
      ))}
    </ul>
  );
}
