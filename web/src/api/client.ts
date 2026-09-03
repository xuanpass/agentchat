const BASE = '/api';
const STORAGE_KEY = 'aoc-api-key';

/** 获取存储的 API Key */
export function getApiKey(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** 设置 API Key */
export function setApiKey(key: string | null) {
  if (key) localStorage.setItem(STORAGE_KEY, key);
  else localStorage.removeItem(STORAGE_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 → 清除 key, 通知需要重新登录
  if (res.status === 401) {
    setApiKey(null);
    const event = new CustomEvent('aoc:unauthorized');
    window.dispatchEvent(event);
  }

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error ?? j.message ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }

  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('application/json') ? res.json() : (res.text() as any);
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  delete: <T>(p: string) => request<T>('DELETE', p),
};
