import { useEffect, useState } from "react";
import { api, type AuditItem, type EntriesResp } from "../lib/api";
import { useLive } from "../lib/live";
import { CATEGORY_LABEL, ddmm, money, moneyShort, timeHM } from "../lib/format";
import { AnimatedNumber, Badge, SectionTitle } from "../components/ui";
import { Loading } from "./Loading";

type Period = "week" | "month";

const ACTION_LABEL: Record<string, string> = {
  parsed: "Ovoz/matn tanildi",
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

const ACTOR_LABEL: Record<string, string> = { owner: "Egasi", ai: "AI", system: "Tizim" };

function auditDetail(a: AuditItem): string | null {
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

export function Report() {
  const { summary, tick, error } = useLive();
  const [period, setPeriod] = useState<Period>("week");
  const [entries, setEntries] = useState<EntriesResp | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.entries(period), api.audit(20)])
      .then(([e, a]) => {
        if (!alive) return;
        setEntries(e);
        setAudit(a.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [period, tick]);

  if (!summary || !entries) return <Loading error={error} />;

  const cats = Object.entries(entries.by_category.expense).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(([, v]) => v));
  const trust = summary.trust_share;
  const trustParts = [
    { key: "tasdiqlangan", label: "Tasdiqlangan (bank)", cls: "bg-pos", v: trust["tasdiqlangan"] ?? 0 },
    { key: "skrinshot", label: "Skrinshot", cls: "bg-ink-2", v: trust["skrinshot"] ?? 0 },
    { key: "so'zdan", label: "So'zdan", cls: "bg-line", v: trust["so'zdan"] ?? 0 },
  ];

  return (
    <div className="pb-28 lg:pb-10">
      <div className="flex items-center justify-between pt-2 pb-5 lg:pt-6">
        <div>
          <div className="text-[14px] font-medium text-ink-2">Hisobot</div>
          <div className="num text-[13px] text-ink-3">
            {ddmm(entries.from)} — {ddmm(entries.to)}
          </div>
        </div>
        <div className="flex rounded-xl border border-line bg-surface p-0.5 text-[13.5px] font-medium">
          {(["week", "month"] as Period[]).map((k) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`rounded-[10px] px-4 py-1.5 transition ${period === k ? "bg-btn text-btn-ink" : "text-ink-2"}`}
            >
              {k === "week" ? "Hafta" : "Oy"}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        <div>
          <section className="card grid grid-cols-3 divide-x divide-line">
            <Figure label="Sotuv" value={entries.sales} />
            <Figure label="Xarajat" value={entries.expenses} />
            <Figure label="Foyda" value={entries.profit} tone={entries.profit >= 0 ? "pos" : "neg"} />
          </section>

          <section className="card mt-5 p-5">
            <SectionTitle>Xarajatlar toifalar bo'yicha</SectionTitle>
            <div className="space-y-3.5">
              {cats.map(([cat, v]) => (
                <div key={cat}>
                  <div className="mb-1.5 flex justify-between text-[14px]">
                    <span className="font-medium">{CATEGORY_LABEL[cat] ?? cat}</span>
                    <span className="num text-ink-2">{money(v)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(2, (v / maxCat) * 100)}%` }} />
                  </div>
                </div>
              ))}
              {cats.length === 0 && <div className="text-[14px] text-ink-3">Bu davrda xarajat yo'q</div>}
            </div>
          </section>

          <section className="card mt-5 p-5">
            <SectionTitle right={<span className="num text-[13px] font-semibold text-pos">{Math.round((trust["tasdiqlangan"] ?? 0) * 100)}%</span>}>
              Ma'lumot ishonchliligi
            </SectionTitle>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
              {trustParts.map((p) => (
                <div key={p.key} className={p.cls} style={{ width: `${p.v * 100}%` }} />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[12.5px]">
              {trustParts.map((p) => (
                <div key={p.key}>
                  <div className="flex items-center gap-1.5 text-ink-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${p.cls}`} /> {p.label}
                  </div>
                  <div className="num mt-0.5 text-[15px] font-semibold">{Math.round(p.v * 100)}%</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
              Bank orqali o'tgan yozuvlar — tasdiqlangan; ovoz va matn — egasining so'zi.
            </p>
          </section>
        </div>

        <section className="card mt-5 p-5 lg:mt-0">
          <SectionTitle>Harakatlar jurnali</SectionTitle>
          <div className="divide-y divide-line">
            {audit.map((a) => {
              const detail = auditDetail(a);
              return (
                <div key={a.id} className="flex items-start gap-3 py-3">
                  <span className="num w-11 shrink-0 pt-0.5 text-[12.5px] text-ink-3">{timeHM(a.created_at)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium">{ACTION_LABEL[a.action] ?? a.action}</div>
                    {detail && <div className="num text-[12.5px] text-ink-2">{detail}</div>}
                  </div>
                  <Badge tone={a.actor === "owner" ? "neutral" : a.actor === "ai" ? "neutral" : "neutral"}>{ACTOR_LABEL[a.actor]}</Badge>
                </div>
              );
            })}
            {audit.length === 0 && <div className="py-6 text-center text-[14px] text-ink-3">Hozircha harakat yo'q</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "pos" | "neg" }) {
  return (
    <div className="px-4 py-4">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className={`mt-1 text-[19px] font-bold tracking-tight lg:text-[22px] ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}>
        <span className="sm:hidden num">{moneyShort(value)}</span>
        <span className="hidden sm:inline">
          <AnimatedNumber value={value} />
        </span>
      </div>
    </div>
  );
}
