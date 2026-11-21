// Хуки данных поверх LiveProvider: живая лента записей и отчёт (записи + журнал).
import { useEffect, useRef, useState } from "react";
import { api, type AuditItem, type Entry, type EntriesResp } from "../lib/api";
import { useLive } from "../lib/live";

/**
 * Последние записи. Новые id после первой загрузки помечаются как fresh —
 * лента подсвечивает их (запись из бота «въезжает» на дашборде).
 */
export function useFeed(limit = 12) {
  const { tick } = useLive();
  const [items, setItems] = useState<Entry[] | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef<Set<number> | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .entries("month")
      .then((r) => {
        if (!alive) return;
        const list = r.entries.filter((e) => e.status === "confirmed").slice(0, limit);
        if (known.current) {
          const added = list.filter((e) => !known.current!.has(e.id)).map((e) => e.id);
          if (added.length) {
            setFresh(new Set(added));
            window.setTimeout(() => setFresh(new Set()), 4000);
          }
        }
        known.current = new Set(r.entries.map((e) => e.id));
        setItems(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tick, limit]);

  return { items, fresh };
}

export function useReport(period: "week" | "month", auditLimit = 30) {
  const { tick } = useLive();
  const [entries, setEntries] = useState<EntriesResp | null>(null);
  const [audit, setAudit] = useState<AuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.entries(period), api.audit(auditLimit)])
      .then(([e, a]) => {
        if (!alive) return;
        setEntries(e);
        setAudit(a.items);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [period, tick, auditLimit]);

  return { entries, audit, error };
}
