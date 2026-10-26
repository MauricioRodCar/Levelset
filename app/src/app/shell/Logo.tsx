/** Levelset mark: three levels (entry / stop / target) in theme colours. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" style={{ fill: 'var(--ls-surface-2)' }} />
      <path
        d="M8 10h7"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ stroke: 'var(--ls-profit)' }}
      />
      <path
        d="M8 16h12"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ stroke: 'var(--ls-text)' }}
      />
      <path
        d="M8 22h17"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ stroke: 'var(--ls-primary)' }}
      />
    </svg>
  );
}
