import { Save, RotateCw, Zap } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/context/ConfigContext";
import { cn } from "@/lib/utils";

const titles: Record<string, string> = {
  "/": "总览",
  "/providers": "账号池",
  "/routing": "模型路由",
  "/auth": "入站鉴权",
  "/integration": "接入说明",
  "/ops": "保存与验证",
  "/models": "运行时模型",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] || "控制台";
  const { stateLabel, dirty, restartPending, validationBad, saveConfig, restartFlux, saveAndRestart } =
    useConfig();

  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[rgba(7,9,13,0.82)] px-6 py-3.5 backdrop-blur-xl">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-weak)]">ModelFlux Console</p>
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <span
          className={cn(
            "hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:inline-flex",
            dirty || restartPending
              ? "border-[var(--color-warn)]/30 bg-[rgba(251,191,36,0.08)] text-[var(--color-warn)]"
              : "border-[var(--color-good)]/25 bg-[rgba(52,211,153,0.08)] text-[var(--color-good)]",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              dirty || restartPending ? "bg-[var(--color-warn)]" : "status-live bg-[var(--color-good)]",
            )}
          />
          {stateLabel}
        </span>

        <Button variant="ghost" className="hidden sm:inline-flex" disabled={validationBad} onClick={() => saveConfig()}>
          <Save className="size-3.5" />
          保存
        </Button>
        <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => restartFlux()}>
          <RotateCw className="size-3.5" />
          重启
        </Button>
        <Button variant="primary" disabled={validationBad} onClick={() => saveAndRestart()}>
          <Zap className="size-3.5" />
          <span className="hidden sm:inline">保存并重启</span>
          <span className="sm:hidden">部署</span>
        </Button>
      </div>
    </header>
  );
}
