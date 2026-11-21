// Отчёт: итоги периода, бары категорий, шкала доверия, журнал действий.
import { Bot, Cog, User } from "lucide-react";
import type { AuditItem, EntriesResp } from "../lib/api";
import { CATEGORY_LABEL, ddmm, money, moneyShort, timeHM } from "../lib/format";
import { AnimatedNumber } from "../ui/AnimatedNumber";

export function Totals({ entries, dense = false }: { entries: EntriesResp; dense?: boolean }) {
  const items = [
    { label: "Sotuv", v: entries.sales, cls: "" },
    { label: "Xarajat", v: entries.expenses, cls: "" },
    { label: "Foyda", v: entries.profit, cls: entries.profit >= 0 ? "text-pos-text" : "text-neg-text" },
  ];
  return (
    <dl className="grid grid-cols-3 gap-4">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[13px] text-ink-3">{it.label}</dt>
          <dd className={`display mt-1 truncate font-semibold ${dense ? "text-[18px]" : "text-[24px] lg:text-[28px]"} ${it.cls}`} title={money(it.v)}>
            {dense ? moneyShort(it.v) : <AnimatedNumber value={it.v} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CategoryBars({ data }: { data: Record<string, number> }) {
  const cats = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...cats.map(([, v]) => v));
  const total = cats.reduce((s, [, v]) => s + v, 0) || 1;
  if (cats.length === 0) return <p className="text-ink-3">Bu davrda xarajat yo'q.</p>;
  return (
    <ul className="space-y-4">
      {cats.map(([cat, v], i) => (
        <li key={cat}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[15px]">
            <span className="font-medium">{CATEGORY_LABEL[cat] ?? cat}</span>
            <span className="num text-ink-2">
              {money(v)} <span className="text-ink-3">· {Math.round((v / total) * 100)}%</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${i === 0 ? "bg-brand" : "bg-ink-3/60"}`} style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const TRUST = [
  { key: "tasdiqlangan", label: "Tasdiqlangan", hint: "bank orqali", cls: "bg-pos" },
  { key: "skrinshot", label: "Skrinshot", hint: "chek, ilova", cls: "bg-brand" },
  { key: "so'zdan", label: "So'zdan", hint: "ovoz va matn", cls: "bg-surface-3" },
];

export function TrustScale({ share }: { share: Record<string, number> }) {
  return (
    <div>
      <div className="flex h-3 gap-[3px] overflow-hidden rounded-full" role="img" aria-label={TRUST.map((t) => `${t.label} ${Math.round((share[t.key] ?? 0) * 100)}%`).join(", ")}>
        {TRUST.map((t) => (share[t.key] ?? 0) > 0 && <div key={t.key} className={`${t.cls} rounded-full`} style={{ width: `${(share[t.key] ?? 0) * 100}%` }} />)}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {TRUST.map((t) => (
          <div key={t.key}>
            <dt className="flex items-center gap-2 text-[13.5px] text-ink-2">
              <span className={`h-2.5 w-2.5 rounded-full ${t.cls}`} aria-hidden />
              {t.label}
            </dt>
            <dd className="display mt-1 text-[20px] font-semibold">{Math.round((share[t.key] ?? 0) * 100)}%</dd>
            <dd className="text-[12.5px] text-ink-3">{t.hint}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export const ACTION_LABEL: Record<string, string> = {
  parsed: "AI ovoz/matnni tanidi",
  drafts_confirmed: "Yozuvlar tasdiqlandi",
  drafts_rejected: "Yozuvlar bekor qilindi",
  offer_proposed: "Bank taklifi ko'rsatildi",
  offer_accepted: "Bank taklifi qabul qilindi",
  offer_declined: "Bank taklifi rad etildi",
  sms_consent: "SMS roziligi o'zgardi",
  reminders_shown: "Eslatma matni tayyorlandi",
  shop_created: "Biznes qo'shildi",
  demo_linked: "Demo biznes ulandi",
  seed: "Demo ma'lumotlar yuklandi",
};

/** Строки песочницы лендинга (распознали -> сразу отклонили) — служебные, по умолчанию скрыты. */
export const SERVICE_ACTIONS = new Set(["parsed", "drafts_rejected"]);

const ACTOR = { owner: { label: "Egasi", icon: User }, ai: { label: "AI", icon: Bot }, system: { label: "Tizim", icon: Cog } };

function detail(a: AuditItem): string | null {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  switch (a.action) {
    case "parsed": {
      const ev = (p.events as unknown[] | undefined)?.length ?? 0;
      return p.intent === "question" ? "savol" : `${ev} ta yozuv · ${p.source === "voice" ? "ovoz" : "matn"}`;
    }
    case "drafts_confirmed":
      return `${(p.confirmed as unknown[] | undefined)?.length ?? 0} ta yozuv`;
    case "offer_accepted":
    case "offer_declined":
    case "offer_proposed": {
      const t = p.type === "overdraft" ? "Overdraft" : p.type === "deposit" ? "Omonat" : "";
      return p.amount ? `${t} ${money(Number(p.amount))}` : t || null;
    }
    default:
      return null;
  }
}

export function AuditList({ items, showService = false, limit }: { items: AuditItem[]; showService?: boolean; limit?: number }) {
  const list = items.filter((a) => showService || !SERVICE_ACTIONS.has(a.action)).slice(0, limit);
  if (list.length === 0) return <p className="py-6 text-ink-3">Hozircha harakat yo'q.</p>;
  let lastDay = "";
  return (
    <ol>
      {list.map((a) => {
        const day = a.created_at.slice(0, 10);
        const header = day !== lastDay;
        lastDay = day;
        const actor = ACTOR[a.actor];
        const Icon = actor.icon;
        const d = detail(a);
        return (
          <li key={a.id}>
            {header && <div className="pt-4 pb-2 text-[13px] font-medium text-ink-3 first:pt-0">{ddmm(day)}</div>}
            <div className="flex items-start gap-3 py-2.5">
              <span className="num w-12 shrink-0 pt-0.5 text-[13.5px] text-ink-3">{timeHM(a.created_at)}</span>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-3" title={actor.label}>
                <Icon size={14} strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                {d && <span className="num block text-[13.5px] text-ink-2">{d}</span>}
              </span>
              <span className="pt-0.5 text-[13px] text-ink-3">{actor.label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
