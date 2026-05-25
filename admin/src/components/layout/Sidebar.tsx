import {
  Boxes,
  GitBranch,
  LayoutDashboard,
  Plug,
  Server,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FluxLogo } from "@/components/brand/FluxLogo";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { HealthPayload } from "@/types/config";

const configLinks = [
  { to: "/", label: "总览", icon: LayoutDashboard, end: true },
  { to: "/providers", label: "账号池", icon: Server },
  { to: "/routing", label: "模型路由", icon: GitBranch },
  { to: "/auth", label: "鉴权", icon: Shield },
];

const deliveryLinks = [
  { to: "/integration", label: "接入", icon: Plug },
  { to: "/ops", label: "运维", icon: SlidersHorizontal },
  { to: "/models", label: "模型目录", icon: Boxes },
];

export function Sidebar() {
  const { data: health } = useQuery({
    queryKey: ["sidebar-health"],
    queryFn: () => api<HealthPayload>("/health"),
    refetchInterval: 20_000,
  });

  const online = health?.status === "ok";

  return (
    <aside className="relative z-10 flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-[var(--color-line)] bg-[rgba(8,11,16,0.85)] backdrop-blur-xl">
      <div className="border-b border-[var(--color-line)] p-4">
        <div className="flex items-center gap-3">
          <FluxLogo />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">model-flux</p>
            <p className="text-[11px] text-[var(--color-muted)]">本地模型流量路由控制台</p>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-auto p-3">
        <SectionLabel>配置</SectionLabel>
        {configLinks.map((link) => (
          <NavItem key={link.to} {...link} />
        ))}
        <SectionLabel className="mt-4">交付</SectionLabel>
        {deliveryLinks.map((link) => (
          <NavItem key={link.to} {...link} />
        ))}
      </nav>

      <div className="border-t border-[var(--color-line)] p-3">
        <div className="glass-panel rounded-[12px] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                online ? "status-live bg-[var(--color-good)]" : "bg-[var(--color-warn)]",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{online ? "ModelFlux 在线" : "连接中…"}</p>
              <p className="truncate font-mono text-[10px] text-[var(--color-muted)]">
                {health?.default_provider ? `默认 · ${health.default_provider}` : "127.0.0.1:19090"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-weak)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-sm font-medium transition",
          isActive
            ? "bg-[rgba(232,163,23,0.12)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_rgba(232,163,23,0.25)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]",
        )
      }
    >
      <Icon className="size-4 shrink-0 opacity-80" />
      {label}
    </NavLink>
  );
}
