import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import Callout from './ui/Callout.jsx'

function QuestionLinks({ indices, onJump }) {
  return (
    <span className="question-links">
      {indices.map((index) => (
        <button key={index} type="button" className="link-button" onClick={() => onJump(index)}>Q{index + 1}</button>
      ))}
    </span>
  )
}

export default function SubmitDialog({ open, summary, submitting, error, onCancel, onConfirm, onJump }) {
  return (
    <Modal open={open} title="Submit your exam?" onClose={onCancel}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>Keep working</Button>
          <Button onClick={onConfirm} loading={submitting}>Submit exam</Button>
        </>
      )}>
      <dl className="summary-list">
        <div><dt>Answered</dt><dd className="num">{summary.answered} of {summary.total}</dd></div>
        <div><dt>Not answered</dt><dd>{summary.unanswered.length ? <QuestionLinks indices={summary.unanswered} onJump={onJump} /> : 'None'}</dd></div>
        <div><dt>Flagged for review</dt><dd>{summary.flagged.length ? <QuestionLinks indices={summary.flagged} onJump={onJump} /> : 'None'}</dd></div>
      </dl>
      <p>After you submit, you cannot change your answers.</p>
      {error && <Callout tone="danger" role="alert">{error}</Callout>}
    </Modal>
  )
}
