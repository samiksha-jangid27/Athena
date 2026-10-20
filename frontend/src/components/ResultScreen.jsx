import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'

export default function ResultScreen({ result, attempt, onDone }) {
  const expired = attempt?.status === 'expired'
  return (
    <main className="center-screen">
      <section className="final-panel" aria-labelledby="final-title">
        <span className="final-icon"><Icon name="check" size={22} /></span>
        <p className="eyebrow">{expired ? 'Time is up' : 'Submission received'}</p>
        <h1 id="final-title" className="display">Your exam has been submitted.</h1>
        <p className="muted">The exam server confirmed your submission. You can close Athena now.</p>
        <dl className="receipt">
          {attempt?.submittedAt && <div><dt>Submitted</dt><dd>{new Date(attempt.submittedAt).toLocaleString()}</dd></div>}
          {attempt?.sessionId && <div><dt>Reference</dt><dd><code>{attempt.sessionId}</code></dd></div>}
          {result && <div><dt>Answered</dt><dd className="num">{result.attempted}</dd></div>}
          {result && <div><dt>Correct (multiple choice)</dt><dd className="num">{result.correct}</dd></div>}
        </dl>
        <Button variant="secondary" onClick={onDone}>Finish</Button>
      </section>
    </main>
  )
}
