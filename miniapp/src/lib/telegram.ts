// Обёртка над Telegram WebApp. Вне Telegram скрипт тоже создаёт объект, но initData пустой.

type Haptic = "success" | "error" | "warning" | "light" | "medium";

interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: string, cb: () => void): void;
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

export type Theme = "light" | "dark";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  return inTelegram && tg ? tg.colorScheme : systemTheme();
}

export function applyTheme(theme: Theme = currentTheme()) {
  document.documentElement.dataset.theme = theme;
  const bg = theme === "dark" ? "#0c0e11" : "#f2f4f7";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  if (inTelegram && tg) {
    try {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    } catch {
      /* старые клиенты Telegram */
    }
  }
}

export function setupTelegram() {
  applyTheme();
  if (inTelegram && tg) {
    tg.ready();
    tg.expand();
    tg.onEvent?.("themeChanged", () => applyTheme());
  } else {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => applyTheme());
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
