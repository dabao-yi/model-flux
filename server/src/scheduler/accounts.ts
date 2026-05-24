import { maskSecret, type KeyPoolRow } from "../lib/utils.js";

export type ProviderAccountState =
  | "healthy"
  | "probing"
  | "insufficient_balance"
  | "rate_limited"
  | "auth_error"
  | "temporary_error"
  | "manual_disabled";

export type ProviderAccountErrorCode =
  | "ok"
  | "auth_error"
  | "insufficient_balance"
  | "rate_limited"
  | "temporary_error"
  | "bad_request"
  | "unknown_error";

export interface ProviderAccount {
  id: string;
  label: string;
  provider: string;
  key: string;
  masked: string;
  enabled: boolean;
  state: ProviderAccountState;
  weight: number;
  in_flight: number;
  success_count: number;
  failure_count: number;
  last_success_at: number | null;
  last_error_at: number | null;
  last_error: string;
  last_status: number | null;
  cooldown_until: number | null;
  next_probe_at: number | null;
  last_used_at: number | null;
}

export interface ProviderAccountSnapshot extends Omit<ProviderAccount, "key"> {
  schedulable: boolean;
  cooldown_ms_remaining: number;
}

export interface AccountFailureClassification {
  code: ProviderAccountErrorCode;
  state: ProviderAccountState | "healthy";
  message: string;
  status?: number;
  retryable: boolean;
  affectsAccount: boolean;
  cooldownMs: number;
}

export interface AccountFailureAttempt {
  provider: string;
  id: string;
  label: string;
  state: ProviderAccountState | "healthy";
  code: ProviderAccountErrorCode;
  status?: number;
  message: string;
}

const LONG_COOLDOWN_MS = Number(process.env.ACCOUNT_LONG_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.ACCOUNT_RATE_LIMIT_COOLDOWN_MS || 60 * 1000);
const TEMP_COOLDOWN_MS = Number(process.env.ACCOUNT_TEMP_COOLDOWN_MS || 30 * 1000);
const PROBE_COOLDOWN_MS = Number(process.env.ACCOUNT_PROBE_COOLDOWN_MS || 15 * 1000);

function nowMs() {
  return Date.now();
}

function accountKey(provider: string, id: string) {
  return `${provider}:${id}`;
}

function shortMessage(message: string): string {
  return String(message || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function retryAfterMs(headers?: Headers): number {
  const raw = headers?.get("retry-after") || "";
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, LONG_COOLDOWN_MS);
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) return Math.max(0, Math.min(ts - nowMs(), LONG_COOLDOWN_MS));
  return 0;
}

export function classifyUpstreamResponse(
  status: number,
  bodyText = "",
  headers?: Headers,
): AccountFailureClassification {
  const text = shortMessage(bodyText);
  if (status === 401 || status === 403) {
    return {
      code: "auth_error",
      state: "auth_error",
      status,
      message: text || `HTTP ${status}`,
      retryable: true,
      affectsAccount: true,
      cooldownMs: LONG_COOLDOWN_MS,
    };
  }
  if (status === 402) {
    return {
      code: "insufficient_balance",
      state: "insufficient_balance",
      status,
      message: text || "Insufficient account balance",
      retryable: true,
      affectsAccount: true,
      cooldownMs: LONG_COOLDOWN_MS,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      state: "rate_limited",
      status,
      message: text || "Rate limited",
      retryable: true,
      affectsAccount: true,
      cooldownMs: retryAfterMs(headers) || RATE_LIMIT_COOLDOWN_MS,
    };
  }
  if (status >= 500) {
    return {
      code: "temporary_error",
      state: "temporary_error",
      status,
      message: text || `HTTP ${status}`,
      retryable: true,
      affectsAccount: true,
      cooldownMs: TEMP_COOLDOWN_MS,
    };
  }
  return {
    code: status >= 400 && status < 500 ? "bad_request" : "unknown_error",
    state: "healthy",
    status,
    message: text || `HTTP ${status}`,
    retryable: false,
    affectsAccount: false,
    cooldownMs: 0,
  };
}

export function classifyUpstreamException(err: unknown): AccountFailureClassification {
  const message = err instanceof Error ? err.message : String(err || "unknown upstream error");
  const normalized = message.toLowerCase();
  const isTimeout = normalized.includes("abort") || normalized.includes("timeout") || normalized.includes("timed out");
  const isNetwork =
    normalized.includes("eof") ||
    normalized.includes("socket") ||
    normalized.includes("network") ||
    normalized.includes("terminated") ||
    normalized.includes("fetch failed") ||
    normalized.includes("connection");
  return {
    code: isTimeout || isNetwork ? "temporary_error" : "unknown_error",
    state: "temporary_error",
    message: shortMessage(message),
    retryable: true,
    affectsAccount: true,
    cooldownMs: TEMP_COOLDOWN_MS,
  };
}

