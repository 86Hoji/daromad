import { NavLink, Route, Routes } from "react-router-dom";
import { IconChart, IconHome, IconUsers } from "./components/icons";
import { ToastHost } from "./components/ui";
import { LiveProvider, useLive } from "./lib/live";
import { inTelegram } from "./lib/telegram";
import { Debts } from "./screens/Debts";
import { Home } from "./screens/Home";
import { Pay } from "./screens/Pay";
import { Report } from "./screens/Report";

const TABS = [
  { to: "/", label: "Bosh", icon: IconHome },
  { to: "/qarzlar", label: "Qarzlar", icon: IconUsers },
  { to: "/hisobot", label: "Hisobot", icon: IconChart },
];

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/pay/:token" element={<Pay />} />
        <Route
          path="*"
          element={
            <LiveProvider>
              <Shell />
            </LiveProvider>
          }
        />
      </Routes>
      <ToastHost />
    </>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-10">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/qarzlar" element={<Debts />} />
          <Route path="/hisobot" element={<Report />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}

function LiveDot() {
  const { updatedAt, error } = useLive();
  const t = updatedAt ? updatedAt.toTimeString().slice(0, 8) : "—";
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-ink-3" title="Har 5 soniyada yangilanadi">
      <span className={`h-1.5 w-1.5 rounded-full ${error ? "bg-neg" : "bg-pos"}`} />
      {error ? "aloqa yo'q" : <span className="num">jonli · {t}</span>}
    </span>
  );
}

function Header() {
  const { summary } = useLive();
  return (
    <header className="sticky top-0 z-20 border-b border-transparent bg-bg/85 backdrop-blur-md lg:border-line">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:h-[68px] lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden text-[17px] font-extrabold tracking-tight lg:inline">Daromad</span>
          <span className="hidden h-5 w-px bg-line lg:inline" />
          <span className="truncate text-[15px] font-semibold lg:font-medium lg:text-ink-2">{summary?.shop.name ?? "Daromad"}</span>
          {!inTelegram && (
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-3 sm:inline">demo</span>
          )}
        </div>
        <nav className="hidden items-center gap-1 rounded-2xl border border-line bg-surface p-1 lg:flex">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end
              className={({ isActive }) =>
                `rounded-xl px-4 py-2 text-[14px] font-semibold transition ${isActive ? "bg-btn text-btn-ink" : "text-ink-2 hover:text-ink"}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <LiveDot />
      </div>
    </header>
  );
}

function TabBar() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-3">
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${isActive ? "text-ink" : "text-ink-3"}`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
