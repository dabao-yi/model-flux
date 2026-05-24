import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  aliasRowStatus,
  aliasRowsFromText,
  defaultInferProvider,
  parseAliasEntries,
  serializeAliasRows,
  type AliasRow,
} from "@/lib/aliases";
import { api } from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import { isMasked, normModel, splitModels } from "@/lib/utils";
import type {
  ConfigPayload,
  ConfigSnapshot,
  ProviderId,
  ProviderAccountRuntime,
  ProviderModelsResult,
  ProviderState,
} from "@/types/config";

export interface FormKeyRow {
  id: string;
  masked: string;
  enabled: boolean;
  label: string;
  key: string;
  scheduler?: ProviderAccountRuntime;
  revealed?: boolean;
  secret?: string;
}

export interface FormProvider {
  enabled: boolean;
  base_url: string;
  models: string;
  keys: FormKeyRow[];
}

interface ConfigContextValue {
  snapshot: ConfigSnapshot | null;
  ready: boolean;
  dirty: boolean;
  restartPending: boolean;
  reveal: boolean;
  validationBad: boolean;
  discoveredModels: Record<string, string[]>;
  editingAliasKey: string;
  routeProbe: string;
  setRouteProbe: (v: string) => void;
  form: {
    providers: Record<ProviderId, FormProvider>;
    defaultProvider: string;
    modelAliases: string;
    openaiPrefixes: string;
    proxyAuth: string;
    proxyKeys: string;
    adminAuth: string;
    logLevel: string;
    accessLog: boolean;
    upstreamTimeout: string;
  };
  setProvider: (id: ProviderId, patch: Partial<FormProvider>) => void;
  setProviderKeys: (id: ProviderId, keys: FormKeyRow[]) => void;
  setRouting: (patch: Partial<Pick<ConfigContextValue["form"], "defaultProvider" | "modelAliases" | "openaiPrefixes">>) => void;
  setInbound: (patch: Partial<Pick<ConfigContextValue["form"], "proxyAuth" | "proxyKeys" | "adminAuth">>) => void;
  setTuning: (patch: Partial<Pick<ConfigContextValue["form"], "logLevel" | "accessLog" | "upstreamTimeout">>) => void;
  markDirty: () => void;
  loadConfig: (reveal?: boolean) => Promise<void>;
  saveConfig: () => Promise<boolean>;
  restartFlux: () => Promise<boolean>;
  saveAndRestart: () => Promise<void>;
  collectPayload: () => ConfigPayload;
  getProviderCfg: (id: ProviderId) => { enabled: boolean; models: string; base_url: string };
  inferProvider: (target: string) => string;
  aliasRows: AliasRow[];
  aliasParse: ReturnType<typeof parseAliasEntries>;
  setEditingAliasKey: (k: string) => void;
  addOrUpdateAlias: (row: Omit<AliasRow, "raw">, replaceFrom?: string) => void;
  deleteAlias: (from: string) => void;
  discoverModels: (pid: ProviderId) => Promise<ProviderModelsResult>;
  syncDiscoveredToProvider: (pid: ProviderId) => number;
  modelsForProvider: (pid: ProviderId) => string[];
  validateProvider: (id: ProviderId) => [("good" | "warn" | "bad"), string][];
  validateAuth: () => [("good" | "warn" | "bad"), string][];
  validateOps: () => [("good" | "warn" | "bad"), string][];
  aliasStatus: (row: AliasRow) => [("good" | "warn" | "bad"), string];
  stateLabel: string;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

function providerFromSnapshot(p: ProviderState | undefined, meta: { base: string; models: string }): FormProvider {
  const keys = p?.keys?.length
    ? p.keys.map((k) => ({
        id: k.id || "",
        masked: k.masked || k.key || "",
        enabled: k.enabled !== false,
        label: k.label || "",
        key: k.key || "",
        scheduler: k.scheduler,
      }))
    : [{ id: "", masked: "", enabled: true, label: "primary", key: "" }];
  return {
    enabled: !!p?.enabled,
    base_url: p?.base_url || meta.base,
    models: p?.models || meta.models,
    keys,
  };
}

function initialForm(snapshot: ConfigSnapshot | null) {
  const providers = Object.fromEntries(
    PROVIDERS.map((m) => [m.id, providerFromSnapshot(snapshot?.providers?.[m.id], m)]),
  ) as Record<ProviderId, FormProvider>;
  return {
    providers,
    defaultProvider: snapshot?.routing?.default_provider || "",
    modelAliases: snapshot?.routing?.model_aliases || "",
    openaiPrefixes:
      snapshot?.routing?.openai_model_prefixes || "gpt-,o1,o3,o4,codex-,chatgpt-",
    proxyAuth: snapshot?.inbound?.proxy_auth_key || "",
    proxyKeys: snapshot?.inbound?.proxy_keys || "",
    adminAuth: snapshot?.inbound?.admin_auth_key || "",
    logLevel: snapshot?.tuning?.log_level || "info",
    accessLog: String(snapshot?.tuning?.access_log ?? "1") !== "0",
    upstreamTimeout: snapshot?.tuning?.upstream_timeout_ms || "120000",
  };
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null);
  const [form, setForm] = useState(() => initialForm(null));
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restartPending, setRestartPending] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, string[]>>({});
  const [editingAliasKey, setEditingAliasKey] = useState("");
  const [routeProbe, setRouteProbe] = useState("");
  const readyRef = useRef(false);

  const markDirty = useCallback(() => {
    if (!readyRef.current) return;
    setDirty(true);
  }, []);

  const getProviderCfg = useCallback(
    (id: ProviderId) => ({
      enabled: form.providers[id].enabled,
      models: form.providers[id].models,
      base_url: form.providers[id].base_url,
    }),
    [form.providers],
  );

  const inferProvider = useCallback(
    (target: string) =>
      defaultInferProvider(target, {
        getProviderCfg,
        openaiPrefixes: form.openaiPrefixes,
        defaultProvider: form.defaultProvider,
      }),
    [form.defaultProvider, form.openaiPrefixes, getProviderCfg],
  );

  const aliasParse = useMemo(
    () => parseAliasEntries(form.modelAliases, inferProvider),
    [form.modelAliases, inferProvider],
  );
  const aliasRows = aliasParse.rows;

  const collectProvider = useCallback(
    (pid: ProviderId) => ({
      enabled: form.providers[pid].enabled,
      base_url: form.providers[pid].base_url.trim(),
      models: form.providers[pid].models.trim(),
      keys: form.providers[pid].keys
        .filter((k) => k.key || k.id)
        .map((k) => ({
          id: k.id,
          masked: k.masked,
          enabled: k.enabled,
          label: k.label.trim(),
          key: k.key.trim(),
        })),
    }),
    [form.providers],
  );

  const collectPayload = useCallback((): ConfigPayload => {
    return {
      providers: Object.fromEntries(PROVIDERS.map((p) => [p.id, collectProvider(p.id)])) as ConfigPayload["providers"],
      routing: {
        default_provider: form.defaultProvider,
        model_aliases: form.modelAliases.trim(),
        openai_model_prefixes: form.openaiPrefixes.trim(),
      },
      inbound: {
        proxy_auth_key: form.proxyAuth.trim(),
        proxy_keys: form.proxyKeys.trim(),
        admin_auth_key: form.adminAuth.trim(),
      },
      tuning: {
        log_level: form.logLevel,
        access_log: form.accessLog,
        upstream_timeout_ms: form.upstreamTimeout.trim(),
      },
    };
  }, [collectProvider, form]);

  const modelsForProvider = useCallback(
    (pid: ProviderId) => {
      const discovered = discoveredModels[pid];
      if (discovered?.length) return discovered;
      return splitModels(form.providers[pid].models);
    },
    [discoveredModels, form.providers],
  );

  const validateProvider = useCallback(
    (metaId: ProviderId): [("good" | "warn" | "bad"), string][] => {
      const p = collectProvider(metaId);
      const rows = p.keys;
      const enabledRows = rows.filter((k) => k.enabled && k.key);
      const hasMasked = rows.some((k) => isMasked(k.key));
      const hasPlain = rows.some((k) => k.key && !isMasked(k.key));
      const checks: [("good" | "warn" | "bad"), string][] = [];
      if (p.enabled && !p.base_url) checks.push(["bad", "启用供应商必须填写 Base URL"]);
      if (p.enabled && !p.models) checks.push(["bad", "启用供应商必须填写至少一个真实上游模型"]);
      if (p.enabled && !enabledRows.length && !hasMasked) {
        checks.push(["bad", "启用供应商至少需要一个启用状态的 key"]);
      }
      if (hasPlain && hasMasked) {
        checks.push(["warn", "混合明文和脱敏 key 可以保存；已有脱敏 key 会按内部 ID 保留"]);
      }
      if (metaId === "openai" && p.enabled) {
        checks.push(["warn", "openai 只适合原生 Responses 上游，普通兼容上游请用 compat"]);
      }
      if (!checks.length) {
        checks.push([
          p.enabled ? "good" : "good",
          p.enabled ? `可用：${enabledRows.length || "已有"} 个 key 参与轮询` : "供应商未启用，key 会保留但不参与路由",
        ]);
      }
      return checks;
    },
    [collectProvider],
  );

  const validateAuth = useCallback((): [("good" | "warn" | "bad"), string][] => {
    const auth: [("good" | "warn" | "bad"), string][] = [];
    if (!form.proxyAuth.trim() && !form.proxyKeys.trim()) {
      auth.push(["warn", "未配置入站 key，仅建议完全隔离的本机调试"]);
    } else auth.push(["good", "入站鉴权已配置"]);
    if (!form.adminAuth.trim()) auth.push(["warn", "管理页没有二次口令，请确保只绑定 127.0.0.1"]);
    return auth;
  }, [form.adminAuth, form.proxyAuth, form.proxyKeys]);

  const validateOps = useCallback((): [("good" | "warn" | "bad"), string][] => {
    const ops: [("good" | "warn" | "bad"), string][] = [];
    const timeout = Number(form.upstreamTimeout);
    if (!Number.isFinite(timeout) || timeout < 5000 || timeout > 600000) {
      ops.push(["bad", "上游超时必须在 5000 - 600000 ms"]);
    } else ops.push(["good", "上游超时有效"]);
    ops.push(
      form.accessLog ? ["warn", "访问日志已开启，会增加输出"] : ["good", "访问日志已关闭，输出更干净"],
    );
    return ops;
  }, [form.accessLog, form.upstreamTimeout]);

  const validationBad = useMemo(() => {
    if (!ready) return false;
    const providerBad = PROVIDERS.some((m) => validateProvider(m.id).some((x) => x[0] === "bad"));
    const opsBad = validateOps().some((x) => x[0] === "bad");
    return providerBad || opsBad;
  }, [ready, validateOps, validateProvider]);

  const loadConfig = useCallback(async (showReveal = false) => {
    try {
      const data = await api<ConfigSnapshot>(`/admin/api/config${showReveal ? "?reveal=1" : ""}`);
      setReveal(showReveal);
      setSnapshot(data);
      readyRef.current = false;
      setForm(initialForm(data));
      setEditingAliasKey("");
      readyRef.current = true;
      setReady(true);
      setDirty(false);
      setRestartPending(false);
      toast.success("配置已加载");
    } catch (e) {
      toast.error("配置加载失败");
      throw e;
    }
  }, []);

  const saveConfig = useCallback(async () => {
    if (validationBad) {
      toast.error("请先修复红色校验项");
      return false;
    }
    try {
      await api<{ ok: boolean }>("/admin/api/config", {
        method: "POST",
        body: JSON.stringify(collectPayload()),
      });
      setDirty(false);
      setRestartPending(true);
      toast.success("已保存");
      return true;
    } catch {
      toast.error("保存失败");
      return false;
    }
  }, [collectPayload, validationBad]);

  const restartFlux = useCallback(async () => {
    if (!window.confirm("将重启 model-flux，继续？")) return false;
    try {
      await api("/admin/api/restart", { method: "POST", body: "{}" });
      toast.message("正在重启...");
      await new Promise((r) => setTimeout(r, 4300));
      await loadConfig(reveal);
      return true;
    } catch {
      toast.error("重启请求失败");
      return false;
    }
  }, [loadConfig, reveal]);

  const saveAndRestart = useCallback(async () => {
    if (await saveConfig()) await restartFlux();
  }, [restartFlux, saveConfig]);

  const setProvider = useCallback(
    (id: ProviderId, patch: Partial<FormProvider>) => {
      setForm((f) => ({ ...f, providers: { ...f.providers, [id]: { ...f.providers[id], ...patch } } }));
      markDirty();
    },
    [markDirty],
  );

  const setProviderKeys = useCallback(
    (id: ProviderId, keys: FormKeyRow[]) => {
      setForm((f) => ({ ...f, providers: { ...f.providers, [id]: { ...f.providers[id], keys } } }));
      markDirty();
    },
    [markDirty],
  );

  const setRouting = useCallback(
    (patch: Partial<typeof form>) => {
      setForm((f) => ({ ...f, ...patch }));
      markDirty();
    },
    [markDirty],
  );

  const setInbound = useCallback(
    (patch: Partial<typeof form>) => {
      setForm((f) => ({ ...f, ...patch }));
      markDirty();
    },
    [markDirty],
  );

  const setTuning = useCallback(
    (patch: Partial<typeof form>) => {
      setForm((f) => ({ ...f, ...patch }));
      markDirty();
    },
    [markDirty],
  );

  const discoverModels = useCallback(async (pid: ProviderId) => {
    const r = await api<ProviderModelsResult>("/admin/api/provider-models", {
      method: "POST",
      body: JSON.stringify({ provider: pid }),
    });
    setDiscoveredModels((d) => ({ ...d, [pid]: r.models || [] }));
    return r;
  }, []);

  const syncDiscoveredToProvider = useCallback(
    (pid: ProviderId) => {
      const models = discoveredModels[pid] || [];
      if (!models.length) return 0;
      const existing = splitModels(form.providers[pid].models);
      const seen = new Set(existing.map((x) => x.toLowerCase()));
      let added = 0;
      for (const m of models) {
        if (!seen.has(m.toLowerCase())) {
          existing.push(m);
          seen.add(m.toLowerCase());
          added++;
        }
      }
      if (added) setProvider(pid, { models: existing.join(",") });
      return added;
    },
    [discoveredModels, form.providers, setProvider],
  );

  const addOrUpdateAlias = useCallback(
    (row: Omit<AliasRow, "raw">, replaceFrom = "") => {
      const key = normModel(row.from);
      const replaceKey = replaceFrom ? normModel(replaceFrom) : editingAliasKey || key;
      const rows = aliasRowsFromText(form.modelAliases, inferProvider);
      const next: AliasRow[] = [];
      let placed = false;
      const newRow: AliasRow = {
        ...row,
        raw: `${row.from}=${row.provider}:${row.upstream_model}`,
      };
      for (const r of rows) {
        const rowKey = normModel(r.from);
        if (rowKey === replaceKey || rowKey === key) {
          if (!placed) {
            next.push(newRow);
            placed = true;
          }
        } else next.push(r);
      }
      if (!placed) next.push(newRow);
      setRouting({ modelAliases: serializeAliasRows(next) });
      setRouteProbe(row.from);
      setEditingAliasKey("");
    },
    [editingAliasKey, form.modelAliases, inferProvider, setRouting],
  );

  const deleteAlias = useCallback(
    (from: string) => {
      const key = normModel(from);
      const rows = aliasRowsFromText(form.modelAliases, inferProvider).filter(
        (r) => normModel(r.from) !== key,
      );
      setRouting({ modelAliases: serializeAliasRows(rows) });
      if (editingAliasKey === key) setEditingAliasKey("");
      toast.message("映射已删除，保存并重启后生效");
    },
    [editingAliasKey, form.modelAliases, inferProvider, setRouting],
  );

  const aliasStatus = useCallback(
    (row: AliasRow) => aliasRowStatus(row, getProviderCfg, discoveredModels),
    [discoveredModels, getProviderCfg],
  );

  const stateLabel = !snapshot ? "未加载" : dirty ? "未保存" : restartPending ? "待重启" : "已同步";

  const value: ConfigContextValue = {
    snapshot,
    ready,
    dirty,
    restartPending,
    reveal,
    validationBad,
    discoveredModels,
    editingAliasKey,
    routeProbe,
    setRouteProbe,
    form,
    setProvider,
    setProviderKeys,
    setRouting,
    setInbound,
    setTuning,
    markDirty,
    loadConfig,
    saveConfig,
    restartFlux,
    saveAndRestart,
    collectPayload,
    getProviderCfg,
    inferProvider,
    aliasRows,
    aliasParse,
    setEditingAliasKey,
    addOrUpdateAlias,
    deleteAlias,
    discoverModels,
    syncDiscoveredToProvider,
    modelsForProvider,
    validateProvider,
    validateAuth,
    validateOps,
    aliasStatus,
    stateLabel,
  };

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
