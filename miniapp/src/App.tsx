// Один код, три оболочки: лендинг (/), дашборд (/app), Mini App (/tg) + страница оплаты (/pay/:token).
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { AppDebts, AppHome, AppJournal, AppReport } from "./app/pages";
import { inTelegram } from "./lib/telegram";
import { Pay } from "./screens/Pay";
import { TgLayout } from "./tg/TgLayout";
import { TgDebtDetail, TgDebts, TgHome, TgReport } from "./tg/pages";
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
        <Route path="/tg" element={<TgLayout />}>
          <Route index element={<TgHome />} />
          <Route path="qarzlar" element={<TgDebts />} />
          <Route path="qarzlar/:id" element={<TgDebtDetail />} />
          <Route path="hisobot" element={<TgReport />} />
          <Route path="*" element={<Navigate to="/tg" replace />} />
        </Route>
        <Route path="/pay/:token" element={<Pay />} />
        <Route path="*" element={<Navigate to={inTelegram ? "/tg" : "/"} replace />} />
      </Routes>
      <ToastHost />
    </>
  );
}
