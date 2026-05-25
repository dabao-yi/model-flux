import path from "node:path";
import type { Context } from "hono";
import {
  maskSecret,
  normalizeBaseUrl,
  normalizeConfigNewlines,
  parseCsv,
  parseKeyPoolAll,
  publicBaseFromReq,
  redactBearerInCurl,
  shellSingleQuote,
  maskedValue,
  encodeKeyPoolEntry,
} from "../lib/utils.js";
import { CONFIG_ENV_PATH, parseEnvFile, readLocalSecretFile } from "./env.js";
import type { AppContext } from "../app/context.js";
import {
  describeModelRoute,
  firstModelForProvider,
  pickProxyKeyForProvider,
} from "../routing/models.js";

export function providerEnvFromPayload(
  prefix: string,
  provider: Record<string, unknown> | undefined,
  pickEnv: (key: string, fallback?: string) => string,
): Record<string, string> {
  const up = prefix.toUpperCase();
  const out: Record<string, string> = {};
  if (!provider) return out;
  const defaultBaseUrl = normalizeBaseUrl(provider.base_url);
  out[`${up}_BASE_URL`] = defaultBaseUrl;
  out[`${up}_MODELS`] = Array.isArray(provider.models)
    ? (provider.models as string[]).join(",")
    : String(provider.models || "");

  const fileEnv = parseEnvFile();
  const existingDefaultBaseUrl = defaultBaseUrl || normalizeBaseUrl(fileEnv[`${up}_BASE_URL`] ?? process.env[`${up}_BASE_URL`] ?? "");
  const existing = parseKeyPoolAll(
    fileEnv[`${up}_API_KEY`] ?? process.env[`${up}_API_KEY`] ?? "",
    fileEnv[`${up}_API_KEYS`] ?? process.env[`${up}_API_KEYS`] ?? "",
    existingDefaultBaseUrl,
  );
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const existingByMasked = new Map(existing.map((row) => [maskSecret(row.key), row]));
  const rows = Array.isArray(provider.keys) ? (provider.keys as Record<string, unknown>[]) : [];
  const resolved: { key: string; label: string; enabled: boolean; base_url: string; priority: number }[] = [];
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    let key = String(row?.key || "").trim();
    const id = String(row?.id || "").trim();
    const masked = String(row?.masked || "").trim();
    if (!key || key.includes("•") || key.includes("…")) {
      key = existingById.get(id)?.key || existingByMasked.get(key)?.key || existingByMasked.get(masked)?.key || "";
    }
    key = String(key || "").trim();
    const baseUrl = normalizeBaseUrl(row?.base_url) || existingById.get(id)?.base_url || existingByMasked.get(masked)?.base_url || defaultBaseUrl;
    const dedupeKey = `${key}|${baseUrl}`;
    if (!key || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    resolved.push({
      key,
      label: String(row?.label || "").trim() || `key-${i + 1}`,
      enabled: provider.enabled !== false && row?.enabled !== false,
      base_url: baseUrl,
      priority: Number(row?.priority || 0) || 0,
    });
  });

  if (!resolved.length && rows.some((row) => String(row?.key || "").includes("•") || String(row?.key || "").includes("…"))) {
    return out;
  }

  const enabled = resolved.filter((row) => row.enabled !== false);
  const disabled = resolved.filter((row) => row.enabled === false);
  out[`${up}_API_KEY`] = enabled[0]?.key || "";
  const poolRows = [...enabled.slice(1), ...disabled];
  out[`${up}_API_KEYS`] = poolRows.map((row) => encodeKeyPoolEntry(row, defaultBaseUrl)).filter(Boolean).join(",");
  return out;
}

