// Mini App /tg целиком: знакомство при первом запуске, потом оболочка с вкладками.
// Маршруты /tg/* живут здесь, а не в App.tsx — сайт и Mini App правятся независимо.
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { isOnboarded, onRestartIntro, Onboarding } from "./Onboarding";
import { TgLayout } from "./TgLayout";
import { TgDebtDetail, TgDebts, TgHome, TgReport } from "./pages";

export default function TgApp() {
  const [done, setDone] = useState(isOnboarded);
  useEffect(() => onRestartIntro(() => setDone(false)), []);

  if (!done) return <Onboarding onDone={() => setDone(true)} />;
  return (
    <Routes>
      <Route element={<TgLayout />}>
        <Route index element={<TgHome />} />
        <Route path="qarzlar" element={<TgDebts />} />
        <Route path="qarzlar/:id" element={<TgDebtDetail />} />
        <Route path="hisobot" element={<TgReport />} />
        <Route path="*" element={<Navigate to="/tg" replace />} />
      </Route>
    </Routes>
  );
}
