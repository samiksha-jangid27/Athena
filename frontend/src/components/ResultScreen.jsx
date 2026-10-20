export default function ResultScreen({ result, status, onDone }) {
  return (
    <main className="exam-layout single">
      <div className="result-card">
        <div className="result-badge">✓</div>
        <div className="eyebrow">{status === 'expired' ? 'Time is up' : 'Exam submitted'}</div>
        <h2>Your answers are recorded.</h2>
        <div className="result-stats">
          <div><strong>{result?.correct ?? 0}</strong><span>Correct</span></div>
          <div><strong>{result?.wrong ?? 0}</strong><span>Incorrect</span></div>
          <div><strong>{result?.attempted ?? 0}</strong><span>Attempted</span></div>
        </div>
        <button className="primary-button" onClick={onDone}>Finish <span>↗</span></button>
      </div>
    </main>
  )
}
