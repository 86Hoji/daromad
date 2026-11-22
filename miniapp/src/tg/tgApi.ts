// Адреса Mini App из backend/tg_api.py: скан фото и итоги за 7 / 30 дней.
// Свои функции, а не правка общего lib/api.ts: сайт правится параллельно.
import { API_URL, ApiError, type Entry, type ProcessResult } from "../lib/api";
import { getLang } from "../lib/i18n";
import { initData } from "../lib/telegram";

const MAX_SIDE = 2000;
const SHRINK_FROM = 1.5 * 1024 * 1024;

/** Большое фото с камеры уменьшаем до 2000 px (быстрее загрузка и ответ Gemini). Не вышло — шлём как есть. */
async function shrink(file: File): Promise<Blob> {
  if (file.size < SHRINK_FROM || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers({ "Accept-Language": getLang() });
  if (initData) headers.set("X-Telegram-Init-Data", initData);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** Фото чека / накладной -> черновики (POST /api/photo). */
export async function scanPhoto(file: File): Promise<ProcessResult> {
  const image = await shrink(file);
  const fd = new FormData();
  fd.append("image", image, image === file ? file.name || "photo.jpg" : "photo.jpg");
  return call<ProcessResult>("/api/photo", { method: "POST", body: fd });
}

/** Подтверждённые записи и итоги за последние `days` дней (GET /api/tg/period). */
export interface PeriodResp {
  days: number;
  from: string;
  to: string;
  sales: number;
  expenses: number;
  profit: number;
  entries: Pick<Entry, "id" | "kind" | "amount" | "category" | "note" | "date" | "source" | "trust" | "created_at">[];
}

export const tgPeriod = (days: 7 | 30) => call<PeriodResp>(`/api/tg/period?days=${days}`);
