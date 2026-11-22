// Лендинг: hero -> проблема -> как работает -> песочница -> доверие -> банкам -> финальный CTA.
import { Play, Send } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "../lib/brand";
import { useLenis, useMagnet, useSpotlight } from "../lib/fx";
import { Logo, ThemeToggle } from "../ui/bits";
import { LangSwitch, t } from "../lib/i18n";
import { LiquidBg, setLiquidBoost } from "../ui/Liquid";
import { HeroScene } from "./HeroScene";
import { Banks, HowItWorks, Problem, SandboxSection, Trust, WRAP } from "./Sections";

const BOT_URL =
  (import.meta.env.VITE_BOT_URL as string | undefined) ||
  "https://t.me/daromad_hoji_test_bot";
function CtaLink({ to, href, children, primary = false, icon }: { to?: string; href?: string; children: ReactNode; primary?: boolean; icon: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnet(ref, true, 0.3, 12);
  const cls = `btn-fx inline-flex h-14 items-center justify-center gap-2.5 rounded-full px-7 text-[16px] font-medium ${
    primary ? "bg-brand text-brand-ink shadow-[var(--elev-2)] hover:bg-brand-hover" : "glass lift-1 text-ink"
  }`;
  return to ? (
    <Link ref={ref} to={to} className={cls}>
      {icon}
      {children}
    </Link>
  ) : (
    <a ref={ref} href={href} target="_blank" rel="noreferrer" className={cls}>
      {icon}
      {children}
    </a>
  );
}

function Ctas({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${className}`}>
      <CtaLink to="/login" primary icon={<Play size={18} strokeWidth={1.9} aria-hidden />}>
        {t("Demo'ni ochish")}
      </CtaLink>
      <CtaLink href={BOT_URL} icon={<Send size={18} strokeWidth={1.75} aria-hidden />}>
        {t("Telegram'da ochish")}
      </CtaLink>
    </div>
  );
}

function Header() {
  const link = "rounded-full px-3.5 py-2 text-[15px] text-ink-2 transition-colors hover:bg-surface-2/60 hover:text-ink";
  return (
    <header className="fixed inset-x-0 top-3 z-40 px-3 sm:top-4">
      <div className="glass lift-2 mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 rounded-full pr-2 pl-5">
        <Link to="/" aria-label={`${BRAND} — ${t("bosh sahifa")}`} className="rounded-full">
          <Logo size={26} />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label={t("Sahifa bo'limlari")}>
          <a href="#qanday" className={link}>
            {t("Qanday ishlaydi")}
          </a>
          <a href="#sinov" className={link}>
            {t("Sinab ko'ring")}
          </a>
          <a href="#banklar" className={link}>
            {t("Banklar uchun")}
          </a>
        </nav>
        <div className="flex items-center gap-1.5">
          <LangSwitch compact />
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link to="/login" className="btn-fx inline-flex h-10 items-center rounded-full bg-brand px-5 text-[15px] font-medium text-brand-ink hover:bg-brand-hover">
            Demo
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Плавающие стеклянные фишки вокруг сцены — глубина. */
function Floater({ className, children, delay = 0, depth = 1 }: { className: string; children: ReactNode; delay?: number; depth?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      className={`glass absolute z-0 hidden rounded-full px-4 py-2.5 text-[14px] lg:flex ${className}`}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: [0, -10 * depth, 0] }}
      transition={reduce ? {} : { opacity: { delay, duration: 0.8 }, y: { delay, duration: 6 + depth * 2, repeat: Infinity, ease: "easeInOut" } }}
    >
      {children}
    </motion.div>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const rise = (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 28 }, animate: { opacity: 1, y: 0 }, transition: { type: "spring" as const, stiffness: 90, damping: 18, delay: 0.1 + i * 0.12 } };
  return (
    <section className="relative flex min-h-[100svh] items-center pt-28 pb-16 lg:pt-24" aria-labelledby="hero-h">
      <div className={`${WRAP} grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14`}>
        <div className="relative z-10">
          <motion.div {...rise(0)} className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13.5px] text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-pos" aria-hidden /> {t("Kichik va mikro biznes uchun")}
          </motion.div>
          <motion.h1 {...rise(1)} id="hero-h" className="display mt-6 text-[clamp(40px,4.7vw,74px)] leading-[1] font-bold tracking-[-0.045em]">
            {t("Gapiring.")}
            <span className="mt-1 block bg-gradient-to-br from-ink to-ink-3 bg-clip-text pb-1 text-transparent">{t("Pulingizni oldindan biling.")}</span>
          </motion.h1>
          <motion.p {...rise(2)} className="mt-7 max-w-[480px] text-[18px] leading-relaxed text-ink-2 sm:text-[19px]">
            {t("Ovozli moliyaviy yordamchi: savdo, xarajat va qarzlar — ovoz bilan, bo'sh pul — oldindan.")}
          </motion.p>
          <motion.div {...rise(3)}>
            <Ctas className="mt-9" />
          </motion.div>
          <motion.p {...rise(4)} className="mt-5 text-[14px] text-ink-3">
            {t("Ro'yxatdan o'tmasdan · o'zbek va rus tilida · tasdiqlamaguningizcha hech narsa saqlanmaydi")}
          </motion.p>
        </div>

        <motion.div
          className="relative"
          initial={reduce ? false : { opacity: 0, scale: 0.94, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.15 }}
        >
          <Floater className="-top-10 left-6" delay={1.2} depth={1.2}>
            <span className="text-pos-text">+2 300 000</span>&nbsp;<span className="text-ink-3">{t("sotuv · bugun")}</span>
          </Floater>
          <Floater className="-bottom-12 left-[-36px]" delay={1.8} depth={0.8}>
            <span className="text-ink-3">{t("Akmal · tovar ·")}</span>&nbsp;<span className="text-ink">{t("3 mln, payshanba")}</span>
          </Floater>
          <div className="glass lift-3 relative z-10 rounded-[32px] p-6 sm:p-9">
            <HeroScene />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  useEffect(() => {
    setLiquidBoost(inView ? 4 : 1);
    return () => setLiquidBoost(1);
  }, [inView]);
  return (
    <section ref={ref} className="relative" aria-labelledby="final-h">
      <div className={`${WRAP} py-28 lg:py-40`}>
        <h2
          id="final-h"
          className="display max-w-[980px] bg-gradient-to-b from-ink via-ink to-ink-3/40 bg-clip-text pb-2 text-[clamp(44px,7vw,112px)] leading-[0.98] font-bold tracking-[-0.045em] text-transparent"
        >
          {t("Ertangi pulni bugun ko'ring.")}
        </h2>
        <p className="mt-6 max-w-[560px] text-[18px] leading-relaxed text-ink-2">{t("Demo biznes tayyor: qarzlar, to'lovlar va payshanbadagi kamomad bilan.")}</p>
        <Ctas className="mt-10" />
      </div>
      <footer className="relative">
        <div className={`${WRAP} pb-8`}>
          <div className="glass flex flex-col gap-4 rounded-[20px] px-6 py-5 text-[14px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
            <Logo size={24} />
            <span>{t("Inha FinTech Hackathon 2026 · jamoa: [Jamoa nomi]")}</span>
          </div>
        </div>
      </footer>
    </section>
  );
}

export default function Landing() {
  useLenis();
  useSpotlight();
  return (
    <div className="relative min-h-dvh">
      <LiquidBg speed={1} blur={90} />
      <a
        href="#muammo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-el focus:bg-surface focus:px-4 focus:py-2"
      >
        {t("Asosiy qismga o'tish")}
      </a>
      <Header />
      <div className="relative z-10">
        <Hero />
        <main>
          <Problem />
          <HowItWorks />
          <SandboxSection />
          <Trust />
          <Banks />
        </main>
        <FinalCta />
      </div>
    </div>
  );
}
