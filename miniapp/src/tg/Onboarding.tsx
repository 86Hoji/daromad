// Первый запуск Mini App: 3 экрана знакомства (свайп) -> «Продолжить как <имя>» -> «Открыть демо-бизнес».
// Флаг «знакомство пройдено» — в localStorage; в настройках его можно сбросить («Пройти знакомство заново»).
import { Check, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { moneyShort } from "../lib/format";
import { haptic, tg } from "../lib/telegram";
import { Button } from "../ui/Button";
import { LogoMark } from "../ui/bits";
import { tx, type TxKey } from "./i18n.tg";

const KEY = "flowcast.tg.onboarded";
const RESTART = "flowcast:tg-intro";
/** Демо-владелец: имя вне Telegram (в браузере) */
const DEMO_OWNER = "Alisher";
const DEMO_SHOP = "Alisher Savdo";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* приватный режим — знакомство покажется снова, это не страшно */
  }
}

/** Настройки -> «Пройти знакомство заново». */
export function restartIntro() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new Event(RESTART));
}

/** Подписка на «Пройти знакомство заново» (TgApp). */
export function onRestartIntro(cb: () => void) {
  window.addEventListener(RESTART, cb);
  return () => window.removeEventListener(RESTART, cb);
}

function telegramName(): string {
  const user = (tg as { initDataUnsafe?: { user?: { first_name?: string } } } | undefined)?.initDataUnsafe?.user;
  return user?.first_name?.trim() || DEMO_OWNER;
}

const SLIDES: { title: TxKey; text: TxKey; art: () => JSX.Element }[] = [
  { title: "intro1Title", text: "intro1Text", art: ArtVoice },
  { title: "intro2Title", text: "intro2Text", art: ArtMoney },
  { title: "intro3Title", text: "intro3Text", art: ArtYes },
];

function ArtVoice() {
  return (
    <div className="flex flex-col items-center gap-4">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-brand text-brand-ink shadow-float">
        <Mic size={40} strokeWidth={1.75} />
      </span>
      <span className="rounded-full bg-surface px-4 py-2 text-[14px] text-ink-2 shadow-[var(--elev-1)]">{tx("introSay")}</span>
      <span className="flex items-center gap-3 rounded-el bg-surface px-4 py-3 shadow-[var(--elev-1)]">
        <span className="text-[14px] text-ink-2">{tx("introSaved")}</span>
        <span className="display text-[17px] font-bold text-pos-text">+{moneyShort(1_000_000)}</span>
      </span>
    </div>
  );
}

function ArtMoney() {
  return (
    <div className="flex w-full max-w-[300px] flex-col items-start gap-3 rounded-panel bg-surface p-5 shadow-[var(--elev-1)]">
      <span className="flex items-center gap-2 text-[14px] text-ink-2">
        <span className="h-2 w-2 rounded-full bg-neg" aria-hidden />
        {tx("introFree")}
      </span>
      <span className="display text-[44px] leading-none font-bold text-neg-text">{moneyShort(-350_000)}</span>
      <span className="text-[14px] text-ink-3">{tx("introShort")}</span>
    </div>
  );
}

function ArtYes() {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-surface text-ink shadow-float">
        <Check size={44} strokeWidth={2} />
      </span>
      <div className="mt-2 grid w-[240px] grid-cols-2 gap-2">
        <span className="flex h-12 items-center justify-center rounded-el bg-surface-2 text-[16px] font-medium text-ink-2">{tx("no")}</span>
        <span className="flex h-12 items-center justify-center rounded-el bg-brand text-[16px] font-medium text-brand-ink">{tx("yes")}</span>
      </div>
    </div>
  );
}

// сверху — вырез экрана и шапка Telegram в полноэкранном режиме (CSS-переменные ставит telegram-web-app.js)
const screen =
  "mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-bg pt-[calc(16px+max(env(safe-area-inset-top),var(--tg-safe-area-inset-top,0px))+var(--tg-content-safe-area-inset-top,0px))] pb-[calc(20px+env(safe-area-inset-bottom))]";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"intro" | "auth" | "biz">("intro");
  if (step === "intro") return <Intro onDone={() => setStep("auth")} />;
  if (step === "auth") return <Auth onNext={() => setStep("biz")} />;
  return (
    <Biz
      onOpen={() => {
        markOnboarded();
        haptic("success");
        onDone();
      }}
    />
  );
}

