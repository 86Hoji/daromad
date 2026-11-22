// Оболочка Mini App /tg: нижняя панель Главная · Операции · [ + ] · Долги · Ещё.
// [ + ] открывает лист действий (AddFlow): голос, скан чека / накладной, текст. Плавающих кнопок нет.
import { Home, ListOrdered, Menu, Plus, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ReminderProvider } from "../features/Reminder";
import { LiveProvider } from "../lib/live";
import { haptic } from "../lib/telegram";
import { AddFlow, openAdd } from "./AddFlow";
import { tx, type TxKey } from "./i18n.tg";

const TAB_H = 62;

/** Экраны вкладки «Ещё»: подсвечиваем её и на вложенных страницах. */
const MORE_PATHS = ["/tg/yana", "/tg/hisobot", "/tg/jurnal", "/tg/sozlamalar"];

const TABS: { to: string; text: TxKey; icon: typeof Home; end?: boolean }[] = [
  { to: "/tg", text: "navHome", icon: Home, end: true },
  { to: "/tg/amallar", text: "navOps", icon: ListOrdered },
  { to: "/tg/qarzlar", text: "navDebts", icon: Users },
  { to: "/tg/yana", text: "navMore", icon: Menu },
];

function Tab({ to, text, icon: Icon, end }: (typeof TABS)[number]) {
  const { pathname } = useLocation();
  const more = to === "/tg/yana" && MORE_PATHS.some((p) => pathname.startsWith(p));
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => haptic("light")}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive || more ? "text-ink" : "text-ink-3"}`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={22} strokeWidth={isActive || more ? 2.1 : 1.6} />
          <span className="max-w-full truncate px-0.5">{tx(text)}</span>
        </>
      )}
    </NavLink>
  );
}

function TabBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={tx("navMore")}
    >
      <div className="mx-auto grid max-w-[560px] grid-cols-5" style={{ height: TAB_H }}>
        <Tab {...TABS[0]} />
        <Tab {...TABS[1]} />
        <div className="flex items-start justify-center">
          <button
            onClick={() => openAdd("menu")}
            aria-label={tx("add")}
            className="-mt-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-ink shadow-float ring-4 ring-bg active:scale-95"
          >
            <Plus size={28} strokeWidth={2.2} />
          </button>
        </div>
        <Tab {...TABS[2]} />
        <Tab {...TABS[3]} />
      </div>
    </nav>
  );
}

export function TgLayout() {
  return (
    <LiveProvider>
      <ReminderProvider>
        <div className="min-h-dvh bg-bg" style={{ "--tg-tabbar-h": `${TAB_H}px` } as CSSProperties}>
          {/* сверху — вырез экрана и шапка Telegram в полноэкранном режиме; снизу — панель вкладок */}
          <main
            className="mx-auto max-w-[560px] px-4"
            style={{
              paddingTop: "calc(12px + max(env(safe-area-inset-top), var(--tg-safe-area-inset-top, 0px)) + var(--tg-content-safe-area-inset-top, 0px))",
              paddingBottom: `calc(${TAB_H + 28}px + env(safe-area-inset-bottom))`,
            }}
          >
            <Outlet />
          </main>
          <AddFlow />
          <TabBar />
        </div>
      </ReminderProvider>
    </LiveProvider>
  );
}
