// Athena mark: an owl's two eyes inside a square — watchful, precise.
export default function Logo({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="logo">
      <rect width="24" height="24" rx="4" fill="var(--ink)" />
      <circle cx="8.5" cy="11" r="3.6" fill="none" stroke="var(--ink-text)" strokeWidth="1.6" />
      <circle cx="15.5" cy="11" r="3.6" fill="none" stroke="var(--ink-text)" strokeWidth="1.6" />
      <circle cx="8.5" cy="11" r="1.3" fill="var(--accent)" />
      <circle cx="15.5" cy="11" r="1.3" fill="var(--accent)" />
      <path d="M6 18.5h12" stroke="var(--ink-text)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
