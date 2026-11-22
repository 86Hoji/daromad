// Регулярные платежи (аренда, зарплата, коммуналка): список + простая форма в листе.
// Шаблон сам попадает в прогноз и в «Bo'sh pul» платежом в нужный день. Голосом: «Har oy 5-sanada ijara 3 million».
import { Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type RecurringItem } from "../lib/api";
import { useLive } from "../lib/live";
import { categoryLabel, ddmm, moneyShort, num, ruPlural } from "../lib/format";
import { getLang, pick, t, tMaybe } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";

const CATS = ["ijara", "maosh", "kommunal", "tovar", "transport", "boshqa"] as const;
const WD: Record<"uz" | "ru" | "en", string[]> = {
  uz: ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"],
  ru: ["понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам", "воскресеньям"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
const WD_NAME: Record<"uz" | "ru" | "en", string[]> = {
  uz: WD.uz.map((d) => d[0].toUpperCase() + d.slice(1)),
  ru: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
  en: WD.en,
};

export function recurringWhen(r: Pick<RecurringItem, "period" | "day">): string {
  if (r.period === "weekly")
    return pick({ uz: `har ${WD.uz[r.day]}`, ru: `по ${WD.ru[r.day]}`, en: `every ${WD.en[r.day]}` });
  return pick({ uz: `har oy ${r.day}-sanada`, ru: `каждый месяц ${r.day}-го`, en: `monthly on day ${r.day}` });
}

type Form = { id?: number; title: string; category: string; amount: string; period: "monthly" | "weekly"; day: number };
const EMPTY: Form = { title: "", category: "ijara", amount: "", period: "monthly", day: 1 };

export function useRecurring(active = true) {
  const [items, setItems] = useState<RecurringItem[] | null>(null);
  const load = useCallback(() => api.recurring().then((r) => setItems(r.items)).catch(() => setItems([])), []);
  useEffect(() => {
    if (active) load();
  }, [active, load]);
  return { items, load };
}

/** Кнопка-панель «Doimiy to'lovlar» + лист со списком и формой. */
export function RecurringButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { items, load } = useRecurring();
  const n = items?.length ?? 0;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex min-h-11 items-center gap-2 rounded-el bg-surface-2/70 px-4 py-2.5 text-left text-[14.5px] transition hover:bg-surface-2 ${className}`}
      >
        <Repeat size={17} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden />
        <span className="font-medium">{t("Doimiy to'lovlar")}</span>
        <span className="num text-ink-3">
          · {pick({ uz: `${n} ta`, ru: `${n} ${ruPlural(n, ["шаблон", "шаблона", "шаблонов"])}`, en: `${n}` })}
        </span>
      </button>
      <RecurringSheet open={open} onClose={() => setOpen(false)} items={items} reload={load} />
    </>
  );
}

export function RecurringSheet({ open, onClose, items, reload }: { open: boolean; onClose: () => void; items: RecurringItem[] | null; reload: () => Promise<void> }) {
  const { refresh } = useLive();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const lang = getLang();

  useEffect(() => {
    if (!open) setForm(null);
  }, [open]);

  const save = async () => {
    if (!form) return;
    const amount = Number(form.amount.replace(/\D/g, ""));
    if (!amount) return toast(t("Summani kiriting"), "neg");
    setBusy(true);
    try {
      // пустое название -> бэкенд подставит узбекский ключ («Ijara», «Maosh»…), он переводится при показе
      const body = { title: form.title.trim(), category: form.category, amount, period: form.period, day: form.day };
      if (form.id) await api.recurringUpdate(form.id, body);
      else await api.recurringCreate(body);
      toast(t("Saqlandi"), "pos");
      setForm(null);
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("Xatolik"), "neg");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: RecurringItem) => {
    setBusy(true);
    try {
      await api.recurringDelete(r.id);
      toast(t("O'chirildi"));
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("Xatolik"), "neg");
    } finally {
      setBusy(false);
    }
  };

  const edit = (r: RecurringItem) => setForm({ id: r.id, title: tMaybe(r.title), category: r.category, amount: num(r.amount), period: r.period, day: r.day });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={form ? (form.id ? t("To'lovni o'zgartirish") : t("Yangi doimiy to'lov")) : t("Doimiy to'lovlar")}
      primary={form ? { label: t("Saqlash"), onClick: save, loading: busy } : { label: t("Qo'shish"), onClick: () => setForm({ ...EMPTY }) }}
      secondary={form ? { label: t("Bekor"), onClick: () => setForm(null), disabled: busy } : undefined}
      footnote={form ? undefined : t("Ovoz bilan ham bo'ladi: «Har oy 5-sanada ijara 3 million»")}
    >
      {form ? (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-ink-3">{t("Nomi")}</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={categoryLabel(form.category)}
              maxLength={80}
              className="h-12 w-full rounded-el bg-surface-2 px-4 text-[16px] outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-[13px] text-ink-3">{t("Toifa")}</span>
            <div className="flex flex-wrap gap-2">
              {CATS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, category: c })}
                  aria-pressed={form.category === c}
                  className={`h-10 rounded-full px-4 text-[14px] font-medium transition ${form.category === c ? "bg-ink text-bg" : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                >
                  {categoryLabel(c)}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-ink-3">{t("Summa")}</span>
            <input
              inputMode="numeric"
              value={form.amount}
              onChange={(e) => {
                const d = e.target.value.replace(/\D/g, "").slice(0, 11);
                setForm({ ...form, amount: d ? num(Number(d)) : "" });
              }}
              placeholder="3 000 000"
              className="num h-12 w-full rounded-el bg-surface-2 px-4 text-[18px] font-semibold outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink-3">{t("Davr")}</span>
              <select
                value={form.period}
                onChange={(e) => {
                  const period = e.target.value as Form["period"];
                  setForm({ ...form, period, day: period === "weekly" ? Math.min(form.day, 6) : Math.max(1, form.day) });
                }}
                className="h-12 w-full rounded-el bg-surface-2 px-3 text-[16px] outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="monthly">{t("Har oy")}</option>
                <option value="weekly">{t("Har hafta")}</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink-3">{form.period === "weekly" ? t("Hafta kuni") : t("Oy kuni")}</span>
              <select
                value={form.day}
                onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}
                className="num h-12 w-full rounded-el bg-surface-2 px-3 text-[16px] outline-none focus:ring-2 focus:ring-brand"
              >
                {form.period === "weekly"
                  ? WD_NAME[lang].map((d, i) => (
                      <option key={i} value={i}>
                        {d}
                      </option>
                    ))
                  : Array.from({ length: 31 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}
                      </option>
                    ))}
              </select>
            </label>
          </div>
          <p className="text-[13px] text-ink-3">{t("Prognozga va bo'sh pulga o'zi qo'shiladi.")}</p>
        </div>
      ) : items === null ? (
        <div className="h-24" />
      ) : items.length === 0 ? (
        <p className="text-[15px] text-ink-2">{t("Ijara, maosh, kommunal to'lovlarni bir marta qo'shing — prognoz ularni o'zi hisobga oladi.")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">{tMaybe(r.title)}</span>
                <span className="block truncate text-[13px] text-ink-3">
                  {recurringWhen(r)}
                  {r.next_date && <span className="num"> · {t("keyingisi {date}", { date: ddmm(r.next_date) })}</span>}
                </span>
              </span>
              <span className="num shrink-0 text-[15.5px] font-semibold">−{moneyShort(r.amount)}</span>
              <Button size="sm" variant="quiet" onClick={() => edit(r)} aria-label={t("O'zgartirish")}>
                <Pencil size={15} />
              </Button>
              <Button size="sm" variant="quiet" onClick={() => remove(r)} disabled={busy} aria-label={t("O'chirish")}>
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!form && items && items.length > 0 && (
        <button onClick={() => setForm({ ...EMPTY })} className="mt-3 flex items-center gap-2 text-[14.5px] font-medium text-brand-text hover:underline">
          <Plus size={16} /> {t("Yana qo'shish")}
        </button>
      )}
    </Sheet>
  );
}
