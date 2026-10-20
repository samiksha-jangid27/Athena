// tone: neutral | success | warning | danger | info | accent
export default function Badge({ tone = 'neutral', dot, children, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
