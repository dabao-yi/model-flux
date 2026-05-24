import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Copy, FlaskConical, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FluxDiagram } from "@/components/dashboard/FluxDiagram";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfig } from "@/context/ConfigContext";
import { api } from "@/lib/api";
import { copyText } from "@/lib/utils";
import type { CurlResult } from "@/types/config";

export function DashboardPage() {
  const { snapshot, stateLabel, dirty, loadConfig, reveal, saveAndRestart, routeProbe } = useConfig();
  const rt = snapshot?.runtime;
  const scheduler = rt?.scheduler_summary;

  const curlMutation = useMutation({
    mutationFn: () =>
      api<CurlResult>("/admin/api/curl", {
        method: "POST",
        body: JSON.stringify({ model: routeProbe.trim() }),
      }),
    onSuccess: async (r) => {
      if (r.curl) await copyText(r.curl);
      toast.success("已复制有效 curl");
    },
    onError: () => toast.error("复制失败"),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      api<{ ok?: boolean }>("/admin/api/test", {
        method: "POST",
        body: JSON.stringify({
          model: routeProbe.trim() || "gpt-5.5",
          prompt: "请只输出 MIMO_OK，不要输出其他内容",
        }),
      }),
    onSuccess: (r) => toast.success(r.ok ? "链路测试通过" : "链路测试未通过"),
    onError: () => toast.error("测试失败"),
  });

  return (
    <div className="space-y-6">
      <Card className="animate-fade-in overflow-hidden">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">ModelFlux</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
              让客户端 / 前置代理共用一个 <span className="text-gradient-brand">模型流量入口</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
              管理供应商密钥、模型路由与鉴权。保存写入本地 <code className="font-mono text-[var(--color-flow)]">.env</code>，重启后生效。
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => saveAndRestart()}>
                保存并重启
              </Button>
              <Button variant="good" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
                <FlaskConical className="size-4" />
                链路测试
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:min-w-[280px]">
            <Metric label="运行供应商" value={(rt?.enabled_providers || []).join(", ") || "none"} />
            <Metric label="模型数" value={String(rt?.model_count ?? "—")} accent />
            <Metric label="可调度账号" value={String(scheduler?.schedulable_accounts ?? "—")} accent />
            <Metric label="异常账号" value={String(scheduler?.abnormal_accounts ?? "—")} warn={(scheduler?.abnormal_accounts || 0) > 0} />
            <Metric label="默认路由" value={rt?.default_provider || "—"} />
            <Metric label="配置状态" value={stateLabel} warn={dirty} />
          </div>
        </div>
      </Card>

      <Card className="animate-fade-in-delay-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-semibold">可选接入链路</p>
            <div className="mt-1 space-y-1 font-mono text-sm text-[var(--color-flow)]">
              <p>Codex -&gt; ModelFlux -&gt; upstream</p>
              <p>Codex -&gt; CLIProxyAPI / sub2api -&gt; ModelFlux -&gt; upstream</p>
              <p>OpenAI-compatible client -&gt; ModelFlux -&gt; upstream</p>
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              ModelFlux 内部只调度健康账号；余额不足、限流、认证异常会自动进入冷却并等待探测恢复。
            </p>
          </div>
          <div className="min-w-[260px] rounded-[14px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] p-3 text-xs text-[var(--color-muted)]">
            <b className="mb-2 block text-[var(--color-text)]">最近异常</b>
            {scheduler?.recent_errors?.length ? (
              <div className="space-y-1.5">
                {scheduler.recent_errors.slice(0, 3).map((e) => (
                  <div key={`${e.provider}-${e.id}-${e.at}`} className="truncate" title={e.error}>
                    <span className="text-[var(--color-warn)]">{e.provider}/{e.label}</span>
                    {e.status ? ` HTTP ${e.status}` : ""}: {e.error}
                  </div>
                ))}
              </div>
            ) : (
              <span>暂无账号异常</span>
            )}
          </div>
        </div>
      </Card>

      <FluxDiagram />

      <div className="grid gap-4 md:grid-cols-3 animate-fade-in-delay-2">
        <QuickLink to="/providers" title="配置供应商" desc="Key 池、Base URL、模型发现" />
        <QuickLink to="/routing" title="模型映射" desc="别名规则与路由预览" />
        <QuickLink to="/integration" title="接入客户端" desc="Codex / CLIProxyAPI / sub2api / CPA" />
      </div>

      <Card className="animate-fade-in-delay-2">
        <p className="text-sm font-medium">快捷操作</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => loadConfig(reveal)}>
            <RefreshCw className="size-4" />
            刷新配置
          </Button>
          <Button variant="ghost" onClick={() => curlMutation.mutate()} disabled={curlMutation.isPending}>
            <Copy className="size-4" />
            复制测试 curl
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value, warn, accent }: { label: string; value: string; warn?: boolean; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] p-4">
      <p
        className={`truncate text-lg font-semibold ${warn ? "text-[var(--color-warn)]" : accent ? "text-[var(--color-flow)]" : ""}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="glass-panel glass-panel-hover group flex flex-col rounded-[var(--radius-lg)] p-4 no-underline transition"
    >
      <span className="font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)]">{title}</span>
      <span className="mt-1 text-xs text-[var(--color-muted)]">{desc}</span>
      <ArrowRight className="mt-3 size-4 text-[var(--color-weak)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-flow)]" />
    </Link>
  );
}
