import crypto from "node:crypto";
import type { Context } from "hono";

export function maskSecret(value: unknown): string {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 12) return "••••";
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

export function parseCsv(value: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(value || "").split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const k = trimmed.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(trimmed);
  }
  return out;
}

export function normalizeModelId(model: unknown): string {
  return String(model || "").trim().toLowerCase();
}

export function normalizeConfigNewlines(value: unknown): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Admin writes .env values through JSON.stringify when quoting is needed.
    // Older builds read quoted values by only stripping quotes, so every save
    // could double the backslashes in MODEL_ALIASES: \n -> \\n -> ... .
    // Treat any run of backslashes immediately followed by n as a logical
    // newline for list-like config fields. This repairs old polluted values and
    // prevents route aliases from keeping literal backslashes as model suffixes.
    .replace(/\\+n/g, "\n");
}

export function splitConfigList(value: unknown): string[] {
  return normalizeConfigNewlines(value)
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function isDisabledFlag(value: unknown): boolean {
  return ["disabled", "off", "false", "0", "no"].includes(String(value || "").trim().toLowerCase());
}

export function keyFingerprint(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) return "";
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function normalizeBaseUrl(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function normalizePriority(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

export function encodeKeyPoolEntry(
  row: { key?: string; label?: string; enabled?: boolean; base_url?: string; priority?: number },
  defaultBaseUrl = "",
): string {
  const key = String(row?.key || "").trim();
  if (!key) return "";
  const label = String(row?.label || "").trim() || "key";
  const status = row?.enabled === false ? "disabled" : "enabled";
  const baseUrl = normalizeBaseUrl(row?.base_url);
  const fallback = normalizeBaseUrl(defaultBaseUrl);
  const priority = normalizePriority(row?.priority);
  const parts = [key, label, status];
  if (baseUrl && baseUrl !== fallback) {
    parts.push(baseUrl);
  } else if (priority > 0) {
    parts.push("");
  }
  if (priority > 0) parts.push(String(priority));
  return parts.join("|");
}

export interface KeyPoolRow {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  source: string;
  base_url?: string;
  priority: number;
}

export function parseKeyPoolAll(primary: unknown, pool: unknown, defaultBaseUrl = ""): KeyPoolRow[] {
  const out: KeyPoolRow[] = [];
  const seen = new Set<string>();
  const fallbackBaseUrl = normalizeBaseUrl(defaultBaseUrl);
  const add = (value: unknown, label = "", enabled = true, source = "pool", baseUrl = "") => {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || fallbackBaseUrl;
    const priority = 0;
    out.push({
      id: keyFingerprint(key),
      key,
      label: label || `key-${out.length + 1}`,
      enabled: enabled !== false,
      source,
      base_url: normalizedBaseUrl,
      priority,
    });
  };
  add(primary, "primary", true, "primary", fallbackBaseUrl);
  for (const item of parseCsv(pool)) {
    const parts = item.split("|");
    const key = (parts[0] || "").trim();
    const label = (parts[1] || "").trim();
    const enabled = parts.length >= 3 ? !isDisabledFlag(parts[2]) : true;
    const maybeFourth = (parts[3] || "").trim();
    const maybeFifth = (parts[4] || "").trim();
    const fourthIsPriority = maybeFourth !== "" && /^\d+$/.test(maybeFourth) && !maybeFifth;
    const baseUrl = fourthIsPriority ? "" : maybeFourth;
    const priority = normalizePriority(fourthIsPriority ? maybeFourth : maybeFifth);
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl) || fallbackBaseUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: keyFingerprint(key),
      key,
      label: label || `key-${out.length + 1}`,
      enabled: enabled !== false,
      source: "pool",
      base_url: normalizedBaseUrl,
      priority,
    });
  }
  return out;
}

export function parseKeyPool(primary: unknown, pool: unknown, defaultBaseUrl = ""): KeyPoolRow[] {
  return parseKeyPoolAll(primary, pool, defaultBaseUrl).filter((row) => row.enabled !== false);
}

export function uid(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function shellSingleQuote(value: unknown): string {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

export function redactBearerInCurl(curl: string): string {
  return String(curl || "").replace(/Authorization: Bearer [^"']+/g, "Authorization: Bearer <redacted>");
}

export function publicBaseFromReq(c: Context, port: number): string {
  const host = c.req.header("host") || `127.0.0.1:${port}`;
  const proto = host.startsWith("127.") || host.startsWith("localhost") ? "http" : "http";
  return `${proto}://${host}`;
}

export function maskedValue(v: unknown): boolean {
  return String(v || "").includes("…") || String(v || "").includes("•");
}

/** Client disconnected — use AbortSignal on Hono/Fetch requests. */
export function clientGone(signal?: AbortSignal | null): boolean {
  return !!signal?.aborted;
}

export function wireClientCancel(signal: AbortSignal | undefined, upstreamRes: Response): () => void {
  if (!signal || !upstreamRes.body) return () => {};
  let cancelled = false;
  const onAbort = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      upstreamRes.body?.cancel?.();
    } catch {
      /* ignore */
    }
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    cancelled = true;
    signal.removeEventListener("abort", onAbort);
  };
}

export async function writeWithBackpressure(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  chunk: string,
  encoder: TextEncoder,
): Promise<void> {
  await writer.write(encoder.encode(chunk));
}

export function createStreamWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal?: AbortSignal,
): {
  write: (chunk: string) => Promise<void>;
  end: () => void;
} {
  const encoder = new TextEncoder();
  return {
    async write(chunk: string) {
      if (clientGone(signal)) return;
      controller.enqueue(encoder.encode(chunk));
    },
    end() {
      try {
        controller.close();
      } catch {
        /* ignore */
      }
    },
  };
}
