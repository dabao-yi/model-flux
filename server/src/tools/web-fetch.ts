import { execSync } from "node:child_process";
import { WEB_FETCH_TOOL } from "./web-fetch-tool.js";

export { WEB_FETCH_TOOL };

let _githubToken: string | null = process.env.GITHUB_TOKEN || null;

export function getGithubToken(): string {
  if (_githubToken !== null) return _githubToken;
  try {
    _githubToken = execSync("gh auth token", { encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    _githubToken = "";
  }
  return _githubToken;
}

export function ensureWebFetchTool(tools: unknown[] | undefined): unknown[] {
  const list = Array.isArray(tools) ? [...tools] : [];
  const alreadyPresent = list.some((tool) => {
    const t = tool as { type?: string; function?: { name?: string }; name?: string };
    if (t?.type !== "function") return false;
    return t?.function?.name === WEB_FETCH_TOOL.function.name || t?.name === WEB_FETCH_TOOL.function.name;
  });
  if (!alreadyPresent) list.push(WEB_FETCH_TOOL);
  return list;
}

export function ensureWebFetchHint(messages: { role?: string; content?: unknown }[]): typeof messages {
  const hint =
    "[System: You have a `web_fetch` tool available for making HTTP requests. Use it instead of curl, wget, or other shell-based HTTP tools. Call web_fetch with {\"url\": \"...\"} to fetch any URL. It supports GET, HEAD, POST, PUT, DELETE, PATCH, and OPTIONS methods.]";
  const alreadyPresent = messages.some((message) => message?.role === "user" && message?.content === hint);
  if (alreadyPresent) return messages;
  return [...messages, { role: "user", content: hint }];
}

export async function jinaRead(
  url: string,
  jinaBase: string,
  jinaFetchTimeout: number,
  jinaMaxBody: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), jinaFetchTimeout);
  try {
    const res = await fetch(`${jinaBase}/${url}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
        "User-Agent": "Mozilla/5.0 (compatible; ModelFlux/1.0)",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return `Jina error: ${res.status} ${res.statusText}\n${text}`.slice(0, jinaMaxBody);
    }
    let text = await res.text();
    if (text.length > jinaMaxBody) {
      text =
        text.slice(0, jinaMaxBody) + `\n...[content truncated, ${text.length - jinaMaxBody} chars omitted]`;
    }
    return text;
  } catch (err) {
    clearTimeout(timeout);
    const e = err as { name?: string; message?: string };
    if (e.name === "AbortError") return "Jina fetch error: request timed out (20s)";
    return `Jina fetch error: ${e.message}`;
  }
}

export async function rawFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  reqBody: unknown,
  fetchTimeout: number,
  fetchMaxBody: number,
): Promise<string> {
  if (!headers["User-Agent"]) headers["User-Agent"] = "Mozilla/5.0 (compatible; ModelFlux/1.0)";
  if (/api\.github\.com/.test(url) && !headers["Authorization"] && !headers["authorization"]) {
    const tok = getGithubToken();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeout);
  const fetchOpts: RequestInit = { method, headers, signal: controller.signal, redirect: "follow" };
  if (reqBody && /^(POST|PUT|PATCH)$/i.test(method)) {
    if (typeof reqBody === "string" || reqBody instanceof Uint8Array || reqBody instanceof ArrayBuffer) {
      fetchOpts.body = reqBody as BodyInit;
    } else {
      fetchOpts.body = JSON.stringify(reqBody);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }
  const response = await fetch(url, fetchOpts);
  clearTimeout(timeout);
  const ct = response.headers.get("content-type") || "";
  const status = `HTTP ${response.status} ${response.statusText}`;
  if (/^(HEAD|OPTIONS)$/i.test(method)) {
    const hdrs = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    return `${status}\n${hdrs}`;
  }
  if (/image|audio|video|octet-stream/.test(ct)) {
    return `${status}\nContent-Type: ${ct}\n(binary content, not shown)`;
  }
  let text = await response.text();
  if (text.length > fetchMaxBody) {
    text = text.slice(0, fetchMaxBody) + `\n...[truncated, ${text.length - fetchMaxBody} chars omitted]`;
  }
  return `${status}\n\n${text}`;
}

export async function executeWebFetch(
  argsStr: unknown,
  config: { jinaBase: string; jinaFetchTimeout: number; jinaMaxBody: number; fetchTimeout: number; fetchMaxBody: number },
): Promise<string> {
  try {
    const args = typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr;
    const { url, method = "GET", headers = {}, body: reqBody } = args as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    if (!url) return "Error: no URL provided";
    if (method === "GET") return await jinaRead(url, config.jinaBase, config.jinaFetchTimeout, config.jinaMaxBody);
    return await rawFetch(url, method, headers, reqBody, config.fetchTimeout, config.fetchMaxBody);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "AbortError") return "Fetch error: request timed out";
    return `Fetch error: ${e.message}`;
  }
}
