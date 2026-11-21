// Цвета темы для SVG (Recharts): читаем CSS-переменные и перечитываем при смене темы.
import { useEffect, useState } from "react";

export interface Palette {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  surface: string;
  pos: string;
  neg: string;
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
    pos: g("--pos"),
    neg: g("--neg"),
  };
}

export function usePalette(): Palette {
  const [p, setP] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setP(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return p;
}
