// Shown when a saved attempt cannot be resumed right away.
export default function RecoveryScreen({ kind, onRetry, onStartOver }) {
  if (kind === 'loading') {
    return <main className="exam-layout single"><p role="status">Restoring your exam…</p></main>
  }
  const offline = kind === 'recovery-offline'
  return (
    <main className="exam-layout single">
      <div className="result-card" role="alert">
        <div className="eyebrow">{offline ? 'Connection lost' : 'Session expired'}</div>
        <h2>{offline ? 'We can’t reach the exam service.' : 'This exam session is no longer valid.'}</h2>
        <p>
          {offline
            ? 'Your answers are saved on this device. Check that the exam service is running, then try again. Do not start a new attempt.'
            : 'The exam service does not recognise this session. It may have been reset. Ask your instructor before starting again.'}
        </p>
        <div className="question-actions">
          {offline && <button className="primary-button" onClick={onRetry}>Try again</button>}
          {!offline && <button className="primary-button" onClick={onStartOver}>Start over</button>}
        </div>
      </div>
    </main>
  )
}
