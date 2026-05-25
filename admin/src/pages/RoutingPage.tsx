import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { CheckList } from "@/components/common/CheckList";
import { Field } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { useConfig } from "@/context/ConfigContext";
import { api } from "@/lib/api";
import { PROVIDERS, providerMeta } from "@/lib/providers";
import { REASON_LABELS } from "@/lib/aliases";
import { normModel } from "@/lib/utils";
import type { ProviderId, RoutePreview } from "@/types/config";

const providerOptions = [
  ...PROVIDERS.map((p) => ({ value: p.id, label: p.title })),
];
const defaultOptions = [
  { value: "mimo", label: "mimo" },
  { value: "deepseek", label: "deepseek" },
  { value: "compat", label: "compat" },
  { value: "openai", label: "openai" },
  { value: "", label: "auto" },
];

type AliasDraft = {
  from: string;
  provider: ProviderId;
  upstream_model: string;
};

const emptyDraft: AliasDraft = { from: "", provider: "mimo", upstream_model: "" };

export function RoutingPage() {
  const cfg = useConfig();
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<AliasDraft>(emptyDraft);
  const [editingKey, setEditingKey] = useState("");
  const [editDraft, setEditDraft] = useState<AliasDraft>(emptyDraft);
  const [previewKey, setPreviewKey] = useState("");
  const [previewModel, setPreviewModel] = useState("");

  const routeQuery = useQuery({
    queryKey: ["route-preview", previewModel],
    enabled: Boolean(previewModel.trim()),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: () =>
      api<RoutePreview>("/admin/api/route", {
        method: "POST",
        body: JSON.stringify({ model: previewModel.trim() }),
      }),
  });

  const hasAlias = (from: string, except = "") => {
    const key = normModel(from);
    const exceptKey = normModel(except);
    return cfg.aliasRows.some((row) => normModel(row.from) === key && normModel(row.from) !== exceptKey);
  };

  const openAdd = () => {
    setEditingKey("");
    setPreviewKey("");
    setEditDraft(emptyDraft);
    setAddDraft({ ...emptyDraft, provider: (cfg.form.defaultProvider as ProviderId) || "mimo" });
    setAddOpen(true);
  };

  const startInlineEdit = (row: { from: string; provider: string; upstream_model: string }) => {
    setAddOpen(false);
    setPreviewKey("");
    setEditingKey(normModel(row.from));
    setEditDraft({
      from: row.from,
      provider: row.provider as ProviderId,
      upstream_model: row.upstream_model,
    });
  };

  const saveInlineEdit = (originalFrom: string) => {
    const error = validateDraft(editDraft, hasAlias(editDraft.from, originalFrom));
    if (error) {
      toast.error(error);
      return;
    }
    cfg.addOrUpdateAlias(editDraft, originalFrom);
    const nextKey = normModel(editDraft.from);
    setPreviewKey(nextKey);
    setPreviewModel(editDraft.from);
    cfg.setRouteProbe(editDraft.from);
    setEditingKey("");
    setEditDraft(emptyDraft);
    toast.success("映射已更新，保存并重启后生效");
  };

  const saveAdd = () => {
    const error = validateDraft(addDraft, hasAlias(addDraft.from));
    if (error) {
      toast.error(error);
      return;
    }
    cfg.addOrUpdateAlias(addDraft);
    setPreviewKey(normModel(addDraft.from));
    setPreviewModel(addDraft.from);
    cfg.setRouteProbe(addDraft.from);
    setAddOpen(false);
    setAddDraft(emptyDraft);
    toast.success("映射已加入草稿，保存并重启后生效");
  };

  const previewRow = (from: string) => {
    setPreviewKey(normModel(from));
    setPreviewModel(from);
    cfg.setRouteProbe(from);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        step="02"
        title="模型路由"
        hint="把客户端请求的模型名，明确映射到某个账号池和真实上游模型；预览会直接展开在当前行下方，不会再把结果丢到页面底部。"
        actions={
          <Button variant="primary" onClick={openAdd}>
            <Plus className="size-4" />
            新增映射
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["1", "先看明确映射", "如 gpt-5.5 = mimo:mimo-v2-pro"],
          ["2", "再看真实模型直连", "请求模型在账号池 Models 里则直连"],
          ["3", "最后走默认账号池", "未命中时走 DEFAULT_PROVIDER"],
        ].map(([no, title, desc]) => (
          <div
            key={no}
            className="relative rounded-[20px] border border-[#223343] bg-[linear-gradient(180deg,rgba(11,20,29,0.96),rgba(8,16,24,0.88))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
          >
            <b className="flex items-center gap-2 text-sm">
              <span className="inline-grid size-7 place-items-center rounded-full bg-[var(--color-accent)] text-xs font-black text-[#111] shadow-[0_8px_18px_rgba(232,163,23,0.22)]">
                {no}
              </span>
              {title}
            </b>
            <span className="mt-2.5 block text-xs leading-relaxed text-[var(--color-muted)]">{desc}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="默认兜底" value={cfg.form.defaultProvider || "auto"} />
        <SummaryCard label="明确映射数" value={`${cfg.aliasRows.length} 条`} />
        <SummaryCard label="OpenAI 前缀" value={cfg.form.openaiPrefixes || "-"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="DEFAULT_PROVIDER（未命中时的兜底账号池）" hint="只有在明确映射和真实模型直连都未命中时，才会走这里。">
          <Select
            value={cfg.form.defaultProvider || ""}
            onValueChange={(v) => cfg.setRouting({ defaultProvider: v })}
            options={defaultOptions}
          />
        </Field>
        <Field label="OPENAI_MODEL_PREFIXES" hint="用于辅助识别 OpenAI 风格模型名前缀；多个前缀用逗号分隔。">
          <Input
            value={cfg.form.openaiPrefixes}
            onChange={(e) => cfg.setRouting({ openaiPrefixes: e.target.value })}
            placeholder="gpt-,o1,o3,o4,codex-,chatgpt-"
          />
        </Field>
      </div>

      <Section className="overflow-hidden">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">映射规则表</h3>
              <span className="rounded-full border border-[rgba(61,214,198,0.24)] bg-[rgba(61,214,198,0.08)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-flow)]">
                MODEL_ALIASES
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              一行就是一条路由链路；点“预览”会直接在当前行下方展开命中结果，点“编辑”直接在当前行修改；新增则统一走弹窗。
            </p>
          </div>
          <Button variant="mini" onClick={openAdd}>
            <Plus className="size-3.5" />
            新增映射
          </Button>
        </div>
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <RouteGuide
            title="预览"
            desc="直接展开在当前行下方，方便边看命中结果边调整映射。"
            tone="flow"
          />
          <RouteGuide
            title="编辑"
            desc="已有规则直接行内改，避免新增与编辑同时占用视线。"
            tone="accent"
          />
          <RouteGuide
            title="新增"
            desc="只在弹窗里创建新规则，保持映射表本身干净稳定。"
            tone="muted"
          />
        </div>
        {cfg.aliasRows.length === 0 ? (
          <EmptyAliasState onAdd={openAdd} />
        ) : (
          <div className="overflow-hidden rounded-[24px] border border-[#223343] bg-[linear-gradient(180deg,rgba(7,16,25,0.9),rgba(5,11,16,0.84))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="hidden grid-cols-[1fr_0.72fr_1.15fr_120px_220px] gap-2 border-b border-[#1b2a38] bg-[linear-gradient(90deg,rgba(232,163,23,0.09),rgba(61,214,198,0.06),transparent)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-weak)] lg:grid">
              <span>客户端模型</span>
              <span>账号池</span>
              <span>上游模型</span>
              <span>状态</span>
              <span className="text-right">操作</span>
            </div>
            <div className="grid gap-3 p-3">
              {cfg.aliasRows.map((row) => {
                const rowKey = normModel(row.from);
                const editing = editingKey === rowKey;
                const selected = previewKey === rowKey;
                const draft = editing ? editDraft : { from: row.from, provider: row.provider as ProviderId, upstream_model: row.upstream_model };
                const st = cfg.aliasStatus(row);
                const meta = providerMeta(draft.provider);
                return (
                  <div key={row.from} className="grid gap-2">
                    <div
                      className={`group relative grid gap-3 overflow-hidden rounded-[20px] border p-4 transition-all lg:grid-cols-[1fr_0.72fr_1.15fr_120px_220px] lg:items-center ${
                        editing
                          ? "border-[rgba(232,163,23,0.45)] bg-[linear-gradient(90deg,rgba(232,163,23,0.12),rgba(11,18,25,0.96))] shadow-[0_0_0_1px_rgba(232,163,23,0.16),0_16px_30px_rgba(0,0,0,0.18)]"
                          : selected
                            ? "border-[rgba(61,214,198,0.45)] bg-[linear-gradient(90deg,rgba(61,214,198,0.12),rgba(11,18,25,0.96))] shadow-[0_0_26px_rgba(61,214,198,0.08)]"
                            : "border-[#172635] bg-[#0b1219] hover:border-[#2a4154] hover:bg-[#0e1822] hover:shadow-[0_14px_26px_rgba(0,0,0,0.14)]"
                      }`}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full opacity-90"
                        style={{ backgroundColor: meta?.accent || "var(--color-accent)" }}
                      />
                      <EditableCell label="客户端模型">
                        {editing ? (
                          <Input
                            value={draft.from}
                            onChange={(e) => setEditDraft((d) => ({ ...d, from: e.target.value }))}
                            placeholder="例如 gpt-5.5"
                            className="py-2"
                          />
                        ) : (
                          <div className="min-w-0 pl-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <b className="block truncate font-mono text-sm text-[var(--color-text)]">{row.from}</b>
                              {selected ? <Badge variant="good">当前预览</Badge> : null}
                            </div>
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#263746] bg-[#071019] px-2 py-0.5 text-[10px] tracking-wide text-[var(--color-muted)]">
                              Client model
                            </span>
                          </div>
                        )}
                      </EditableCell>
                      <EditableCell label="账号池">
                        {editing ? (
                          <Select
                            value={draft.provider}
                            onValueChange={(v) => setEditDraft((d) => ({ ...d, provider: v as ProviderId, upstream_model: "" }))}
                            options={providerOptions}
                            className="py-2"
                          />
                        ) : (
                          <div className="min-w-0">
                            <b className="block truncate text-sm" style={{ color: meta?.accent }}>
                              {meta?.title || row.provider}
                            </b>
                            <span className="text-[11px] text-[var(--color-weak)]">{row.provider}</span>
                          </div>
                        )}
                      </EditableCell>
                      <EditableCell label="上游模型">
                        {editing ? (
                          <ModelPicker
                            provider={draft.provider}
                            value={draft.upstream_model}
                            onChange={(upstream_model) => setEditDraft((d) => ({ ...d, upstream_model }))}
                          />
                        ) : (
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="hidden shrink-0 text-[var(--color-flow)]/70 md:block">→</span>
                            <b className="block truncate font-mono text-sm">{row.upstream_model}</b>
                          </div>
                        )}
                      </EditableCell>
                      <EditableCell label="状态">
                        <Badge variant={st[0]}>{st[1]}</Badge>
                      </EditableCell>
                      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                        {editing ? (
                          <>
                            <Button variant="good" className="px-2.5 py-1.5 text-xs" onClick={() => saveInlineEdit(row.from)}>
                              <Check className="size-3.5" />
                              保存
                            </Button>
                            <Button
                              variant="ghost"
                              className="px-2.5 py-1.5 text-xs"
                              onClick={() => {
                                setEditingKey("");
                                setEditDraft(emptyDraft);
                              }}
                            >
                              <X className="size-3.5" />
                              取消
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant={selected ? "good" : "mini"}
                              className={selected ? "px-2.5 py-1 text-xs shadow-[0_0_0_1px_rgba(52,211,153,0.18)]" : undefined}
                              onClick={() => (selected ? setPreviewKey("") : previewRow(row.from))}
                            >
                              {selected ? "收起预览" : "预览"}
                              <ChevronDown className={`size-3.5 transition ${selected ? "rotate-180" : ""}`} />
                            </Button>
                            <Button variant="mini" onClick={() => startInlineEdit(row)}>
                              <Pencil className="size-3.5" />
                              编辑
                            </Button>
                            <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => cfg.deleteAlias(row.from)}>
                              <Trash2 className="size-3.5" />
                              删除
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {selected ? (
                      <RoutePreviewPanel probe={previewModel} query={routeQuery} compact />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {(cfg.aliasParse.invalid.length > 0 || cfg.aliasParse.duplicates.length > 0) && (
          <div className="mt-3">
            <CheckList
              items={[
                ...(cfg.aliasParse.invalid.length
                  ? [["warn", `高级配置中有 ${cfg.aliasParse.invalid.length} 条无法解析`] as ["warn", string]]
                  : []),
                ...(cfg.aliasParse.duplicates.length
                  ? [["warn", `发现 ${cfg.aliasParse.duplicates.length} 条重复客户端模型名`] as ["warn", string]]
                  : []),
              ]}
            />
          </div>
        )}
      </Section>

      <details className="rounded-[20px] border border-[#263746] bg-[#091018] p-4">
        <summary className="cursor-pointer font-bold text-[#c6d5df]">高级：直接编辑 MODEL_ALIASES 原始配置</summary>
        <Field label="MODEL_ALIASES" className="mt-3">
          <Textarea
            value={cfg.form.modelAliases}
            onChange={(e) => {
              cfg.setRouting({ modelAliases: e.target.value });
              cfg.setEditingAliasKey("");
              setEditingKey("");
            }}
            placeholder="gpt-5.5=mimo:mimo-v2-pro"
            rows={6}
          />
        </Field>
      </details>

      <AddAliasDialog
        open={addOpen}
        draft={addDraft}
        onDraftChange={setAddDraft}
        onOpenChange={setAddOpen}
        onSubmit={saveAdd}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-[#223343] bg-[linear-gradient(180deg,rgba(9,16,24,0.95),rgba(7,12,18,0.88))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <label className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-weak)]">{label}</label>
      <strong className="mt-2 block truncate text-[22px] font-semibold leading-none text-[var(--color-text)]">{value}</strong>
    </div>
  );
}

function RouteGuide({
  title,
  desc,
  tone,
}: {
  title: string;
  desc: string;
  tone: "flow" | "accent" | "muted";
}) {
  const style =
    tone === "flow"
      ? "border-[rgba(61,214,198,0.22)] bg-[linear-gradient(180deg,rgba(61,214,198,0.09),rgba(8,16,24,0.92))]"
      : tone === "accent"
        ? "border-[rgba(232,163,23,0.22)] bg-[linear-gradient(180deg,rgba(232,163,23,0.08),rgba(8,16,24,0.92))]"
        : "border-[#1b2a38] bg-[linear-gradient(180deg,rgba(11,18,25,0.96),rgba(8,13,19,0.92))]";
  return (
    <div className={`rounded-[18px] border px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${style}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-weak)]">{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">{desc}</p>
    </div>
  );
}

function EmptyAliasState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-[18px] border border-dashed border-[#33485d] bg-[#071019] p-8 text-center">
      <p className="text-sm font-semibold text-[var(--color-text)]">还没有明确映射</p>
      <p className="mt-2 text-sm text-[var(--color-muted)]">建议先添加 gpt-5.5 → MIMO → mimo-v2-pro，然后保存并重启。</p>
      <Button variant="primary" className="mt-4" onClick={onAdd}>
        <Plus className="size-4" />
        新增第一条映射
      </Button>
    </div>
  );
}

function EditableCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-weak)] lg:hidden">{label}</span>
      {children}
    </div>
  );
}

function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: ProviderId;
  value: string;
  onChange: (value: string) => void;
}) {
  const cfg = useConfig();
  const models = cfg.modelsForProvider(provider);
  const matchedModel = models.find((model) => normModel(model) === normModel(value)) || "";
  const options = [
    { value: "", label: models.length ? "从已配置 Models 中选择" : "暂无已配置模型，可手动输入" },
    ...models.map((model) => ({ value: model, label: model })),
  ];
  return (
    <div className="grid gap-2">
      <Select
        value={matchedModel}
        onValueChange={(model) => {
          if (model) onChange(model);
        }}
        options={options}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="或直接输入自定义上游模型"
        className="py-2 font-mono"
      />
      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
        下拉会始终展示当前账号池下已配置的全部模型，不需要先清空输入框；下面这一行用于手动覆盖成自定义上游模型。
      </p>
    </div>
  );
}

function AddAliasDialog({
  open,
  draft,
  onDraftChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  draft: AliasDraft;
  onDraftChange: React.Dispatch<React.SetStateAction<AliasDraft>>;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const cfg = useConfig();
  const models = useMemo(() => cfg.modelsForProvider(draft.provider), [cfg, draft.provider]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新增模型映射"
      description="新增只负责创建一条明确映射；已有映射请直接在列表行内编辑。"
    >
      <div className="space-y-4">
        <Field label="客户端模型名">
          <Input
            value={draft.from}
            onChange={(e) => onDraftChange((d) => ({ ...d, from: e.target.value }))}
            placeholder="例如 gpt-5.5"
          />
        </Field>
        <Field label="账号池">
          <Select
            value={draft.provider}
            onValueChange={(v) => onDraftChange((d) => ({ ...d, provider: v as ProviderId, upstream_model: "" }))}
            options={providerOptions}
          />
        </Field>
        <Field label="上游模型">
          <ModelPicker
            provider={draft.provider}
            value={draft.upstream_model}
            onChange={(upstream_model) => onDraftChange((d) => ({ ...d, upstream_model }))}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="mini"
              onClick={async () => {
                try {
                  const r = await cfg.discoverModels(draft.provider);
                  toast.message(r.models?.length ? `已发现 ${r.models.length} 个模型` : "未发现模型，可手动输入");
                } catch {
                  toast.error("刷新上游模型失败");
                }
              }}
            >
              <RotateCw className="size-3.5" />
              刷新上游模型
            </Button>
            {models[0] ? (
              <Button variant="mini" onClick={() => onDraftChange((d) => ({ ...d, upstream_model: models[0] }))}>
                使用 {models[0]}
              </Button>
            ) : null}
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={onSubmit}>
            <Plus className="size-4" />
            添加映射
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RoutePreviewPanel({
  probe,
  query,
  compact = false,
}: {
  probe: string;
  query: { isFetching: boolean; isPlaceholderData?: boolean; data?: RoutePreview; error: Error | null };
  compact?: boolean;
}) {
  const loadingFresh = query.isFetching && !query.data;
  const updating = query.isFetching && !!query.data;
  return (
    <div
      className={`overflow-hidden rounded-[22px] border border-[rgba(61,214,198,0.26)] bg-[radial-gradient(circle_at_0%_0%,rgba(61,214,198,0.14),transparent_34%),#060a0e] shadow-[0_14px_34px_rgba(0,0,0,0.22)] ${
        compact ? "mx-1 animate-fade-in" : "min-h-[152px]"
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#142434] px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-weak)]">
            {compact ? "Inline Route Preview" : "Route Preview"}
          </p>
          <p className="mt-1 font-mono text-sm text-[var(--color-flow)]">{probe.trim() || "等待输入模型名"}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] ${
            updating || loadingFresh
              ? "border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.08)] text-[var(--color-warn)]"
              : "border-[rgba(52,211,153,0.30)] bg-[rgba(52,211,153,0.08)] text-[var(--color-good)]"
          }`}
        >
          {updating ? "更新中" : loadingFresh ? "查询中" : "稳定"}
        </span>
      </div>
      <div className="max-h-[330px] overflow-auto p-4 font-mono text-xs leading-relaxed text-[#a8b9c7]">
        <RoutePreviewBody probe={probe} query={query} />
      </div>
    </div>
  );
}

function RoutePreviewBody({
  probe,
  query,
}: {
  probe: string;
  query: { isFetching: boolean; isPlaceholderData?: boolean; data?: RoutePreview; error: Error | null };
}) {
  if (!probe.trim()) return <span className="text-[var(--color-muted)]">等待输入模型名，或点击映射规则表中的“预览”。</span>;
  if (query.isFetching && !query.data) return <span className="text-[var(--color-warn)]">正在查询服务端路由...</span>;
  if (query.error) return <span className="text-[var(--color-bad)]">路由预览失败：{String(query.error.message)}</span>;
  const d = query.data;
  if (!d) return <span className="text-[var(--color-muted)]">无数据</span>;
  const reasonText = REASON_LABELS[d.reason || ""] || d.reason || "-";
  const providerTitle = providerMeta(d.provider || "")?.title || d.provider;
  return (
    <div className="grid gap-2">
      <PreviewLine label="请求模型" value={d.requested_model || probe} />
      <PreviewLine label="命中规则" value={`${d.reason}（${reasonText}）`} />
      <PreviewLine label="路由账号池" value={`${providerTitle} (${d.provider})`} />
      <PreviewLine label="上游模型" value={d.upstream_model || "-"} emphasis />
      {query.isPlaceholderData ? (
        <p className="pt-1 text-[var(--color-warn)]">正在获取当前映射结果，先保留上一条稳定结果。</p>
      ) : query.isFetching ? (
        <p className="pt-1 text-[var(--color-warn)]">正在后台刷新，先保留当前稳定结果。</p>
      ) : null}
      <p className="pt-1 text-[var(--color-weak)]">来自服务端 /admin/api/route，反映当前运行配置。</p>
    </div>
  );
}

function PreviewLine({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="grid gap-1 rounded-[14px] border border-[#132333] bg-[linear-gradient(180deg,rgba(8,16,24,0.95),rgba(7,13,18,0.9))] px-3 py-2.5 sm:grid-cols-[92px_1fr]">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-weak)]">{label}</span>
      <span className={`min-w-0 break-words ${emphasis ? "text-[var(--color-flow)]" : "text-[#d4e0ea]"}`}>{value}</span>
    </div>
  );
}

function validateDraft(draft: AliasDraft, duplicate: boolean) {
  if (!draft.from.trim()) return "请填写客户端模型名";
  if (!draft.upstream_model.trim()) return "请填写上游模型";
  if (!draft.provider) return "请选择账号池";
  if (duplicate) return "客户端模型名已存在，请直接编辑现有行";
  return "";
}
