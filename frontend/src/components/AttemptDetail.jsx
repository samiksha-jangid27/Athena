import { useState } from 'react'
import { api } from '../services/api.js'
import { formatDuration } from '../lib/exam.js'
import { EVENT_LABEL, STATUS_LABEL, STATUS_TONE, attemptRemaining, evidenceHint, validateExtension } from '../lib/instructor.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Field from './ui/Field.jsx'
import Modal from './ui/Modal.jsx'
import { useToast } from './ui/Toast.jsx'
import PracticalReview from './PracticalReview.jsx'

const SEVERITY_TONE = { critical: 'danger', warning: 'warning', info: 'neutral' }

function time(value) {
  return value ? new Date(value).toLocaleTimeString() : '—'
}

export default function AttemptDetail({ attempt, instructorKey, serverOffset, now, onChanged, onClose }) {
  const notify = useToast()
  const [severity, setSeverity] = useState('all')
  const [minutes, setMinutes] = useState('5')
  const [confirm, setConfirm] = useState(null) // 'unlock' | 'extend'
  const [busy, setBusy] = useState(false)

  const remaining = attemptRemaining(attempt, serverOffset, now)
  const extensionError = validateExtension(minutes)
  const open = attempt.status !== 'submitted'
  const events = [...attempt.events].reverse().filter((event) => severity === 'all' || event.severity === severity)

  async function run() {
    setBusy(true)
    try {
      if (confirm === 'unlock') {
        await api.unlock(instructorKey, attempt.sessionId)
        notify(`${attempt.name}'s attempt was unlocked.`, 'success')
      } else {
        await api.extend(instructorKey, attempt.sessionId, Number(minutes))
        notify(`Added ${minutes} min for ${attempt.name}.`, 'success')
      }
      setConfirm(null)
      onChanged()
    } catch (error) {
      notify(error.message || 'The action failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="detail" aria-labelledby="detail-title">
      <header className="detail-head">
        <div>
          <h2 id="detail-title">{attempt.name}</h2>
          <p className="subtle">{attempt.userId}</p>
        </div>
        <Badge tone={STATUS_TONE[attempt.status]} dot>{STATUS_LABEL[attempt.status]}</Badge>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close details" onClick={onClose} />
      </header>

      <dl className="detail-facts">
        <div><dt>Time left</dt><dd className="num">{remaining === null ? '—' : formatDuration(remaining)}</dd></div>
        <div><dt>Answered</dt><dd className="num">{attempt.attempted}</dd></div>
        <div><dt>Flagged</dt><dd className="num">{attempt.flags.length}</dd></div>
        <div><dt>Started</dt><dd className="num">{time(attempt.startedAt)}</dd></div>
        <div><dt>Deadline</dt><dd className="num">{time(attempt.deadline)}</dd></div>
        <div><dt>Submitted</dt><dd className="num">{time(attempt.submittedAt)}</dd></div>
        <div className="wide"><dt>Attempt ID</dt><dd><code>{attempt.sessionId}</code></dd></div>
        {attempt.extensions.length > 0 && (
          <div className="wide"><dt>Extensions</dt><dd>{attempt.extensions.map((item) => `+${item.minutes} min at ${time(item.at)}`).join(', ')}</dd></div>
        )}
      </dl>

      {open && (
        <div className="detail-actions">
          {attempt.status === 'locked' && (
            <Button icon="lock" onClick={() => setConfirm('unlock')}>Unlock attempt</Button>
          )}
          <form className="extend-form" onSubmit={(event) => { event.preventDefault(); if (!extensionError) setConfirm('extend') }}>
            <Field label="Extra minutes" type="number" min="1" max="120" step="1" inputMode="numeric" value={minutes}
              onChange={(event) => setMinutes(event.target.value)} error={minutes === '' ? undefined : extensionError || undefined} />
            <Button type="submit" variant="secondary" icon="clock" disabled={Boolean(extensionError)}>Extend time</Button>
          </form>
          {typeof window !== 'undefined' && window.athena?.openEvidenceFolder && (
            <Button variant="ghost" size="sm" icon="file" onClick={async () => {
              try {
                const res = await window.athena.openEvidenceFolder(attempt.sessionId)
                if (res?.error) notify(res.error, 'error')
              } catch {
                notify('Could not open evidence folder.', 'error')
              }
            }}>
              Open local evidence folder
            </Button>
          )}
        </div>
      )}

      <PracticalReview attempt={attempt} instructorKey={instructorKey} />

      <section className="activity">
        <div className="activity-head">
          <h3>Activity</h3>
          <div className="segmented" role="group" aria-label="Filter by severity">
            {['all', 'critical', 'warning', 'info'].map((value) => (
              <button key={value} type="button" aria-pressed={severity === value} onClick={() => setSeverity(value)}>
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {events.length === 0 ? <p className="subtle">No {severity === 'all' ? '' : severity} events recorded.</p> : (
          <ol className="activity-list">
            {events.map((event) => {
              const hint = evidenceHint(event, attempt.sessionId)
              return (
                <li key={event.id || event.seq} className={`sev-${event.severity || 'info'}`}>
                  <time className="num" title={`Received ${time(event.receivedAt)}`}>{time(event.clientAt || event.receivedAt)}</time>
                  <div>
                    <div className="row">
                      <strong>{EVENT_LABEL[event.type] || event.type}</strong>
                      {event.severity && event.severity !== 'info' && <Badge tone={SEVERITY_TONE[event.severity]}>{event.severity}</Badge>}
                    </div>
                    {event.detail && <p className="subtle">{event.detail}</p>}
                    {hint && <p className="evidence-ref">{hint}, around this time</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)}
        title={confirm === 'unlock' ? 'Unlock this attempt?' : `Add ${minutes} minutes?`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button onClick={run} loading={busy}>{confirm === 'unlock' ? 'Unlock' : 'Extend time'}</Button>
          </>
        )}>
        {confirm === 'unlock'
          ? <p>{attempt.name} will be able to change answers again. Check the activity timeline before unlocking. This is recorded in the attempt’s activity log.</p>
          : <p>{attempt.name}’s deadline moves from {time(attempt.deadline)} to {time(Date.parse(attempt.deadline) + Number(minutes) * 60000)}. The student’s timer updates within about 10 seconds without losing answers.</p>}
      </Modal>
    </aside>
  )
}
