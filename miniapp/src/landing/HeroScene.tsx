// Hero-сцена (~6 c, затем лёгкий idle-цикл):
// стеклянный пузырь голосового -> волна пульсирует -> расшифровка печатается -> волна вытягивается в линию денег
// -> линия ныряет в красную зону, точка «Payshanba −350 000» пульсирует -> вылетает карточка «Qarzlar yopadi»
// -> линия поднимается в бирюзу, цифра прокручивается до плюса. Кнопка ↻ повторяет.
import { Check, Mic, RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Odometer } from "../ui/Odometer";

const W = 560;
const H = 260;
const ZERO = 176;
const X0 = 16;
const STEP = 36;
// уровни линии: факт -> провал ниже нуля -> рост
const YS = [140, 124, 130, 108, 116, 94, 100, 80, 214, 170, 150, 126, 104, 80, 54];
const DIP = 8;
const x = (i: number) => X0 + i * STEP;

function stepPath(from: number, to: number) {
  let d = `M${x(from)} ${YS[from]}`;
  for (let i = from + 1; i <= to; i++) d += ` H${x(i)} V${YS[i]}`;
  return d;
}
const PATH_BEFORE = stepPath(0, DIP - 1);
const PATH_DIP = `M${x(DIP - 1)} ${YS[DIP - 1]} H${x(DIP)} V${YS[DIP]} H${x(DIP + 1)} V${YS[DIP + 1]}`;
const END_X = x(YS.length - 1) + STEP * 0.5;
const PATH_AFTER = `${stepPath(DIP + 1, YS.length - 1)} H${END_X}`;
const DIP_X = x(DIP) + STEP / 2;

export const WAVE = [0.2, 0.45, 0.3, 0.7, 0.5, 0.9, 0.6, 0.35, 0.8, 0.55, 0.3, 0.65, 0.4, 0.85, 0.5, 0.25, 0.6, 0.4, 0.2, 0.5];
const PHRASE = "Bugun 2 million 300 ming sotdim…";

// таймлайн (мс): 0 пузырь · 1 печать · 2 линия · 3 провал · 4 карточка · 5 рост · 6 idle
const T = [200, 700, 2500, 3300, 4300, 5000, 6300];

function useTimeline(run: number, reduce: boolean) {
  const [step, setStep] = useState(reduce ? 6 : -1);
  useEffect(() => {
    if (reduce) return setStep(6);
    setStep(-1);
    const ids = T.map((ms, i) => window.setTimeout(() => setStep(i), ms));
    return () => ids.forEach(clearTimeout);
  }, [run, reduce]);
  return step;
}

function useTyped(text: string, on: boolean, done: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (done) return setN(text.length);
    if (!on) return setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 48);
    return () => clearInterval(id);
  }, [on, done, text]);
  return text.slice(0, n);
}

const spring = { type: "spring" as const, stiffness: 180, damping: 18 };

