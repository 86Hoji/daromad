// Цвета темы для SVG (Recharts): читаем CSS-переменные и перечитываем при смене темы/themeParams.
import { useEffect, useState } from "react";

export interface Palette {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  surface: string;
  surface2: string;
  brand: string;
  pos: string;
  neg: string;
  negText: string;
  warn: string;
  past: string;
  future: string;
  band: string;
}

function read(): Palette {
  const s = getComputedStyle(document.documentElement);
  const g = (n: string) => s.getPropertyValue(n).trim();
  return {
    ink: g("--ink"),
    ink2: g("--ink-2"),
    ink3: g("--ink-3"),
    line: g("--line"),
    surface: g("--surface"),
    surface2: g("--surface-2"),
    brand: g("--brand"),
    pos: g("--pos"),
    neg: g("--neg"),
    negText: g("--neg-text"),
    warn: g("--warn"),
    past: g("--chart-past"),
    future: g("--chart-future"),
    band: g("--chart-band"),
  };
}

export function usePalette(): Palette {
  const [p, setP] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setP(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => mo.disconnect();
  }, []);
  return p;
}
