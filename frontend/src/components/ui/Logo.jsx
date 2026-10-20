// Athena mark: a stylised owl-eye laurel in a rounded square.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="11.5" cy="14" r="4.2" fill="none" stroke="var(--accent-text)" strokeWidth="2" />
      <circle cx="20.5" cy="14" r="4.2" fill="none" stroke="var(--accent-text)" strokeWidth="2" />
      <circle cx="11.5" cy="14" r="1.4" fill="var(--accent-text)" />
      <circle cx="20.5" cy="14" r="1.4" fill="var(--accent-text)" />
      <path d="M16 18.5l-1.6 2.4h3.2z" fill="var(--gold)" />
      <path d="M8 24c3 1.6 13 1.6 16 0" fill="none" stroke="var(--accent-text)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
