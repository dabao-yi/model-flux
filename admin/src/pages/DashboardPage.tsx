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
              管理账号池密钥、模型路由与鉴权。保存写入本地 <code className="font-mono text-[var(--color-flow)]">.env</code>，重启后生效。
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:min-w-[320px]">
            <Metric label="运行账号池" value={(rt?.enabled_providers || []).join(", ") || "none"} hint="当前已启用的账号池" />
            <Metric label="模型数" value={String(rt?.model_count ?? "—")} accent hint="当前可暴露给客户端的模型总数" />
            <Metric label="可调度账号" value={String(scheduler?.schedulable_accounts ?? "—")} accent hint="健康且参与轮询的账号数" />
            <Metric label="异常账号" value={String(scheduler?.abnormal_accounts ?? "—")} warn={(scheduler?.abnormal_accounts || 0) > 0} hint="余额不足 / 限流 / 认证异常" />
            <Metric label="默认路由" value={rt?.default_provider || "—"} hint="未命中明确映射时的兜底账号池" />
            <Metric label="配置状态" value={stateLabel} warn={dirty} hint={dirty ? "存在未保存更改" : "当前配置已同步"} />
          </div>
        </div>
      </Card>

      <Card className="animate-fade-in-delay-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-weak)]">可选接入链路</p>
            <div className="mt-1 space-y-1 font-mono text-sm text-[var(--color-flow)]">
              <p>Codex -&gt; ModelFlux -&gt; upstream</p>
              <p>Codex -&gt; CLIProxyAPI / sub2api -&gt; ModelFlux -&gt; upstream</p>
              <p>OpenAI-compatible client -&gt; ModelFlux -&gt; upstream</p>
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              ModelFlux 内部只调度健康账号；余额不足、限流、认证异常会自动进入冷却并等待探测恢复。
            </p>
          </div>
          <div className="min-w-[300px] rounded-[18px] border border-[#20303f] bg-[linear-gradient(180deg,rgba(10,17,24,0.92),rgba(7,12,18,0.86))] p-4 text-xs text-[var(--color-muted)]">
            <b className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-[var(--color-weak)]">最近异常</b>
            {scheduler?.recent_errors?.length ? (
              <div className="space-y-1.5">
                {scheduler.recent_errors.slice(0, 3).map((e) => (
                  <div key={`${e.provider}-${e.id}-${e.at}`} className="rounded-[12px] border border-[rgba(248,113,113,0.16)] bg-[rgba(248,113,113,0.05)] px-3 py-2" title={e.error}>
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
        <QuickLink to="/providers" title="配置账号池" desc="Key 池、Base URL、模型发现" />
        <QuickLink to="/routing" title="模型映射" desc="别名规则与路由预览" />
        <QuickLink to="/integration" title="接入客户端" desc="Codex / CLIProxyAPI / sub2api / CPA" />
      </div>

      <Card className="animate-fade-in-delay-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-weak)]">快捷操作</p>
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

function Metric({
  label,
  value,
  hint,
  warn,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[18px] border border-[#223343] bg-[linear-gradient(180deg,rgba(10,17,24,0.95),rgba(7,12,18,0.88))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-weak)]">{label}</p>
      <p
        className={`mt-2 truncate text-[22px] font-semibold leading-none ${warn ? "text-[var(--color-warn)]" : accent ? "text-[var(--color-flow)]" : ""}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );
}

function QuickLink({ to, title, desc }: { to: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="glass-panel glass-panel-hover group flex flex-col rounded-[20px] p-4 no-underline transition"
    >
      <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-weak)]">Quick Link</span>
      <span className="mt-2 font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)]">{title}</span>
      <span className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{desc}</span>
      <ArrowRight className="mt-4 size-4 text-[var(--color-weak)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-flow)]" />
    </Link>
  );
}
