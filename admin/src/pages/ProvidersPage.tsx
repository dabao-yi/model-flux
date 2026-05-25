import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckList } from "@/components/common/CheckList";
import { Field } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfig, type FormKeyRow } from "@/context/ConfigContext";
import { api } from "@/lib/api";
import { PROVIDERS } from "@/lib/providers";
import { copyText, isMasked } from "@/lib/utils";
import type { ConfigPayload, ProviderAccountRuntime, ProviderAccountState, ProviderId, ProviderKeyTestResult } from "@/types/config";

export function ProvidersPage() {
  const { form } = useConfig();
  const [activeProvider, setActiveProvider] = useState<ProviderId>(PROVIDERS[0]?.id ?? "mimo");

  useEffect(() => {
    const ids = PROVIDERS.map((meta) => meta.id);
    const nodes = ids
      .map((id) => document.getElementById(`provider-${id}`))
      .filter((node): node is HTMLElement => !!node);

    if (!nodes.length) return;

    const findScrollContainer = (node: HTMLElement) => {
      let current: HTMLElement | null = node.parentElement;
      while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return current;
        current = current.parentElement;
      }
      return window;
    };

    const scrollContainer = findScrollContainer(nodes[0]);

    const pickActive = () => {
      const threshold = 180;
      let candidate = ids[0] as ProviderId;
      const containerTop = scrollContainer instanceof Window ? 0 : scrollContainer.getBoundingClientRect().top;

      for (let i = 0; i < nodes.length; i += 1) {
        const rect = nodes[i].getBoundingClientRect();
        const relativeTop = rect.top - containerTop;
        if (relativeTop - threshold <= 0) {
          candidate = ids[i] as ProviderId;
        } else {
          break;
        }
      }

      setActiveProvider((prev) => (prev === candidate ? prev : candidate));
    };

    pickActive();
    scrollContainer.addEventListener("scroll", pickActive, { passive: true });
    window.addEventListener("hashchange", pickActive);
    return () => {
      scrollContainer.removeEventListener("scroll", pickActive);
      window.removeEventListener("hashchange", pickActive);
    };
  }, []);

  const activeMeta = PROVIDERS.find((meta) => meta.id === activeProvider) ?? PROVIDERS[0];

  const jumpToProvider = (id: ProviderId) => {
    setActiveProvider(id);
    const node = document.getElementById(`provider-${id}`);
    if (!node) return;
    window.history.replaceState(null, "", `#provider-${id}`);
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        step="01"
        title="账号池"
        hint="按上游协议类型组织账号池；每个 key 都可以配置自己的 Base URL、启用状态和运行态调度。不同账号地址不一致时，会优先使用账号行上的 Base URL。"
      />
      <div className="sticky top-2 z-30 rounded-[18px] border border-[#223343] bg-[linear-gradient(180deg,rgba(9,16,24,0.98),rgba(7,12,18,0.94))] px-3 py-3 shadow-[0_16px_30px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-weak)]">账号池导航</p>
            <h3 className="mt-1 text-sm font-semibold text-[var(--color-text)]">选择厂商快速定位</h3>
            {activeMeta ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <span>当前厂商</span>
                <span
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-medium text-[var(--color-text)]"
                  style={{
                    borderColor: `${activeMeta.accent}66`,
                    background: activeMeta.accentBg,
                  }}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: activeMeta.accent }} />
                  {activeMeta.title}
                </span>
                <Badge variant="good">当前</Badge>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((meta) => {
              const provider = form.providers[meta.id];
              const totalKeys = provider?.keys.length ?? 0;
              const schedulable = provider?.keys.filter((key) => key.scheduler?.schedulable).length ?? 0;
              return (
                <button
                  key={meta.id}
                  type="button"
                  onClick={() => jumpToProvider(meta.id)}
                  aria-pressed={activeProvider === meta.id}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium text-[var(--color-text)] transition hover:-translate-y-px ${
                    activeProvider === meta.id ? "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_12px_24px_rgba(0,0,0,0.16)]" : ""
                  }`}
                  style={{
                    borderColor: activeProvider === meta.id ? meta.accent : `${meta.accent}55`,
                    background: activeProvider === meta.id ? `${meta.accent}26` : meta.accentBg,
                    boxShadow: activeProvider === meta.id ? `0 0 0 1px ${meta.accent}33, 0 10px 22px ${meta.accent}20` : undefined,
                  }}
                >
                  <span
                    className={`size-2.5 rounded-full ${activeProvider === meta.id ? "scale-110" : ""}`}
                    style={{ backgroundColor: meta.accent }}
                  />
                  <span className="flex items-center gap-2">
                    <span>{meta.title}</span>
                    <span className="text-[11px] font-normal text-[var(--color-muted)]">
                      {schedulable}/{totalKeys || 0} 可调度
                    </span>
                  </span>
                  {activeProvider === meta.id ? <Badge variant="good">当前</Badge> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid gap-5">
        {PROVIDERS.map((meta) => (
          <ProviderCard key={meta.id} id={meta.id} active={activeProvider === meta.id} />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ id, active }: { id: ProviderId; active?: boolean }) {
  const meta = PROVIDERS.find((p) => p.id === id)!;
  const {
    form,
    setProvider,
    setProviderKeys,
    validateProvider,
    discoverModels,
    getProviderDraft,
    syncDiscoveredToProvider,
    discoveredModels,
  } = useConfig();
  const p = form.providers[id];
  const checks = validateProvider(id);
  const discovered = discoveredModels[id] || [];
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [newKey, setNewKey] = useState<FormKeyRow>({
    id: "",
    masked: "",
    enabled: true,
    label: `key-${p.keys.length + 1}`,
    key: "",
    base_url: "",
    priority: 0,
  });
  const enabledKeys = p.keys.filter((k) => k.enabled).length;
  const modelCount = p.models
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean).length;
  const schedulableCount = p.keys.filter((k) => k.scheduler?.schedulable).length;
  const exceptionalCount = p.keys.filter((k) => {
    const state = k.scheduler?.state;
    return !!state && state !== "healthy" && state !== "manual_disabled";
  }).length;
  const customBaseUrlCount = p.keys.filter((k) => k.base_url.trim()).length;

  const updateKey = (index: number, patch: Partial<FormKeyRow>) => {
    const keys = [...p.keys];
    keys[index] = { ...keys[index], ...patch };
    setProviderKeys(id, keys);
  };

  const addKey = () => {
    setProviderKeys(id, [
      ...p.keys,
      {
        ...newKey,
      },
    ]);
    setAddKeyOpen(false);
    setNewKey({
      id: "",
      masked: "",
      enabled: true,
      label: `key-${p.keys.length + 2}`,
      key: "",
      base_url: "",
      priority: 0,
    });
  };

  const openAddKeyDialog = () => {
    setNewKey({
      id: "",
      masked: "",
      enabled: true,
      label: `key-${p.keys.length + 1}`,
      key: "",
      base_url: "",
      priority: 0,
    });
    setAddKeyOpen(true);
  };

  const openCloneKeyDialog = (row: FormKeyRow) => {
    setNewKey({
      id: "",
      masked: "",
      enabled: row.enabled,
      label: row.label ? `${row.label}-copy` : `key-${p.keys.length + 1}`,
      key: row.secret || (isMasked(row.key) ? "" : row.key),
      base_url: row.base_url,
      priority: Number(row.priority || 0) || 0,
    });
    setAddKeyOpen(true);
  };

  const removeKey = (index: number) => {
    setProviderKeys(
      id,
      p.keys.filter((_, i) => i !== index),
    );
  };

  return (
    <Section
      id={`provider-${id}`}
      className={p.enabled ? "overflow-hidden scroll-mt-36" : "overflow-hidden scroll-mt-36 opacity-75"}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: meta.accent,
        borderLeftStyle: "solid",
        boxShadow: active ? `0 0 0 1px ${meta.accent}3d, 0 24px 48px rgba(0,0,0,0.45)` : undefined,
      }}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{meta.title}</h3>
            <Badge variant={p.enabled ? "good" : "bad"}>{p.enabled ? `启用 ${enabledKeys} / ${p.keys.length}` : "未启用"}</Badge>
            {active ? <Badge variant="accent">当前定位</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{meta.desc}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-line)] bg-[#0a1118] px-3 py-2 text-sm text-[var(--color-muted)]">
          <Switch checked={p.enabled} onCheckedChange={(v) => setProvider(id, { enabled: v })} />
          启用账号池路由
        </label>
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
        <PoolMetric label="可调度" value={String(schedulableCount)} hint="运行态健康并参与轮询" tone={schedulableCount > 0 ? "good" : "warn"} />
        <PoolMetric label="异常" value={String(exceptionalCount)} hint="余额不足 / 认证异常 / 限流等" tone={exceptionalCount > 0 ? "warn" : "good"} />
        <PoolMetric label="模型数" value={String(modelCount)} hint="当前账号池声明的真实上游模型" tone="accent" />
        <PoolMetric label="独立上游" value={String(customBaseUrlCount)} hint="填写了账号级 Base URL 的 key" tone={customBaseUrlCount > 0 ? "accent" : "good"} />
      </div>

      <div className="rounded-[18px] border border-[#1a2a38] bg-[linear-gradient(180deg,rgba(8,16,24,0.92),rgba(8,13,19,0.82))] p-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.95fr)_minmax(360px,1.05fr)]">
          <Field label="默认 Base URL（可被账号行覆盖）">
            <Input className="font-mono text-xs" value={p.base_url} onChange={(e) => setProvider(id, { base_url: e.target.value })} placeholder={meta.base || "https://provider.example/v1"} />
          </Field>
          <Field label="Models（真实上游模型，逗号分隔）">
            <Textarea className="min-h-[96px] font-mono text-xs" value={p.models} onChange={(e) => setProvider(id, { models: e.target.value })} />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="mini" onClick={() => copyText(p.base_url, `${meta.title} Base URL`).then(() => toast.success("已复制"))}>
            复制默认 Base URL
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
            同步发现模型
          </Button>
        </div>
      </div>

      {discovered.length > 0 ? (
        <div className="mt-3 rounded-[14px] border border-[#1d3445] bg-[#081019] p-3">
          <p className="text-xs text-[var(--color-muted)]">发现到 {discovered.length} 个模型，点击加入：</p>
          <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-auto pr-1">
            {discovered.map((m) => (
              <button
                key={m}
                type="button"
                className="cursor-pointer rounded-full border border-[#294257] bg-[#0a131b] px-2.5 py-1 text-xs hover:border-[#6091bd]"
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

      <div className="mt-5 rounded-[18px] border border-[#1a2a38] bg-[linear-gradient(180deg,rgba(10,17,24,0.9),rgba(7,13,18,0.86))] p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">账号列表</p>
            <p className="text-xs text-[var(--color-muted)]">Base URL 留空会继承账号池默认地址；填了则该 key 单独走自己的上游地址。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="mini" onClick={openAddKeyDialog}>+ 添加 key</Button>
            <Button variant="mini" onClick={() => testProvider(id, p.models, getProviderDraft(id))}>测试账号池</Button>
          </div>
        </div>
        {p.keys.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[#2a4154] bg-[#081018] px-4 py-5 text-sm text-[var(--color-muted)]">
            这个账号池还没有账号。先添加 key，再保存并重启进入运行态调度。
          </div>
        ) : (
          <div className="grid gap-4">
            {p.keys.map((row, i) => (
              <KeyRow
                key={`${row.id || "new"}-${i}`}
                row={row}
                providerId={id}
                model={p.models.split(",").map((x) => x.trim()).filter(Boolean)[0] || ""}
                defaultBaseUrl={p.base_url}
                providerDraft={getProviderDraft(id)}
                onChange={(patch) => updateKey(i, patch)}
                onRemove={() => removeKey(i)}
                onClone={() => openCloneKeyDialog(row)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-3">
        <CheckList items={checks} />
      </div>

      <Dialog
        open={addKeyOpen}
        onOpenChange={setAddKeyOpen}
        title={`新增 ${meta.title} 账号`}
        description="新增账号使用弹出框填写，避免账号池很多时直接插入列表导致感知不明显。"
      >
        <div className="space-y-4">
          <Field label="账号标签">
            <Input
              value={newKey.label}
              onChange={(e) => setNewKey((draft) => ({ ...draft, label: e.target.value }))}
              placeholder="primary / backup-cn"
            />
          </Field>
          <Field label="Key">
            <Input
              className="font-mono text-xs"
              value={newKey.key}
              onChange={(e) => setNewKey((draft) => ({ ...draft, key: e.target.value }))}
              placeholder="sk-..."
            />
          </Field>
          <Field label="账号 Base URL" hint="留空会继承当前账号池上面的默认 Base URL。">
            <Input
              className="font-mono text-xs"
              value={newKey.base_url}
              onChange={(e) => setNewKey((draft) => ({ ...draft, base_url: e.target.value }))}
              placeholder={p.base_url || meta.base || "https://provider.example/v1"}
            />
          </Field>
          <Field label="优先级" hint="数值越大优先级越高；留空或 0 表示默认优先级。">
            <Input
              type="number"
              min="0"
              value={String(newKey.priority ?? 0)}
              onChange={(e) => setNewKey((draft) => ({ ...draft, priority: Number(e.target.value || 0) || 0 }))}
              placeholder="0"
            />
          </Field>
          <label className="flex items-center gap-2 rounded-[14px] border border-[#1d3445] bg-[#0a1016] px-3 py-2 text-sm text-[var(--color-muted)]">
            <input
              className="cursor-pointer"
              type="checkbox"
              checked={newKey.enabled}
              onChange={(e) => setNewKey((draft) => ({ ...draft, enabled: e.target.checked }))}
            />
            新增后默认启用该账号
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddKeyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!newKey.key.trim()) {
                  toast.error("请先填写 key");
                  return;
                }
                addKey();
                toast.success("新账号已加入当前页面草稿");
              }}
            >
              添加账号
            </Button>
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

function PoolMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "warn" | "accent";
}) {
  const toneClass =
    tone === "good"
      ? "border-[rgba(52,211,153,0.22)] bg-[linear-gradient(180deg,rgba(52,211,153,0.08),rgba(8,17,24,0.92))]"
      : tone === "warn"
        ? "border-[rgba(251,191,36,0.22)] bg-[linear-gradient(180deg,rgba(251,191,36,0.08),rgba(8,17,24,0.92))]"
        : "border-[rgba(232,163,23,0.22)] bg-[linear-gradient(180deg,rgba(232,163,23,0.08),rgba(8,17,24,0.92))]";
  const valueClass =
    tone === "good" ? "text-[var(--color-good)]" : tone === "warn" ? "text-[var(--color-warn)]" : "text-[var(--color-accent)]";

  return (
    <div className={`rounded-[16px] border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-weak)]">{label}</span>
      <div className={`mt-2 text-2xl font-semibold leading-none ${valueClass}`}>{value}</div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">{hint}</p>
    </div>
  );
}