function Intro({ onDone }: { onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;

  // пока идёт плавная прокрутка к слайду по кнопке, промежуточные позиции не меняют точку и подпись кнопки
  const target = useRef<number | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const go = (n: number) => {
    const el = track.current;
    if (!el) return;
    target.current = n;
    window.clearTimeout(timer.current);
    const left = n * el.clientWidth;
    // запасной ход: если плавная прокрутка не случилась (старый WebView, фоновая вкладка) — ставим слайд сразу
    timer.current = window.setTimeout(() => {
      if (Math.abs(el.scrollLeft - left) > 2) el.scrollTo({ left });
      target.current = null;
    }, 600);
    setI(n);
    haptic("light");
    el.scrollTo({ left, behavior: "smooth" });
  };

  const onScroll = () => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const n = Math.round(el.scrollLeft / el.clientWidth);
    if (target.current !== null) {
      if (n === target.current) target.current = null;
      return;
    }
    if (n !== i) {
      setI(n);
      haptic("light");
    }
  };

  return (
    <div className={screen}>
      <div className="flex h-10 items-center justify-between px-5">
        <LogoMark size={26} />
        {!last && (
          <button onClick={onDone} className="h-10 px-2 text-[15px] font-medium text-ink-3 active:text-ink">
            {tx("skip")}
          </button>
        )}
      </div>
      <div
        ref={track}
        onScroll={onScroll}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map(({ title, text, art: Art }, n) => (
          <section key={title} aria-hidden={n !== i} className="flex w-full shrink-0 snap-center flex-col px-6">
            <div className="flex flex-1 items-center justify-center py-6">
              <Art />
            </div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{tx(title)}</h1>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{tx(text)}</p>
          </section>
        ))}
      </div>
      <div className="px-6 pt-6">
        <div className="mb-5 flex justify-center gap-2" role="tablist">
          {SLIDES.map((s, n) => (
            <button
              key={s.title}
              role="tab"
              aria-selected={n === i}
              aria-label={`${n + 1} / ${SLIDES.length}`}
              onClick={() => go(n)}
              className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-ink" : "w-2 bg-surface-3"}`}
            />
          ))}
        </div>
        <Button size="lg" className="w-full" onClick={() => (last ? onDone() : go(i + 1))}>
          {last ? tx("start") : tx("next")}
        </Button>
      </div>
    </div>
  );
}

function Auth({ onNext }: { onNext: () => void }) {
  const name = telegramName();
  return (
    <div className={`${screen} px-6`}>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <LogoMark size={56} />
        <h1 className="mt-6 text-[26px] leading-tight font-semibold tracking-tight">{tx("authTitle")}</h1>
        <p className="mt-3 max-w-[32ch] text-[16px] text-balance text-ink-2">{tx("authText")}</p>
        <div className="mt-8 flex items-center gap-3 rounded-full bg-surface py-2 pr-5 pl-2 shadow-[var(--elev-1)]">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-[17px] font-semibold">{name[0]?.toUpperCase()}</span>
          <span className="text-[16px] font-medium">{name}</span>
        </div>
      </div>
      <Button
        size="lg"
        className="w-full"
        onClick={() => {
          haptic("light");
          onNext();
        }}
      >
        {tx("continueAs", { name })}
      </Button>
    </div>
  );
}

function Biz({ onOpen }: { onOpen: () => void }) {
  const [shop, setShop] = useState<{ name: string; owner: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .summary()
      .then((s) => alive && setShop({ name: s.shop.name, owner: s.shop.owner_name }))
      .catch(() => undefined); // нет связи — покажем демо-название, приложение само покажет ошибку
    return () => {
      alive = false;
    };
  }, []);
  const name = shop?.name ?? DEMO_SHOP;
  return (
    <div className={`${screen} px-6`}>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{tx("bizTitle")}</h1>
        <p className="mt-3 text-[16px] text-ink-2">{tx("bizText")}</p>
        <div className="mt-8 flex items-center gap-4 rounded-panel bg-surface p-4 shadow-[var(--elev-1)]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-[19px] font-semibold text-brand-ink">{name[0]?.toUpperCase()}</span>
          <div className="min-w-0">
            <div className="truncate text-[17px] font-semibold">{name}</div>
            <div className="text-[14px] text-ink-3">
              {shop?.owner ?? DEMO_OWNER} · {tx("demoBiz")}
            </div>
          </div>
        </div>
      </div>
      <Button size="lg" className="w-full" onClick={onOpen}>
        {tx("openDemo")}
      </Button>
    </div>
  );
}
