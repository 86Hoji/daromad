// Итоги и записи за последние 7 / 30 дней; перезапрос после каждого обновления живых данных (tick).
import { useEffect, useState } from "react";
import { useLive } from "../lib/live";
import { tgPeriod, type PeriodResp } from "./tgApi";

export function usePeriod(days: 7 | 30) {
  const { tick } = useLive();
  const [data, setData] = useState<PeriodResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    tgPeriod(days)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [days, tick]);

  // при смене 7 <-> 30 старые цифры не показываем как новые
  return { data: data && data.days === days ? data : null, error };
}
