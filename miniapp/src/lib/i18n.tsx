// Языки интерфейса: RU (по умолчанию) / UZ / EN. Простая схема на словарях без библиотек.
//
// Ключ перевода — исходная строка на узбекском (как в gettext): t("Bo'sh pul") -> «Свободные деньги».
// Узбекский = сам ключ; ru/en берутся из словарей lib/locales/*.ts. Нет перевода — показываем ключ
// и пишем предупреждение в консоль (в dev). Подстановки: t("{n} ta mijoz", { n: 3 }).
//
// Выбор языка: сохранённый (localStorage) -> в Telegram language_code пользователя (ru/uz/en) -> RU.
// Смена языка перемонтирует дерево (key={lang}), поэтому обычные функции форматирования (money, untilLabel…)
// без хуков тоже сразу видят новый язык.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { BRAND, BRAND_TAGLINE } from "./brand";
import { EN } from "./locales/en";
import { RU } from "./locales/ru";

export type Lang = "ru" | "uz" | "en";
export const LANGS: Lang[] = ["ru", "uz", "en"];
export const LANG_LABEL: Record<Lang, string> = { ru: "RU", uz: "UZ", en: "EN" };
export const LANG_NAME: Record<Lang, string> = { ru: "Русский", uz: "O'zbekcha", en: "English" };

const STORAGE_KEY = "flowcast.lang";
const DICTS: Record<Lang, Record<string, string> | null> = { uz: null, ru: RU, en: EN };

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "ru" || v === "uz" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function telegramLang(): Lang | null {
  const code = (window.Telegram?.WebApp as { initDataUnsafe?: { user?: { language_code?: string } } } | undefined)
    ?.initDataUnsafe?.user?.language_code?.toLowerCase();
  if (!code) return null;
  if (code.startsWith("uz")) return "uz";
  if (code.startsWith("en")) return "en";
  if (code.startsWith("ru")) return "ru";
  return null;
}

export function detectLang(): Lang {
  return stored() ?? telegramLang() ?? "ru";
}

let current: Lang = detectLang();
const warned = new Set<string>();

export const getLang = (): Lang => current;

/** Перевод строки на текущий язык. vars: {name} в строке заменяется значением. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let s = dict ? dict[key] : key;
  if (s === undefined) {
    if (import.meta.env.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] ${current}: нет перевода для «${key}»`);
    }
    s = key;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Перевод, если он есть; иначе строка как есть, без предупреждения (данные пользователя, названия с бэка). */
export function tMaybe(key: string): string {
  const dict = DICTS[current];
  return (dict && dict[key]) || key;
}

/** Выбор по языку для фраз, которые нельзя собрать из одного шаблона (падежи, порядок слов). */
export function pick<T>(v: Record<Lang, T>): T {
  return v[current];
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangCtx = createContext<Ctx>({ lang: current, setLang: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* приватный режим — язык просто не запомнится */
    }
    setState(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${BRAND} — ${t(BRAND_TAGLINE)}`;
  }, [lang]);
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
      <div key={lang} className="contents">
        {children}
      </div>
    </LangCtx.Provider>
  );
}

export const useLang = () => useContext(LangCtx);

/** Переключатель RU / UZ / EN (шапка лендинга и /app, меню /tg). */
export function LangSwitch({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label={t("Til")} className={`inline-flex rounded-full bg-surface-2/80 p-0.5 ${className}`}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          title={LANG_NAME[l]}
          className={`btn-fx rounded-full font-medium ${compact ? "px-2 py-1 text-[12px]" : "px-2.5 py-1 text-[12.5px]"} ${
            lang === l ? "bg-surface text-ink shadow-[var(--elev-1)]" : "text-ink-3 hover:text-ink"
          }`}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
