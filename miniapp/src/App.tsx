// Один код, три оболочки: лендинг (/), дашборд (/app), Mini App (/tg) + страница оплаты (/pay/:token).
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { AppDebts, AppHome, AppJournal, AppReport } from "./app/pages";
import { inTelegram } from "./lib/telegram";
import { Pay } from "./screens/Pay";
import TgApp from "./tg/TgApp";
import { ToastHost } from "./ui/Toast";

const Landing = lazy(() => import("./landing/Landing"));

export default function App() {
  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            inTelegram ? (
              <Navigate to="/tg" replace />
            ) : (
              <Suspense fallback={<div className="min-h-dvh bg-bg" />}>
                <Landing />
              </Suspense>
            )
          }
        />
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<AppHome />} />
          <Route path="qarzlar" element={<AppDebts />} />
          <Route path="hisobot" element={<AppReport />} />
          <Route path="jurnal" element={<AppJournal />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="/tg/*" element={<TgApp />} />
        <Route path="/pay/:token" element={<Pay />} />
        <Route path="*" element={<Navigate to={inTelegram ? "/tg" : "/"} replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}
