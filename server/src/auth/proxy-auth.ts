import type { Context, Next } from "hono";
import { log } from "../lib/log.js";
import { isAccessLogOn } from "../lib/log.js";
import { parseCsv } from "../lib/utils.js";
import { getAppContext } from "../app/context.js";

export const VALID_LOCK_PROVIDERS = new Set(["deepseek", "mimo", "compat", "openai", "*"]);

export function loadProxyKeyTable(
  proxyKeysRaw: string,
  proxyAuthKey: string,
): Map<string, string> {
  const table = new Map<string, string>();
  for (const entry of parseCsv(proxyKeysRaw)) {
    const idx = entry.lastIndexOf(":");
    if (idx === -1) {
      log.warn(`[proxy] PROXY_KEYS entry missing ':<provider>': "${entry}" — ignored`);
      continue;
    }
    const key = entry.slice(0, idx).trim();
    const provider = entry.slice(idx + 1).trim().toLowerCase();
    if (!key) {
      log.warn(`[proxy] PROXY_KEYS entry has empty key — ignored`);
      continue;
    }
    if (!VALID_LOCK_PROVIDERS.has(provider)) {
      log.warn(
        `[proxy] PROXY_KEYS entry has unknown provider "${provider}" (allowed: deepseek, mimo, compat, openai, *) — ignored`,
      );
      continue;
    }
    if (table.has(key)) {
      log.warn(`[proxy] PROXY_KEYS entry duplicates key "${key.slice(0, 12)}…" — last wins`);
    }
    table.set(key, provider);
  }
  if (proxyAuthKey) {
    if (!table.has(proxyAuthKey)) table.set(proxyAuthKey, "*");
  }
  return table;
}

export function proxyAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const ctx = getAppContext();
    c.set("lockedProvider", "*");

    if (!ctx.proxyAuthEnabled) {
      await next();
      return;
    }

    const requestPath = new URL(c.req.url).pathname;
    const isHealth = c.req.method === "GET" && (requestPath === "/health" || requestPath === "/");
    const isAdminPath = requestPath === "/admin" || requestPath.startsWith("/admin/");
    const isStaticPublic = requestPath === "/favicon.ico";

    if (isHealth || isAdminPath || isStaticPublic) {
      await next();
      return;
    }

    const header = c.req.header("authorization") || "";
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const lock = presented ? ctx.proxyKeyTable.get(presented) : undefined;

    if (!lock) {
      if (isAccessLogOn()) {
        log.access(`[access] 401 unauthorized (presented=${presented ? presented.slice(0, 8) + "…" : "<none>"})`);
      }
      return c.json(
        {
          error: {
            message:
              "Invalid or missing proxy key. Set Authorization: Bearer <key> using one of the keys configured in PROXY_KEYS or PROXY_AUTH_KEY.",
            type: "invalid_request_error",
            code: "proxy_auth_required",
          },
        },
        401,
      );
    }

    c.set("lockedProvider", lock);
    await next();
  };
}

export function getLockedProvider(c: Context): string {
  return c.get("lockedProvider") ?? "*";
}
