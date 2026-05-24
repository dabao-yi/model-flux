import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Radix Select forbids empty-string item values; map them to a sentinel. */
const EMPTY_VALUE = "__select_empty__";

function toSelectValue(value: string) {
  return value === "" ? EMPTY_VALUE : value;
}

function fromSelectValue(value: string) {
  return value === EMPTY_VALUE ? "" : value;
}

export function Select({
  value,
  onValueChange,
  placeholder,
  options,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const hasEmptyOption = options.some((opt) => opt.value === "");
  const selectValue = value === "" ? (hasEmptyOption ? EMPTY_VALUE : undefined) : toSelectValue(value);

  return (
    <SelectPrimitive.Root
      value={selectValue}
      onValueChange={(v) => onValueChange(fromSelectValue(v))}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "flex w-full cursor-pointer items-center justify-between rounded-[14px] border border-[#263746] bg-[#080d13] px-3 py-2.5 text-left text-[var(--color-text)] outline-none focus:border-[#6091bd]",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-70" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-50 overflow-hidden rounded-[14px] border border-[#33485d] bg-[#0d151d] shadow-xl">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={toSelectValue(opt.value)}
                value={toSelectValue(opt.value)}
                className="cursor-pointer rounded-[10px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-[#172636] data-[state=checked]:text-[var(--color-accent2)]"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
