import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[86px] w-full resize-y rounded-[14px] border border-[#263746] bg-[#080d13] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[#6091bd] focus:shadow-[0_0_0_3px_rgba(100,199,255,0.1)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
