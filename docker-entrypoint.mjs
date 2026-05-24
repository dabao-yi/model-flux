import fs from "node:fs";

function parseEnvFile(filePath) {
  const out = {};
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const envPath = process.env.CONFIG_ENV_PATH || "/app/.env";
const fileEnv = parseEnvFile(envPath);
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] = value;
}

process.env.CONFIG_ENV_PATH ||= envPath;
process.env.BIND_HOST ||= "0.0.0.0";
process.env.PROXY_PORT ||= "19090";

await import("./server/dist/index.js");