function KeyRow({
  row,
  providerId,
  model,
  defaultBaseUrl,
  providerDraft,
  onChange,
  onRemove,
  onClone,
}: {
  row: FormKeyRow;
  providerId: ProviderId;
  model: string;
  defaultBaseUrl: string;
  providerDraft: ConfigPayload["providers"][ProviderId];
  onChange: (p: Partial<FormKeyRow>) => void;
  onRemove: () => void;
  onClone: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const scheduler = row.scheduler;
  const hasOwnBaseUrl = !!row.base_url.trim();
  const effectiveBaseUrl = row.base_url || defaultBaseUrl;
  const sourceLabel = hasOwnBaseUrl ? "独立 Base URL" : "继承默认 Base URL";

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
      const r = await api<{ key: string; masked?: string; base_url?: string }>("/admin/api/provider-key", {
        method: "POST",
        body: JSON.stringify({ provider: providerId, id: row.id }),
      });
      onChange({ key: r.key, secret: r.key, masked: r.masked || row.masked, base_url: r.base_url || row.base_url, revealed: true });
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

  const copyBaseUrl = async () => {
    if (!effectiveBaseUrl) {
      toast.error("当前没有可复制的 Base URL");
      return;
    }
    try {
      await copyText(effectiveBaseUrl, "上游 Base URL");
      toast.success("已复制上游 Base URL");
    } catch {
      toast.error("复制上游 Base URL 失败");
    }
  };

  const runKeyAction = async (kind: "test" | "probe" | "status", enabled?: boolean) => {
    if (kind === "status" && !row.id) {
      toast.error("这个 key 还没有保存，保存并重启后才能做运行态操作");
      return;
    }
    if ((kind === "test" || kind === "probe") && !row.key.trim() && !row.masked.trim()) {
      toast.error("请先填写当前页面里的 key，再执行测试或探测");
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
            body: JSON.stringify({
              provider: providerId,
              id: row.id,
              model,
              draft: {
                id: row.id,
                label: row.label,
                enabled: row.enabled,
                key: row.key,
                masked: row.masked,
                base_url: row.base_url,
              },
              provider_draft: providerDraft,
            }),
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
    <div className="rounded-[20px] border border-[#223343] bg-[linear-gradient(180deg,#0b1219_0%,#080e14_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex flex-col gap-3 border-b border-[#172635] pb-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text)]">{row.label || "未命名账号"}</p>
            <AccountStateBadge state={scheduler?.state} schedulable={scheduler?.schedulable} enabled={row.enabled} />
            <Badge variant={hasOwnBaseUrl ? "accent" : "warn"}>{sourceLabel}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
            账号标签用于管理台识别；Key 与 Base URL 会在保存并重启后进入运行态调度。
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 xl:max-w-[380px] xl:justify-end">
          <Button variant="mini" onClick={onClone}>复制新增</Button>
          <Button variant="mini" onClick={copyBaseUrl}>复制上游地址</Button>
          <Button variant="mini" onClick={revealKey}>{revealed ? "隐藏" : "显示 key"}</Button>
          <Button variant="mini" onClick={copyKey}>复制 key</Button>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] xl:items-end">
        <Field label="账号标签">
          <div className="grid grid-cols-[auto_minmax(120px,1fr)] items-center gap-2">
            <label className="flex items-center gap-2 rounded-[12px] border border-[#1d3445] bg-[#090f15] px-2.5 py-2 text-xs text-[var(--color-muted)]">
              <input className="cursor-pointer" type="checkbox" checked={row.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
              启用
            </label>
            <Input className="min-w-0 text-sm" placeholder="primary / backup-cn" value={row.label} onChange={(e) => onChange({ label: e.target.value })} />
          </div>
        </Field>
        <Field label="Key">
          <Input
            className="min-w-0 font-mono text-xs"
            placeholder="sk-..."
            value={row.key}
            onChange={(e) => onChange({ key: e.target.value })}
          />
        </Field>
        <Field label="优先级" hint="数值越大优先级越高；留空表示默认（0）。">
          <Input
            type="number"
            min="0"
            className="min-w-0 text-sm"
            placeholder="0"
            value={row.priority === undefined ? "" : String(row.priority)}
            onChange={(e) => onChange({ priority: Number(e.target.value || 0) || 0 })}
          />
        </Field>
        <Field label="账号 Base URL" hint="留空会继承上面的默认 Base URL；填写后该账号单独走自己的上游地址。" className="xl:col-span-2">
          <Input
            className="min-w-0 font-mono text-xs"
            placeholder={defaultBaseUrl || "https://provider.example/v1"}
            value={row.base_url}
            onChange={(e) => onChange({ base_url: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-3 border-t border-[#172635] pt-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 flex-1 space-y-2 text-xs text-[var(--color-muted)]">
          <div className="flex flex-wrap items-center gap-2">
            <RuntimeStat label="成功" value={String(scheduler?.success_count ?? 0)} tone="good" />
            <RuntimeStat label="失败" value={String(scheduler?.failure_count ?? 0)} tone={(scheduler?.failure_count ?? 0) > 0 ? "bad" : "muted"} />
            <RuntimeStat label="并发" value={String(scheduler?.in_flight ?? 0)} tone="accent" />
            {scheduler?.cooldown_ms_remaining ? <RuntimeStat label="冷却" value={formatDuration(scheduler.cooldown_ms_remaining)} tone="warn" /> : null}
            {scheduler?.last_success_at ? <RuntimeStat label="最近成功" value={formatTime(scheduler.last_success_at)} tone="good" /> : null}
            {scheduler?.last_error_at ? <RuntimeStat label="最近失败" value={formatTime(scheduler.last_error_at)} tone="bad" /> : null}
          </div>
          <div className="rounded-[12px] border border-[#172635] bg-[#081019] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-weak)]" title={effectiveBaseUrl}>
            <span className="mr-2 text-[var(--color-muted)]">{sourceLabel}</span>
            <span className="break-all">{effectiveBaseUrl || "未配置 Base URL"}</span>
          </div>
          <div className="rounded-[12px] border border-[#172635] bg-[#081019] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
            <span className="mr-2 text-[var(--color-weak)]">优先级</span>
            <span>{Number(row.priority || 0) || 0}</span>
          </div>
          {scheduler?.last_error ? (
            <div className="rounded-[12px] border border-[rgba(248,113,113,0.2)] bg-[rgba(248,113,113,0.06)] px-3 py-2 text-[var(--color-bad)]">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#ffb0bc]">最近错误</p>
              <p title={scheduler.last_error} className="break-all leading-relaxed">
                {scheduler.last_status ? `HTTP ${scheduler.last_status}: ` : ""}
                {scheduler.last_error}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5 rounded-[16px] border border-[#172635] bg-[#081019] p-2.5 xl:max-w-[340px] xl:justify-end">
          <span className="w-full text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-weak)]">运行操作</span>
          <Button
            variant="mini"
            disabled={busy || (!row.id && !row.key.trim() && !row.masked.trim())}
            onClick={() => runKeyAction("test")}
          >
            测试
          </Button>
          <Button
            variant="mini"
            disabled={busy || row.enabled === false || scheduler?.state === "manual_disabled" || (!row.id && !row.key.trim() && !row.masked.trim())}
            onClick={() => runKeyAction("probe")}
          >
            探测
          </Button>
          <Button
            variant={scheduler?.state === "manual_disabled" ? "good" : "danger"}
            className="px-2 py-1 text-xs"
            disabled={busy || !row.id}
            onClick={() => runKeyAction("status", scheduler?.state === "manual_disabled")}
          >
            {scheduler?.state === "manual_disabled" ? "加入调度" : "禁用调度"}
          </Button>
          <Button variant="danger" className="px-2 py-1 text-xs" onClick={onRemove}>删除</Button>
        </div>
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

function RuntimeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "accent" | "muted";
}) {
  const className =
    tone === "good"
      ? "border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.08)] text-[var(--color-good)]"
      : tone === "warn"
        ? "border-[rgba(251,191,36,0.18)] bg-[rgba(251,191,36,0.08)] text-[var(--color-warn)]"
        : tone === "bad"
          ? "border-[rgba(248,113,113,0.18)] bg-[rgba(248,113,113,0.08)] text-[var(--color-bad)]"
          : tone === "accent"
            ? "border-[rgba(61,214,198,0.18)] bg-[rgba(61,214,198,0.08)] text-[var(--color-flow)]"
            : "border-[#182736] bg-[#0a131b] text-[var(--color-muted)]";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] leading-none ${className}`}>
      <span className="text-[var(--color-weak)]">{label}</span>
      <span>{value}</span>
    </span>
  );
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

async function testProvider(id: ProviderId, models: string, draft: ConfigPayload["providers"][ProviderId]) {
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
          draft,
        }),
      },
    );
    toast.success(r.ok ? "账号池测试成功" : "账号池测试未通过");
  } catch {
    toast.error("账号池测试失败");
  }
}