export function activeConfigSnapshot(ctx: AppContext, { reveal = false } = {}) {
  const fileEnv = parseEnvFile();
  const pick = (key: string, fallback = "") => fileEnv[key] ?? process.env[key] ?? fallback;

  const provider = (name: string, defaults: { base: string; models: string }) => {
    const upper = name.toUpperCase();
    const primary = pick(`${upper}_API_KEY`);
    const pool = pick(`${upper}_API_KEYS`);
    const baseUrl = normalizeBaseUrl(pick(`${upper}_BASE_URL`, defaults.base));
    const allKeys = parseKeyPoolAll(primary, pool, baseUrl);
    const enabledKeys = allKeys.filter((k) => k.enabled !== false);
    const runtimeRows = ctx.accountScheduler.snapshot(name)[name] || [];
    const runtimeById = new Map(runtimeRows.map((row) => [row.id, row]));
    return {
      id: name,
      enabled: enabledKeys.length > 0,
      base_url: baseUrl,
      models: parseCsv(pick(`${upper}_MODELS`, defaults.models)).join(","),
      key_count: enabledKeys.length,
      total_key_count: allKeys.length,
      disabled_key_count: allKeys.filter((k) => k.enabled === false).length,
      keys: allKeys.map((k) => ({
        id: k.id,
        label: k.label,
        enabled: k.enabled !== false,
        key: reveal ? k.key : maskSecret(k.key),
        masked: maskSecret(k.key),
        base_url: k.base_url || baseUrl,
        priority: k.priority || 0,
        scheduler:
          runtimeById.get(k.id) ||
          ({
            id: k.id,
            label: k.label,
            provider: name,
            masked: maskSecret(k.key),
            base_url: k.base_url || baseUrl,
            enabled: k.enabled !== false,
            state: k.enabled === false ? "manual_disabled" : "healthy",
            schedulable: k.enabled !== false,
            in_flight: 0,
            success_count: 0,
            failure_count: 0,
            last_success_at: null,
            last_error_at: null,
            last_error: "",
            last_status: null,
            cooldown_until: null,
            next_probe_at: null,
            cooldown_ms_remaining: 0,
            weight: Math.max(1, Number(k.priority || 0) + 1),
          }),
      })),
      primary_key: reveal ? primary : maskSecret(primary),
      key_pool: reveal
        ? pool
        : parseKeyPoolAll("", pool, baseUrl)
            .map(
              (k) =>
                `${maskSecret(k.key)}${k.label ? "|" + k.label : ""}|${k.enabled === false ? "disabled" : "enabled"}${
                  k.base_url && k.base_url !== baseUrl ? "|" + k.base_url : k.priority ? "|" : ""
                }${k.priority ? "|" + k.priority : ""}`,
            )
            .join(","),
    };
  };

  return {
    env_path: CONFIG_ENV_PATH,
    admin_enabled: ctx.adminEnabled,
    runtime_note: "保存后需要重启 ModelFlux 服务才能让运行时读取新 .env。页面会提供重启按钮。",
    inbound: {
      proxy_auth_key: reveal ? pick("PROXY_AUTH_KEY") : maskSecret(pick("PROXY_AUTH_KEY")),
      proxy_keys: reveal
        ? pick("PROXY_KEYS")
        : pick("PROXY_KEYS")
            .split(",")
            .filter(Boolean)
            .map((x) => {
              const idx = x.lastIndexOf(":");
              return idx === -1 ? maskSecret(x) : `${maskSecret(x.slice(0, idx))}:${x.slice(idx + 1)}`;
            })
            .join(","),
      admin_auth_key: reveal ? pick("ADMIN_AUTH_KEY") : maskSecret(pick("ADMIN_AUTH_KEY")),
    },
    routing: {
      default_provider: pick("DEFAULT_PROVIDER"),
      model_aliases: normalizeConfigNewlines(pick("MODEL_ALIASES")),
      openai_model_prefixes: pick("OPENAI_MODEL_PREFIXES", "gpt-,o1,o3,o4,codex-,chatgpt-"),
    },
    providers: {
      mimo: provider("mimo", { base: "https://token-plan-cn.xiaomimimo.com/v1", models: "mimo-v2.5-pro" }),
      deepseek: provider("deepseek", { base: "https://api.deepseek.com/v1", models: "deepseek-v4-pro,deepseek-v4-flash" }),
      compat: provider("compat", { base: "", models: "" }),
      openai: provider("openai", { base: "https://api.openai.com/v1", models: "" }),
    },
    tuning: {
      log_level: pick("LOG_LEVEL", "info"),
      access_log: pick("ACCESS_LOG", "1"),
      upstream_timeout_ms: pick("UPSTREAM_TIMEOUT_MS", "120000"),
    },
    runtime: {
      enabled_providers: [...ctx.enabledProviders],
      default_provider: ctx.getFallbackProvider(),
      model_count: ctx.modelCatalog.length,
      models: ctx.modelCatalog,
      scheduler_summary: ctx.accountScheduler.summary(),
      scheduler: ctx.accountScheduler.snapshot(),
    },
  };
}

