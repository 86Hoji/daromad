// Клиент API Flowcast. В Telegram шлёт X-Telegram-Init-Data, в браузере — без него (DEV_SHOP_ID).
import { getLang, t } from "./i18n";
import { initData } from "./telegram";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

// Mini App на https не может ходить в http-API (mixed content) — подскажем в консоли
if (typeof window !== "undefined" && window.location.protocol === "https:" && API_URL.startsWith("http:"))
  console.warn(`[Flowcast] Sahifa https, API esa ${API_URL} — brauzer so'rovlarni bloklaydi. VITE_API_URL ni https qiling.`);

export class ApiError extends Error {
  /** code — машинный код ошибки extras: {"error": "no_consent", "detail": ...} */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (initData) headers.set("X-Telegram-Init-Data", initData);
  headers.set("Accept-Language", getLang()); // язык ответов AI и текстов ошибок
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, t("Server bilan aloqa yo'q"));
  }
  if (!res.ok) {
    let detail = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
      if (typeof body.error === "string") code = body.error;
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, detail, code);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// --- типы ответов -------------------------------------------------------------------

export interface Debtor {
  id: number;
  person_name: string;
  remaining: number;
  days_open: number;
  has_phone: boolean;
  sms_consent: boolean;
}

export interface Payment {
  id: number;
  title: string;
  counterparty: string | null;
  amount: number;
  due_date: string;
  /** платёж по шаблону регулярного платежа (аренда, зарплата…) */
  recurring?: boolean;
}

/** «Посчитано по N% данных»: доля подтверждённых денег, регулярность записей, дни без записей. */
export interface Reliability {
  percent: number;
  low: boolean;
  window_days: number;
  confirmed_share: number;
  regularity: number;
  coverage: number;
  missing_days: number;
  missing_dates: string[];
}

export interface RecurringItem {
  id: number;
  title: string;
  category: string;
  amount: number;
  period: "monthly" | "weekly";
  /** monthly: 1..31; weekly: 0=пн..6=вс */
  day: number;
  next_date: string | null;
}

export interface PeriodTotals {
  from: string;
  to: string;
  sales: number;
  expenses: number;
  profit: number;
}

export interface Summary {
  shop: { id: number; name: string; owner_name: string | null };
  free_money: number;
  horizon: string;
  horizon_weekday: string;
  cash_now: number;
  expected_sales: number;
  expected_expenses: number;
  payments_due: number;
  payments: Payment[];
  total_receivable: number;
  top_debtors: Debtor[];
  periods: Record<"today" | "week" | "month", PeriodTotals>;
  trust_share: Record<string, number>;
  reliability?: Reliability;
  /** вчера (ISO), если за вчера нет записей по наличным — «Дописать?» */
  nudge_date?: string | null;
}

export interface FcEvent {
  id: number;
  type: string;
  title: string;
  counterparty: string | null;
  amount: number;
  date?: string;
  overdue?: boolean;
  recurring?: boolean;
}

export interface ForecastDay {
  date: string;
  weekday: string;
  balance: number;
  /** полоса неопределённости: худший / лучший сценарий продаж по тем же 4 дням недели */
  low: number;
  high: number;
  expected_sales: number;
  expected_expenses: number;
  events: FcEvent[];
  red: boolean;
}

export interface Forecast {
  today: string;
  cash_now: number;
  history: { date: string; balance: number }[];
  forecast: ForecastDay[];
  events: (FcEvent & { date: string })[];
}

export interface Overdraft {
  type: "overdraft";
  name: string;
  amount: number;
  term_days: number;
  annual_rate: number;
  cost: number;
  risk_text: string;
}

export interface Deposit {
  type: "deposit";
  name: string;
  amount: number;
  term_days: number;
  annual_rate: number;
  income: number;
  early_withdrawal: string;
}

interface RecBase {
  free_money: number;
  horizon: string;
  horizon_weekday: string;
  cash_now: number;
  /** false — данных < 50%: банковские предложения не показываем */
  offers_allowed?: boolean;
  reliability?: number;
}

export type Recommendation = RecBase &
  (
    | {
        kind: "shortage";
        gap: number;
        receivable: number;
        covers_by_debts: boolean;
        debtors_to_remind: Debtor[];
        top_debtors: Debtor[];
        overdraft: Overdraft;
      }
    | { kind: "surplus"; amount: number; deposit: Deposit }
    | { kind: "ok" }
  );

export interface DebtRow {
  id: number;
  person_name: string;
  phone: string | null;
  sms_consent: boolean;
  amount: number;
  remaining: number;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  close_source: string | null;
  days_open: number;
}

export interface DebtsResp {
  total_receivable: number;
  open_count: number;
  debts: DebtRow[];
}

export interface Draft {
  id: number;
  batch_id: string;
  source: string;
  trust: string;
  type: "sale" | "expense" | "debt_given" | "debt_returned" | "scheduled_payment" | "recurring_payment";
  amount: number;
  person: string | null;
  phone: string | null;
  category: string | null;
  due_date: string | null;
  note: string | null;
  needs_check: boolean;
  /** sale/expense за прошлый день («kecha sotdim») */
  date?: string | null;
  period?: "monthly" | "weekly";
  day?: number;
}

