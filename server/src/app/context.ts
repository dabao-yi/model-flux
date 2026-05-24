import { normalizeModelId, parseCsv, parseKeyPool, type KeyPoolRow } from "../lib/utils.js";
import { configureLogging } from "../lib/log.js";
import { loadProxyKeyTable } from "../auth/proxy-auth.js";
import { createResponseStore, type ResponseStore } from "../store/response-store.js";
import {
  buildExplicitModelProvider,
  buildModelCatalog,
  describeModelRoute,
  extractModelIdsFromPayload,
  getFallbackProvider,
  loadCatalogModels,
  parseModelAliases,
  resolveProviderForModel,
  resolveUpstreamModelForProvider,
  type ModelAlias,
  type ModelCatalogEntry,
} from "../routing/models.js";
import { upstreamFetch } from "../lib/upstream-fetch.js";
import { findProviderKey } from "../routing/models.js";
import { parseEnvFile } from "../config/env.js";
import { parseKeyPoolAll } from "../lib/utils.js";
import { createAccountScheduler, type AccountScheduler } from "../scheduler/accounts.js";

export interface OaiCompatProviderConfig {
  base: string;
  key: string;
  keys: KeyPoolRow[];
  keyCursor: number;
  models: string[];
  defaultModel: string;
  envKey: string;
}

export interface AppContext {
  port: number;
  bindHost: string;
  useUndiciAgent: boolean;
  adminEnabled: boolean;
  adminAuthKey: string;
  proxyAuthKey: string;
  proxyKeysRaw: string;
  proxyKeyTable: Map<string, string>;
  proxyAuthEnabled: boolean;
  defaultProvider: string;
  openaiBase: string;
  openaiKeys: KeyPoolRow[];
  openaiKey: string;
  openaiModels: string[];
  openaiModelPrefixes: string[];
  oaiCompatProviders: Record<string, OaiCompatProviderConfig>;
  enabledProviders: Set<string>;
  providerModels: Record<string, string[]>;
  explicitModelProvider: Map<string, string>;
  modelAliases: ModelAlias[];
  modelAliasMap: Map<string, ModelAlias>;
  modelCatalog: ModelCatalogEntry[];
  responseStore: ResponseStore;
  accountScheduler: AccountScheduler;
  storeTtl: number;
  storeMax: number;
  maxConsecutiveToolCalls: number;
  upstreamTimeout: number;
  maxFetchLoops: number;
  webFetchConfig: {
    jinaBase: string;
    jinaFetchTimeout: number;
    jinaMaxBody: number;
    fetchTimeout: number;
    fetchMaxBody: number;
  };
  resolveProvider: (model: string) => string;
  resolveUpstreamModel: (provider: string, model: string) => string;
  describeModelRoute: (model: string) => ReturnType<typeof describeModelRoute>;
  getFallbackProvider: () => string;
  nextProviderKey: (provider: string) => string;
  nextOpenAIKey: () => string;
  firstOpenAIKey: () => string;
  pickEnv: (key: string, fallback?: string) => string;
  discoverProviderModels: (provider: string) => Promise<Record<string, unknown>>;
}

let appContext: AppContext | null = null;

