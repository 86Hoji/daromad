// Mini App /tg целиком: знакомство при первом запуске, потом оболочка с вкладками.
// Маршруты /tg/* живут здесь, а не в App.tsx — сайт и Mini App правятся независимо.
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { tg } from "../lib/telegram";
import { TgJournal, TgMore, TgSettings } from "./More";
import { isOnboarded, onRestartIntro, Onboarding } from "./Onboarding";
import { TgOps } from "./Ops";
import { TgLayout } from "./TgLayout";
import { TgDebtDetail, TgDebts, TgHome, TgReport } from "./pages";

export default function TgApp() {
  const [done, setDone] = useState(isOnboarded);
  useEffect(() => onRestartIntro(() => setDone(false)), []);
  // свайп вниз не сворачивает Mini App (листы и прокрутка ленты; Bot API 7.7+, в старых клиентах метода нет)
  useEffect(() => {
    try {
      (tg as { disableVerticalSwipes?: () => void } | undefined)?.disableVerticalSwipes?.();
    } catch {
      /* старый клиент Telegram */
    }
  }, []);

  if (!done) return <Onboarding onDone={() => setDone(true)} />;
  return (
    <Routes>
      <Route element={<TgLayout />}>
        <Route index element={<TgHome />} />
        <Route path="amallar" element={<TgOps />} />
        <Route path="qarzlar" element={<TgDebts />} />
        <Route path="qarzlar/:id" element={<TgDebtDetail />} />
        <Route path="yana" element={<TgMore />} />
        <Route path="hisobot" element={<TgReport />} />
        <Route path="jurnal" element={<TgJournal />} />
        <Route path="sozlamalar" element={<TgSettings />} />
        <Route path="*" element={<Navigate to="/tg" replace />} />
      </Route>
    </Routes>
  );
}
