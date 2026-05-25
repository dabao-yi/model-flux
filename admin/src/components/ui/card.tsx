import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("glass-panel glass-panel-hover rounded-[var(--radius-xl)] p-5 md:p-6", className)}>
      {children}
    </div>
  );
}

export function Section({
  className,
  children,
  style,
  id,
}: {
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  id?: string;
}) {
  return (
    <section
      id={id}
      style={style}
      className={cn("glass-panel glass-panel-hover mb-5 rounded-[var(--radius-xl)] p-5 md:p-6", className)}
    >
      {children}
    </section>
  );
}
