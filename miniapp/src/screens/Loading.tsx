import { API_URL } from "../lib/api";
import { Spinner } from "../components/ui";

export function Loading({ error }: { error: string | null }) {
  if (error) {
    return (
      <div className="mx-auto mt-24 max-w-sm text-center">
        <div className="mb-2 text-[17px] font-semibold">Server bilan aloqa yo'q</div>
        <p className="text-[14px] leading-relaxed text-ink-2">
          {error}. Backend ishlab turganini tekshiring: <span className="num break-all text-ink">{API_URL}</span>
        </p>
        <p className="mt-3 text-[13px] text-ink-3">Har 5 soniyada qayta urinyapman…</p>
      </div>
    );
  }
  return (
    <div className="mt-32 flex justify-center text-ink-3">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