export function integrationSnapshot(c: Context, ctx: AppContext) {
  const fluxKey = ctx.proxyAuthKey || readLocalSecretFile(path.join(process.cwd(), ".model-flux-key"));
  const fluxPublicBase = `${publicBaseFromReq(c, ctx.port)}/v1`;
  const sub2apiInternalFluxBase = process.env.SUB2API_TO_FLUX_BASE_URL || "http://model-flux:19090/v1";
  const model = ctx.modelAliases[0]?.from || ctx.modelCatalog[0]?.id || "gpt-5.5";
  const items = {
    direct_model_flux: {
      title: "本机客户端 -> ModelFlux",
      base_url: fluxPublicBase,
      api_key: fluxKey,
      model,
      note: "适合运行在宿主机 / 本机的 Codex、CPA 或其它 OpenAI-compatible 客户端。不要把 127.0.0.1 配给其它容器使用。",
      snippet: `base_url=${fluxPublicBase}\napi_key=${fluxKey || "<ModelFlux PROXY_AUTH_KEY>"}\nmodel=${model}\nwire_api=responses_or_chat_completions`,
    },
    cliproxyapi_to_flux: {
      title: "本机 CLIProxyAPI -> ModelFlux",
      base_url: fluxPublicBase,
      api_key: fluxKey,
      model,
      note: "适合 CLIProxyAPI 运行在宿主机 / 本机的场景。Codex 先连 CLIProxyAPI，CLIProxyAPI 的 OpenAI-compatible 上游再指向 ModelFlux。",
      snippet: `upstream_base_url=${fluxPublicBase}\nupstream_api_key=${fluxKey || "<ModelFlux PROXY_AUTH_KEY>"}\nupstream_model=${model}\nprotocol=openai-compatible`,
    },
    sub2api_to_flux: {
      title: "容器内 sub2api -> ModelFlux",
      base_url: sub2apiInternalFluxBase,
      api_key: fluxKey,
      model,
      note: "适合 sub2api 和 ModelFlux 在同一个 Docker Compose / Docker network 内。若 sub2api 配了 HTTP_PROXY，请把 model-flux 加入 NO_PROXY/no_proxy，并且这个本地上游账号不要绑定代理。",
      snippet: `upstream_base_url=${sub2apiInternalFluxBase}\nupstream_api_key=${fluxKey || "<ModelFlux PROXY_AUTH_KEY>"}\nmodel=${model}\nproxy=disabled`,
    },
    generic_client_to_flux: {
      title: "本机 OpenAI-compatible -> ModelFlux",
      base_url: fluxPublicBase,
      api_key: fluxKey,
      model,
      note: "适合运行在宿主机 / 本机的通用工具。其它机器访问时请把 127.0.0.1 换成 ModelFlux 所在机器的 IP 或域名。",
      snippet: `OPENAI_BASE_URL=${fluxPublicBase}\nOPENAI_API_KEY=${fluxKey || "<ModelFlux PROXY_AUTH_KEY>"}\nOPENAI_MODEL=${model}`,
    },
  };
  const redactItem = (item: { api_key: string; snippet: string }) => ({
    ...item,
    api_key_masked: maskSecret(item.api_key),
    snippet_redacted: item.snippet.replace(item.api_key || "<never>", maskSecret(item.api_key)),
  });
  return { ok: true, items: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, redactItem(v)])) };
}

export function generateTestCurl(c: Context, ctx: AppContext, { provider = "", model = "" } = {}) {
  const route = model ? ctx.describeModelRoute(model) : null;
  const selectedProvider =
    provider && ctx.enabledProviders.has(provider) ? provider : route?.provider || ctx.getFallbackProvider();
  const selectedModel = model || firstModelForProvider(selectedProvider, ctx.openaiModels, ctx.oaiCompatProviders);
  const upstreamModel = ctx.resolveUpstreamModel(selectedProvider, selectedModel);
  const picked = pickProxyKeyForProvider(
    selectedProvider,
    ctx.proxyAuthEnabled,
    ctx.proxyAuthKey,
    ctx.proxyKeyTable,
  );
  if (picked.auth_enabled && !picked.key) {
    const err = new Error(`没有找到可用于 ${selectedProvider} 的入站 key，请检查 PROXY_AUTH_KEY / PROXY_KEYS。`) as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }
  const host = c.req.header("host") || "127.0.0.1:19090";
  const proto = host.startsWith("127.") || host.startsWith("localhost") ? "http" : "http";
  const url = `${proto}://${host}/v1/responses`;
  const body = JSON.stringify({
    model: selectedModel,
    input: "请只输出 MIMO_OK，不要输出其他内容",
    stream: false,
  });
  const lines = [
    `curl -sS --max-time 60 ${shellSingleQuote(url)} \\`,
    picked.key ? `  -H ${shellSingleQuote(`Authorization: Bearer ${picked.key}`)} \\` : "",
    `  -H ${shellSingleQuote("Content-Type: application/json")} \\`,
    `  --data-raw ${shellSingleQuote(body)}`,
  ].filter(Boolean);
  const curl = lines.join("\n");
  return {
    ok: true,
    target: "model-flux",
    provider: selectedProvider,
    model: selectedModel,
    upstream_model: upstreamModel,
    route_reason: route?.reason || (model ? "fallback" : "default provider"),
    auth_enabled: picked.auth_enabled,
    key_lock: picked.lock || "open",
    curl,
    redacted_curl: redactBearerInCurl(curl),
  };
}

export { maskedValue };