export class AccountScheduler {
  private accounts = new Map<string, ProviderAccount>();

  upsertAccount(provider: string, row: KeyPoolRow): ProviderAccount {
    const id = row.id;
    const key = accountKey(provider, id);
    const existing = this.accounts.get(key);
    if (existing) {
      existing.key = row.key;
      existing.label = row.label || existing.label;
      existing.masked = maskSecret(row.key);
      existing.enabled = row.enabled !== false;
      if (existing.enabled && existing.state === "manual_disabled") existing.state = "healthy";
      if (!existing.enabled) existing.state = "manual_disabled";
      return existing;
    }
    const account: ProviderAccount = {
      id,
      provider,
      key: row.key,
      label: row.label || "primary",
      masked: maskSecret(row.key),
      enabled: row.enabled !== false,
      state: row.enabled === false ? "manual_disabled" : "healthy",
      weight: 1,
      in_flight: 0,
      success_count: 0,
      failure_count: 0,
      last_success_at: null,
      last_error_at: null,
      last_error: "",
      last_status: null,
      cooldown_until: null,
      next_probe_at: null,
      last_used_at: null,
    };
    this.accounts.set(key, account);
    return account;
  }

  syncProvider(provider: string, rows: KeyPoolRow[]): void {
    const currentIds = new Set<string>();
    for (const row of rows) {
      const id = row.id;
      currentIds.add(id);
      this.upsertAccount(provider, row);
    }

    for (const acc of this.accounts.values()) {
      if (acc.provider === provider && !currentIds.has(acc.id)) {
        acc.enabled = false;
        acc.state = "manual_disabled";
      }
    }
  }

  find(provider: string, id: string): ProviderAccount | undefined {
    return this.accounts.get(accountKey(provider, id));
  }

  private refreshDueStates(provider?: string) {
    const now = nowMs();
    for (const acc of this.accounts.values()) {
      if (provider && acc.provider !== provider) continue;
      if (!acc.enabled || acc.state === "manual_disabled") continue;
      if (acc.state !== "healthy" && acc.state !== "probing" && acc.cooldown_until && acc.cooldown_until <= now) {
        acc.state = "probing";
        acc.next_probe_at = now;
      }
    }
  }

  select(provider: string, attemptedIds = new Set<string>()): ProviderAccount | null {
    this.refreshDueStates(provider);
    const now = nowMs();
    const candidates = [...this.accounts.values()].filter(
      (acc) =>
        acc.provider === provider &&
        acc.enabled &&
        acc.state === "healthy" &&
        (!acc.cooldown_until || acc.cooldown_until <= now) &&
        !attemptedIds.has(acc.id),
    );
    candidates.sort((a, b) => {
      const loadA = a.in_flight / Math.max(1, a.weight || 1);
      const loadB = b.in_flight / Math.max(1, b.weight || 1);
      if (loadA !== loadB) return loadA - loadB;
      return (a.last_used_at || 0) - (b.last_used_at || 0);
    });
    const selected = candidates[0];
    if (!selected) return null;
    selected.in_flight += 1;
    selected.last_used_at = now;
    return selected;
  }

  release(account: ProviderAccount | undefined | null): void {
    if (!account) return;
    const current = this.find(account.provider, account.id);
    if (current) current.in_flight = Math.max(0, current.in_flight - 1);
  }

  recordSuccess(accountOrProvider: ProviderAccount | string, id?: string): void {
    const acc = typeof accountOrProvider === "string" ? this.find(accountOrProvider, id || "") : this.find(accountOrProvider.provider, accountOrProvider.id);
    if (!acc || !acc.enabled) return;
    acc.state = "healthy";
    acc.success_count += 1;
    acc.last_success_at = nowMs();
    acc.last_error = "";
    acc.last_status = 200;
    acc.cooldown_until = null;
    acc.next_probe_at = null;
  }

  recordFailure(accountOrProvider: ProviderAccount | string, idOrClassification: string | AccountFailureClassification, maybeClassification?: AccountFailureClassification): void {
    const acc = typeof accountOrProvider === "string"
      ? this.find(accountOrProvider, idOrClassification as string)
      : this.find(accountOrProvider.provider, accountOrProvider.id);
    const classification = (typeof accountOrProvider === "string" ? maybeClassification : idOrClassification) as AccountFailureClassification;
    if (!acc || !classification?.affectsAccount || !acc.enabled) return;
    const now = nowMs();
    acc.failure_count += 1;
    acc.last_error_at = now;
    acc.last_error = classification.message;
    acc.last_status = classification.status ?? null;
    acc.state = classification.state === "healthy" ? "temporary_error" : classification.state;
    acc.cooldown_until = classification.cooldownMs > 0 ? now + classification.cooldownMs : null;
    acc.next_probe_at = acc.cooldown_until;
  }

