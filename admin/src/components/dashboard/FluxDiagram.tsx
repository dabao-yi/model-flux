import { useQuery } from "@tanstack/react-query";
import { useConfig } from "@/context/ConfigContext";
import { api } from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import type { HealthPayload } from "@/types/config";

export function FluxDiagram() {
  const { snapshot } = useConfig();
  const enabled = new Set(snapshot?.runtime?.enabled_providers || []);
  const defaultProvider = snapshot?.runtime?.default_provider || "—";

  const { data: health } = useQuery({
    queryKey: ["health-diagram"],
    queryFn: () => api<HealthPayload>("/health"),
    refetchInterval: 30_000,
  });

  return (
    <div className="glass-panel relative overflow-hidden rounded-[var(--radius-xl)] p-6 animate-fade-in-delay-1">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(232,163,23,0.06),transparent_55%)]" />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">数据流</p>
        <h3 className="mt-1 text-lg font-semibold">客户端 → ModelFlux → 上游</h3>

        <div className="mt-6 flex flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-between">
          <FlowNode title="客户端 / 前置代理" subtitle="Responses / Chat Completions" active />
          <FlowArrow />
          <FlowNode
            title="model-flux"
            subtitle={health?.status === "ok" ? "运行中 · :19090" : "连接中…"}
            highlight
            live={health?.status === "ok"}
          />
          <FlowArrow />
          <div className="flex flex-1 flex-wrap justify-center gap-2 md:justify-end">
            {PROVIDERS.map((p) => (
              <ProviderPill key={p.id} label={p.title.split(" ")[0]} on={enabled.has(p.id)} color={p.accent} />
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-[var(--color-muted)]">
          默认路由兜底：
          <span className="font-mono text-[var(--color-flow)]">{defaultProvider}</span>
          {" · "}
          已暴露 <span className="font-medium text-[var(--color-text)]">{snapshot?.runtime?.model_count ?? 0}</span> 个模型
        </p>
      </div>
    </div>
  );
}

function FlowNode({
  title,
  subtitle,
  active,
  highlight,
  live,
}: {
  title: string;
  subtitle: string;
  active?: boolean;
  highlight?: boolean;
  live?: boolean;
}) {
  return (
    <div
      className={`min-w-[120px] rounded-[14px] border px-4 py-3 text-center ${
        highlight
          ? "border-[var(--color-accent)]/40 bg-[rgba(232,163,23,0.08)] shadow-[0_0_24px_rgba(232,163,23,0.12)]"
          : active
            ? "border-[var(--color-line-strong)] bg-[var(--color-surface)]"
            : "border-[var(--color-line)] bg-[var(--color-bg-elevated)] opacity-60"
      }`}
    >
      <div className="flex items-center justify-center gap-2">
        {live ? <span className="status-live size-2 rounded-full bg-[var(--color-good)]" /> : null}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <span className="mt-1 block font-mono text-[10px] text-[var(--color-muted)]">{subtitle}</span>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden shrink-0 items-center justify-center md:flex" aria-hidden>
      <svg width="32" height="12" viewBox="0 0 32 12" fill="none">
        <path d="M0 6h24M24 6l-5-5M24 6l-5 5" stroke="url(#arr)" strokeWidth="1.5" strokeLinecap="round" />
        <defs>
          <linearGradient id="arr" x1="0" y1="6" x2="32" y2="6">
            <stop stopColor="#e8a317" />
            <stop offset="1" stopColor="#3dd6c6" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function ProviderPill({ label, on, color }: { label: string; on: boolean; color: string }) {
  return (
    <span
      className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition"
      style={{
        borderColor: on ? `${color}55` : "var(--color-line)",
        background: on ? `${color}18` : "transparent",
        color: on ? color : "var(--color-weak)",
      }}
    >
      {label}
    </span>
  );
}
