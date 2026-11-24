import { useEffect, useId, useRef } from 'react'

// Native <dialog>: focus is trapped and Escape closes it, for free.
export default function Modal({ open, title, onClose, children, footer, tone = 'default' }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} className={`modal modal-${tone}`} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose?.() }}>
      {open && (
        <>
          <h2 id={titleId} className="modal-title">{title}</h2>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  )
}
