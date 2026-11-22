// Сессия сайта: токен из POST /api/auth/demo. В Telegram не нужен — там initData.
const KEY = "flowcast.session";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* приватный режим: сессия живёт до перезагрузки через memory */
  }
  memory = token;
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  memory = null;
}

let memory: string | null = null;

/** Токен для заголовка: localStorage, а если он недоступен — память вкладки. */
export function sessionToken(): string | null {
  return getToken() ?? memory;
}