export function HeroScene() {
  const reduce = !!useReducedMotion();
  const [run, setRun] = useState(0);
  const s = useTimeline(run, reduce);
  const typed = useTyped(PHRASE, s >= 1, reduce);
  const waving = s >= 0 && s < 2 && !reduce;
  const value = s >= 5 ? 550000 : -350000;

  return (
    <div
      className="relative w-full"
      role="img"
      aria-label="Ovozli xabar pul chizig'iga aylanadi: payshanba kuni 350 ming yetmaydi, qarzlar qaytsa bo'sh pul 550 ming plyusga chiqadi"
    >
      {/* верх: пузырь голосового + цифра */}
      <div className="flex flex-wrap items-start justify-between gap-4 pr-9 sm:pr-0" aria-hidden>
        <motion.div
          className="glass lift-2 flex max-w-full items-center gap-3 rounded-full py-2 pr-5 pl-2"
          initial={false}
          animate={s >= 0 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.7, y: 16 }}
          transition={spring}
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-ink">
            {waving && <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-20" />}
            <Mic size={18} strokeWidth={1.75} className="relative" />
          </span>
          <span className="flex h-7 items-center gap-[3px]">
            {WAVE.slice(0, 14).map((v, i) => (
              <motion.span
                key={i}
                className="w-[3px] origin-center rounded-full bg-ink"
                style={{ height: `${24 + v * 76}%` }}
                animate={waving ? { scaleY: [0.35, 1, 0.5, 0.9, 0.35] } : { scaleY: s >= 2 ? 0.55 : 1, opacity: s >= 2 ? 0.55 : 1 }}
                transition={waving ? { duration: 1.1, repeat: Infinity, delay: (i % 7) * 0.08, ease: "easeInOut" } : { duration: 0.5 }}
              />
            ))}
          </span>
          <span className="min-w-0 truncate text-[15px] text-ink">
            «{typed}
            {!reduce && s >= 1 && typed.length < PHRASE.length && <span className="opacity-40">▍</span>}»
          </span>
        </motion.div>

        <motion.div className="text-left" initial={false} animate={s >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }} transition={{ duration: 0.5 }}>
          <div className="text-[13px] text-ink-3">Bo'sh pul · payshanbagacha</div>
          <div className={`display mt-1 text-[clamp(26px,3vw,38px)] leading-none font-bold transition-colors duration-700 ${value < 0 ? "text-neg-text" : "text-pos-text"}`}>
            <Odometer value={value} prefix={value > 0 ? "+" : ""} />
          </div>
        </motion.div>
      </div>

      {/* линия денег */}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 block h-auto w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="hs-pos" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--ink)" />
            <stop offset="0.35" stopColor="var(--pos)" />
          </linearGradient>
        </defs>
        <motion.line x1={X0 - 8} x2={W} y1={ZERO} y2={ZERO} stroke="var(--ink-3)" strokeOpacity={0.5} strokeDasharray="3 6" initial={false} animate={{ opacity: s >= 2 ? 1 : 0 }} />
        <motion.text x={X0 - 6} y={ZERO - 8} fontSize={12} fill="var(--ink-3)" initial={false} animate={{ opacity: s >= 2 ? 1 : 0 }}>
          0
        </motion.text>
        {/* красная зона */}
        <motion.rect
          x={x(DIP - 1) + 4}
          y={ZERO}
          width={STEP * 2 - 8}
          height={H - ZERO + 4}
          rx={10}
          fill="var(--neg)"
          initial={false}
          animate={{ opacity: s >= 3 ? (s >= 5 ? 0.06 : 0.14) : 0 }}
          transition={{ duration: 0.6 }}
        />

        <motion.path
          d={PATH_BEFORE}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: s >= 2 ? 1 : 0, opacity: s >= 2 ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.9, ease: [0.65, 0, 0.35, 1] }}
        />
        <motion.path
          d={PATH_DIP}
          fill="none"
          stroke="var(--neg)"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: s >= 3 ? 1 : 0, opacity: s >= 3 ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.7, ease: [0.55, 0, 0.45, 1] }}
        />
        <motion.path
          d={PATH_AFTER}
          fill="none"
          stroke="url(#hs-pos)"
          strokeWidth={3.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: s >= 5 ? 1 : 0, opacity: s >= 5 ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 1.2, ease: [0.33, 0, 0.2, 1] }}
        />

        {/* точка провала */}
        <AnimatePresence>
          {s >= 3 && (
            <motion.g key="dip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.5 }}>
              {!reduce && s < 5 && (
                <motion.circle cx={DIP_X} cy={YS[DIP]} r={7} fill="var(--neg)" style={{ transformBox: "fill-box", transformOrigin: "center" }} animate={{ scale: [1, 2.9], opacity: [0.35, 0] }} transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }} />
              )}
              <circle cx={DIP_X} cy={YS[DIP]} r={6} fill="var(--surface)" stroke="var(--neg)" strokeWidth={3} />
              <text x={x(DIP - 1) - 2} y={YS[DIP] + 6} textAnchor="end" fontFamily="var(--font-display)" fontWeight={600} fontSize={16} fill="var(--neg-text)">
                Payshanba: −350 000
              </text>
            </motion.g>
          )}
        </AnimatePresence>

        {/* конец линии: мягкая пульсация в idle */}
        {s >= 5 && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 1.1 }}>
            {!reduce && s >= 6 && (
              <motion.circle cx={END_X} cy={YS[YS.length - 1]} r={6} fill="var(--pos)" style={{ transformBox: "fill-box", transformOrigin: "center" }} animate={{ scale: [1, 3], opacity: [0.35, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }} />
            )}
            <circle cx={END_X} cy={YS[YS.length - 1]} r={6} fill="var(--pos)" />
          </motion.g>
        )}
      </svg>

      {/* карточка решения */}
      <motion.div
        aria-hidden
        className="glass lift-3 relative z-10 mt-3 ml-auto flex w-fit max-w-full items-center gap-3 rounded-[20px] px-4 py-3 sm:absolute sm:right-[-30px] sm:bottom-[-30px] sm:mt-0"
        initial={false}
        animate={s >= 4 ? { opacity: 1, x: 0, y: s >= 6 && !reduce ? [0, -6, 0] : 0, rotate: 0, scale: 1 } : { opacity: 0, x: 80, y: 30, rotate: 6, scale: 0.9 }}
        transition={s >= 6 && !reduce ? { y: { duration: 4, repeat: Infinity, ease: "easeInOut" } } : spring}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pos-soft text-pos-text">
          <Check size={19} strokeWidth={2.2} />
        </span>
        <span>
          <span className="block text-[16px] font-semibold text-ink">Qarzlar yopadi</span>
          <span className="block text-[13px] text-ink-3">3 mijoz · 900 ming</span>
        </span>
      </motion.div>

      {/* повтор */}
      <AnimatePresence>
        {s >= 6 && !reduce && (
          <motion.button
            key="replay"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRun((r) => r + 1)}
            aria-label="Animatsiyani qayta ko'rsatish"
            title="Qayta ko'rsatish"
            className="glass btn-fx absolute -top-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:text-ink sm:-top-6 sm:-right-6"
          >
            <RotateCcw size={17} strokeWidth={1.9} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
