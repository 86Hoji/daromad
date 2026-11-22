// Секции лендинга после hero: Muammo -> Qanday ishlaydi (scrollytelling) -> Sinov -> Ishonch -> Banklar uchun.
// Моушн только transform/opacity; prefers-reduced-motion — всё статично.
import { BadgeCheck, CalendarClock, Camera, Check, LineChart, Mic, ShieldCheck } from "lucide-react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoneyLine } from "../chart/MoneyLine";
import { DraftCards } from "../features/Drafts";
import { api, type Forecast } from "../lib/api";
import { capitalize, weekday } from "../lib/format";
import { EXAMPLES, demoForecast } from "./demo";
import { CREDIT_FACT, THESES } from "./facts";
import { WAVE } from "./HeroScene";
import { Sandbox } from "./Sandbox";
import { t } from "../lib/i18n";

export const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
export const H2 = "display text-[clamp(34px,4.4vw,62px)] leading-[1.02] font-bold tracking-[-0.04em]";
const H2S = "display text-[clamp(30px,3.4vw,48px)] leading-[1.06] font-bold tracking-[-0.035em]";
const LEAD = "mt-5 max-w-[580px] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]";
const EASE = [0.16, 1, 0.3, 1] as const;

function useMedia(q: string) {
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [q]);
  return on;
}

function Eyebrow({ n, children }: { n: string; children: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3 text-[14px] text-ink-3">
      <span className="num">{n}</span>
      <span className="h-px w-10 bg-ink-3/40" aria-hidden />
      {children}
    </div>
  );
}

/** Появление при входе в экран: подъём с пружиной, по индексу — каскад. */
function Reveal({ i = 0, className = "", children, as = "div", y = 32 }: { i?: number; className?: string; children: ReactNode; as?: "div" | "li"; y?: number }) {
  const reduce = useReducedMotion();
  const Tag = as === "li" ? motion.li : motion.div;
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ type: "spring", stiffness: 110, damping: 20, delay: i * 0.1 }}
    >
      {children}
    </Tag>
  );
}

function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.8, ease: EASE, onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [inView, reduce, to]);
  return (
    <span ref={ref} className="num">
      {v}
    </span>
  );
}

/* ───────────────────────── 1. Muammo ───────────────────────── */