export interface ProcessResult {
  intent: "record" | "question";
  transcript: string;
  batch_id: string | null;
  drafts: Draft[];
  errors: string[];
  answer: string | null;
  /** короткий текст для озвучки ответа (топ-3 + сумма) */
  voice_text?: string | null;
}

export interface EntriesResp {
  period: string;
  from: string;
  to: string;
  sales: number;
  expenses: number;
  profit: number;
  by_category: { sale: Record<string, number>; expense: Record<string, number> };
  entries: Entry[];
}

export interface Entry {
  id: number;
  kind: "sale" | "expense";
  amount: number;
  category: string;
  note: string | null;
  date: string;
  source: string;
  trust: string;
  status: string;
  created_at: string;
}

export interface AuditItem {
  id: number;
  actor: "owner" | "system" | "ai";
  action: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface OfferResult {
  status: "accepted";
  offer_id: number;
  bank: string;
  type: "overdraft" | "deposit";
  amount: number;
  term_days: number;
  cost?: number;
  income?: number;
  start_date: string;
  end_date: string;
  free_money_after: number;
  horizon: string;
}

export type RemindReason =
  | "not_found" | "debt_closed" | "no_phone" | "no_consent" | "too_soon" | "sms_failed" | "link_too_long"
  | "phone_not_allowed" | "link_not_public" | "token_expired";

/** POST /api/debts/{id}/remind/preview (backend/extras/reminders.py) */
export interface RemindPreview {
  debt_id: number;
  sms_text: string | null;
  pay_url: string | null;
  phone: string | null;
  can_send: boolean;
  reason: RemindReason | null;
  next_allowed_at: string | null;
  /** mock — SMS не уходит; eskiz_test — уходит «Bu Eskiz dan test»; live — настоящее SMS */
  sms_mode?: "mock" | "eskiz_test" | "live";
}

export interface RemindSent {
  status: "sent";
  sms_text: string;
  pay_url: string;
  sent_at: string;
  expires_at: string;
  sms_test_mode: boolean;
  provider: string;
}

export interface PayInfo {
  business_name: string;
  person_name: string;
  amount: number;
  status?: string;
  demo?: boolean;
}

// --- вызовы ------------------------------------------------------------------------

export const api = {
  summary: () => request<Summary>("/api/summary"),
  forecast: (days = 14) => request<Forecast>(`/api/forecast?days=${days}`),
  debts: () => request<DebtsResp>("/api/debts"),
  recommendation: () => request<Recommendation>("/api/recommendation"),
  entries: (period: "week" | "month") => request<EntriesResp>(`/api/entries?period=${period}`),
  audit: (limit = 20) => request<{ items: AuditItem[] }>(`/api/audit?limit=${limit}`),

  text: (text: string) => post<ProcessResult>("/api/text", { text }),
  voice: (audio: Blob) => {
    const fd = new FormData();
    const ext = audio.type.includes("wav") ? "wav" : "webm";
    fd.append("audio", audio, `voice.${ext}`);
    return request<ProcessResult>("/api/voice", { method: "POST", body: fd });
  },
  /** озвучка ответа: WAV (играет в любом браузере и WebView) */
  tts: async (text: string): Promise<Blob> => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (initData) headers.set("X-Telegram-Init-Data", initData);
  headers.set("Accept-Language", getLang()); // язык ответов AI и текстов ошибок
    const res = await fetch(`${API_URL}/api/tts`, { method: "POST", headers, body: JSON.stringify({ text, format: "wav" }) });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.blob();
  },
  demoReset: () => post<{ ok: boolean; free_money: number }>("/api/demo/reset"),
  confirm: (ids: number[]) => post<{ confirmed: unknown[]; errors: string[] }>("/api/entries/confirm", { ids }),
  reject: (ids: number[]) => post<{ rejected: number }>("/api/entries/reject", { ids }),

  recurring: () => request<{ items: RecurringItem[] }>("/api/recurring"),
  recurringCreate: (body: Omit<RecurringItem, "id" | "next_date">) => post<RecurringItem>("/api/recurring", body),
  recurringUpdate: (id: number, body: Partial<Omit<RecurringItem, "id" | "next_date">>) =>
    request<RecurringItem>(`/api/recurring/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  recurringDelete: (id: number) => request<{ ok: boolean }>(`/api/recurring/${id}`, { method: "DELETE" }),

  acceptOffer: (type: "overdraft" | "deposit", amount: number, term_days: number) =>
    post<OfferResult>("/api/offers/accept", { type, amount, term_days }),
  declineOffer: (type: "overdraft" | "deposit", amount: number, term_days: number) =>
    post<{ status: string }>("/api/offers/decline", { type, amount, term_days }),

  // backend/extras (второй разработчик). При 404 экран переходит в demo-режим.
  remindPreview: (id: number) => post<RemindPreview>(`/api/debts/${id}/remind/preview`),
  remindSend: (id: number) => post<RemindSent>(`/api/debts/${id}/remind`),
  payInfo: (token: string) => request<Record<string, unknown>>(`/api/pay/${encodeURIComponent(token)}`),
  payConfirm: (token: string) => post<Record<string, unknown>>(`/api/pay/${encodeURIComponent(token)}/confirm`),
};

export const isNotFound = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);
/** Эндпоинта нет совсем (старый бэкенд без extras) — 404/405 без кода ошибки extras. */
export const isMissingEndpoint = (e: unknown) => isNotFound(e) && !(e as ApiError).code;
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);
