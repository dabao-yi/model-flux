import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-[18px] w-[34px] cursor-pointer rounded-full border border-[#3a5266] bg-[#0b1219] data-[state=checked]:border-[#4a7a55] data-[state=checked]:bg-[#163022] disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-[#91a4b6] transition data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-[#8cf0bd]" />
    </SwitchPrimitive.Root>
  );
}
