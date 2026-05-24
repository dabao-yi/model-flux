export type ProviderId = "mimo" | "deepseek" | "compat" | "openai";

export interface ProviderKeyRow {
  id?: string;
  label?: string;
  key?: string;
  masked?: string;
  enabled?: boolean;
  scheduler?: ProviderAccountRuntime;
}

export interface ProviderState {
  id?: string;
  enabled?: boolean;
  base_url?: string;
  models?: string;
  key_count?: number;
  total_key_count?: number;
  keys?: ProviderKeyRow[];
}

export interface ConfigSnapshot {
  env_path?: string;
  admin_enabled?: boolean;
  runtime_note?: string;
  inbound: {
    proxy_auth_key?: string;
    proxy_keys?: string;
    admin_auth_key?: string;
  };
  routing: {
    default_provider?: string;
    model_aliases?: string;
    openai_model_prefixes?: string;
  };
  providers: Record<ProviderId, ProviderState>;
  tuning: {
    log_level?: string;
    access_log?: string;
    upstream_timeout_ms?: string;
  };
  runtime: {
    enabled_providers?: string[];
    default_provider?: string;
    model_count?: number;
    models?: RuntimeModel[];
    scheduler_summary?: SchedulerSummary;
    scheduler?: Record<ProviderId, ProviderAccountRuntime[]>;
  };
}

export type ProviderAccountState =
  | "healthy"
  | "probing"
  | "insufficient_balance"
  | "rate_limited"
  | "auth_error"
  | "temporary_error"
  | "manual_disabled";

export interface ProviderAccountRuntime {
  id: string;
  label: string;
  provider: string;
  masked?: string;
  enabled: boolean;
  state: ProviderAccountState;
  weight?: number;
  in_flight?: number;
  success_count?: number;
  failure_count?: number;
  last_success_at?: number | null;
  last_error_at?: number | null;
  last_error?: string;
  last_status?: number | null;
  cooldown_until?: number | null;
  next_probe_at?: number | null;
  last_used_at?: number | null;
  schedulable?: boolean;
  cooldown_ms_remaining?: number;
}

export interface SchedulerSummary {
  total_accounts?: number;
  schedulable_accounts?: number;
  abnormal_accounts?: number;
  recent_errors?: {
    provider?: string;
    id?: string;
    label?: string;
    state?: ProviderAccountState;
    status?: number | null;
    error?: string;
    at?: number | null;
  }[];
  by_provider?: Record<string, { total?: number; schedulable?: number; abnormal?: number }>;
}

export interface RuntimeModel {
  id: string;
  owned_by?: string;
  alias_of?: string;
}

export interface ConfigPayload {
  providers: Record<
    ProviderId,
    {
      enabled: boolean;
      base_url: string;
      models: string;
      keys: {
        id: string;
        masked: string;
        enabled: boolean;
        label: string;
        key: string;
      }[];
    }
  >;
  routing: {
    default_provider: string;
    model_aliases: string;
    openai_model_prefixes: string;
  };
  inbound: {
    proxy_auth_key: string;
    proxy_keys: string;
    admin_auth_key: string;
  };
  tuning: {
    log_level: string;
    access_log: boolean;
    upstream_timeout_ms: string;
  };
}

export interface RoutePreview {
  ok?: boolean;
  requested_model?: string;
  provider?: string;
  upstream_model?: string;
  reason?: string;
}

export interface IntegrationItem {
  title: string;
  base_url?: string;
  api_key?: string;
  api_key_masked?: string;
  model?: string;
  note?: string;
  snippet?: string;
  snippet_redacted?: string;
}

export interface IntegrationSnapshot {
  ok?: boolean;
  items: Record<string, IntegrationItem>;
}

export interface ProviderModelsResult {
  ok?: boolean;
  models?: string[];
  source?: string;
  error?: string;
}

export interface TestResult {
  ok?: boolean;
  model?: string;
  upstream_model?: string;
  provider?: string;
  text?: string;
}

export interface ProviderKeyTestResult {
  ok?: boolean;
  provider?: string;
  id?: string;
  label?: string;
  model?: string;
  http_status?: number;
  latency_ms?: number;
  classification?: {
    code?: string;
    state?: ProviderAccountState;
    message?: string;
    status?: number;
  };
  account?: ProviderAccountRuntime | null;
}

export interface HealthPayload {
  status?: string;
  providers?: string[];
  default_provider?: string;
}

export interface CurlResult {
  curl?: string;
  redacted_curl?: string;
  provider?: string;
  model?: string;
  upstream_model?: string;
}
