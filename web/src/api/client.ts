import type { ApiError, Session } from './types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const KEY = 'sms.session';

export class HttpError extends Error {
  status: number; error: ApiError;
  constructor(status: number, error: ApiError) { super(error.message); this.status = status; this.error = error; }
}

type Listener = (s: Session | null) => void;
const listeners = new Set<Listener>();
let session: Session | null = load();
let refreshing: Promise<Session | null> | null = null;

function load(): Session | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function save(s: Session | null) {
  session = s;
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  listeners.forEach(l => l(s));
}

export const auth = {
  get session() { return session; },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  set: save,
  async login(email: string, password: string) {
    const s = await request<Session>('POST', '/api/v1/auth/login', { body: { email, password }, auth: false });
    save(s); return s;
  },
  async logout() {
    const rt = session?.refresh_token;
    save(null);
    if (rt) { try { await request('POST', '/api/v1/auth/logout', { body: { refresh_token: rt }, auth: false }); } catch { /* ignore */ } }
  },
  async refresh(): Promise<Session | null> {
    if (refreshing) return refreshing;
    const rt = session?.refresh_token;
    if (!rt) return null;
    refreshing = (async () => {
      try {
        const s = await request<Session>('POST', '/api/v1/auth/refresh', { body: { refresh_token: rt }, auth: false });
        save(s); return s;
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) save(null);
        return null;
      } finally { refreshing = null; }
    })();
    return refreshing;
  },
};

interface Opts { body?: unknown; auth?: boolean; query?: Record<string, string | number | boolean | undefined | null>; raw?: boolean; retry?: boolean }

export async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false && session) headers.authorization = `Bearer ${session.access_token}`;
  const res = await fetch(url.toString(), { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  if (res.status === 401 && opts.auth !== false && opts.retry !== false && session) {
    const s = await auth.refresh();
    if (s) return request<T>(method, path, { ...opts, retry: false });
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const err = (json as { error?: ApiError } | null)?.error ?? { code: 'http_' + res.status, message: res.statusText || 'Request failed' };
    throw new HttpError(res.status, err);
  }
  return json as T;
}

export const api = {
  get: <T,>(path: string, query?: Opts['query']) => request<T>('GET', path, { query }),
  post: <T,>(path: string, body?: unknown, query?: Opts['query']) => request<T>('POST', path, { body, query }),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  del: <T,>(path: string) => request<T>('DELETE', path),
  url: (path: string) => BASE + path,
};

export function errorMessage(e: unknown): string {
  if (e instanceof HttpError) return e.error.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
