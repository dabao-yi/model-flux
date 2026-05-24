import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-[12px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-weak)] outline-none transition focus:border-[var(--color-flow)]/50 focus:shadow-[0_0_0_3px_var(--color-flow-dim)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
