// Лендинг — шаг 4. Пока временная заглушка с переходом в демо.
import { Link } from "react-router-dom";
import { Logo } from "../ui/bits";

export default function Landing() {
  return (
    <div className="flex min-h-dvh flex-col items-start justify-center gap-6 bg-night px-6 text-white sm:px-16">
      <Logo light />
      <h1 className="font-display text-[40px] leading-tight font-semibold">Gapiring. Daromad pulingizni oldindan hisoblaydi.</h1>
      <Link to="/app" className="rounded-el bg-lapis px-6 py-3 font-medium">
        Demo'ni ochish
      </Link>
    </div>
  );
}
