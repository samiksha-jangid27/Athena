import { useId } from 'react'

// Labelled input with optional hint and validation message.
export default function Field({ label, hint, error, as: Tag = 'input', className = '', ...props }) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      <Tag id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...props} />
      {hint && !error && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
    </div>
  )
}
