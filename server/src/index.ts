import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getLockedProvider, proxyAuthMiddleware } from "./auth/proxy-auth.js";
import { adminAuthMiddleware } from "./auth/admin-auth.js";
import { initAppContext, validateProviderKeys, getAppContext, findProviderKeyInContext } from "./app/context.js";
import {
  activeConfigSnapshot,
  generateTestCurl,
  integrationSnapshot,
  maskedValue,
  providerEnvFromPayload,
} from "./config/snapshot.js";
import { CONFIG_ENV_PATH, writeManagedEnv } from "./config/env.js";
import { log, isAccessLogOn } from "./lib/log.js";
import { initUpstreamFetch, upstreamFetch } from "./lib/upstream-fetch.js";
import { keyFingerprint, maskSecret, normalizeBaseUrl, normalizeConfigNewlines } from "./lib/utils.js";
import { pickProxyKeyForProvider } from "./routing/models.js";
import { classifyUpstreamException, classifyUpstreamResponse } from "./scheduler/accounts.js";
import { normalizeInputToArray } from "./translate/messages.js";
import { executeWebFetch } from "./tools/web-fetch.js";
import { handleOaiCompatResponses, handleOaiCompatChatCompletions } from "./providers/handlers.js";
import { forwardOpenAIResponses, forwardOpenAIChatCompletions } from "./providers/openai.js";
import type { KeyPoolRow } from "./lib/utils.js";
type Variables = {
  lockedProvider: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminDistCandidates = [
  path.resolve(__dirname, "admin"),
  path.resolve(process.cwd(), "dist/admin"),
  path.resolve(process.cwd(), "../dist/admin"),
  path.resolve(__dirname, "../../admin/dist"),
];
const adminDist =
  adminDistCandidates.find((p) => existsSync(path.join(p, "index.html"))) ??
  path.resolve(process.cwd(), "dist/admin");

const app = new Hono<{ Variables: Variables }>();

process.on("uncaughtException", (err) => {
  log.error("[proxy] uncaught exception:", (err as Error).message);
});
process.on("unhandledRejection", (err) => {
  const e = err as Error;
  log.error("[proxy] unhandled rejection:", e?.message || err);
});

const ctx = initAppContext();
validateProviderKeys(ctx);
initUpstreamFetch();

app.use("*", async (c, next) => {
  if (isAccessLogOn()) {
    const ua = c.req.header("user-agent") || "";
    log.access(`[access] ${c.req.method} ${c.req.path} ua="${ua.slice(0, 60)}"`);
  }
  await next();
});

app.use("*", proxyAuthMiddleware());
app.use("/admin/api/*", adminAuthMiddleware());

app.use(
  "*",
  bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
);

app.get("/favicon.ico", (c) => c.body(null, 204, { "Cache-Control": "public, max-age=86400" }));

function healthPayload() {
  const appCtx = getAppContext();
  return {
    status: "ok",
    proxy: "model-flux",
    providers: [...appCtx.enabledProviders],
    default_provider: appCtx.getFallbackProvider(),
  };
}

function providerBase(provider: string, accountBaseUrl = ""): string {
  const appCtx = getAppContext();
  if (accountBaseUrl) return accountBaseUrl;
  if (provider === "openai") return appCtx.openaiBase;
  return appCtx.oaiCompatProviders[provider]?.base || "";
}

function providerProbeModel(provider: string, requestedModel = ""): string {
  const appCtx = getAppContext();
  if (requestedModel) return appCtx.resolveUpstreamModel(provider, requestedModel) || requestedModel;
  if (provider === "openai") return appCtx.openaiModels[0] || "gpt-5.4";
  const cfg = appCtx.oaiCompatProviders[provider];
  return cfg?.models?.[0] || cfg?.defaultModel || "";
}

function accountSnapshot(provider: string, id: string) {
  return getAppContext().accountScheduler.snapshot(provider)[provider]?.find((row) => row.id === id) || null;
}

type DraftProviderKeyInput = {
  id?: string;
  label?: string;
  key?: string;
  masked?: string;
  enabled?: boolean;
  base_url?: string;
  provider_base_url?: string;
  priority?: number;
};

type DraftProviderInput = {
  enabled?: boolean;
  base_url?: string;
  models?: string;
  keys?: DraftProviderKeyInput[];
};

function httpError(message: string, statusCode = 400) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function toDraftProviderKeyRow(provider: string, id: string, draft?: DraftProviderKeyInput): KeyPoolRow {
  const existing = id ? findProviderKeyInContext(provider, id) : null;
  const rawKey = String(draft?.key || "").trim();
  const rawMasked = String(draft?.masked || "").trim();

  let effectiveKey = "";
  if (draft) {
    if (rawKey) {
      effectiveKey = maskedValue(rawKey) ? existing?.key || "" : rawKey;
    } else if (rawMasked && maskedValue(rawMasked)) {
      effectiveKey = existing?.key || "";
    }
  } else {
    effectiveKey = existing?.key || "";
  }

  if (!effectiveKey) {
    throw httpError("当前页面 key 为空或仍是不可解析的脱敏值，无法连接上游。", 400);
  }

  const providerBaseUrl = normalizeBaseUrl(draft?.provider_base_url || "");
  const explicitBaseUrl = normalizeBaseUrl(draft?.base_url || "");
  const fallbackBaseUrl = existing?.base_url || providerBase(provider);
  const effectiveBaseUrl =
    draft !== undefined
      ? explicitBaseUrl || providerBaseUrl || fallbackBaseUrl
      : explicitBaseUrl || fallbackBaseUrl;

  return {
    id: String(id || draft?.id || existing?.id || keyFingerprint(effectiveKey)).trim(),
    key: effectiveKey,
    label: String(draft?.label || "").trim() || existing?.label || "primary",
    enabled: draft?.enabled !== false && (draft?.enabled !== undefined || existing ? existing?.enabled !== false : true),
    source: existing?.source || "draft",
    base_url: effectiveBaseUrl,
    priority: Number(draft?.priority ?? existing?.priority ?? 0) || 0,
  };
}

function toDraftProviderRows(provider: string, draft?: DraftProviderInput): KeyPoolRow[] {
  if (!draft) return [];
  const providerBaseUrl = normalizeBaseUrl(draft.base_url || "");
  const rows = Array.isArray(draft.keys) ? draft.keys : [];
  const dedupe = new Set<string>();
  const out: KeyPoolRow[] = [];
  for (const item of rows) {
    const row = toDraftProviderKeyRow(provider, String(item?.id || "").trim(), {
      ...item,
      provider_base_url: item?.provider_base_url || providerBaseUrl,
    });
    const key = `${row.id}|${row.base_url}|${row.key}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    out.push(row);
  }
  return out;
}

function draftAccountSnapshot(
  provider: string,
  row: KeyPoolRow,
  result?: { ok?: boolean; classification?: ReturnType<typeof classifyUpstreamException>; status?: number | null },
) {
  const runtime = accountSnapshot(provider, row.id);
  const now = Date.now();
  const base = runtime
    ? { ...runtime }
    : {
        id: row.id,
        label: row.label,
        provider,
        masked: maskSecret(row.key),
        base_url: row.base_url || "",
        enabled: row.enabled !== false,
        state: row.enabled === false ? "manual_disabled" : "healthy",
        weight: Math.max(1, Number(row.priority || 0) + 1),
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
        schedulable: row.enabled !== false,
        cooldown_ms_remaining: 0,
      };

  base.label = row.label;
  base.masked = maskSecret(row.key);
  base.base_url = row.base_url || "";
  base.enabled = row.enabled !== false;

  if (!base.enabled) {
    base.state = "manual_disabled";
    base.schedulable = false;
    base.cooldown_until = null;
    base.next_probe_at = null;
    base.cooldown_ms_remaining = 0;
    return base;
  }

  if (result?.ok) {
    base.state = "healthy";
    base.success_count = (base.success_count || 0) + 1;
    base.last_success_at = now;
    base.last_error = "";
    base.last_status = 200;
    base.cooldown_until = null;
    base.next_probe_at = null;
    base.cooldown_ms_remaining = 0;
    base.schedulable = true;
    return base;
  }

  const classification = result?.classification;
  if (classification) {
    base.failure_count = (base.failure_count || 0) + 1;
    base.last_error_at = now;
    base.last_error = classification.message;
    base.last_status = classification.status ?? null;
    base.state = classification.state === "healthy" ? "temporary_error" : classification.state;
    base.cooldown_until = classification.cooldownMs > 0 ? now + classification.cooldownMs : null;
    base.next_probe_at = base.cooldown_until;
    base.cooldown_ms_remaining = classification.cooldownMs || 0;
    base.schedulable = false;
  }

  return base;
}

async function discoverProviderModelsWithDraft(provider: string, draft?: DraftProviderInput) {
  if (!draft) return getAppContext().discoverProviderModels(provider);

  const rows = toDraftProviderRows(provider, draft).filter((row) => row.enabled !== false);
  const row = rows[0];
  if (!row) {
    throw httpError("当前页面没有可用的启用 key，无法发现模型。", 400);
  }
  const base = normalizeBaseUrl(row.base_url || draft.base_url || "");
  if (!base) {
    throw httpError("当前页面没有可用的 Base URL，无法发现模型。", 400);
  }

  const upstreamRes = await upstreamFetch(
    `${base}/models`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${row.key}`, Accept: "application/json" },
    },
    30000,
  );
  const raw = await upstreamRes.text();
  if (!upstreamRes.ok) {
    const classification = classifyUpstreamResponse(upstreamRes.status, raw, upstreamRes.headers);
    return { ok: false, error: classification.message, models: [], source: "draft" };
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const models = Array.isArray(parsed?.data)
    ? parsed.data.map((item: any) => String(item?.id || "").trim()).filter(Boolean)
    : [];
  return {
    ok: true,
    models,
    source: "draft",
  };
}

