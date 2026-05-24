import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[12px] border text-sm font-medium transition-all duration-200 enabled:cursor-pointer enabled:hover:-translate-y-px enabled:active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-hover)]",
        primary:
          "border-0 bg-gradient-to-r from-[#e8a317] to-[#d49212] font-semibold text-[#0a0c10] shadow-[0_4px_20px_rgba(232,163,23,0.25)] hover:shadow-[0_6px_28px_rgba(232,163,23,0.35)]",
        good: "border-[rgba(52,211,153,0.35)] bg-[rgba(52,211,153,0.1)] text-[var(--color-good)]",
        danger: "border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.08)] text-[var(--color-bad)]",
        ghost: "border-transparent bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]",
        mini: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant }), "px-3.5 py-2", className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
