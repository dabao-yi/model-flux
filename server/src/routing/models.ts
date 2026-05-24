import fs from "node:fs";
import {
  normalizeModelId,
  parseCsv,
  splitConfigList,
  type KeyPoolRow,
} from "../lib/utils.js";
import type { OaiCompatProviderConfig } from "../app/context.js";

export interface ModelAlias {
  from: string;
  provider: string;
  upstream_model: string;
  raw: string;
}

export interface ModelCatalogEntry {
  id: string;
  object: string;
  owned_by: string;
  alias_of?: string;
}

export const OAI_COMPAT_NAME_HINTS = [
  { provider: "deepseek", tokens: ["deepseek"] },
  { provider: "mimo", tokens: ["mimo", "xiaomi"] },
  { provider: "compat", tokens: ["compat"] },
] as const;

export function loadCatalogModels(path: string): Record<string, string[]> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path, "utf-8")) as { models?: { slug?: string; provider?: string }[] };
    const out: Record<string, string[]> = { deepseek: [], mimo: [], compat: [], openai: [] };
    for (const m of raw.models || []) {
      if (!m?.slug) continue;
      let p = (m.provider || "").toLowerCase();
      if (!p) {
        const s = m.slug.toLowerCase();
        if (s.startsWith("deepseek")) p = "deepseek";
        else if (s.startsWith("mimo") || s.startsWith("xiaomi")) p = "mimo";
        else if (s.startsWith("compat-")) p = "compat";
        else if (
          s.startsWith("gpt-") ||
          s.startsWith("o1") ||
          s.startsWith("o3") ||
          s.startsWith("o4") ||
          s.startsWith("codex-") ||
          s.startsWith("chatgpt-")
        )
          p = "openai";
      }
      if (out[p]) out[p].push(m.slug);
    }
    console.log(
      `[model-flux] model_catalog: loaded ${path} (deepseek=${out.deepseek.length}, mimo=${out.mimo.length}, openai=${out.openai.length})`,
    );
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[model-flux] model_catalog: ${path} unreadable (${message}), falling back to env lists`);
    return null;
  }
}

export function parseModelAliases(
  value: string,
  enabledProviders: Set<string>,
  providerModels: Record<string, string[]>,
  openaiModelPrefixes: string[],
  defaultProvider: string,
): ModelAlias[] {
  const out: ModelAlias[] = [];
  const seen = new Set<string>();

  const inferProviderForUpstreamModel = (model: string): string => {
    const normalized = normalizeModelId(model);
    if (!normalized) return "";
    for (const [provider, models] of Object.entries(providerModels || {})) {
      if ((models || []).some((m) => normalizeModelId(m) === normalized)) return provider;
    }
    if (enabledProviders.has("openai") && openaiModelPrefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase())))
      return "openai";
    if (defaultProvider && enabledProviders.has(defaultProvider)) return defaultProvider;
    for (const provider of enabledProviders) return provider;
    return "";
  };

  for (const raw of splitConfigList(value)) {
    const match = raw.match(/^([^=]+?)\s*(?:=>|->|=)\s*(.+)$/);
    if (!match) continue;
    const from = match[1].trim();
    let target = match[2].trim();
    if (!from || !target) continue;
    let provider = "";
    const providerMatch = target.match(/^(deepseek|mimo|compat|openai)\s*[:/]\s*(.+)$/i);
    if (providerMatch) {
      provider = providerMatch[1].toLowerCase();
      target = providerMatch[2].trim();
    }
    if (!provider) provider = inferProviderForUpstreamModel(target);
    if (!target || !provider) continue;
    const key = normalizeModelId(from);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, provider, upstream_model: target, raw });
  }
  return out.filter((alias) => enabledProviders.has(alias.provider));
}

export function buildExplicitModelProvider(
  oaiCompatProviders: Record<string, OaiCompatProviderConfig>,
  openaiModels: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [name, cfg] of Object.entries(oaiCompatProviders)) {
    for (const model of cfg.models) map.set(normalizeModelId(model), name);
  }
  for (const model of openaiModels) map.set(normalizeModelId(model), "openai");
  return map;
}

export function buildModelCatalog(
  modelAliases: ModelAlias[],
  oaiCompatProviders: Record<string, OaiCompatProviderConfig>,
  openaiKey: string,
  openaiModels: string[],
): ModelCatalogEntry[] {
  const seen = new Set<string>();
  const out: ModelCatalogEntry[] = [];
  const add = (id: string, owned_by: string, alias_of = "") => {
    const key = normalizeModelId(id);
    if (!id || seen.has(key)) return;
    seen.add(key);
    out.push({ id, object: "model", owned_by, ...(alias_of ? { alias_of } : {}) });
  };
  for (const alias of modelAliases) add(alias.from, alias.provider, alias.upstream_model);
  for (const [name, cfg] of Object.entries(oaiCompatProviders)) {
    if (!cfg.key) continue;
    for (const id of cfg.models) add(id, name);
  }
  if (openaiKey) for (const id of openaiModels) add(id, "openai");
  return out;
}

export function getFallbackProvider(
  defaultProvider: string,
  enabledProviders: Set<string>,
  oaiCompatProviderNames: string[],
): string {
  if (defaultProvider && enabledProviders.has(defaultProvider)) return defaultProvider;
  if (enabledProviders.has("openai")) return "openai";
  for (const name of oaiCompatProviderNames) {
    if (enabledProviders.has(name)) return name;
  }
  throw new Error("No providers are enabled");
}

export function resolveProviderForModel(
  model: string,
  explicitModelProvider: Map<string, string>,
  enabledProviders: Set<string>,
  openaiModelPrefixes: string[],
  getFallback: () => string,
): string {
  const normalized = normalizeModelId(model);
  if (normalized) {
    const explicit = explicitModelProvider.get(normalized);
    if (explicit && enabledProviders.has(explicit)) return explicit;
    for (const { provider, tokens } of OAI_COMPAT_NAME_HINTS) {
      if (enabledProviders.has(provider) && tokens.some((t) => normalized.includes(t))) return provider;
    }
    if (enabledProviders.has("openai")) {
      const looksOpenAI = openaiModelPrefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
      if (looksOpenAI) return "openai";
    }
  }
  return getFallback();
}

export function resolveUpstreamModelForProvider(
  provider: string,
  requestedModel: string,
  modelAliasMap: Map<string, ModelAlias>,
  oaiCompatProviders: Record<string, OaiCompatProviderConfig>,
  openaiModels: string[],
): string {
  const alias = modelAliasMap.get(normalizeModelId(requestedModel));
  if (alias && alias.provider === provider) return alias.upstream_model;
  if (provider === "openai") return requestedModel || openaiModels[0] || "";
  const cfg = oaiCompatProviders[provider];
  if (!cfg) return requestedModel || "";
  const requested = normalizeModelId(requestedModel);
  const isProviderModel = requested && cfg.models.some((m) => normalizeModelId(m) === requested);
  return isProviderModel ? requestedModel : cfg.defaultModel;
}

export function describeModelRoute(
  model: string,
  explicitModelProvider: Map<string, string>,
  modelAliasMap: Map<string, ModelAlias>,
  resolveProvider: (m: string) => string,
  resolveUpstream: (provider: string, requested: string) => string,
): {
  requested_model: string;
  provider: string;
  upstream_model: string;
  reason: string;
} {
  const requested_model = String(model || "").trim();
  const provider = resolveProvider(requested_model);
  const upstream_model = resolveUpstream(provider, requested_model);
  const alias = modelAliasMap.get(normalizeModelId(requested_model));
  let reason = "fallback";
  if (alias) reason = "MODEL_ALIASES";
  else if (explicitModelProvider.get(normalizeModelId(requested_model)) === provider) reason = "provider model list";
  else if (requested_model && provider === "openai") reason = "OpenAI prefix";
  return { requested_model, provider, upstream_model, reason };
}

export function extractModelIdsFromPayload(payload: unknown): string[] {
  const ids: string[] = [];
  const add = (value: unknown) => {
    const id = String(value || "").trim();
    if (id) ids.push(id);
  };
  const arrays: unknown[][] = [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p?.data)) arrays.push(p.data);
  if (Array.isArray(p?.models)) arrays.push(p.models);
  if (Array.isArray(payload)) arrays.push(payload as unknown[]);
  for (const arr of arrays) {
    for (const item of arr) {
      if (typeof item === "string") add(item);
      else {
        const row = item as Record<string, unknown>;
        add(row?.id || row?.model || row?.name || row?.slug);
      }
    }
  }
  return parseCsv(ids.join(","));
}

export function firstModelForProvider(
  provider: string,
  openaiModels: string[],
  oaiCompatProviders: Record<string, OaiCompatProviderConfig>,
): string {
  if (provider === "openai") return openaiModels[0] || "gpt-5.4";
  const cfg = oaiCompatProviders[provider];
  return cfg?.models?.[0] || cfg?.defaultModel || "gpt-5.4";
}

export function pickProxyKeyForProvider(
  provider: string,
  proxyAuthEnabled: boolean,
  proxyAuthKey: string,
  proxyKeyTable: Map<string, string>,
): { key: string; lock: string; auth_enabled: boolean } {
  if (!proxyAuthEnabled) return { key: "", lock: "", auth_enabled: false };
  if (
    proxyAuthKey &&
    (proxyKeyTable.get(proxyAuthKey) === "*" || proxyKeyTable.get(proxyAuthKey) === provider)
  ) {
    return { key: proxyAuthKey, lock: proxyKeyTable.get(proxyAuthKey) || "*", auth_enabled: true };
  }
  for (const [key, lock] of proxyKeyTable.entries()) {
    if (lock === "*" || lock === provider) return { key, lock, auth_enabled: true };
  }
  return { key: "", lock: "", auth_enabled: true };
}

export function findProviderKey(
  provider: string,
  id: string,
  pickEnv: (key: string) => string,
  parseKeyPoolAll: (primary: string, pool: string) => KeyPoolRow[],
): KeyPoolRow | null {
  const name = String(provider || "").trim().toLowerCase();
  const upper = name.toUpperCase();
  const rows = parseKeyPoolAll(pickEnv(`${upper}_API_KEY`), pickEnv(`${upper}_API_KEYS`));
  const wanted = String(id || "").trim();
  return rows.find((row) => row.id === wanted) || null;
}
