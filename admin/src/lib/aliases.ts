import { PROVIDERS } from "@/lib/providers";
import { normModel, normalizeConfigNewlines, splitModels } from "@/lib/utils";
import type { ProviderId } from "@/types/config";

export interface AliasRow {
  from: string;
  provider: string;
  upstream_model: string;
  raw: string;
}

export function serializeAliasRows(rows: AliasRow[]) {
  return rows.map((r) => `${r.from}=${r.provider}:${r.upstream_model}`).join("\n");
}

export function parseAliasEntries(
  text: string,
  inferProvider: (target: string) => string,
): { rows: AliasRow[]; invalid: string[]; duplicates: string[] } {
  const rows: AliasRow[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  normalizeConfigNewlines(text)
    .split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((raw) => {
      const m = raw.match(/^([^=]+?)\s*(?:=>|->|=)\s*(.+)$/);
      if (!m) {
        invalid.push(raw);
        return;
      }
      let from = m[1].trim();
      let target = m[2].trim();
      let provider = "";
      const pm = target.match(/^(deepseek|mimo|compat|openai)\s*[:/]\s*(.+)$/i);
      if (pm) {
        provider = pm[1].toLowerCase();
        target = pm[2].trim();
      }
      if (!provider) provider = inferProvider(target);
      if (!from || !target || !provider) {
        invalid.push(raw);
        return;
      }
      const key = normModel(from);
      if (seen.has(key)) {
        duplicates.push(raw);
        return;
      }
      seen.add(key);
      rows.push({ from, provider, upstream_model: target, raw });
    });

  return { rows, invalid, duplicates };
}

export function aliasRowsFromText(text: string, inferProvider: (target: string) => string) {
  return parseAliasEntries(text, inferProvider).rows;
}

export function aliasRowStatus(
  row: AliasRow,
  getProviderCfg: (id: ProviderId) => { enabled: boolean; models: string },
  discovered: Record<string, string[]>,
): ["good" | "warn" | "bad", string] {
  const cfg = getProviderCfg(row.provider as ProviderId);
  if (!cfg.enabled) return ["bad", "账号池未启用"];
  const configured = splitModels(cfg.models).map(normModel);
  const target = normModel(row.upstream_model);
  if (configured.includes(target)) return ["good", "已匹配 Models"];
  if ((discovered[row.provider] ?? []).map(normModel).includes(target)) {
    return ["warn", "已发现未同步"];
  }
  return ["warn", "自定义模型"];
}

export const REASON_LABELS: Record<string, string> = {
  MODEL_ALIASES: "明确映射优先命中",
  "provider model list": "请求模型就是账号池真实模型",
  "name hint": "根据模型名关键词判断",
  "OpenAI prefix": "OpenAI 前缀命中",
  DEFAULT_PROVIDER: "未命中映射，走默认账号池",
  "first enabled provider": "无默认账号池，走第一个启用账号池",
  fallback: "兜底路由",
};

export function defaultInferProvider(
  target: string,
  ctx: {
    getProviderCfg: (id: ProviderId) => { enabled: boolean; models: string };
    openaiPrefixes: string;
    defaultProvider: string;
  },
): string {
  const lower = normModel(target);
  if (!lower) return "";
  for (const meta of PROVIDERS) {
    const cfg = ctx.getProviderCfg(meta.id);
    if (splitModels(cfg.models).some((m) => normModel(m) === lower)) return meta.id;
  }
  const openai = ctx.getProviderCfg("openai");
  if (
    openai.enabled &&
    String(ctx.openaiPrefixes ?? "")
      .split(",")
      .some((x) => x && lower.startsWith(x.trim().toLowerCase()))
  ) {
    return "openai";
  }
  const pref = ctx.defaultProvider;
  if (pref && ctx.getProviderCfg(pref as ProviderId).enabled) return pref;
  return PROVIDERS.find((p) => ctx.getProviderCfg(p.id).enabled)?.id ?? "";
}
