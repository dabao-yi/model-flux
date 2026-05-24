import type { ProviderId } from "@/types/config";

export interface ProviderMeta {
  id: ProviderId;
  title: string;
  base: string;
  models: string;
  desc: string;
  /** 品牌色，用于卡片左边框与徽章 */
  accent: string;
  accentBg: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "mimo",
    title: "小米 MiMo",
    base: "https://api.xiaomimimo.com/v1",
    models: "mimo-v2-pro,mimo-v2-flash,mimo-v2-omni,mimo-v2-tts",
    desc: "Chat Completions → Responses 协议适配",
    accent: "#ff6b35",
    accentBg: "rgba(255, 107, 53, 0.12)",
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    models: "deepseek-v4-pro,deepseek-v4-flash",
    desc: "DeepSeek V4 系列，含思考模式适配",
    accent: "#4d9fff",
    accentBg: "rgba(77, 159, 255, 0.12)",
  },
  {
    id: "compat",
    title: "OpenAI 兼容",
    base: "",
    models: "",
    desc: "Kimi / 硅基流动 / OpenRouter 等 Chat 上游",
    accent: "#a78bfa",
    accentBg: "rgba(167, 139, 250, 0.12)",
  },
  {
    id: "openai",
    title: "OpenAI 原生",
    base: "https://api.openai.com/v1",
    models: "",
    desc: "原生 Responses API 直通",
    accent: "#10b981",
    accentBg: "rgba(16, 185, 129, 0.12)",
  },
];

export function providerMeta(id: string) {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerAccent(id: string) {
  return providerMeta(id)?.accent ?? "var(--color-accent)";
}
