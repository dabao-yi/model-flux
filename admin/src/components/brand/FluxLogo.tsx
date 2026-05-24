export function FluxLogo({ className = "size-9" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect width="40" height="40" rx="10" fill="url(#flux-bg)" />
      <path
        d="M8 20h8l4-6 4 12 4-6h8"
        stroke="url(#flux-stroke)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="2.5" fill="#e8a317" />
      <defs>
        <linearGradient id="flux-bg" x1="0" y1="0" x2="40" y2="40">
          <stop stopColor="#1a2332" />
          <stop offset="1" stopColor="#0f141c" />
        </linearGradient>
        <linearGradient id="flux-stroke" x1="8" y1="20" x2="32" y2="20">
          <stop stopColor="#e8a317" />
          <stop offset="1" stopColor="#3dd6c6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
