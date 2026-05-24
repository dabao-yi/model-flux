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
  await navigator.clipboard.writeText(value);
}
