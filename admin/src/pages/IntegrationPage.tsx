import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Box, Copy, Monitor } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/card";
import { api } from "@/lib/api";
import { copyText } from "@/lib/utils";
import type { IntegrationSnapshot } from "@/types/config";

const CARD_ACCENTS: Record<string, string> = {
  direct_model_flux: "#3dd6c6",
  cliproxyapi_to_flux: "#60a5fa",
  sub2api_to_flux: "#e8a317",
  generic_client_to_flux: "#a78bfa",
};

const LOCAL_ITEMS = ["direct_model_flux", "cliproxyapi_to_flux", "generic_client_to_flux"] as const;
const CONTAINER_ITEMS = ["sub2api_to_flux"] as const;

export function IntegrationPage() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["integration"],
    queryFn: () => api<IntegrationSnapshot>("/admin/api/integration"),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        step="04"
        title="接入说明"
        hint="先判断调用方运行在哪里：宿主机 / 本机进程用本机地址；Docker 容器内进程只有在同一 Docker network 且绕过 HTTP_PROXY 时才用服务名。"
        actions={
          <Button variant="mini" onClick={() => refetch()} disabled={isFetching}>
            刷新
          </Button>
        }
      />
      <Section className="mb-4 overflow-hidden">
        <div className="grid gap-4 lg:grid-cols-2">
          <EndpointGuide
            icon={<Monitor className="size-5" />}
            title="宿主机 / 本机进程接入"
            base={data?.items?.direct_model_flux?.base_url || "http://127.0.0.1:19090/v1"}
            examples={["Codex 直接接入", "本机 CLIProxyAPI", "本机 CPA / curl / SDK"]}
            warning="本机进程可以用 127.0.0.1；但 Docker 容器里的 127.0.0.1 指的是容器自己，不是 ModelFlux。"
          />
          <EndpointGuide
            icon={<Box className="size-5" />}
            title="Docker 容器内接入"
            base={data?.items?.sub2api_to_flux?.base_url || "http://model-flux:19090/v1"}
            examples={["同一个 Docker Compose 内的 sub2api", "同一个 Docker network 内的代理服务", "已把 model-flux 加入 NO_PROXY 的容器"]}
            warning="服务名只在同一 Docker network 内可解析；如果容器配置了 HTTP_PROXY，请把 model-flux 加入 NO_PROXY/no_proxy；这个本地上游账号也不要绑定代理，否则可能 502。"
          />
        </div>
        <div className="mt-4 rounded-[16px] border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.07)] p-3 text-sm leading-relaxed text-[#ffd98a]">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              判断规则：谁发起请求，就站在谁的运行环境看地址。本机程序访问 ModelFlux 用
              <code className="mx-1 font-mono">127.0.0.1:19090</code>
              ；容器内程序访问 ModelFlux 用
              <code className="mx-1 font-mono">model-flux:19090</code>
              或你在 compose/network 里的服务名，并确认两个容器在同一网络且服务名没有走 HTTP_PROXY。
            </p>
          </div>
        </div>
      </Section>

      <IntegrationGroup
        title="本机 / 宿主机接入配置"
        subtitle="这些配置复制给运行在 Mac/宿主机上的 Codex、CLIProxyAPI、CPA、curl 或 SDK。"
        keys={LOCAL_ITEMS}
        items={data?.items}
      />
      <IntegrationGroup
        title="容器内接入配置"
        subtitle="这些配置复制给和 ModelFlux 同处 Docker Compose / Docker network 的服务；如果是独立 compose 栈，需要先把 ModelFlux 接入对方网络并在调用方 NO_PROXY 中加入 model-flux。"
        keys={CONTAINER_ITEMS}
        items={data?.items}
      />
    </div>
  );
}

function EndpointGuide({
  icon,
  title,
  base,
  examples,
  warning,
}: {
  icon: React.ReactNode;
  title: string;
  base: string;
  examples: string[];
  warning: string;
}) {
  return (
    <div className="rounded-[18px] border border-[#223343] bg-[#081018] p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] text-[var(--color-flow)]">
          {icon}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <CopyLine label="base" display={base} onCopy={() => copyField(base, `${title} base_url`)} />
      <div className="mt-3 flex flex-wrap gap-2">
        {examples.map((x) => (
          <span key={x} className="rounded-full border border-[#263746] bg-[#0b1219] px-2.5 py-1 text-xs text-[var(--color-muted)]">
            {x}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-warn)]">{warning}</p>
    </div>
  );
}

function IntegrationGroup({
  title,
  subtitle,
  keys,
  items,
}: {
  title: string;
  subtitle: string;
  keys: readonly string[];
  items?: IntegrationSnapshot["items"];
}) {
  return (
    <Section className="mb-4">
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {keys.map((key) => {
          const item = items?.[key];
          if (!item) return null;
          return <IntegrationCard key={key} item={item} accent={CARD_ACCENTS[key] ?? "var(--color-accent)"} />;
        })}
      </div>
    </Section>
  );
}

function IntegrationCard({ item, accent }: { item: IntegrationSnapshot["items"][string]; accent: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[18px] border border-[var(--color-line)] bg-[#081018] p-4" style={{ borderTopWidth: 3, borderTopColor: accent, borderTopStyle: "solid" }}>
      <h3 className="font-semibold">{item.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--color-muted)]">{item.note}</p>
      <CopyLine label="base" display={item.base_url || "-"} onCopy={() => copyField(item.base_url, `${item.title} base`)} />
      <CopyLine
        label="key"
        display={item.api_key_masked || "未配置"}
        onCopy={() => copyField(item.api_key, `${item.title} key`)}
      />
      <CopyLine label="model" display={item.model || "-"} onCopy={() => copyField(item.model, `${item.title} model`)} />
      <Button variant="primary" className="mt-4 w-full" onClick={() => copyField(item.snippet, `${item.title} 完整配置`)}>
        <Copy className="size-4" />
        复制完整配置
      </Button>
    </div>
  );
}

function CopyLine({ label, display, onCopy }: { label: string; display: string; onCopy: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] p-2">
      <span className="w-10 shrink-0 text-[10px] font-semibold uppercase text-[var(--color-weak)]">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-muted)]">{display}</code>
      <Button variant="mini" onClick={onCopy}>
        复制
      </Button>
    </div>
  );
}

async function copyField(value: string | undefined, label: string) {
  try {
    await copyText(value || "", label);
    toast.success(`已复制 ${label}`);
  } catch {
    toast.error(`${label} 不存在`);
  }
}
