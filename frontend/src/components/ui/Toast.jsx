import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Icon from './Icon.jsx'

const ToastContext = createContext(() => {})

const ICONS = { success: 'check', error: 'alert', info: 'clock' }

// Short-lived notifications announced to screen readers.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const notify = useCallback((message, tone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500)
  }, [])

  const value = useMemo(() => notify, [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <Icon name={ICONS[toast.tone]} size={16} />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}
