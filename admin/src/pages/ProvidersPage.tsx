import { useState } from "react";
import { toast } from "sonner";
import { CheckList } from "@/components/common/CheckList";
import { Field } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfig, type FormKeyRow } from "@/context/ConfigContext";
import { api } from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import { copyText, isMasked } from "@/lib/utils";
import type { ProviderAccountRuntime, ProviderAccountState, ProviderId, ProviderKeyTestResult } from "@/types/config";

export function ProvidersPage() {
  return (
    <div>
      <PageHeader
        step="01"
        title="供应商账号池"
        hint="供应商启用表示允许路由到它；每个 key 也可以独立启用/停用。停用 key 不会删除密钥，保存后它会保留在配置里但不会参与轮询。"
      />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {PROVIDERS.map((meta) => (
          <ProviderCard key={meta.id} id={meta.id} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ id }: { id: ProviderId }) {
  const meta = PROVIDERS.find((p) => p.id === id)!;
  const {
    form,
    setProvider,
    setProviderKeys,
    validateProvider,
    discoverModels,
    syncDiscoveredToProvider,
    discoveredModels,
  } = useConfig();
  const p = form.providers[id];
  const checks = validateProvider(id);
  const discovered = discoveredModels[id] || [];

  const updateKey = (index: number, patch: Partial<FormKeyRow>) => {
    const keys = [...p.keys];
    keys[index] = { ...keys[index], ...patch };
    setProviderKeys(id, keys);
  };

  const addKey = () => {
    setProviderKeys(id, [
      ...p.keys,
      { id: "", masked: "", enabled: true, label: `key-${p.keys.length + 1}`, key: "" },
    ]);
  };

  const removeKey = (index: number) => {
    setProviderKeys(
      id,
      p.keys.filter((_, i) => i !== index),
    );
  };

  return (
    <Section
      className={`min-w-0 overflow-hidden ${p.enabled ? "" : "opacity-75"}`}
      style={{ borderLeftWidth: 3, borderLeftColor: meta.accent, borderLeftStyle: "solid" }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{meta.title}</h3>
          <p className="text-sm text-[var(--color-muted)]">{meta.desc}</p>
        </div>
        <Badge variant={p.enabled ? "good" : "bad"}>
          {p.enabled ? `启用 ${p.keys.filter((k) => k.enabled).length} / ${p.keys.length}` : "未启用"}
        </Badge>
      </div>

      <label className="mb-3 flex items-center gap-2 text-sm text-[var(--color-muted)]">
        <Switch checked={p.enabled} onCheckedChange={(v) => setProvider(id, { enabled: v })} />
        启用该供应商路由
      </label>

      <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
        <Field label="Base URL">
          <Input value={p.base_url} onChange={(e) => setProvider(id, { base_url: e.target.value })} />
        </Field>
        <Field label="Models（真实上游模型，逗号分隔）">
          <Textarea value={p.models} onChange={(e) => setProvider(id, { models: e.target.value })} />
        </Field>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="mini"
          onClick={() => copyText(p.base_url, `${meta.title} Base URL`).then(() => toast.success("已复制"))}
        >
          复制 Base URL
        </Button>
        <Button variant="mini" onClick={() => discoverModels(id).then((r) => toast.message(r.ok ? "模型列表已刷新" : "模型发现失败"))}>
          发现模型
        </Button>
        <Button
          variant="mini"
          onClick={() => {
            const added = syncDiscoveredToProvider(id);
            toast.message(added ? `已同步 ${added} 个新模型` : "没有新增模型需要同步");
          }}
        >
          把发现模型同步到 Models
        </Button>
      </div>

      {discovered.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-[var(--color-muted)]">发现到 {discovered.length} 个模型，点击加入：</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {discovered.map((m) => (
              <button
                key={m}
                type="button"
                className="rounded-full border border-[#294257] bg-[#0a131b] px-2.5 py-1 text-xs hover:border-[#6091bd]"
                onClick={() => {
                  const list = p.models.split(",").map((x) => x.trim()).filter(Boolean);
                  if (!list.map((x) => x.toLowerCase()).includes(m.toLowerCase())) {
                    list.push(m);
                    setProvider(id, { models: list.join(",") });
                  }
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Field label="Key 池" className="mt-3 min-w-0">
        <div className="grid min-w-0 gap-2">
          {p.keys.map((row, i) => (
            <KeyRow
              key={i}
              row={row}
              providerId={id}
              model={p.models.split(",").map((x) => x.trim()).filter(Boolean)[0] || ""}
              onChange={(patch) => updateKey(i, patch)}
              onRemove={() => removeKey(i)}
            />
          ))}
        </div>
      </Field>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="mini" onClick={addKey}>
          + 添加 key
        </Button>
        <Button variant="mini" onClick={() => testProvider(id, p.models)}>
          测试供应商
        </Button>
      </div>

      <div className="mt-3">
        <CheckList items={checks} />
      </div>
    </Section>
  );
}

function KeyRow({
  row,
  providerId,
  model,
  onChange,
  onRemove,
}: {
  row: FormKeyRow;
  providerId: ProviderId;
  model: string;
  onChange: (p: Partial<FormKeyRow>) => void;
  onRemove: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const scheduler = row.scheduler;

  const revealKey = async () => {
    if (revealed) {
      onChange({ key: row.masked || row.key, revealed: false });
      setRevealed(false);
      return;
    }
    const current = row.key.trim();
    if (current && !isMasked(current)) {
      setRevealed(true);
      return;
    }
    if (!row.id) {
      toast.error("这个 key 还没有保存");
      return;
    }
    try {
      const r = await api<{ key: string; masked?: string }>("/admin/api/provider-key", {
        method: "POST",
        body: JSON.stringify({ provider: providerId, id: row.id }),
      });
      onChange({ key: r.key, secret: r.key, masked: r.masked || row.masked, revealed: true });
      setRevealed(true);
      toast.success("已显示该 key");
    } catch {
      toast.error("显示 key 失败");
    }
  };

  const copyKey = async () => {
    let secret = row.secret || row.key;
    if (isMasked(secret) && row.id) {
      const r = await api<{ key: string }>("/admin/api/provider-key", {
        method: "POST",
        body: JSON.stringify({ provider: providerId, id: row.id }),
      });
      secret = r.key;
    }
    try {
      await copyText(secret, "key");
      toast.success("已复制 key");
    } catch {
      toast.error("复制 key 失败");
    }
  };

  const runKeyAction = async (kind: "test" | "probe" | "status", enabled?: boolean) => {
    if (!row.id) {
      toast.error("这个 key 还没有保存，保存并重启后才能做运行态操作");
      return;
    }
    setBusy(true);
    try {
      if (kind === "status") {
        const r = await api<{ ok?: boolean; enabled?: boolean; account?: ProviderAccountRuntime }>(
          "/admin/api/provider-key/status",
          {
            method: "POST",
            body: JSON.stringify({ provider: providerId, id: row.id, enabled }),
          },
        );
        onChange({ enabled: r.enabled !== false, scheduler: r.account });
        toast.success(r.enabled === false ? "已从运行调度池禁用" : "已进入探测队列");
      } else {
        const r = await api<ProviderKeyTestResult>(
          kind === "probe" ? "/admin/api/provider-key/probe" : "/admin/api/provider-key/test",
          {
            method: "POST",
            body: JSON.stringify({ provider: providerId, id: row.id, model }),
          },
        );
        onChange({ scheduler: r.account || row.scheduler });
        if (r.ok) toast.success(kind === "probe" ? "探测成功，已恢复可调度" : "单账号测试成功");
        else toast.error(r.classification?.message || "单账号测试失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-[16px] border border-[#223343] bg-[#0b1219] p-2.5">
      <div className="grid min-w-0 gap-2 xl:grid-cols-[72px_minmax(120px,0.75fr)_minmax(180px,1fr)] 2xl:grid-cols-[72px_minmax(130px,0.75fr)_minmax(180px,1fr)_auto] 2xl:items-center">
        <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-muted)]">
          <input type="checkbox" checked={row.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          启用
        </label>
        <Input className="min-w-0 text-sm" placeholder="label" value={row.label} onChange={(e) => onChange({ label: e.target.value })} />
        <Input
          className="min-w-0 font-mono text-xs"
          placeholder="sk-..."
          value={row.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
        <div className="flex min-w-0 flex-wrap gap-1 xl:col-span-3 2xl:col-span-1 2xl:justify-end">
          <Button variant="mini" onClick={revealKey}>
            {revealed ? "隐藏" : "显示"}
          </Button>
          <Button variant="mini" onClick={copyKey}>
            复制
          </Button>
          <Button variant="danger" className="px-2 py-1 text-xs" onClick={onRemove}>
            删除
          </Button>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-[#172635] pt-2 text-xs text-[var(--color-muted)]">
        <AccountStateBadge state={scheduler?.state} schedulable={scheduler?.schedulable} enabled={row.enabled} />
        <span className="shrink-0">成功 {scheduler?.success_count ?? 0}</span>
        <span className="shrink-0">失败 {scheduler?.failure_count ?? 0}</span>
        <span className="shrink-0">并发 {scheduler?.in_flight ?? 0}</span>
        {scheduler?.cooldown_ms_remaining ? <span className="shrink-0">冷却 {formatDuration(scheduler.cooldown_ms_remaining)}</span> : null}
        {scheduler?.last_success_at ? <span className="shrink-0">最近成功 {formatTime(scheduler.last_success_at)}</span> : null}
        {scheduler?.last_error_at ? <span className="shrink-0">最近失败 {formatTime(scheduler.last_error_at)}</span> : null}
        {scheduler?.last_error ? (
          <span title={scheduler.last_error} className="min-w-0 basis-full truncate text-[var(--color-bad)]">
            {scheduler.last_status ? `HTTP ${scheduler.last_status}: ` : ""}
            {scheduler.last_error}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap gap-1">
        <Button variant="mini" disabled={busy || !row.id} onClick={() => runKeyAction("test")}>
          测试单账号
        </Button>
        <Button variant="mini" disabled={busy || !row.id || scheduler?.state === "manual_disabled"} onClick={() => runKeyAction("probe")}>
          立即探测
        </Button>
        <Button
          variant={scheduler?.state === "manual_disabled" ? "good" : "danger"}
          className="px-2 py-1 text-xs"
          disabled={busy || !row.id}
          onClick={() => runKeyAction("status", scheduler?.state === "manual_disabled")}
        >
          {scheduler?.state === "manual_disabled" ? "加入调度" : "临时禁用调度"}
        </Button>
      </div>
    </div>
  );
}

function AccountStateBadge({
  state,
  schedulable,
  enabled,
}: {
  state?: ProviderAccountState;
  schedulable?: boolean;
  enabled?: boolean;
}) {
  const normalized = !enabled ? "manual_disabled" : state || "healthy";
  const labels: Record<ProviderAccountState, string> = {
    healthy: schedulable ? "可调度" : "健康",
    probing: "探测中",
    insufficient_balance: "余额不足",
    rate_limited: "限流冷却",
    auth_error: "认证异常",
    temporary_error: "临时异常",
    manual_disabled: "手动禁用",
  };
  const variant =
    normalized === "healthy" && schedulable
      ? "good"
      : normalized === "probing" || normalized === "rate_limited" || normalized === "temporary_error"
        ? "warn"
        : "bad";
  return <Badge variant={variant}>{labels[normalized]}</Badge>;
}

function formatDuration(ms: number) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.ceil(m / 60)}h`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

async function testProvider(id: ProviderId, models: string) {
  const model = models.split(",").map((x) => x.trim()).filter(Boolean)[0] || "";
  try {
    const r = await api<{ ok?: boolean; upstream_model?: string; model?: string; text?: string }>(
      "/admin/api/test",
      {
        method: "POST",
        body: JSON.stringify({
          provider: id,
          model,
          prompt: "请只输出 MIMO_OK，不要输出其他内容",
        }),
      },
    );
    toast.success(r.ok ? "供应商测试成功" : "供应商测试未通过");
  } catch {
    toast.error("供应商测试失败");
  }
}
