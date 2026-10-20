import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'

// Shown when a saved attempt cannot be resumed right away.
export default function RecoveryScreen({ kind, onRetry, onStartOver }) {
  if (kind === 'loading') {
    return (
      <main className="center-screen">
        <p className="row muted" role="status"><span className="spinner" aria-hidden="true" />Restoring your exam…</p>
      </main>
    )
  }
  const offline = kind === 'recovery-offline'
  return (
    <main className="center-screen">
      <section className="final-panel" role="alert" aria-labelledby="recovery-title">
        <span className={`final-icon ${offline ? 'warning' : 'danger'}`}><Icon name={offline ? 'wifi' : 'alert'} size={22} /></span>
        <p className="eyebrow">{offline ? 'Connection lost' : 'Session not recognised'}</p>
        <h1 id="recovery-title" className="display">{offline ? 'Athena can’t reach the exam service.' : 'This exam session is no longer valid.'}</h1>
        <p className="muted">
          {offline
            ? 'Your answers are saved on this device and will be sent when the connection returns. Do not start a new attempt.'
            : 'The exam service does not recognise this session. It may have been reset. Ask your instructor before starting again.'}
        </p>
        {offline
          ? <Button icon="refresh" onClick={onRetry}>Try again</Button>
          : <Button variant="secondary" onClick={onStartOver}>Discard and start over</Button>}
      </section>
    </main>
  )
}
