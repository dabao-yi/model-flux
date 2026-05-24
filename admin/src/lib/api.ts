const ADMIN_KEY_STORAGE = "modelFluxAdminKey";
const ADMIN_KEY_COOKIE = "modelflux_admin_key";

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  const fromStorage = localStorage.getItem(ADMIN_KEY_STORAGE);
  if (fromStorage) return fromStorage;
  return new URLSearchParams(window.location.search).get("key") || "";
}

export function setAdminKey(key: string) {
  localStorage.setItem(ADMIN_KEY_STORAGE, key);
  document.cookie = `${ADMIN_KEY_COOKIE}=${encodeURIComponent(key)}; path=/; max-age=2592000`;
}

export function clearAdminKey() {
  localStorage.removeItem(ADMIN_KEY_STORAGE);
  document.cookie = `${ADMIN_KEY_COOKIE}=; path=/; max-age=0`;
}

type AuthResolver = (key: string | null) => void;
let authResolver: AuthResolver | null = null;

export function requestAdminAuth(): Promise<string | null> {
  return new Promise((resolve) => {
    authResolver = resolve;
    window.dispatchEvent(new CustomEvent("modelflux-admin-auth"));
  });
}

export function resolveAdminAuth(key: string | null) {
  authResolver?.(key);
  authResolver = null;
}

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const key = getAdminKey();
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error?: { message?: string } }).error?.message ?? "request failed")
        : String(body);
    super(msg);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, opt: RequestInit = {}): Promise<T> {
  const doFetch = async () => {
    const res = await fetch(path, {
      ...opt,
      headers: { ...headers(), ...(opt.headers as Record<string, string> | undefined) },
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  };

  try {
    return await doFetch();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const key = await requestAdminAuth();
      if (key) {
        setAdminKey(key);
        return doFetch();
      }
      throw err;
    }
    throw err;
  }
}
