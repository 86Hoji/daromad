// Лендинг: hero (Night) -> проблема -> как работает -> песочница -> доверие -> банкам -> финальный CTA.
import {
  BadgeCheck,
  CalendarClock,
  Camera,
  LineChart,
  MessageCircle,
  Play,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MoneyLine } from "../chart/MoneyLine";
import { DraftCards } from "../features/Drafts";
import { api, type Forecast } from "../lib/api";
import { Logo, ThemeToggle } from "../ui/bits";
import { EXAMPLES, demoForecast } from "./demo";
import { FACTS } from "./facts";
import { HeroScene, WAVE } from "./HeroScene";
import { Sandbox } from "./Sandbox";

const BOT_URL =
  (import.meta.env.VITE_BOT_URL as string | undefined) ||
  "https://t.me/daromad_hoji_test_bot";
const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";
const H2 =
  "font-display text-[clamp(28px,3.4vw,44px)] leading-[1.12] font-semibold tracking-[-0.025em]";
const LEAD =
  "mt-4 max-w-[640px] text-[17px] leading-relaxed text-ink-2 sm:text-[18px]";

function Ctas({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row ${className}`}>
      <Link
        to="/app"
        className="inline-flex h-14 items-center justify-center gap-2.5 rounded-[14px] bg-brand px-7 text-[16px] font-medium text-white transition-colors hover:bg-brand-hover"
      >
        <Play size={18} strokeWidth={1.75} aria-hidden />
        Demo'ni ochish
      </Link>
      <a
        href={BOT_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-14 items-center justify-center gap-2.5 rounded-[14px] bg-white/10 px-7 text-[16px] font-medium text-white transition-colors hover:bg-white/15"
      >
        <Send size={18} strokeWidth={1.75} aria-hidden />
        Telegram'da ochish
      </a>
    </div>
  );
}

function Header() {
  const link =
    "rounded-el px-3 py-2 text-[15px] text-ink-2 transition-colors hover:text-ink";
  return (
    <header className={`${WRAP} flex h-20 items-center justify-between gap-4`}>
      <Logo light />
      <nav
        className="hidden items-center gap-1 md:flex"
        aria-label="Sahifa bo'limlari"
      >
        <a href="#qanday" className={link}>
          Qanday ishlaydi
        </a>
        <a href="#sinov" className={link}>
          Sinab ko'ring
        </a>
        <a href="#banklar" className={link}>
          Banklar uchun
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          to="/app"
          className="inline-flex h-10 items-center rounded-el bg-white/10 px-4 text-[15px] font-medium text-white hover:bg-white/15"
        >
          Demo
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="on-night overflow-hidden">
      <Header />
      <div className={`${WRAP} pt-8 pb-20 lg:pt-16 lg:pb-28`}>
        <h1 className="max-w-[1120px] font-display text-[clamp(34px,5vw,68px)] leading-[1.06] font-bold tracking-[-0.035em]">
          <span className="text-brand-text">Gapiring.</span> Daromad pulingizni
          oldindan hisoblaydi.
        </h1>
        <div className="mt-10 grid items-start gap-12 lg:mt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
          <div className="lg:pt-4">
            <p className="max-w-[500px] text-[18px] leading-relaxed text-ink-2 sm:text-[19px]">
              Kichik va mikro biznes uchun ovozli moliyaviy yordamchi: savdo,
              xarajat va qarzlar — ovoz bilan, bo'sh pul — oldindan
            </p>
            <Ctas className="mt-9" />
            <p className="mt-5 max-w-[460px] text-[14px] text-ink-3">
              Ro'yxatdan o'tmasdan · o'zbek tilida · ma'lumot
              tasdiqlamaguningizcha saqlanmaydi
            </p>
          </div>
          <div className="rounded-panel bg-surface p-5 sm:p-7">
            <HeroScene />
          </div>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className={`${WRAP} py-20 lg:py-28`} aria-labelledby="muammo">
      <h2 id="muammo" className={`${H2} max-w-[760px]`}>
        Pul yetmasligi to'lov kuni bilinadi
      </h2>
      <p className={LEAD}>
        Kichik biznesda savdo, xarajat va qarzlar daftar va xotirada turadi.
        Bugun qancha bo'sh pul borligini — va payshanba kuni yetadimi — hech kim
        oldindan aytmaydi.
      </p>
      <dl className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
        {FACTS.map((f) => (
          <div key={f.value} className="sm:px-8 sm:first:pl-0 sm:last:pr-0">
            <dt className="display text-[clamp(40px,4.4vw,60px)] leading-none font-bold tracking-[-0.03em] text-brand-text">
              {f.value}
            </dt>
            <dd className="mt-4 text-[16px] leading-relaxed text-ink-2">
              {f.text}
            </dd>
            {f.source && (
              <dd className="mt-2 text-[13px] text-ink-3">{f.source}</dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

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

function Step({
  n,
  title,
  text,
  children,
  flip,
}: {
  n: number;
  title: string;
  text: string;
  children: ReactNode;
  flip?: boolean;
}) {
  return (
    <li className="grid items-center gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <div className={flip ? "lg:order-2" : ""}>
        <span className="display flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-[17px] font-semibold text-brand-text">
          {n}
        </span>
        <h3 className="mt-5 font-display text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h3>
        <p className="mt-3 max-w-[440px] text-[16.5px] leading-relaxed text-ink-2">
          {text}
        </p>
      </div>
      <div
        className={`rounded-panel bg-surface p-5 sm:p-7 ${flip ? "lg:order-1" : ""}`}
      >
        {children}
      </div>
    </li>
  );
}

function VoiceBubble() {
  return (
    <div className="space-y-4">
      <div className="flex w-fit items-center gap-3 rounded-[20px] rounded-br-[6px] bg-brand py-2.5 pr-5 pl-2.5 text-white sm:ml-auto">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
          <Play size={16} strokeWidth={2} fill="currentColor" aria-hidden />
        </span>
        <span className="flex h-7 items-center gap-[3px]" aria-hidden>
          {WAVE.map((v, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-white/85"
              style={{ height: `${20 + v * 80}%` }}
            />
          ))}
        </span>
        <span className="num text-[13px] text-white/80">0:06</span>
      </div>
      <div className="rounded-[20px] rounded-bl-[6px] bg-surface-2 px-4 py-3 sm:max-w-[85%]">
        <div className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <MessageCircle size={13} strokeWidth={1.75} aria-hidden /> eshitganim
        </div>
        <p className="mt-1 text-[16px]">«{EXAMPLES[0].text}»</p>
      </div>
    </div>
  );
}

function ConfirmDemo() {
  return (
    <div>
      <div className="mb-3 text-[15px] font-semibold">Yozib oldim</div>
      <DraftCards drafts={EXAMPLES[0].drafts} />
      <div className="mt-4 grid grid-cols-2 gap-2" aria-hidden>
        <span className="flex h-11 items-center justify-center rounded-el bg-surface-2 text-[15px] font-medium">
          Tuzatish
        </span>
        <span className="flex h-11 items-center justify-center rounded-el bg-brand text-[15px] font-medium text-white">
          To'g'ri
        </span>
      </div>
    </div>
  );
}

function HowItWorks() {
  const forecast = useLandingForecast();
  return (
    <section
      id="qanday"
      className="scroll-mt-6 bg-surface-2/60 py-20 lg:py-28"
      aria-labelledby="qanday-h"
    >
      <div className={WRAP}>
        <h2 id="qanday-h" className={`${H2} max-w-[760px]`}>
          Uch qadam: gapiring, tasdiqlang, oldindan biling
        </h2>
        <ol className="mt-14 space-y-16 lg:space-y-24">
          <Step
            n={1}
            title="Gapiring"
            text="Savdo, xarajat, qarz yoki kelgusi to'lovni o'zbekcha ayting yoki yozing. Telegram'dagi oddiy ovozli xabar ham bo'ladi."
          >
            <VoiceBubble />
          </Step>
          <Step
            flip
            n={2}
            title="Tasdiqlang"
            text="AI gapni yozuvlarga ajratadi, summalarni kod tekshiradi. Siz «To'g'ri» demaguningizcha hech narsa saqlanmaydi."
          >
            <ConfirmDemo />
          </Step>
          <Step
            n={3}
            title="Oldindan biling"
            text="Pul chizig'i keyingi 14 kunni ko'rsatadi: qaysi kuni pul yetmaydi va uni qaysi qarzlar yopadi."
          >
            <MoneyLine data={forecast} height={260} compact />
          </Step>
        </ol>
      </div>
    </section>
  );
}

function SandboxSection() {
  return (
    <section
      id="sinov"
      className={`${WRAP} scroll-mt-6 py-20 lg:py-28`}
      aria-labelledby="sinov-h"
    >
      <h2 id="sinov-h" className={H2}>
        O'zingiz sinab ko'ring
      </h2>
      <p className={LEAD}>
        Gapni yozing — Daromad uni qanday tushunishini ko'rasiz. Bu sinov: hech
        narsa saqlanmaydi.
      </p>
      <div className="mt-10">
        <Sandbox />
      </div>
    </section>
  );
}

const LEVELS = [
  {
    label: "So'zdan",
    text: "Ovoz yoki matndan. Siz tasdiqlagansiz, hujjat yo'q.",
    icon: MessageCircle,
    bar: "h-1/3 bg-ink-3/40",
    dot: "text-ink-3",
  },
  {
    label: "Skrinshot",
    text: "Chek, nakladnoy yoki ilova skrinshotidan.",
    icon: Camera,
    bar: "h-2/3 bg-brand",
    dot: "text-brand-text",
  },
  {
    label: "Tasdiqlangan",
    text: "Bank yoki to'lov havolasi orqali tushgan pul.",
    icon: BadgeCheck,
    bar: "h-full bg-pos",
    dot: "text-pos-text",
  },
];

function Trust() {
  return (
    <section
      className="bg-surface-2/60 py-20 lg:py-28"
      aria-labelledby="ishonch"
    >
      <div className={`${WRAP} grid gap-12 lg:grid-cols-2 lg:gap-16`}>
        <div>
          <h2 id="ishonch" className={H2}>
            AI tushunadi, kod hisoblaydi, siz tasdiqlaysiz.
          </h2>
          <p className={LEAD}>
            Har bir yozuvning ishonch darajasi bor. Hisobotda ham, bankda ham
            qaysi raqam qayerdan kelgani doim ko'rinadi. Summalarni til modeli
            emas, oddiy kod qo'shadi.
          </p>
        </div>
        <ol className="grid grid-cols-3 items-end gap-3 sm:gap-5">
          {LEVELS.map((l) => (
            <li key={l.label} className="flex h-full flex-col">
              <div
                className="flex h-40 items-end rounded-[18px] bg-surface p-2 sm:h-52"
                aria-hidden
              >
                <div className={`w-full rounded-[12px] ${l.bar}`} />
              </div>
              <div
                className={`mt-4 flex items-center gap-2 text-[15px] font-semibold ${l.dot}`}
              >
                <l.icon size={17} strokeWidth={1.75} aria-hidden />
                <span className="text-ink">{l.label}</span>
              </div>
              <p className="mt-1.5 text-[14px] leading-snug text-ink-3">
                {l.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const BANK_POINTS = [
  {
    icon: LineChart,
    title: "Kunlik pul oqimi",
    text: "Savdo, xarajat va qarzlar bir joyda, 14 kunlik prognoz va oraliq bilan.",
  },
  {
    icon: ShieldCheck,
    title: "Ma'lumot sifati",
    text: "Har bir raqamning manbasi ko'rinadi: so'zdan, skrinshot yoki bank tasdig'i.",
  },
  {
    icon: CalendarClock,
    title: "O'z vaqtidagi taklif",
    text: "Overdraft — pul yetmaydigan kundan oldin, omonat — bo'sh pul paydo bo'lganda. Egasi bitta tugma bilan rozi bo'ladi.",
  },
];

function Banks() {
  return (
    <section
      id="banklar"
      className="scroll-mt-6 bg-surface py-20 lg:py-28"
      aria-labelledby="banklar-h"
    >
      <div
        className={`${WRAP} grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}
      >
        <div>
          <h2 id="banklar-h" className={H2}>
            Banklar uchun
          </h2>
          <p className={LEAD}>
            Mikro biznes bank uchun ko'rinmas: hisobot yo'q, tarix yo'q. Daromad
            uning pul oqimini har kuni, egasining roziligi bilan ko'rsatadi —
            kredit qarorini taxmin emas, ma'lumot asosida qilish uchun.
          </p>
        </div>
        <ul className="divide-y divide-line">
          {BANK_POINTS.map((p) => (
            <li key={p.title} className="flex gap-5 py-6 first:pt-0 last:pb-0">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-el bg-brand-soft text-brand-text">
                <p.icon size={22} strokeWidth={1.5} aria-hidden />
              </span>
              <div>
                <h3 className="text-[18px] font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-[16px] leading-relaxed text-ink-2">
                  {p.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="on-night">
      <div className={`${WRAP} py-20 lg:py-28`}>
        <h2 className="font-display max-w-[820px] text-[clamp(32px,4.4vw,56px)] leading-[1.08] font-bold tracking-[-0.03em] text-balance">
          Ertangi pulni bugun ko'ring.
        </h2>
        <p className="mt-5 max-w-[560px] text-[18px] leading-relaxed text-ink-2">
          Demo biznes tayyor: qarzlar, to'lovlar va payshanbadagi kamomad bilan.
        </p>
        <Ctas className="mt-9" />
      </div>
      <footer className="border-t border-line">
        <div
          className={`${WRAP} flex flex-col gap-4 py-8 text-[14px] text-ink-3 sm:flex-row sm:items-center sm:justify-between`}
        >
          <Logo light size={24} />
          <span>Inha FinTech Hackathon 2026 · jamoa: [Jamoa nomi]</span>
        </div>
      </footer>
    </section>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = "Daromad — ovozli moliyaviy yordamchi";
  }, []);
  return (
    <div className="min-h-dvh bg-bg">
      <a
        href="#muammo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-el focus:bg-surface focus:px-4 focus:py-2"
      >
        Asosiy qismga o'tish
      </a>
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
  );
}
