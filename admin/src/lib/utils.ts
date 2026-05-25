import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]!,
  );
}

export function isMasked(k: unknown) {
  const s = String(k ?? "");
  return s.includes("…") || s.includes("•");
}


export function normalizeConfigNewlines(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\+n/g, "\n");
}

export function splitModels(text: unknown) {
  return String(text ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function normModel(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

export async function copyText(value: string, label = "内容") {
  if (!value) throw new Error(`${label} 不存在`);

  const text = String(value);
  const clipboard = navigator.clipboard;
  if (window.isSecureContext && clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback below. This keeps copy working on
      // browsers/profiles that expose navigator.clipboard but deny permission.
    }
  }

  // navigator.clipboard only works in secure contexts (HTTPS, localhost). The
  // admin UI is often opened as http://<LAN-IP>:19090/admin, so keep a legacy
  // copy path for local operations over plain HTTP.
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);

  const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
    previousActive?.focus?.();
  }

  if (!ok) throw new Error(`复制 ${label} 失败`);
}
