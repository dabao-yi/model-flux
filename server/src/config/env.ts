import fs from "node:fs";
import path from "node:path";

export function envValueNeedsQuoting(value: unknown): boolean {
  return /[\s#'"`$\\]/.test(String(value || ""));
}

export function quoteEnvValue(value: unknown): string {
  const s = String(value ?? "");
  if (!envValueNeedsQuoting(s)) return s;
  return JSON.stringify(s);
}

export const CONFIG_ENV_PATH = path.resolve(
  process.env.CONFIG_ENV_PATH || path.join(process.cwd(), ".env"),
);

export const MANAGED_ENV_KEYS = [
  "PROXY_PORT",
  "BIND_HOST",
  "PROXY_AUTH_KEY",
  "PROXY_KEYS",
  "DEFAULT_PROVIDER",
  "MODEL_ALIASES",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_KEYS",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODELS",
  "MIMO_API_KEY",
  "MIMO_API_KEYS",
  "MIMO_BASE_URL",
  "MIMO_MODELS",
  "COMPAT_API_KEY",
  "COMPAT_API_KEYS",
  "COMPAT_BASE_URL",
  "COMPAT_MODELS",
  "OPENAI_API_KEY",
  "OPENAI_API_KEYS",
  "OPENAI_BASE_URL",
  "OPENAI_MODELS",
  "OPENAI_MODEL_PREFIXES",
  "LOG_LEVEL",
  "ACCESS_LOG",
  "UPSTREAM_TIMEOUT_MS",
  "STORE_TTL_MS",
  "STORE_MAX",
  "MAX_CONSECUTIVE_TOOL_CALLS",
  "FETCH_TIMEOUT_MS",
  "FETCH_MAX_BODY",
  "MAX_FETCH_LOOPS",
  "JINA_BASE",
  "JINA_FETCH_TIMEOUT_MS",
  "JINA_MAX_BODY",
  "MODEL_CATALOG_PATH",
  "GITHUB_TOKEN",
  "ADMIN_ENABLED",
  "ADMIN_AUTH_KEY",
] as const;

export const SENSITIVE_ENV_KEYS = new Set([
  "PROXY_AUTH_KEY",
  "PROXY_KEYS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_KEYS",
  "MIMO_API_KEY",
  "MIMO_API_KEYS",
  "COMPAT_API_KEY",
  "COMPAT_API_KEYS",
  "COMPAT_BASE_URL",
  "COMPAT_MODELS",
  "OPENAI_API_KEY",
  "OPENAI_API_KEYS",
  "GITHUB_TOKEN",
  "ADMIN_AUTH_KEY",
]);

export function parseEnvValue(rawValue: string): string {
  const val = rawValue.trim();
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      const parsed = JSON.parse(val) as unknown;
      return String(parsed ?? "");
    } catch {
      return val.slice(1, -1);
    }
  }
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  return val;
}

export function parseEnvFile(filePath: string = CONFIG_ENV_PATH): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    raw = "";
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    out[key] = parseEnvValue(line.slice(idx + 1));
  }
  return out;
}

export function writeManagedEnv(nextValues: Record<string, string>, filePath: string = CONFIG_ENV_PATH): void {
  const current = parseEnvFile(filePath);
  const merged = { ...current };
  for (const key of MANAGED_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(nextValues, key)) {
      const val = String(nextValues[key] ?? "").trim();
      if (val) merged[key] = val;
      else delete merged[key];
    }
  }
  const lines = [
    "# model-flux local configuration",
    "# Managed by /admin. Secrets are stored locally in this file.",
    "",
  ];
  for (const key of MANAGED_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      lines.push(`${key}=${quoteEnvValue(merged[key])}`);
    }
  }
  const extras = Object.keys(merged)
    .filter((k) => !(MANAGED_ENV_KEYS as readonly string[]).includes(k))
    .sort();
  if (extras.length) {
    lines.push("", "# Extra unmanaged variables");
    for (const key of extras) lines.push(`${key}=${quoteEnvValue(merged[key])}`);
  }
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // A single-file Docker bind mount can reject atomic rename with EBUSY.
    // Fall back to truncating the mounted file in place so the admin console can
    // still persist configuration in container deployments.
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore chmod failures on non-POSIX mounts */
  }
}

export function readLocalSecretFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}
