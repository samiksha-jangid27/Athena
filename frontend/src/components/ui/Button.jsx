import Icon from './Icon.jsx'

// variant: primary | secondary | ghost | danger. size: md | sm | lg
export default function Button({ variant = 'primary', size = 'md', icon, iconRight, loading, children, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className}`} aria-busy={loading || undefined}
      {...props} disabled={props.disabled || loading}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={16} />}
      {children && <span>{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={16} />}
    </button>
  )
}