export function initAppContext(): AppContext {
  const port = Number(process.env.PROXY_PORT || 19090);
  const bindHost = process.env.BIND_HOST || "127.0.0.1";
  const useUndiciAgent = process.env.USE_UNDICI_AGENT === "1";

  configureLogging(process.env.LOG_LEVEL || "info", process.env.ACCESS_LOG ?? "1");

  const proxyAuthKey = (process.env.PROXY_AUTH_KEY || "").trim();
  const proxyKeysRaw = (process.env.PROXY_KEYS || "").trim();
  const proxyKeyTable = loadProxyKeyTable(proxyKeysRaw, proxyAuthKey);
  const proxyAuthEnabled = proxyKeyTable.size > 0;

  const adminEnabled = process.env.ADMIN_ENABLED !== "0";
  const adminAuthKey = (process.env.ADMIN_AUTH_KEY || "").trim();

  let deepseekModels = parseCsv(process.env.DEEPSEEK_MODELS || "deepseek-v4-pro,deepseek-v4-flash");
  let mimoModels = parseCsv(process.env.MIMO_MODELS || "mimo-v2.5-pro");
  let compatModels = parseCsv(process.env.COMPAT_MODELS || "");
  let openaiModels = parseCsv(process.env.OPENAI_MODELS || "");

  const modelCatalogPath = (process.env.MODEL_CATALOG_PATH || "").trim();
  const catalog = modelCatalogPath ? loadCatalogModels(modelCatalogPath) : null;
  if (catalog) {
    if (catalog.deepseek.length) deepseekModels = [...catalog.deepseek];
    if (catalog.mimo.length) mimoModels = [...catalog.mimo];
    if (catalog.compat.length) compatModels = [...catalog.compat];
    if (catalog.openai.length) openaiModels = [...catalog.openai];
  }

  const deepseekKeys = parseKeyPool(process.env.DEEPSEEK_API_KEY || "", process.env.DEEPSEEK_API_KEYS || "");
  const mimoKeys = parseKeyPool(process.env.MIMO_API_KEY || "", process.env.MIMO_API_KEYS || "");
  const compatKeys = parseKeyPool(process.env.COMPAT_API_KEY || "", process.env.COMPAT_API_KEYS || "");
  const openaiKeys = parseKeyPool(process.env.OPENAI_API_KEY || "", process.env.OPENAI_API_KEYS || "");
  const accountScheduler = createAccountScheduler();

  const oaiCompatProviders: Record<string, OaiCompatProviderConfig> = {
    deepseek: {
      base: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      key: deepseekKeys[0]?.key || "",
      keys: deepseekKeys,
      keyCursor: 0,
      models: deepseekModels,
      defaultModel: deepseekModels[0] || "deepseek-v4-pro",
      envKey: "DEEPSEEK_API_KEY",
    },
    mimo: {
      base: process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1",
      key: mimoKeys[0]?.key || "",
      keys: mimoKeys,
      keyCursor: 0,
      models: mimoModels,
      defaultModel: mimoModels[0] || "mimo-v2.5-pro",
      envKey: "MIMO_API_KEY",
    },
    compat: {
      base: process.env.COMPAT_BASE_URL || "",
      key: compatKeys[0]?.key || "",
      keys: compatKeys,
      keyCursor: 0,
      models: compatModels,
      defaultModel: compatModels[0] || "",
      envKey: "COMPAT_API_KEY",
    },
  };

  const openaiKey = openaiKeys[0]?.key || "";
  const openaiBase = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const openaiModelPrefixes = parseCsv(process.env.OPENAI_MODEL_PREFIXES || "gpt-,o1,o3,o4,codex-,chatgpt-");
  const defaultProvider = (process.env.DEFAULT_PROVIDER || "").trim().toLowerCase();

  const enabledProviders = new Set<string>();
  for (const [name, cfg] of Object.entries(oaiCompatProviders)) {
    if (cfg.key) enabledProviders.add(name);
  }
  if (openaiKey) enabledProviders.add("openai");
  for (const [name, cfg] of Object.entries(oaiCompatProviders)) {
    accountScheduler.syncProvider(name, cfg.keys);
  }
  accountScheduler.syncProvider("openai", openaiKeys);

  const providerModels: Record<string, string[]> = {
    ...Object.fromEntries(Object.entries(oaiCompatProviders).map(([n, c]) => [n, c.models])),
    openai: openaiModels,
  };

  let explicitModelProvider = buildExplicitModelProvider(oaiCompatProviders, openaiModels);
  const modelAliases = parseModelAliases(
    process.env.MODEL_ALIASES || "",
    enabledProviders,
    providerModels,
    openaiModelPrefixes,
    defaultProvider,
  );
  const modelAliasMap = new Map<string, ModelAlias>();
  for (const alias of modelAliases) {
    modelAliasMap.set(normalizeModelId(alias.from), alias);
    explicitModelProvider.set(alias.from.toLowerCase(), alias.provider);
  }

  const modelCatalog = buildModelCatalog(modelAliases, oaiCompatProviders, openaiKey, openaiModels);

  const getFallback = () =>
    getFallbackProvider(defaultProvider, enabledProviders, Object.keys(oaiCompatProviders));

  const resolveProvider = (model: string) =>
    resolveProviderForModel(model, explicitModelProvider, enabledProviders, openaiModelPrefixes, getFallback);

  const resolveUpstreamModel = (provider: string, requestedModel: string) =>
    resolveUpstreamModelForProvider(provider, requestedModel, modelAliasMap, oaiCompatProviders, openaiModels);

  const describeRoute = (model: string) =>
    describeModelRoute(model, explicitModelProvider, modelAliasMap, resolveProvider, resolveUpstreamModel);

  let openaiKeyCursor = 0;
  const nextOpenAIKey = () => {
    const keys = openaiKeys.length ? openaiKeys : openaiKey ? [{ key: openaiKey, label: "primary", id: "", enabled: true, source: "primary" }] : [];
    if (!keys.length) return "";
    const idx = Math.abs(openaiKeyCursor) % keys.length;
    openaiKeyCursor = idx + 1;
    return keys[idx].key;
  };

  const nextProviderKey = (provider: string) => {
    const cfg = oaiCompatProviders[provider];
    if (!cfg) return "";
    const keys = cfg.keys.length ? cfg.keys : cfg.key ? [{ key: cfg.key, label: "primary", id: "", enabled: true, source: "primary" }] : [];
    if (!keys.length) return "";
    const idx = Math.abs(cfg.keyCursor) % keys.length;
    cfg.keyCursor = idx + 1;
    return keys[idx].key;
  };

  const pickEnv = (key: string, fallback = "") => {
    const fileEnv = parseEnvFile();
    return fileEnv[key] ?? process.env[key] ?? fallback;
  };

  const discoverProviderModels = async (provider: string) => {
    const name = String(provider || "").trim().toLowerCase();
    let base = "";
    let key = "";
    let configured: string[] = [];
    if (name === "openai") {
      base = openaiBase;
      key = openaiKeys[0]?.key || openaiKey || "";
      configured = openaiModels;
    } else {
      const cfg = oaiCompatProviders[name];
      if (!cfg) {
        const err = new Error(`未知供应商: ${name}`) as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      }
      base = cfg.base;
      key = cfg.keys?.[0]?.key || cfg.key;
      configured = cfg.models;
    }
    if (!key) {
      const err = new Error(`${name} 没有启用的 key，无法拉取模型列表。`) as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }
    if (!base) {
      const err = new Error(`${name} 没有配置 Base URL。`) as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    }
    const url = `${String(base).replace(/\/+$/, "")}/models`;
    try {
      const upstreamRes = await upstreamFetch(
        url,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        },
        20000,
      );
      const text = await upstreamRes.text();
      let payload: unknown = null;
      try {
        payload = JSON.parse(text);
      } catch {
        /* ignore */
      }
      if (!upstreamRes.ok) {
        const errMsg =
          (payload as { error?: { message?: string } })?.error?.message ||
          text.slice(0, 500) ||
          `HTTP ${upstreamRes.status}`;
        return {
          ok: false,
          provider: name,
          source: url,
          configured_models: configured,
          models: configured,
          error: errMsg,
        };
      }
      const discovered = extractModelIdsFromPayload(payload);
      return {
        ok: true,
        provider: name,
        source: url,
        configured_models: configured,
        models: discovered.length ? discovered : configured,
        discovered_count: discovered.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider: name,
        source: url,
        configured_models: configured,
        models: configured,
        error: message,
      };
    }
  };

  appContext = {
    port,
    bindHost,
    useUndiciAgent,
    adminEnabled,
    adminAuthKey,
    proxyAuthKey,
    proxyKeysRaw,
    proxyKeyTable,
    proxyAuthEnabled,
    defaultProvider,
    openaiBase,
    openaiKeys,
    openaiKey,
    openaiModels,
    openaiModelPrefixes,
    oaiCompatProviders,
    enabledProviders,
    providerModels,
    explicitModelProvider,
    modelAliases,
    modelAliasMap,
    modelCatalog,
    responseStore: createResponseStore({
      storeTtl: Number(process.env.STORE_TTL_MS) || 60 * 60 * 1000,
      storeMax: Number(process.env.STORE_MAX) || 500,
    }),
    accountScheduler,
    storeTtl: Number(process.env.STORE_TTL_MS) || 60 * 60 * 1000,
    storeMax: Number(process.env.STORE_MAX) || 500,
    maxConsecutiveToolCalls: Number(process.env.MAX_CONSECUTIVE_TOOL_CALLS) || 20,
    upstreamTimeout: Number(process.env.UPSTREAM_TIMEOUT_MS) || 120000,
    maxFetchLoops: Number(process.env.MAX_FETCH_LOOPS) || 5,
    webFetchConfig: {
      jinaBase: (process.env.JINA_BASE || "https://r.jina.ai").replace(/\/+$/, ""),
      jinaFetchTimeout: Number(process.env.JINA_FETCH_TIMEOUT_MS) || 20000,
      jinaMaxBody: Number(process.env.JINA_MAX_BODY) || 80000,
      fetchTimeout: Number(process.env.FETCH_TIMEOUT_MS) || 15000,
      fetchMaxBody: Number(process.env.FETCH_MAX_BODY) || 50000,
    },
    resolveProvider,
    resolveUpstreamModel,
    describeModelRoute: describeRoute,
    getFallbackProvider: getFallback,
    nextProviderKey,
    nextOpenAIKey,
    firstOpenAIKey: () => openaiKeys[0]?.key || openaiKey || "",
    pickEnv,
    discoverProviderModels,
  };

  return appContext;
}

export function getAppContext(): AppContext {
  if (!appContext) {
    throw new Error("App context not initialized. Call initAppContext() first.");
  }
  return appContext;
}

export function validateProviderKeys(ctx: AppContext): void {
  const hasKey =
    ctx.oaiCompatProviders.deepseek.key ||
    ctx.openaiKey ||
    ctx.oaiCompatProviders.mimo.key ||
    ctx.oaiCompatProviders.compat.key;
  if (!hasKey) {
    console.error(
      "At least one upstream provider key is required: set DEEPSEEK_API_KEY, MIMO_API_KEY, COMPAT_API_KEY, and/or OPENAI_API_KEY",
    );
    process.exit(1);
  }
}

export function findProviderKeyInContext(provider: string, id: string) {
  const ctx = getAppContext();
  return findProviderKey(provider, id, ctx.pickEnv, parseKeyPoolAll);
}
