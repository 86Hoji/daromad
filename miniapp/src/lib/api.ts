// Клиент API Flowcast. В Telegram шлёт X-Telegram-Init-Data, в браузере — без него (DEV_SHOP_ID).
import { initData } from "./telegram";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (initData) headers.set("X-Telegram-Init-Data", initData);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Server bilan aloqa yo'q");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, detail);
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
}

export interface FcEvent {
  id: number;
  type: string;
  title: string;
  counterparty: string | null;
  amount: number;
  date?: string;
  overdue?: boolean;
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
  type: "sale" | "expense" | "debt_given" | "debt_returned" | "scheduled_payment";
  amount: number;
  person: string | null;
  phone: string | null;
  category: string | null;
  due_date: string | null;
  note: string | null;
  needs_check: boolean;
}

export interface ProcessResult {
  intent: "record" | "question";
  transcript: string;
  batch_id: string | null;
  drafts: Draft[];
  errors: string[];
  answer: string | null;
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

export interface RemindPreview {
  text: string;
  phone?: string | null;
  demo?: boolean;
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
  confirm: (ids: number[]) => post<{ confirmed: unknown[]; errors: string[] }>("/api/entries/confirm", { ids }),
  reject: (ids: number[]) => post<{ rejected: number }>("/api/entries/reject", { ids }),

  acceptOffer: (type: "overdraft" | "deposit", amount: number, term_days: number) =>
    post<OfferResult>("/api/offers/accept", { type, amount, term_days }),
  declineOffer: (type: "overdraft" | "deposit", amount: number, term_days: number) =>
    post<{ status: string }>("/api/offers/decline", { type, amount, term_days }),

  // backend/extras (второй разработчик). При 404 экран переходит в demo-режим.
  remindPreview: (id: number) => post<RemindPreview>(`/api/debts/${id}/remind/preview`),
  remindSend: (id: number) => post<{ status?: string }>(`/api/debts/${id}/remind`),
  payInfo: (token: string) => request<Record<string, unknown>>(`/api/pay/${encodeURIComponent(token)}`),
  payConfirm: (token: string) => post<Record<string, unknown>>(`/api/pay/${encodeURIComponent(token)}/confirm`),
};

export const isNotFound = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);
