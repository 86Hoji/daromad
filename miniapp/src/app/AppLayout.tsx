// Оболочка дашборда /app: сайдбар на ≥1280, верхняя навигация ниже; голосовой док снизу.
import { BRAND } from "../lib/brand";
import { BookText, Home, LogOut, PieChart, Users } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { clearToken, sessionToken } from "../lib/auth";
import { ReminderProvider } from "../features/Reminder";
import { LiveProvider, useLive } from "../lib/live";
import { useLenis, useSpotlight } from "../lib/fx";
import { LiquidBg } from "../ui/Liquid";
import { Chip, LiveDot, Logo, ThemeToggle } from "../ui/bits";
import { DemoResetButton, DemoResetHotkey } from "./DemoReset";
import { VoiceOverlay } from "./VoiceOverlay";
import { LangSwitch, t } from "../lib/i18n";

const NAV = [
  { to: "/app", label: "Bosh", icon: Home, end: true },
  { to: "/app/qarzlar", label: "Qarzlar", icon: Users },
  { to: "/app/hisobot", label: "Hisobot", icon: PieChart },
  { to: "/app/jurnal", label: "Jurnal", icon: BookText },
];

/** «Выйти»: удалить сессию на сервере и в браузере -> /login. */
function LogoutButton({ compact = false }: { compact?: boolean }) {
  const nav = useNavigate();
  if (!sessionToken()) return null;
  const out = async () => {
    try {
      await api.logout();
    } catch {
      /* офлайн — всё равно выходим локально */
    }
    clearToken();
    nav("/login", { replace: true });
  };
  return (
    <button
      onClick={out}
      aria-label={t("Chiqish")}
      title={t("Chiqish")}
      className={`inline-flex h-9 items-center gap-1.5 rounded-el px-2.5 text-[13px] text-ink-3 transition hover:bg-surface-2 hover:text-ink ${compact ? "h-10" : ""}`}
    >
      <LogOut size={15} strokeWidth={1.75} />
      {!compact && t("Chiqish")}
    </button>
  );
}

function Sidebar() {
  const { summary, updatedAt, error } = useLive();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col px-5 py-6 xl:flex">
      <NavLink to="/" className="rounded-el px-2 py-1" aria-label={`${BRAND} — ${t("bosh sahifa")}`}>
        <Logo />
      </NavLink>

      <div className="glass mt-8 rounded-el px-4 py-3.5">
        <div className="truncate text-[15px] font-semibold">{summary?.shop.name ?? "Alisher Savdo"}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <Chip tone="brand">{t("demo")}</Chip>
          <span className="text-[13px] text-ink-3">{t("mikro biznes")}</span>
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-1" aria-label={t("Bo'limlar")}>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex h-11 items-center gap-3 rounded-el px-3 text-[15px] font-medium transition ${
                isActive ? "bg-surface text-ink" : "text-ink-3 hover:bg-surface/60 hover:text-ink"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={19} strokeWidth={isActive ? 2 : 1.6} className={isActive ? "text-brand-text" : ""} />
                {t(label)}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-1">
        <LangSwitch className="mb-3" />
        <DemoResetButton />
        <LogoutButton />
        <div className="mt-1 flex items-center justify-between gap-2">
          <LiveDot at={updatedAt} error={error} />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

function TopNav() {
  const { summary, updatedAt, error } = useLive();
  return (
    <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur xl:hidden">
      <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-4 pt-3 pb-2 sm:px-6">
        <NavLink to="/" aria-label={`${BRAND} — ${t("bosh sahifa")}`} className="rounded-el">
          <Logo size={26} />
        </NavLink>
        <div className="flex items-center gap-1">
          <span className="hidden text-[14px] text-ink-2 sm:inline">{summary?.shop.name}</span>
          <Chip tone="brand" className="ml-2 hidden sm:inline-flex">
            {t("demo")}
          </Chip>
          <LangSwitch compact className="ml-2" />
          <ThemeToggle />
          <LogoutButton compact />
        </div>
      </div>
      <nav className="no-scrollbar mx-auto flex max-w-[960px] gap-1 overflow-x-auto px-4 pb-2.5 sm:px-6" aria-label={t("Bo'limlar")}>
        {NAV.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `h-9 shrink-0 rounded-full px-4 text-[14.5px] leading-9 font-medium transition ${isActive ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`
            }
          >
            {t(label)}
          </NavLink>
        ))}
        <span className="ml-auto hidden shrink-0 items-center sm:flex">
          <LiveDot at={updatedAt} error={error} />
        </span>
      </nav>
    </header>
  );
}

export function AppLayout() {
  useSpotlight();
  useLenis();
  return (
    <LiveProvider>
      <ReminderProvider>
        <div className="min-h-dvh">
          <LiquidBg speed={0.45} blur={90} />
          <Sidebar />
          <TopNav />
          {/* резерв снизу под голосовой док: контент никогда не уходит под него */}
          <main className="relative z-10 px-4 pt-4 pb-[calc(116px+env(safe-area-inset-bottom))] sm:px-6 xl:ml-[248px] xl:px-10 xl:pt-8">
            <div className="mx-auto max-w-[960px] xl:max-w-[1320px]">
              <Outlet />
            </div>
          </main>
          <VoiceOverlay />
          <DemoResetHotkey />
        </div>
      </ReminderProvider>
    </LiveProvider>
  );
}
