import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
  {
    variants: {
      variant: {
        good: "bg-[rgba(73,211,142,0.14)] text-[#85efb7]",
        bad: "bg-[rgba(255,101,122,0.13)] text-[#ff9aaa]",
        warn: "bg-[rgba(255,209,102,0.12)] text-[#ffdc83]",
        accent: "bg-[var(--color-accent)] text-[#111]",
      },
    },
    defaultVariants: { variant: "good" },
  },
);

export function Badge({
  className,
  variant,
  children,
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>;
}
