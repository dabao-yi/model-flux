import { providerMeta } from "@/lib/providers";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/ui/card";
import { useConfig } from "@/context/ConfigContext";

export function ModelsPage() {
  const { snapshot } = useConfig();
  const models = snapshot?.runtime?.models || [];

  return (
    <div className="space-y-4">
      <PageHeader
        step="06"
        title="运行时模型"
        hint="当前 ModelFlux 暴露给客户端 / 前置代理的模型目录。带 alias 的条目会映射到真实上游模型。"
      />
      <Section>
        {models.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => {
              const meta = providerMeta(m.owned_by || "");
              return (
                <div
                  key={m.id}
                  title={m.alias_of ? `${m.id} → ${m.alias_of}` : m.id}
                  className="flex items-center gap-3 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] px-3 py-2.5 transition hover:border-[var(--color-line-strong)]"
                  style={{ borderLeftWidth: 3, borderLeftColor: meta?.accent ?? "var(--color-accent)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-medium">{m.id}</p>
                    <p className="truncate text-[11px] text-[var(--color-muted)]">
                      {m.owned_by}
                      {m.alias_of ? ` → ${m.alias_of}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-[12px] border border-dashed border-[var(--color-line)] py-8 text-center text-sm text-[var(--color-warn)]">
            当前运行时没有可用模型，请先配置账号池并重启 ModelFlux
          </p>
        )}
      </Section>
    </div>
  );
}
