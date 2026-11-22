// /login — минимальный вход на сайт: одна кнопка «Войти в демо (Alisher Savdo)». Регистрации пока нет.
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { sessionToken, setToken } from "../lib/auth";
import { LangSwitch, t } from "../lib/i18n";
import { inTelegram } from "../lib/telegram";
import { LiquidBg } from "../ui/Liquid";
import { Logo } from "../ui/bits";
import { toast } from "../ui/Toast";

export function Login() {
  const nav = useNavigate();
  const { search } = useLocation();
  const [busy, setBusy] = useState(false);
  if (inTelegram) return <Navigate to="/tg" replace />;
  if (sessionToken()) return <Navigate to={`/app${search}`} replace />;

  const enter = async () => {
    setBusy(true);
    try {
      const r = await api.authDemo();
      setToken(r.token);
      nav(`/app${search}`, { replace: true });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("Server bilan aloqa yo'q"), "neg");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      <LiquidBg speed={0.35} blur={90} />
      <header className="relative z-10 mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 py-5 sm:px-8">
        <Link to="/" className="rounded-el" aria-label={t("bosh sahifa")}>
          <Logo />
        </Link>
        <LangSwitch compact />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-20">
        <section className="glass lift-3 w-full max-w-[440px] rounded-[32px] p-8 sm:p-10" aria-labelledby="login-h">
          <h1 id="login-h" className="display text-[30px] leading-[1.08] font-bold tracking-[-0.035em]">
            {t("Flowcast'ga kirish")}
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{t("Demo biznesda hamma narsani sinab ko'ring: pul chizig'i, qarzlar, eslatmalar.")}</p>
          <button
            onClick={enter}
            disabled={busy}
            className="btn-fx mt-8 flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-brand px-6 text-[16px] font-semibold text-brand-ink hover:bg-brand-hover disabled:opacity-70"
          >
            {busy ? <Loader2 size={19} className="animate-spin" /> : null}
            {t("Demoga kirish (Alisher Savdo)")}
            {!busy && <ArrowRight size={18} />}
          </button>
          <p className="mt-5 text-center text-[13px] text-ink-3">{t("Ro'yxatdan o'tish tez orada. Telegram'da — botdagi «Hisobim» tugmasi.")}</p>
        </section>
      </main>
    </div>
  );
}
