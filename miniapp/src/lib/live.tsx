// Живые данные: summary / forecast / debts / recommendation раз в 5 секунд и после любого действия.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type DebtsResp, type Forecast, type Recommendation, type Summary } from "./api";

const POLL_MS = 5000;

interface LiveState {
  summary: Summary | null;
  forecast: Forecast | null;
  debts: DebtsResp | null;
  rec: Recommendation | null;
  error: string | null;
  updatedAt: Date | null;
  /** номер обновления — экраны с собственными данными (отчёт) перезапрашивают по нему */
  tick: number;
  refresh: () => Promise<void>;
}

const Ctx = createContext<LiveState | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [debts, setDebts] = useState<DebtsResp | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const [s, f, d, r] = await Promise.all([api.summary(), api.forecast(14), api.debts(), api.recommendation()]);
      setSummary(s);
      setForecast(f);
      setDebts(d);
      setRec(r);
      setError(null);
      setUpdatedAt(new Date());
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return (
    <Ctx.Provider value={{ summary, forecast, debts, rec, error, updatedAt, tick, refresh }}>{children}</Ctx.Provider>
  );
}

export function useLive(): LiveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLive outside LiveProvider");
  return v;
}