export function Problem() {
  return (
    <section className={`${WRAP} py-24 lg:py-36`} aria-labelledby="muammo">
      <Reveal>
        <Eyebrow n="01">{t("Muammo")}</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 id="muammo" className={`${H2} max-w-[920px]`}>
          {t("Pul yetmasligi")} <span className="text-ink-3">{t("to'lov kuni")}</span> {t("bilinadi.")}
        </h2>
      </Reveal>
      <div className="mt-14 grid grid-cols-1 gap-5 lg:mt-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <Reveal className="h-full">
          <figure className="glass lift-2 flex h-full flex-col justify-between rounded-[32px] p-8 sm:p-10">
            <div className="display text-[clamp(84px,8vw,124px)] leading-[0.85] font-bold tracking-[-0.06em]" aria-label={t("taxminan {n} foiz", { n: CREDIT_FACT.value })}>
              <span className="text-ink-3" aria-hidden>
                ~
              </span>
              <CountUp to={CREDIT_FACT.value} />
              <span className="text-ink-3" aria-hidden>
                %
              </span>
            </div>
            <figcaption className="mt-12">
              <p className="text-[20px] leading-snug text-ink sm:text-[22px]">{t(CREDIT_FACT.text)}</p>
              <p className="mt-3 text-[13.5px] text-ink-3">{t(CREDIT_FACT.source)}</p>
            </figcaption>
          </figure>
        </Reveal>
        <ol className="grid gap-5">
          {THESES.map((th, i) => (
            <Reveal as="li" key={th.title} i={i + 1} className="glass lift-1 flex gap-6 rounded-[28px] p-6 sm:gap-8 sm:p-8">
              <span className="display num text-[15px] font-semibold text-ink-3">0{i + 1}</span>
              <div>
                <h3 className="display text-[22px] leading-tight font-semibold tracking-[-0.02em] sm:text-[24px]">{t(th.title)}</h3>
                <p className="mt-2.5 max-w-[560px] text-[16px] leading-relaxed text-ink-2">{t(th.text)}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── 2. Qanday ishlaydi ───────────────────────── */

const STEPS = [
  {
    title: "Gapiring",
    text: "Naqd savdo, xarajat, qarz yoki kelgusi to'lovni o'zbekcha yoki ruscha ayting yoki yozing. Telegram'dagi oddiy ovozli xabar ham bo'ladi. Karta va QR to'lovlari o'zi tushadi.",
  },
  {
    title: "Tasdiqlang",
    text: "AI gapni yozuvlarga ajratadi, summalarni kod tekshiradi. «To'g'ri» demaguningizcha hech narsa saqlanmaydi.",
  },
  {
    title: "Oldindan biling",
    text: "Pul chizig'i keyingi 14 kunni ko'rsatadi: qaysi kuni pul yetmaydi va uni qaysi qarzlar yopadi.",
  },
];

function useLandingForecast(): Forecast {
  const [f, setF] = useState<Forecast>(demoForecast);
  useEffect(() => {
    let alive = true;
    api
      .forecast(14)
      .then((r) => alive && setF(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return f;
}

function VoiceBody() {
  const reduce = useReducedMotion();
  const bars = [...WAVE, ...WAVE.slice(0, 12).reverse()];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div className="relative flex h-24 w-24 items-center justify-center">
        {!reduce &&
          [0, 0.8].map((d) => (
            <motion.span
              key={d}
              className="absolute inset-0 rounded-full bg-brand"
              initial={{ scale: 1, opacity: 0.18 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, delay: d, ease: "easeOut" }}
            />
          ))}
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-brand text-brand-ink shadow-[var(--elev-2)]">
          <Mic size={34} strokeWidth={1.6} />
        </span>
      </div>
      <div className="flex h-14 items-center gap-[4px]" aria-hidden>
        {bars.map((v, i) => (
          <motion.span
            key={i}
            className="w-[4px] rounded-full bg-ink"
            style={{ height: `${18 + v * 82}%` }}
            animate={reduce ? undefined : { scaleY: [0.4, 1, 0.55, 0.9, 0.4] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: (i % 8) * 0.07, ease: "easeInOut" }}
          />
        ))}
      </div>
      <motion.div
        className="max-w-[440px] rounded-[22px] bg-surface/80 px-5 py-4 text-center shadow-[var(--elev-1)]"
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, type: "spring", stiffness: 160, damping: 20 }}
      >
        <div className="text-[12.5px] text-ink-3">{t("Eshitganim")} · 0:06</div>
        <p className="mt-1 text-[17px] leading-snug">«{t(EXAMPLES[0].text)}»</p>
      </motion.div>
    </div>
  );
}

function ConfirmBody() {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="display text-[22px] font-semibold tracking-[-0.02em]">{t("Yozib oldim")}</span>
        <span className="text-[14px] text-ink-3">{t("{n} ta yozuv", { n: 2 })}</span>
      </div>
      <DraftCards drafts={EXAMPLES[0].drafts} fx />
      <motion.div
        className="mt-5 grid grid-cols-2 gap-2.5"
        aria-hidden
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5, ease: EASE }}
      >
        <span className="flex h-12 items-center justify-center rounded-full bg-surface/70 text-[15px] font-medium">{t("Tuzatish")}</span>
        <span className="flex h-12 items-center justify-center gap-2 rounded-full bg-brand text-[15px] font-medium text-brand-ink">
          <Check size={17} strokeWidth={2} /> {t("To'g'ri")}
        </span>
      </motion.div>
    </div>
  );
}

function ChartBody({ forecast }: { forecast: Forecast }) {
  const red = forecast.forecast.find((d) => d.balance < 0);
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="display text-[22px] font-semibold tracking-[-0.02em]">{t("Pul chizig'i")} · {t("14 kun")}</span>
        {red && (
          <span className="rounded-full bg-neg-soft px-3 py-1 text-[14px] font-medium text-neg-text">
            {capitalize(weekday(red.date))}: {t("kamomad")}
          </span>
        )}
      </div>
      <div className="mt-3 min-h-0 flex-1 rounded-[22px] bg-surface/70 p-2">
        <MoneyLine data={forecast} height={340} compact animate />
      </div>
    </div>
  );
}

function SceneBody({ step, forecast }: { step: number; forecast: Forecast }) {
  if (step === 0) return <VoiceBody />;
  if (step === 1) return <ConfirmBody />;
  return <ChartBody forecast={forecast} />;
}

function Progress({ p, step }: { p: MotionValue<number>; step: number }) {
  return (
    <div className="relative w-[3px] shrink-0 self-stretch rounded-full bg-ink-3/20" aria-hidden>
      <motion.div className="absolute inset-0 origin-top rounded-full bg-ink" style={{ scaleY: p }} />
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 transition-colors duration-300 ${
            i <= step ? "border-ink bg-ink" : "border-ink-3/40 bg-bg"
          }`}
          style={{ top: `calc(${i * 50}% - 7px)` }}
        />
      ))}
    </div>
  );
}

function StoryDesktop({ forecast }: { forecast: Forecast }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useTransform(scrollYProgress, [0.02, 0.92], [0, 1], { clamp: true });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(v < 0.34 ? 0 : v < 0.67 ? 1 : 2));
  const swap = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 140, damping: 22 };

  return (
    <div ref={ref} className="relative h-[330vh]">
      <div className="sticky top-0 flex h-screen items-center">
        <div className={`${WRAP} grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-14 xl:gap-20`}>
          <div>
            <Eyebrow n="02">{t("Qanday ishlaydi")}</Eyebrow>
            <div className="flex gap-8">
              <Progress p={p} step={step} />
              <div className="relative min-h-[330px] flex-1">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={reduce ? false : { opacity: 0, y: 34 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -26 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.42, ease: EASE }}
                  >
                    <div className="num text-[15px] text-ink-3">0{step + 1} / 03</div>
                    <h3 className={`${H2} mt-3`}>{t(STEPS[step].title)}</h3>
                    <p className={LEAD}>{t(STEPS[step].text)}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="glass lift-3 rounded-[36px] p-7 xl:p-9">
            <div className="flex w-fit gap-1 rounded-full bg-surface-2/60 p-1" aria-hidden>
              {STEPS.map((s, i) => (
                <span key={s.title} className={`relative rounded-full px-4 py-2 text-[14px] transition-colors duration-300 ${i === step ? "text-brand-ink" : "text-ink-3"}`}>
                  {i === step && <motion.span layoutId="story-tab" className="absolute inset-0 rounded-full bg-brand" transition={{ type: "spring", stiffness: 320, damping: 30 }} />}
                  <span className="relative">{t(s.title)}</span>
                </span>
              ))}
            </div>
            <div className="relative mt-6 h-[420px]">
              <AnimatePresence initial={false}>
                <motion.div
                  key={step}
                  className="absolute inset-0"
                  initial={reduce ? false : { opacity: 0, scale: 0.93, y: 30 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, scale: 1.05, y: -20, transition: { duration: 0.25 } }}
                  transition={swap}
                >
                  <SceneBody step={step} forecast={forecast} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoryStacked({ forecast }: { forecast: Forecast }) {
  return (
    <div className={`${WRAP} py-24`}>
      <Eyebrow n="02">{t("Qanday ishlaydi")}</Eyebrow>
      <ol className="space-y-16">
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.title}>
            <div className="num text-[15px] text-ink-3">0{i + 1} / 03</div>
            <h3 className="display mt-2 text-[36px] leading-[1.04] font-bold tracking-[-0.04em]">{t(s.title)}</h3>
            <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{t(s.text)}</p>
            <div className="glass lift-2 mt-6 rounded-[28px] p-4 sm:p-6">
              <div className={i === 2 ? "h-[380px]" : ""}>
                <SceneBody step={i} forecast={forecast} />
              </div>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  );
}

export function HowItWorks() {
  const forecast = useLandingForecast();
  const wide = useMedia("(min-width: 1024px)");
  return (
    <section id="qanday" className="relative scroll-mt-0" aria-labelledby="qanday-h">
      <h2 id="qanday-h" className="sr-only">
        {t("Uch qadam: gapiring, tasdiqlang, oldindan biling")}
      </h2>
      {wide ? <StoryDesktop forecast={forecast} /> : <StoryStacked forecast={forecast} />}
    </section>
  );
}

/* ───────────────────────── 3. Sinov ───────────────────────── */

export function SandboxSection() {
  return (
    <section id="sinov" className={`${WRAP} scroll-mt-24 py-24 lg:py-36`} aria-labelledby="sinov-h">
      <Reveal>
        <Eyebrow n="03">{t("Sinov")}</Eyebrow>
      </Reveal>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <Reveal i={1}>
          <h2 id="sinov-h" className={H2}>
            {t("O'zingiz sinab ko'ring.")}
          </h2>
        </Reveal>
        <Reveal i={2}>
          <p className="max-w-[420px] text-[17px] leading-relaxed text-ink-2">{t("Gapni yozing — qanday yozuvlarga ajralishini ko'rasiz. Bu sinov: hech narsa saqlanmaydi.")}</p>
        </Reveal>
      </div>
      <Reveal i={1} className="mt-12">
        <Sandbox />
      </Reveal>
    </section>
  );
}

/* ───────────────────────── 4. Ishonch ───────────────────────── */

type Level = "so'zdan" | "skrinshot" | "tasdiqlangan";
const LEVEL_STYLE: Record<Level, { chip: string; seg: string; n: number }> = {
  "so'zdan": { chip: "bg-ink-3/20 text-ink-2", seg: "bg-ink-3/50", n: 1 },
  skrinshot: { chip: "bg-ink-3 text-white", seg: "bg-ink-3", n: 2 },
  tasdiqlangan: { chip: "bg-ink text-bg", seg: "bg-ink", n: 3 },
};

const RECORDS: { icon: typeof Mic; kind: string; title: string; amount: string; tone: string; src: string; level: Level; note: string }[] = [
  { icon: Mic, kind: "Sotuv", title: "Bugungi savdo", amount: "+2 300 000", tone: "text-pos-text", src: "ovozli xabardan", level: "so'zdan", note: "Siz aytdingiz va tasdiqladingiz. Hujjat yo'q." },
  { icon: Camera, kind: "Xarajat", title: "Tovar · nakladnoy №418", amount: "−1 450 000", tone: "text-ink", src: "chek skrinshotidan", level: "skrinshot", note: "Summani rasmdagi hujjat tasdiqlaydi." },
  { icon: BadgeCheck, kind: "Qarz qaytdi", title: "Nigora opa", amount: "+300 000", tone: "text-pos-text", src: "to'lov havolasi orqali", level: "tasdiqlangan", note: "Pul bank orqali tushdi — eng ishonchli." },
];

function TrustRecord({ r, i }: { r: (typeof RECORDS)[number]; i: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const reduce = useReducedMotion();
  // верхний отступ огромный: запись, которую проскочили якорем, тоже считается увиденной
  const seen = useInView(ref, { once: true, margin: "100000px 0px -40% 0px" });
  const on = seen || !!reduce;
  const st = LEVEL_STYLE[r.level];
  return (
    <motion.li
      ref={ref}
      className={`glass lift-2 rounded-[26px] p-5 sm:p-6 ${["", "lg:ml-10", "lg:ml-20"][i]}`}
      initial={reduce ? false : { opacity: 0, x: 40 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ type: "spring", stiffness: 110, damping: 20 }}
    >
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
          <r.icon size={19} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ink-3">
            {t(r.kind)} · {t(r.src)}
          </div>
          <div className="truncate text-[17px] font-medium">{t(r.title)}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`num text-[17px] font-semibold ${r.tone}`}>{r.amount}</span>
          <span className="relative inline-flex h-[24px] min-w-[104px] justify-end overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {on ? (
                <motion.span
                  key="on"
                  className={`inline-flex items-center rounded-full px-2.5 text-[12.5px] leading-[24px] font-medium ${st.chip}`}
                  initial={{ y: 24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.15 }}
                >
                  {t(r.level)}
                </motion.span>
              ) : (
                <motion.span key="off" className="text-shimmer text-[12.5px] leading-[24px]" exit={{ y: -24, opacity: 0 }} transition={{ duration: 0.2 }}>
                  {t("tekshirilmoqda…")}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex gap-1.5 sm:flex-1" aria-hidden>
          {[0, 1, 2].map((k) => (
            <span key={k} className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-3/15">
              <motion.span
                className={`block h-full origin-left rounded-full ${st.seg}`}
                initial={false}
                animate={{ scaleX: on && k < st.n ? 1 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: 0.6, delay: 0.3 + k * 0.15, ease: EASE }}
              />
            </span>
          ))}
        </div>
        <span className="text-[13px] text-ink-3">{t(r.note)}</span>
      </div>
    </motion.li>
  );
}

export function Trust() {
  return (
    <section className="py-24 lg:py-36" aria-labelledby="ishonch">
      <div className={`${WRAP} grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <div className="lg:sticky lg:top-32 lg:self-start">
          <Reveal>
            <Eyebrow n="04">{t("Ishonch")}</Eyebrow>
          </Reveal>
          <Reveal i={1}>
            <h2 id="ishonch" className={H2S}>
              {t("AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz.")}
            </h2>
          </Reveal>
          <Reveal i={2}>
            <p className={LEAD}>{t("Har bir yozuvning ishonch darajasi bor. Hisobotda ham, bankda ham qaysi raqam qayerdan kelgani ko'rinadi. Summalarni til modeli emas, oddiy kod qo'shadi.")}</p>
          </Reveal>
        </div>
        <ol className="space-y-5 lg:pt-24">
          {RECORDS.map((r, i) => (
            <TrustRecord key={r.title} r={r} i={i} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── 5. Banklar uchun ───────────────────────── */

function MiniFlow() {
  return (
    <svg viewBox="0 0 220 64" className="h-16 w-full" aria-hidden>
      <path d="M2 44 H30 V36 H58 V40 H86 V28 H114 V58 H142 V40 H170 V24 H198 V14 H218" fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" />
      <rect x={114} y={46} width={28} height={18} rx={4} fill="var(--neg)" opacity={0.15} />
    </svg>
  );
}

function MiniTrust() {
  return (
    <div className="flex h-16 items-end gap-2" aria-hidden>
      {[
        ["h-[40%]", "bg-ink-3/40", "so'zdan"],
        ["h-[65%]", "bg-ink-3", "skrinshot"],
        ["h-full", "bg-ink", "tasdiq"],
      ].map(([h, c, l]) => (
        <div key={l} className="flex h-full flex-1 flex-col justify-end gap-1.5">
          <span className={`block w-full rounded-[8px] ${h} ${c}`} />
          <span className="text-center text-[11.5px] text-ink-3">{t(l)}</span>
        </div>
      ))}
    </div>
  );
}

function MiniOffer() {
  return (
    <div className="flex h-16 items-center justify-between gap-3 rounded-[18px] bg-surface/70 px-4" aria-hidden>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-3">{t("Payshanbadan oldin")}</div>
        <div className="truncate text-[14.5px] font-medium">{t("Overdraft")} · 400 000</div>
      </div>
      <span className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-brand-ink">{t("Roziman")}</span>
    </div>
  );
}

const BANK_POINTS = [
  { icon: LineChart, title: "Kunlik pul oqimi", text: "Savdo, xarajat va qarzlar bir joyda — 14 kunlik prognoz va oraliq bilan.", art: MiniFlow, depth: 0.6 },
  { icon: ShieldCheck, title: "Ma'lumot sifati", text: "Har bir raqamning manbasi ko'rinadi: so'zdan, skrinshot yoki bank tasdig'i.", art: MiniTrust, depth: 1.4 },
  { icon: CalendarClock, title: "O'z vaqtidagi taklif", text: "Overdraft — pul yetmaydigan kundan oldin, omonat — bo'sh pul paydo bo'lganda. Egasi bitta tugma bilan rozi bo'ladi.", art: MiniOffer, depth: 0.9 },
];

function BankPanel({ p, prog }: { p: (typeof BANK_POINTS)[number]; prog: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const y = useTransform(prog, [0, 1], reduce ? [0, 0] : [70 * p.depth, -70 * p.depth]);
  const Art = p.art;
  return (
    <motion.li style={{ y }} className="glass lift-2 flex min-h-[340px] flex-col justify-between gap-8 rounded-[30px] p-7 sm:p-8">
      <div>
        <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-brand text-brand-ink shadow-[var(--elev-1)]">
          <p.icon size={24} strokeWidth={1.6} aria-hidden />
        </span>
        <h3 className="display mt-7 text-[24px] leading-tight font-semibold tracking-[-0.02em]">{t(p.title)}</h3>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{t(p.text)}</p>
      </div>
      <Art />
    </motion.li>
  );
}

export function Banks() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  return (
    <section ref={ref} id="banklar" className="scroll-mt-24 py-24 lg:py-36" aria-labelledby="banklar-h">
      <div className={WRAP}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <Reveal>
              <Eyebrow n="05">{t("Banklar uchun")}</Eyebrow>
            </Reveal>
            <Reveal i={1}>
              <h2 id="banklar-h" className={H2}>
                {t("Ko'rinmas biznes — ko'rinadigan pul oqimi.")}
              </h2>
            </Reveal>
          </div>
          <Reveal i={2}>
            <p className="max-w-[500px] text-[17px] leading-relaxed text-ink-2 lg:ml-auto">
              {t("Mikro biznesda hisobot ham, tarix ham yo'q. Bu yerda pul oqimi har kuni, egasining roziligi bilan ko'rinadi — kredit qarori taxmin emas, ma'lumot asosida.")}
            </p>
          </Reveal>
        </div>
        <ul className="mt-14 grid gap-5 md:grid-cols-3 lg:mt-20 lg:gap-6">
          {BANK_POINTS.map((p) => (
            <BankPanel key={p.title} p={p} prog={scrollYProgress} />
          ))}
        </ul>
      </div>
    </section>
  );
}
