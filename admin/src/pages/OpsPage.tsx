import { useState } from "react";
import { toast } from "sonner";
import { CheckList } from "@/components/common/CheckList";
import { Field } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/context/ConfigContext";
import { api, clearAdminKey } from "@/lib/api";
import type { HealthPayload, TestResult } from "@/types/config";

const logLevels = ["silent", "error", "warn", "info", "debug"].map((v) => ({ value: v, label: v }));

export function OpsPage() {
  const {
    dirty,
    restartPending,
    form,
    setTuning,
    validateOps,
    saveConfig,
    restartFlux,
    saveAndRestart,
    loadConfig,
    reveal,
    routeProbe,
  } = useConfig();
  const [opLog, setOpLog] = useState("等待操作...");

  const log = (t: unknown) => setOpLog(typeof t === "string" ? t : JSON.stringify(t, null, 2));

  const pollHealth = async () => {
    for (let i = 0; i < 12; i++) {
      try {
        const h = await api<HealthPayload>("/health");
        log(`健康状态：${h.status}\n账号池：${(h.providers || []).join(",")}\n默认：${h.default_provider}`);
        toast.success("服务已恢复");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    toast.error("健康检查超时");
  };

  const restartWithPoll = async () => {
    if (await restartFlux()) await pollHealth();
  };

  const testRoute = async () => {
    try {
      const r = await api<TestResult>("/admin/api/test", {
        method: "POST",
        body: JSON.stringify({
          model: routeProbe.trim() || "gpt-5.5",
          prompt: "请只输出 MIMO_OK，不要输出其他内容",
        }),
      });
      log(
        `测试${r.ok ? "成功" : "未通过"}\n请求模型：${r.model}\n上游模型：${r.upstream_model || "-"}\n账号池：${r.provider}\n回答：${String(r.text || "").slice(0, 200)}`,
      );
      toast.success(r.ok ? "测试成功" : "测试未通过");
    } catch (e) {
      log(e);
      toast.error("测试失败");
    }
  };

  const stateChecks: [("good" | "warn" | "bad"), string][] = [
    [
      dirty ? "warn" : restartPending ? "warn" : "good",
      dirty ? "页面有未保存修改" : restartPending ? "配置已保存，等待重启加载" : "页面配置与运行配置一致",
    ],
  ];

  return (
    <div>
      <PageHeader step="05" title="保存与验证" hint="保存写入 .env；重启后运行时才会加载。" />
      <Section className="space-y-4">
        <CheckList items={stateChecks} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="日志级别">
            <Select value={form.logLevel} onValueChange={(v) => setTuning({ logLevel: v })} options={logLevels} />
          </Field>
          <Field label="上游请求超时 ms">
            <Input
              type="number"
              min={5000}
              max={600000}
              step={1000}
              value={form.upstreamTimeout}
              onChange={(e) => setTuning({ upstreamTimeout: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Switch checked={form.accessLog} onCheckedChange={(v) => setTuning({ accessLog: v })} />
          启用每请求访问日志（排障后建议关闭）
        </label>
        <CheckList items={validateOps()} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => saveAndRestart().then(() => pollHealth())}>
            保存并重启
          </Button>
          <Button onClick={() => saveConfig()}>只保存</Button>
          <Button onClick={restartWithPoll}>只重启</Button>
          <Button variant="good" onClick={testRoute}>
            默认链路测试
          </Button>
          <Button onClick={pollHealth}>健康状态</Button>
          <Button onClick={() => loadConfig(reveal).then(() => toast.success("已刷新模型"))}>刷新模型</Button>
          <Button
            variant="danger"
            onClick={() => {
              clearAdminKey();
              toast.success("已清除管理口令");
            }}
          >
            清除管理口令
          </Button>
        </div>
        <pre className="max-h-[330px] overflow-auto rounded-[18px] border border-[#1c2b38] bg-[#060a0e] p-3.5 font-mono text-xs whitespace-pre-wrap text-[#a8b9c7]">
          {opLog}
        </pre>
      </Section>
    </div>
  );
}
