import { CheckList } from "@/components/common/CheckList";
import { Field } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useConfig } from "@/context/ConfigContext";

export function AuthPage() {
  const { form, setInbound, validateAuth } = useConfig();

  return (
    <div>
      <PageHeader
        step="03"
        title="入站鉴权"
        hint="这里是客户端或前置代理调用 ModelFlux 的 key，不是供应商原始 key。"
      />
      <Section>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="PROXY_AUTH_KEY">
            <Input
              value={form.proxyAuth}
              onChange={(e) => setInbound({ proxyAuth: e.target.value })}
              placeholder="客户端 / 前置代理调 ModelFlux 的 key"
            />
          </Field>
          <Field label="ADMIN_AUTH_KEY（可选）">
            <Input
              value={form.adminAuth}
              onChange={(e) => setInbound({ adminAuth: e.target.value })}
              placeholder="留空 = 仅依赖 127.0.0.1"
            />
          </Field>
        </div>
        <Field label="PROXY_KEYS（高级：key:provider,key:*）" className="mt-3">
          <Textarea value={form.proxyKeys} onChange={(e) => setInbound({ proxyKeys: e.target.value })} rows={4} />
        </Field>
        <div className="mt-3">
          <CheckList items={validateAuth()} />
        </div>
      </Section>
    </div>
  );
}
