export function PageHeader({
  title,
  hint,
  actions,
  step,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  step?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        {step ? (
          <span className="mb-2 inline-block rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--color-flow)]">
            STEP {step}
          </span>
        ) : null}
        <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h2>
        {hint ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-muted)]">{hint}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
