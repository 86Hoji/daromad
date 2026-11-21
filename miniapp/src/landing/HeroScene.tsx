// Сцена hero: голос -> расшифровка -> линия денег с провалом в четверг -> «Qarzlar yopadi» -> линия уходит вверх.
// Пока статичный финальный кадр; анимация — следующим шагом.
import { Check, Mic } from "lucide-react";

const W = 520;
const H = 250;
const ZERO = 168;
const X0 = 28;
const STEP = 33;
// уровни линии (y в координатах SVG): факт, затем провал ниже нуля, затем рост
const YS = [128, 112, 118, 98, 106, 86, 92, 74, 200, 160, 140, 120, 100, 78, 56];
const DIP = 8;

const x = (i: number) => X0 + i * STEP;

function stepPath(from: number, to: number) {
  let d = `M${x(from)} ${YS[from]}`;
  for (let i = from + 1; i <= to; i++) d += ` H${x(i)} V${YS[i]}`;
  return d;
}

const PATH_BEFORE = stepPath(0, DIP - 1);
const PATH_DIP = `M${x(DIP - 1)} ${YS[DIP - 1]} H${x(DIP)} V${YS[DIP]} H${x(DIP + 1)} V${YS[DIP + 1]}`;
const PATH_AFTER = `${stepPath(DIP + 1, YS.length - 1)} H${x(YS.length - 1) + STEP * 0.6}`;

export const WAVE = [0.2, 0.45, 0.3, 0.7, 0.5, 0.9, 0.6, 0.35, 0.8, 0.55, 0.3, 0.65, 0.4, 0.85, 0.5, 0.25, 0.6, 0.4, 0.2, 0.5];

export function HeroScene() {
  const dipX = x(DIP) + STEP / 2;
  return (
    <div className="relative w-full" role="img" aria-label="Ovozli xabar pul chizig'iga aylanadi: payshanba kuni 350 ming yetmaydi, qarzlar qaytsa chiziq yana ko'tariladi">
      {/* расшифровка */}
      <div className="relative z-10 flex items-center gap-3 rounded-full bg-surface-2 py-2 pr-5 pl-2 sm:w-fit">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <Mic size={18} strokeWidth={1.75} />
        </span>
        <span className="hidden h-6 items-center gap-[3px] text-brand-text sm:flex" aria-hidden>
          {WAVE.slice(0, 12).map((v, i) => (
            <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${20 + v * 80}%` }} />
          ))}
        </span>
        <span className="truncate text-[15px] text-ink">«Bugun 2 million 300 ming sotdim…»</span>
      </div>

      {/* линия денег */}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 block h-auto w-full overflow-visible" aria-hidden>
        <line x1={X0 - 8} x2={W - 4} y1={ZERO} y2={ZERO} stroke="var(--ink-3)" strokeOpacity={0.5} strokeDasharray="3 5" />
        <text x={X0 - 14} y={ZERO + 4} textAnchor="end" fontSize={12} fill="var(--ink-3)">
          0
        </text>
        <rect x={x(DIP - 1) + 2} y={ZERO} width={STEP * 2 - 4} height={H - ZERO - 8} rx={8} fill="var(--neg)" opacity={0.1} />

        <path d={PATH_BEFORE} fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={PATH_DIP} fill="none" stroke="var(--neg)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={PATH_AFTER} fill="none" stroke="var(--pos)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(YS.length - 1) + STEP * 0.6} cy={YS[YS.length - 1]} r={5} fill="var(--pos)" />

        <circle cx={dipX} cy={YS[DIP]} r={5.5} fill="var(--bg)" stroke="var(--neg)" strokeWidth={2.5} />
        <text x={x(DIP + 1) + 12} y={YS[DIP] + 6} fontFamily="var(--font-display)" fontWeight={600} fontSize={15} fill="var(--neg-text)">
          Payshanba: −350 000
        </text>
      </svg>

      {/* карточка решения */}
      <div className="relative z-10 mt-1 ml-auto flex w-fit max-w-full items-center gap-3 rounded-[18px] bg-surface-2 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pos-soft text-pos">
          <Check size={18} strokeWidth={2} />
        </span>
        <span>
          <span className="block text-[15px] font-semibold text-ink">Qarzlar yopadi</span>
          <span className="block text-[13px] text-ink-3">Alisher, Nigora opa, Bobur · 900 ming</span>
        </span>
      </div>
    </div>
  );
}
