import { Agent, fetch as undiciFetch } from "undici";
import { getAppContext } from "../app/context.js";

let dispatcher: Agent | undefined;

export function initUpstreamFetch() {
  const ctx = getAppContext();
  if (ctx.useUndiciAgent) {
    dispatcher = new Agent({
      keepAliveTimeout: 300_000,
      keepAliveMaxTimeout: 300_000,
    });
  }
}

export async function upstreamFetch(
  url: string | URL,
  opts: RequestInit & { signal?: AbortSignal } = {},
  timeoutMs?: number,
): Promise<Response> {
  const ctx = getAppContext();
  const timeout = timeoutMs ?? ctx.upstreamTimeout;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  let onClientAbort: (() => void) | null = null;
  if (opts.signal) {
    onClientAbort = () => controller.abort();
    opts.signal.addEventListener("abort", onClientAbort, { once: true });
  }

  try {
    const merged: RequestInit = { ...opts, signal: controller.signal };
    if (dispatcher) {
      return (await undiciFetch(url, { ...merged, dispatcher } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    }
    return await fetch(url, merged);
  } finally {
    clearTimeout(t);
    if (opts.signal && onClientAbort) {
      opts.signal.removeEventListener("abort", onClientAbort);
    }
  }
}
