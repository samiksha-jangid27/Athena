import { useEffect, useRef } from 'react'

// Native <dialog>: focus is trapped and Escape closes it, for free.
export default function Modal({ open, title, onClose, children, footer, tone = 'default' }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} className={`modal modal-${tone}`} aria-labelledby="modal-title"
      onCancel={(event) => { event.preventDefault(); onClose?.() }}>
      {open && (
        <>
          <h2 id="modal-title" className="modal-title">{title}</h2>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  )
}
