import type { Context, Next } from "hono";
import { getAppContext } from "../app/context.js";

export function requireAdmin(c: Context): boolean {
  const ctx = getAppContext();
  if (!ctx.adminEnabled) {
    return false;
  }
  if (!ctx.adminAuthKey) return true;

  const header = c.req.header("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const cookie = (c.req.header("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("modelflux_admin_key="));
  const cookieKey = cookie ? decodeURIComponent(cookie.slice("modelflux_admin_key=".length)) : "";
  const queryKey = c.req.query("key") || "";
  const presented = bearer || cookieKey || queryKey;
  return presented === ctx.adminAuthKey;
}

export function adminAuthMiddleware() {
  return async (c: Context, next: Next) => {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/admin/api/")) {
      await next();
      return;
    }

    const ctx = getAppContext();
    if (!ctx.adminEnabled) {
      return c.json({ error: { message: "admin is disabled" } }, 404);
    }
    if (!requireAdmin(c)) {
      return c.json({ error: { message: "admin auth required", code: "admin_auth_required" } }, 401);
    }
    await next();
  };
}
