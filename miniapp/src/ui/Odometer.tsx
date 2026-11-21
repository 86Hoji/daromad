// Цифры-«одометр»: каждый разряд — барабан 0–9, при изменении прокручивается с небольшой задержкой по разрядам.
// roll — при первом показе прокрутить от нулей. Для скринридеров — обычный текст в aria-label.
import { useEffect, useState } from "react";
import { num } from "../lib/format";

const DIGITS = "0123456789";

function Reel({ d, delay, instant }: { d: number; delay: number; instant: boolean }) {
  return (
    <span className="relative inline-block h-[1em] overflow-hidden align-top leading-[1em]">
      <span
        className="flex flex-col will-change-transform"
        style={{
          transform: `translateY(${-d}em)`,
          transition: instant ? "none" : `transform 1.1s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s`,
        }}
      >
        {DIGITS.split("").map((x) => (
          <span key={x} className="block h-[1em] leading-[1em]">
            {x}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Odometer({
  value,
  className = "",
  format = num,
  roll = false,
  prefix = "",
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
  roll?: boolean;
  prefix?: string;
}) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [ready, setReady] = useState(!roll || reduce);
  useEffect(() => {
    if (ready) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, [ready]);

  const text = prefix + format(value);
  const chars = text.split("");
  const n = chars.length;
  return (
    <span className={`num inline-flex items-start whitespace-pre ${className}`}>
      <span className="sr-only">{text}</span>
      <span className="inline-flex items-start" aria-hidden>
      {chars.map((ch, i) => {
        const fromRight = n - 1 - i;
        const isDigit = ch >= "0" && ch <= "9";
        return isDigit ? (
          <Reel key={`d${fromRight}`} d={ready ? Number(ch) : 0} delay={fromRight * 0.045} instant={reduce} />
        ) : (
          <span key={`s${fromRight}-${ch}`} className="inline-block h-[1em] leading-[1em]">
            {ch}
          </span>
        );
      })}
      </span>
    </span>
  );
}