  setEnabled(provider: string, id: string, enabled: boolean): ProviderAccountSnapshot | null {
    const acc = this.find(provider, id);
    if (!acc) return null;
    acc.enabled = enabled;
    if (!enabled) {
      acc.state = "manual_disabled";
      acc.cooldown_until = null;
      acc.next_probe_at = null;
      acc.in_flight = 0;
    } else {
      acc.state = "probing";
      acc.cooldown_until = null;
      acc.next_probe_at = nowMs();
    }
    return this.snapshotAccount(acc);
  }

  markProbing(provider: string, id: string): ProviderAccountSnapshot | null {
    const acc = this.find(provider, id);
    if (!acc || !acc.enabled) return null;
    acc.state = "probing";
    acc.cooldown_until = null;
    acc.next_probe_at = nowMs();
    return this.snapshotAccount(acc);
  }

  dueProbeAccounts(limit = 5): ProviderAccount[] {
    this.refreshDueStates();
    const now = nowMs();
    return [...this.accounts.values()]
      .filter((acc) => acc.enabled && acc.state === "probing" && (!acc.next_probe_at || acc.next_probe_at <= now))
      .sort((a, b) => (a.next_probe_at || 0) - (b.next_probe_at || 0))
      .slice(0, limit);
  }

  snapshot(provider?: string): Record<string, ProviderAccountSnapshot[]> {
    this.refreshDueStates(provider);
    const out: Record<string, ProviderAccountSnapshot[]> = {};
    for (const acc of this.accounts.values()) {
      if (provider && acc.provider !== provider) continue;
      if (!out[acc.provider]) out[acc.provider] = [];
      out[acc.provider].push(this.snapshotAccount(acc));
    }
    for (const list of Object.values(out)) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return out;
  }

  summary() {
    this.refreshDueStates();
    const accounts = [...this.accounts.values()];
    const schedulable = accounts.filter((acc) => this.isSchedulable(acc));
    const abnormal = accounts.filter((acc) => acc.enabled && !this.isSchedulable(acc));
    const recentErrors = accounts
      .filter((acc) => acc.last_error_at && acc.last_error)
      .sort((a, b) => (b.last_error_at || 0) - (a.last_error_at || 0))
      .slice(0, 5)
      .map((acc) => ({
        provider: acc.provider,
        id: acc.id,
        label: acc.label,
        state: acc.state,
        status: acc.last_status,
        error: acc.last_error,
        at: acc.last_error_at,
      }));
    return {
      total_accounts: accounts.length,
      schedulable_accounts: schedulable.length,
      abnormal_accounts: abnormal.length,
      recent_errors: recentErrors,
      by_provider: Object.fromEntries(
        Object.entries(this.snapshot()).map(([provider, rows]) => [
          provider,
          {
            total: rows.length,
            schedulable: rows.filter((r) => r.schedulable).length,
            abnormal: rows.filter((r) => r.enabled && !r.schedulable).length,
          },
        ]),
      ),
    };
  }

  private isSchedulable(acc: ProviderAccount): boolean {
    return acc.enabled && acc.state === "healthy" && (!acc.cooldown_until || acc.cooldown_until <= nowMs());
  }

  private snapshotAccount(acc: ProviderAccount): ProviderAccountSnapshot {
    const now = nowMs();
    const cooldownMs = acc.cooldown_until ? Math.max(0, acc.cooldown_until - now) : 0;
    return {
      id: acc.id,
      label: acc.label,
      provider: acc.provider,
      masked: acc.masked,
      enabled: acc.enabled,
      state: acc.state,
      weight: acc.weight,
      in_flight: acc.in_flight,
      success_count: acc.success_count,
      failure_count: acc.failure_count,
      last_success_at: acc.last_success_at,
      last_error_at: acc.last_error_at,
      last_error: acc.last_error,
      last_status: acc.last_status,
      cooldown_until: acc.cooldown_until,
      next_probe_at: acc.next_probe_at,
      last_used_at: acc.last_used_at,
      schedulable: this.isSchedulable(acc),
      cooldown_ms_remaining: cooldownMs,
    };
  }
}

export function createAccountScheduler(): AccountScheduler {
  return new AccountScheduler();
}