async function probeProviderAccount(
  provider: string,
  id: string,
  opts: { model?: string; record?: boolean; forceState?: boolean; rowOverride?: KeyPoolRow } = {},
) {
  const appCtx = getAppContext();
  const row = opts.rowOverride || findProviderKeyInContext(provider, id);
  if (!row) {
    throw httpError("provider key not found", 404);
  }

  let account = opts.record === false ? null : appCtx.accountScheduler.find(provider, id);
  if (opts.record !== false && !account) {
    account = appCtx.accountScheduler.upsertAccount(provider, row);
  }
  if (opts.record !== false && opts.forceState) {
    appCtx.accountScheduler.markProbing(provider, id);
  }

  const base = providerBase(provider, row.base_url).replace(/\/+$/, "");
  if (!base) {
    throw httpError(`${provider} 没有配置 Base URL。`, 400);
  }

  const model = providerProbeModel(provider, opts.model);
  const started = Date.now();
  try {
    const url = provider === "openai" ? `${base}/models` : `${base}/chat/completions`;
    const upstreamRes = await upstreamFetch(
      url,
      provider === "openai"
        ? {
            method: "GET",
            headers: { Authorization: `Bearer ${row.key}`, Accept: "application/json" },
          }
        : {
            method: "POST",
            headers: { Authorization: `Bearer ${row.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false,
            }),
          },
      30000,
    );
    const text = await upstreamRes.text();
    if (upstreamRes.ok) {
      if (opts.record !== false) appCtx.accountScheduler.recordSuccess(provider, id);
      return {
        ok: true,
        provider,
        id,
        label: row.label,
        model,
        http_status: upstreamRes.status,
        latency_ms: Date.now() - started,
        text: text.slice(0, 1000),
        account: opts.record === false ? draftAccountSnapshot(provider, row, { ok: true }) : accountSnapshot(provider, id),
      };
    }
    const classification = classifyUpstreamResponse(upstreamRes.status, text, upstreamRes.headers);
    if (opts.record !== false && classification.affectsAccount) {
      appCtx.accountScheduler.recordFailure(provider, id, classification);
    }
    return {
      ok: false,
      provider,
      id,
      label: row.label,
      model,
      http_status: upstreamRes.status,
      latency_ms: Date.now() - started,
      classification,
      account:
        opts.record === false
          ? draftAccountSnapshot(provider, row, { ok: false, classification })
          : accountSnapshot(provider, id),
    };
  } catch (err) {
    const classification = classifyUpstreamException(err);
    if (opts.record !== false) appCtx.accountScheduler.recordFailure(provider, id, classification);
    return {
      ok: false,
      provider,
      id,
      label: row.label,
      model,
      latency_ms: Date.now() - started,
      classification,
      account:
        opts.record === false
          ? draftAccountSnapshot(provider, row, { ok: false, classification })
          : accountSnapshot(provider, id),
    };
  }
}

let probing = false;
async function probeDueProviderAccounts() {
  if (probing) return;
  probing = true;
  try {
    const appCtx = getAppContext();
    for (const account of appCtx.accountScheduler.dueProbeAccounts(5)) {
      try {
        log.info(`[scheduler] probing ${account.provider}/${account.label}`);
        const result = await probeProviderAccount(account.provider, account.id, { record: true });
        log.info(
          `[scheduler] probe ${account.provider}/${account.label} -> ${result.ok ? "healthy" : result.classification?.code || "failed"}`,
        );
      } catch (err) {
        log.warn(`[scheduler] probe failed: ${(err as Error).message}`);
      }
    }
  } finally {
    probing = false;
  }
}

app.get("/health", (c) => c.json(healthPayload()));

app.get("/", (c) => c.json(healthPayload()));

app.get("/admin/api/config", (c) => {
  const reveal = c.req.query("reveal") === "1";
  return c.json(activeConfigSnapshot(getAppContext(), { reveal }));
});

app.post("/admin/api/config", async (c) => {
  const payload = await c.req.json<Record<string, unknown>>();
  const inbound = payload.inbound as Record<string, string> | undefined;
  const routing = payload.routing as Record<string, string> | undefined;
  const tuning = payload.tuning as Record<string, unknown> | undefined;
  const providers = payload.providers as Record<string, Record<string, unknown>> | undefined;
  const appCtx = getAppContext();

  const next: Record<string, string> = {
    ...(maskedValue(inbound?.proxy_auth_key) ? {} : { PROXY_AUTH_KEY: inbound?.proxy_auth_key || "" }),
    ...(maskedValue(inbound?.proxy_keys) ? {} : { PROXY_KEYS: inbound?.proxy_keys || "" }),
    ...(maskedValue(inbound?.admin_auth_key) ? {} : { ADMIN_AUTH_KEY: inbound?.admin_auth_key || "" }),
    DEFAULT_PROVIDER: routing?.default_provider || "",
    MODEL_ALIASES: normalizeConfigNewlines(routing?.model_aliases || ""),
    OPENAI_MODEL_PREFIXES: routing?.openai_model_prefixes || "",
    LOG_LEVEL: (tuning?.log_level as string) || "info",
    ACCESS_LOG: tuning?.access_log === false || tuning?.access_log === "0" ? "0" : "1",
    UPSTREAM_TIMEOUT_MS: (tuning?.upstream_timeout_ms as string) || "120000",
    ...providerEnvFromPayload("mimo", providers?.mimo, appCtx.pickEnv),
    ...providerEnvFromPayload("deepseek", providers?.deepseek, appCtx.pickEnv),
    ...providerEnvFromPayload("compat", providers?.compat, appCtx.pickEnv),
    ...providerEnvFromPayload("openai", providers?.openai, appCtx.pickEnv),
  };
  writeManagedEnv(next);
  return c.json({ ok: true, message: "saved", env_path: CONFIG_ENV_PATH, restart_required: true });
});

app.post("/admin/api/restart", (c) => {
  setTimeout(() => process.exit(0), 250);
  return c.json({ ok: true, message: "model-flux exiting; process manager should bring it back" });
});

app.get("/admin/api/curl", async (c) => {
  try {
    const provider = c.req.query("provider") || "";
    const model = c.req.query("model") || "";
    return c.json(generateTestCurl(c, getAppContext(), { provider, model }));
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ error: { message: e.message } }, (e.statusCode || 500) as 400);
  }
});

app.post("/admin/api/curl", async (c) => {
  try {
    const payload = await c.req.json<{ provider?: string; model?: string }>();
    return c.json(generateTestCurl(c, getAppContext(), { provider: payload.provider, model: payload.model }));
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ error: { message: e.message } }, (e.statusCode || 500) as 400);
  }
});

app.get("/admin/api/route", (c) => {
  const model = c.req.query("model") || "";
  return c.json({ ok: true, ...getAppContext().describeModelRoute(model) });
});

app.post("/admin/api/route", async (c) => {
  const payload = await c.req.json<{ model?: string }>();
  return c.json({ ok: true, ...getAppContext().describeModelRoute(payload.model || "") });
});

app.get("/admin/api/provider-models", async (c) => {
  try {
    const provider = c.req.query("provider") || "";
    return c.json(await getAppContext().discoverProviderModels(provider));
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ ok: false, error: e.message, models: [] }, (e.statusCode || 500) as 400);
  }
});

app.post("/admin/api/provider-models", async (c) => {
  try {
    const payload = await c.req.json<{ provider?: string; draft?: DraftProviderInput }>();
    return c.json(await discoverProviderModelsWithDraft(payload.provider || "", payload.draft));
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ ok: false, error: e.message, models: [] }, (e.statusCode || 500) as 400);
  }
});

app.get("/admin/api/provider-key", (c) => {
  const provider = c.req.query("provider") || "";
  const id = c.req.query("id") || "";
  const row = findProviderKeyInContext(provider, id);
  if (!row) return c.json({ error: { message: "provider key not found" } }, 404);
  return c.json({
    ok: true,
    provider,
    id: row.id,
    label: row.label,
    enabled: row.enabled !== false,
    key: row.key,
    masked: maskSecret(row.key),
  });
});

app.post("/admin/api/provider-key", async (c) => {
  const payload = await c.req.json<{ provider?: string; id?: string }>();
  const row = findProviderKeyInContext(payload.provider || "", payload.id || "");
  if (!row) return c.json({ error: { message: "provider key not found" } }, 404);
  return c.json({
    ok: true,
    provider: payload.provider,
    id: row.id,
    label: row.label,
    enabled: row.enabled !== false,
    key: row.key,
    masked: maskSecret(row.key),
  });
});

app.post("/admin/api/provider-key/test", async (c) => {
  try {
    const payload = await c.req.json<{
      provider?: string;
      id?: string;
      model?: string;
      draft?: DraftProviderKeyInput;
      provider_draft?: DraftProviderInput;
    }>();
    const provider = String(payload.provider || "").trim().toLowerCase();
    if (!provider) return c.json({ error: { message: "provider is required" } }, 400);
    const row = payload.draft
      ? toDraftProviderKeyRow(provider, String(payload.id || payload.draft.id || "").trim(), {
          ...payload.draft,
          provider_base_url: payload.provider_draft?.base_url,
        })
      : null;
    const id = String(payload.id || row?.id || "").trim();
    if (!id) return c.json({ error: { message: "provider key id is required" } }, 400);
    const result = await probeProviderAccount(provider, id, {
      model: payload.model,
      record: !row,
      rowOverride: row || undefined,
    });
    return c.json({
      ...result,
      account: result.account ?? accountSnapshot(provider, id),
    });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ error: { message: e.message } }, (e.statusCode || 500) as 400);
  }
});

app.post("/admin/api/provider-key/status", async (c) => {
  try {
    const payload = await c.req.json<{ provider?: string; id?: string; enabled?: boolean }>();
    const provider = String(payload.provider || "").trim().toLowerCase();
    const id = String(payload.id || "").trim();
    const enabled = payload.enabled !== false;
    const row = findProviderKeyInContext(provider, id);
    if (!row) return c.json({ error: { message: "provider key not found" } }, 404);
    const appCtx = getAppContext();
    let account = appCtx.accountScheduler.find(provider, id);
    if (!account) {
      account = appCtx.accountScheduler.upsertAccount(provider, { ...row, enabled });
    }
    const snapshot = appCtx.accountScheduler.setEnabled(provider, id, enabled);
    return c.json({ ok: true, provider, id, enabled, account: snapshot });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ error: { message: e.message } }, (e.statusCode || 500) as 400);
  }
});

app.post("/admin/api/provider-key/probe", async (c) => {
  try {
    const payload = await c.req.json<{
      provider?: string;
      id?: string;
      model?: string;
      draft?: DraftProviderKeyInput;
      provider_draft?: DraftProviderInput;
    }>();
    const provider = String(payload.provider || "").trim().toLowerCase();
    if (!provider) return c.json({ error: { message: "provider is required" } }, 400);
    const row = payload.draft
      ? toDraftProviderKeyRow(provider, String(payload.id || payload.draft.id || "").trim(), {
          ...payload.draft,
          provider_base_url: payload.provider_draft?.base_url,
        })
      : findProviderKeyInContext(provider, String(payload.id || "").trim());
    const id = String(payload.id || row?.id || "").trim();
    if (!row) return c.json({ error: { message: "provider key not found" } }, 404);
    if (row.enabled === false) {
      return c.json({ error: { message: "account is manually disabled; enable it before probing" } }, 400);
    }
    const account = payload.draft ? null : getAppContext().accountScheduler.find(provider, id);
    if (account && !account.enabled) {
      return c.json({ error: { message: "account is manually disabled; enable it before probing" } }, 400);
    }
    if (!payload.draft) getAppContext().accountScheduler.markProbing(provider, id);
    const result = await probeProviderAccount(provider, id, {
      model: payload.model,
      record: !payload.draft,
      forceState: !payload.draft,
      rowOverride: row,
    });
    return c.json({
      ...result,
      account: result.account ?? accountSnapshot(provider, id),
    });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return c.json({ error: { message: e.message } }, (e.statusCode || 500) as 400);
  }
});

app.get("/admin/api/scheduler", (c) =>
  c.json({
    ok: true,
    scheduler: getAppContext().accountScheduler.snapshot(),
    summary: getAppContext().accountScheduler.summary(),
  }),
);

app.get("/admin/api/integration", (c) => c.json(integrationSnapshot(c, getAppContext())));

app.post("/admin/api/test", async (c) => {
  const payload = await c.req.json<{ model?: string; provider?: string; prompt?: string; draft?: DraftProviderInput }>();
  const appCtx = getAppContext();
  let model = String(payload.model || "").trim();
  const testBody = {
    model: "",
    input: payload.prompt || "请只输出 MIMO_OK，不要输出其他内容",
    stream: false,
  };
  const requestedProvider = String(payload.provider || "").trim().toLowerCase();
  const provider = requestedProvider || (model ? appCtx.resolveProvider(model) : appCtx.getFallbackProvider());
  if (!model) model = providerProbeModel(provider);
  testBody.model = model;
  if (requestedProvider && !appCtx.enabledProviders.has(requestedProvider)) {
    return c.json(
      {
        error: {
          message: `账号池 ${requestedProvider} 尚未在运行时启用。请先保存配置并重启 ModelFlux 后再测试。`,
          code: "provider_not_enabled",
        },
      },
      400,
    );
  }
  const picked = pickProxyKeyForProvider(
    provider,
    appCtx.proxyAuthEnabled,
    appCtx.proxyAuthKey,
    appCtx.proxyKeyTable,
  );
  if (picked.auth_enabled && !picked.key) {
    return c.json(
      {
        error: {
          message: `没有找到可用于 ${provider} 的入站 key，请检查 PROXY_AUTH_KEY / PROXY_KEYS。`,
          code: "proxy_key_unavailable",
        },
      },
      400,
    );
  }

  if (payload.draft) {
    const rows = toDraftProviderRows(provider, payload.draft).filter((row) => row.enabled !== false);
    const row = rows[0];
    if (!row) {
      return c.json({ error: { message: "当前页面没有可用于测试的启用 key。" } }, 400);
    }
    const result = await probeProviderAccount(provider, row.id, {
      model,
      record: false,
      rowOverride: row,
    });
    return c.json(
      {
        ok: !!result.ok,
        provider,
        model,
        upstream_model: appCtx.resolveUpstreamModel(provider, model),
        route: appCtx.describeModelRoute(model),
        text: result.ok ? result.text || "" : result.classification?.message || "",
        raw: result.ok ? (result.text || "").slice(0, 4096) : "",
        classification: result.classification,
        account: result.account,
      },
      (result.ok ? 200 : (result.http_status || 502)) as 200,
    );
  }

  const res = await app.request(
    new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(picked.key ? { Authorization: `Bearer ${picked.key}` } : {}),
      },
      body: JSON.stringify(testBody),
    }),
  );
  const raw = await res.text();
  let data: { output?: { content?: { text?: string }[] }[] } | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const text =
    data?.output?.flatMap((o) => o.content || []).map((part) => part.text || "").join("") || raw;
  return c.json({
    ok: /MIMO_OK/.test(text),
    provider,
    model,
    upstream_model: appCtx.resolveUpstreamModel(provider, model),
    route: appCtx.describeModelRoute(model),
    text,
    raw: raw.slice(0, 4096),
  }, (res.ok ? 200 : res.status) as 200);
});

app.all("/admin/api/*", (c) => c.json({ error: { message: "unknown admin api" } }, 404));

app.use(
  "/admin/*",
  serveStatic({
    root: adminDist,
    rewriteRequestPath: (p) => {
      const sub = p.replace(/^\/admin\/?/, "") || "index.html";
      return sub;
    },
  }),
);

app.get("/admin", async (c) => {
  const indexPath = path.join(adminDist, "index.html");
  try {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(indexPath, "utf-8");
    return c.html(html, 200, { "Cache-Control": "no-store" });
  } catch {
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>model-flux admin</title><body style="font-family:monospace;background:#0b0f14;color:#e7f0f7;padding:32px"><h1>admin UI not built</h1><p>Build admin to <code>dist/admin</code> (e.g. <code>npm run build -w admin</code>).</p></body>`,
      200,
      { "Cache-Control": "no-store" },
    );
  }
});

app.get("/admin/*", async (c) => {
  if (c.req.path.startsWith("/admin/api/")) return c.notFound();
  const indexPath = path.join(adminDist, "index.html");
  if (existsSync(indexPath)) {
    const { readFile } = await import("node:fs/promises");
    return c.html(await readFile(indexPath, "utf-8"), 200, { "Cache-Control": "no-store" });
  }
  return c.text("admin UI not built", 404);
});

app.all("/cop", async (c) => {
  let url = "";
  let method = "GET";
  let body2: unknown = null;
  let headers2: Record<string, string> = {};

  if (c.req.method === "GET") {
    url = c.req.query("url") || "";
  } else {
    const parsedBody = await c.req.json<{ url?: string; method?: string; body?: unknown; headers?: Record<string, string> }>();
    url = parsedBody.url || "";
    method = parsedBody.method || "GET";
    body2 = parsedBody.body ?? null;
    headers2 = parsedBody.headers || {};
  }

  if (!url) return c.json({ error: "url parameter required" }, 400);

  log.info(`[proxy] /cop ${method} ${url}`);
  const content = await executeWebFetch({ url, method, headers: headers2, body: body2 }, getAppContext().webFetchConfig);
  return c.text(content, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.get("/v1/models", listModels);
app.get("/models", listModels);

function listModels(c: import("hono").Context) {
  const appCtx = getAppContext();
  return c.json({
    object: "list",
    data: appCtx.modelCatalog,
    default_provider: appCtx.getFallbackProvider(),
  });
}

app.post("/v1/responses", handleResponses);
app.post("/responses", handleResponses);

async function handleResponses(c: import("hono").Context<{ Variables: Variables }>) {
  const appCtx = getAppContext();
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (isAccessLogOn()) {
    const inputType = Array.isArray(body.input) ? `array(${body.input.length})` : typeof body.input;
    log.access(
      `[access] /v1/responses body keys=${Object.keys(body).join(",")} model=${body.model || "<none>"} input=${inputType} stream=${!!body.stream}`,
    );
  }

  try {
    const lock = getLockedProvider(c);
    if (lock !== "*" && (!body.model || !String(body.model).trim())) {
      const lockCfg = appCtx.oaiCompatProviders[lock];
      if (lockCfg) body.model = lockCfg.defaultModel;
      else if (lock === "openai") body.model = appCtx.openaiModels[0] || "";
    }

    const provider = appCtx.resolveProvider(body.model as string);

    if (lock !== "*" && provider !== lock) {
      if (isAccessLogOn()) {
        log.access(
          `[access] 401 provider lock mismatch (key locks=${lock}, model=${body.model || "<none>"} -> provider=${provider})`,
        );
      }
      return c.json(
        {
          error: {
            message: `This proxy key is locked to provider "${lock}", but the request model "${body.model || "<none>"}" routes to "${provider}". Either switch model or use a different key.`,
            type: "invalid_request_error",
            code: "proxy_provider_lock",
          },
        },
        401,
      );
    }

    const originalInput = normalizeInputToArray(body.input);
    const hasInput =
      originalInput.length > 0 || (typeof body.input === "string" && (body.input as string).trim().length > 0);
    const hasPrevious = !!body.previous_response_id;

    if (!hasInput && !hasPrevious) {
      if (isAccessLogOn()) {
        log.access(`[access] /v1/responses probe short-circuit (provider=${provider})`);
      }
      const probeId = `resp_probe_${Math.random().toString(36).slice(2, 12)}`;
      return c.json({
        id: probeId,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model || appCtx.oaiCompatProviders[provider]?.defaultModel || "probe",
        output: [
          {
            type: "message",
            id: `msg_probe_${Math.random().toString(36).slice(2, 10)}`,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        previous_response_id: null,
        metadata: { probe: true },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
        incomplete_details: null,
      });
    }

    if (provider === "openai") {
      if (!appCtx.firstOpenAIKey()) {
        return c.json({ error: { message: "OPENAI_API_KEY is not configured" } }, 400);
      }
      const originalPreviousResponseId = (body.previous_response_id as string) || null;
      const { maybeResolvePreviousResponseChain } = await import("./translate/responses.js");
      maybeResolvePreviousResponseChain(body, "openai", appCtx.responseStore);
      body.model = appCtx.resolveUpstreamModel("openai", body.model as string) || body.model;
      log.info(`[proxy] responses openai(${body.model || appCtx.openaiModels[0] || "default"}) | stream=${!!body.stream}`);
      return forwardOpenAIResponses(c, body, originalInput, originalPreviousResponseId);
    }

    if (appCtx.oaiCompatProviders[provider]) {
      return handleOaiCompatResponses(c, provider, body, originalInput);
    }

    return c.json({ error: { message: `Unknown provider resolved: ${provider}` } }, 400);
  } catch (err) {
    log.error("[proxy] responses route error:", (err as Error).message);
    return c.json({ error: { message: (err as Error).message } }, 500);
  }
}

app.post("/v1/chat/completions", handleChatCompletions);
app.post("/chat/completions", handleChatCompletions);

async function handleChatCompletions(c: import("hono").Context<{ Variables: Variables }>) {
  const appCtx = getAppContext();
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  try {
    const lock = getLockedProvider(c);
    if (lock !== "*" && (!body.model || !String(body.model).trim())) {
      const lockCfg = appCtx.oaiCompatProviders[lock];
      if (lockCfg) body.model = lockCfg.defaultModel;
      else if (lock === "openai") body.model = appCtx.openaiModels[0] || "";
    }

    const provider = appCtx.resolveProvider(body.model as string);

    if (lock !== "*" && provider !== lock) {
      if (isAccessLogOn()) {
        log.access(
          `[access] 401 provider lock mismatch (key locks=${lock}, model=${body.model || "<none>"} -> provider=${provider})`,
        );
      }
      return c.json(
        {
          error: {
            message: `This proxy key is locked to provider "${lock}", but the request model "${body.model || "<none>"}" routes to "${provider}". Either switch model or use a different key.`,
            type: "invalid_request_error",
            code: "proxy_provider_lock",
          },
        },
        401,
      );
    }

    if (provider === "openai") {
      if (!appCtx.firstOpenAIKey()) {
        return c.json({ error: { message: "OPENAI_API_KEY is not configured" } }, 400);
      }
      body.model = appCtx.resolveUpstreamModel("openai", body.model as string) || body.model;
      log.info(`[proxy] chat/completions openai(${body.model || appCtx.openaiModels[0] || "default"}) | stream=${!!body.stream}`);
      return forwardOpenAIChatCompletions(c, body);
    }

    if (appCtx.oaiCompatProviders[provider]) {
      return handleOaiCompatChatCompletions(c, provider, body);
    }

    return c.json({ error: { message: `Unknown provider resolved: ${provider}` } }, 400);
  } catch (err) {
    log.error("[proxy] chat/completions route error:", (err as Error).message);
    return c.json({ error: { message: (err as Error).message } }, 500);
  }
}

app.notFound((c) => c.json({ error: "Not found. Use POST /v1/responses" }, 404));

const appCtx = getAppContext();
console.log(`[model-flux] Listening on http://${appCtx.bindHost}:${appCtx.port}`);
console.log(`[model-flux] Default provider: ${appCtx.getFallbackProvider()}`);
for (const [name, cfg] of Object.entries(appCtx.oaiCompatProviders)) {
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  console.log(`[model-flux] ${label.padEnd(8)}: ${cfg.key ? `${cfg.base} | models=${cfg.models.join(", ")}` : "DISABLED"}`);
}
console.log(
  `[model-flux] OpenAI  : ${appCtx.firstOpenAIKey() ? `${appCtx.openaiBase} | models=${appCtx.openaiModels.join(", ")}` : "DISABLED"}`,
);
console.log(
  `[model-flux] GitHub  : ${process.env.GITHUB_TOKEN ? "authenticated (env)" : "lazy (will run \`gh auth token\` on first api.github.com fetch)"}`,
);
if (!appCtx.proxyAuthEnabled) {
  console.log(
    `[model-flux] Inbound : OPEN — anyone on localhost can use this proxy (set PROXY_AUTH_KEY or PROXY_KEYS to lock down)`,
  );
} else {
  console.log(`[model-flux] Inbound : auth required (${appCtx.proxyKeyTable.size} key${appCtx.proxyKeyTable.size === 1 ? "" : "s"} loaded)`);
  for (const [key, lock] of appCtx.proxyKeyTable) {
    const lockLabel = lock === "*" ? "any provider" : `locked to ${lock}`;
    console.log(`[model-flux]           ${key.slice(0, 16)}… (${key.length} chars) — ${lockLabel}`);
  }
}

setInterval(() => {
  probeDueProviderAccounts().catch((err) => log.warn(`[scheduler] background probe loop failed: ${(err as Error).message}`));
}, Number(process.env.ACCOUNT_PROBE_INTERVAL_MS || 30000)).unref?.();

serve(
  {
    fetch: app.fetch,
    port: appCtx.port,
    hostname: appCtx.bindHost,
  },
  (info) => {
    console.log(`[model-flux] Server started at http://${info.address}:${info.port}`);
  },
);

export { app };
