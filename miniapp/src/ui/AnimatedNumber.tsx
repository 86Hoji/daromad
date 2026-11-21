// Сумма-«одометр»: разряды прокручиваются как барабан при изменении (см. Odometer).
import { Odometer } from "./Odometer";

export function AnimatedNumber({ value, className = "", roll = false }: { value: number; className?: string; roll?: boolean }) {
  return <Odometer value={value} className={className} roll={roll} />;
}
