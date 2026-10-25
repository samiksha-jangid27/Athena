import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'
import Badge from './ui/Badge.jsx'

export default function ResultScreen({ result, attempt, exam, onDone }) {
  const expired = attempt?.status === 'expired'
  const score = result?.score
  const maxScore = result?.maxScore
  const hasScore = score !== undefined && score !== null && maxScore
  const percentage = hasScore ? Math.round((score / maxScore) * 100) : null
  const passing = exam?.passingCriteria
  const pass = percentage !== null && passing !== undefined && passing !== null
    ? percentage >= passing
    : null
  return (
    <main className="center-screen">
      <section className="final-panel" aria-labelledby="final-title">
        <span className="final-icon"><Icon name="check" size={22} /></span>
        <p className="eyebrow">{expired ? 'Time is up' : 'Submission received'}</p>
        <h1 id="final-title" className="display">Your exam has been submitted.</h1>
        <p className="muted">The exam server confirmed your submission and scored your answers. You can close Athena now.</p>
        {hasScore && (
          <div className="result-score">
            <p className="result-score-value" aria-label={`Score ${score} out of ${maxScore}`}>
              Score: <strong>{score} / {maxScore}</strong>
            </p>
            {percentage !== null && <p className="result-score-percent">{percentage}%</p>}
            {pass !== null && (
              <Badge tone={pass ? 'success' : 'danger'} dot>{pass ? 'Pass' : 'Fail'}</Badge>
            )}
          </div>
        )}
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
