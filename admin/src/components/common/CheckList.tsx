import { cn } from "@/lib/utils";

export type CheckTone = "good" | "warn" | "bad";

export function CheckList({ items }: { items: [CheckTone, string][] }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-2">
      {items.map(([tone, text], i) => (
        <div
          key={i}
          className={cn(
            "rounded-[14px] border px-3 py-2.5 text-xs leading-relaxed break-words",
            tone === "good" && "border-[#245b43] text-[#8cf0bd]",
            tone === "warn" && "border-[#70551c] text-[#ffd98a]",
            tone === "bad" && "border-[#66313c] text-[#ff9aaa]",
          )}
        >
          {text}
        </div>
      ))}
    </div>
  );
}
