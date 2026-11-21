// Обёртка над Telegram WebApp. Вне Telegram скрипт тоже создаёт объект, но initData пустой.

type Haptic = "success" | "error" | "warning" | "light" | "medium";

interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  subtitle_text_color?: string;
  button_color?: string;
}

interface TgButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TgMainButton extends TgButton {
  setText(text: string): void;
  setParams?(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }): void;
  showProgress?(leaveActive?: boolean): void;
  hideProgress?(): void;
  enable?(): void;
  disable?(): void;
}

interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams?: ThemeParams;
  version?: string;
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent?(event: string, cb: () => void): void;
  BackButton?: TgButton;
  MainButton?: TgMainButton;
  HapticFeedback?: {
    notificationOccurred(type: "success" | "error" | "warning"): void;
    impactOccurred(style: "light" | "medium" | "heavy"): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | undefined = window.Telegram?.WebApp;
export const initData: string = tg?.initData ?? "";
export const inTelegram = initData.length > 0;

// --- тема ----------------------------------------------------------------------------

export type Theme = "light" | "dark";
export type ThemePref = Theme | "system";

const PREF_KEY = "daromad-theme";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setThemePref(p: ThemePref) {
  try {
    if (p === "system") localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, p);
  } catch {
    /* приватный режим */
  }
  applyTheme();
}

export function currentTheme(): Theme {
  if (inTelegram && tg) return tg.colorScheme;
  const p = getThemePref();
  return p === "system" ? systemTheme() : p;
}

/** themeParams Telegram -> наши токены фона и текста; акценты (Lapis, смысловые) остаются нашими. */
function applyTelegramParams(theme: Theme) {
  const root = document.documentElement.style;
  const p = tg?.themeParams ?? {};
  const set = (name: string, v?: string) => (v ? root.setProperty(name, v) : root.removeProperty(name));
  set("--bg", p.secondary_bg_color ?? p.bg_color);
  set("--surface", p.section_bg_color ?? p.bg_color);
  set("--ink", p.text_color);
  set("--ink-3", p.hint_color);
  set("--ink-2", p.subtitle_text_color ?? p.hint_color);
  const bg = p.secondary_bg_color ?? p.bg_color ?? (theme === "dark" ? "#0b1430" : "#f4f6fa");
  try {
    tg?.setHeaderColor?.(bg);
    tg?.setBackgroundColor?.(bg);
    tg?.setBottomBarColor?.(p.section_bg_color ?? p.bg_color ?? bg);
  } catch {
    /* старые клиенты Telegram */
  }
}

export function applyTheme(theme: Theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  if (inTelegram) applyTelegramParams(theme);
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#f4f6fa");
}

export function setupTelegram() {
  applyTheme();
  if (inTelegram && tg) {
    tg.ready();
    tg.expand();
    tg.onEvent?.("themeChanged", () => applyTheme());
  } else {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      if (getThemePref() === "system") applyTheme();
    });
  }
}

export function haptic(kind: Haptic) {
  const h = tg?.HapticFeedback;
  if (!inTelegram || !h) return;
  try {
    if (kind === "light" || kind === "medium") h.impactOccurred(kind);
    else h.notificationOccurred(kind);
  } catch {
    /* noop */
  }
}

export const tgBackButton = () => (inTelegram ? tg?.BackButton : undefined);
export const tgMainButton = () => (inTelegram ? tg?.MainButton : undefined);
