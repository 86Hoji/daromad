import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { num } from "../lib/format";

/**
 * Сумма, которая перетекает к новому значению. Первый рендер — сразу финальное число
 * (без «счётчика с нуля»), дальше — анимация только при изменении.
 */
export function AnimatedNumber({ value, className = "", round = 1000 }: { value: number; className?: string; round?: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    const from = prev.current;
    prev.current = value;
    if (reduce) {
      setShown(value);
      return;
    }
    const c = animate(from, value, { duration: 0.6, ease: [0.2, 0.8, 0.2, 1], onUpdate: setShown });
    return () => c.stop();
  }, [value, reduce]);

  const r = shown === value ? value : Math.round(shown / round) * round;
  return <span className={`num ${className}`}>{num(r)}</span>;
}
