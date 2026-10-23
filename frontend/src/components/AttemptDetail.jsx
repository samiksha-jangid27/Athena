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

export default function AttemptDetail({ attempt, adminToken, instructorKey, serverOffset, now, onChanged, onClose }) {
  const notify = useToast()
  const [severity, setSeverity] = useState('all')
  const [minutes, setMinutes] = useState('5')
  const [confirm, setConfirm] = useState(null) // 'unlock' | 'extend'
  const [busy, setBusy] = useState(false)

  // Manual grading state
  const [manualMarks, setManualMarks] = useState(String(attempt.manualScore || 0))
  const [reviewNotes, setReviewNotes] = useState(attempt.reviewNotes || '')
  const [savingGrade, setSavingGrade] = useState(false)
  const [previewEvidence, setPreviewEvidence] = useState(null)

  const remaining = attemptRemaining(attempt, serverOffset, now)
  const extensionError = validateExtension(minutes)
  const open = attempt.status !== 'submitted'
  const events = [...(attempt.events || [])].reverse().filter((event) => severity === 'all' || event.severity === severity)

  async function run() {
    setBusy(true)
    try {
      if (confirm === 'unlock') {
        if (adminToken) {
          await api.admin.unlockAttempt(adminToken, attempt.sessionId)
        } else {
          await api.unlock(instructorKey, attempt.sessionId)
        }
        notify(`${attempt.name}'s attempt was unlocked.`, 'success')
      } else {
        if (adminToken) {
          await api.admin.extendAttempt(adminToken, attempt.sessionId, Number(minutes))
        } else {
          await api.extend(instructorKey, attempt.sessionId, Number(minutes))
        }
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

  async function handleSaveGrade(e) {
    e.preventDefault()
    setSavingGrade(true)
    try {
      const res = await api.admin.gradeAttempt(adminToken, attempt.sessionId, {
        manualScore: Number(manualMarks) || 0,
        reviewNotes,
      })
      notify(`Grade updated: Total score ${res.attempt.totalScore}.`, 'success')
      onChanged()
    } catch (error) {
      notify(error.message || 'Failed to update grade.', 'error')
    } finally {
      setSavingGrade(false)
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
        <div><dt>Status</dt><dd className="num">{attempt.status}</dd></div>
        <div><dt>Time left</dt><dd className="num">{remaining === null ? '—' : formatDuration(remaining)}</dd></div>
        <div><dt>Total score</dt><dd className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>{attempt.totalScore ?? attempt.correct ?? 0}</dd></div>
        <div><dt>Started</dt><dd className="num">{time(attempt.startedAt)}</dd></div>
        <div><dt>Deadline</dt><dd className="num">{time(attempt.deadline)}</dd></div>
        <div><dt>Submitted</dt><dd className="num">{time(attempt.submittedAt)}</dd></div>
        <div className="wide"><dt>Attempt ID</dt><dd><code>{attempt.sessionId}</code></dd></div>
        {attempt.extensions && attempt.extensions.length > 0 && (
          <div className="wide"><dt>Extensions</dt><dd>{attempt.extensions.map((item) => `+${item.minutes} min at ${time(item.at || item.grantedAt)}`).join(', ')}</dd></div>
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
              Open local folder
            </Button>
          )}
        </div>
      )}

      {/* Manual Grading & Review Section */}
      <section className="grading-section card" style={{ padding: '16px' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', marginBottom: '8px' }}>Grading & Score Adjustment</h3>
        <form onSubmit={handleSaveGrade} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <span className="field-hint">Auto Score (Objective):</span>
              <strong style={{ display: 'block' }}>{attempt.autoScore || attempt.correct || 0} pts</strong>
            </div>
            <Field
              label="Manual Score (Short Answer):"
              type="number"
              value={manualMarks}
              onChange={(e) => setManualMarks(e.target.value)}
            />
          </div>
          <Field
            label="Instructor Review Notes"
            value={reviewNotes}
            placeholder="e.g. Full credit awarded for clear IPC architecture explanation."
            onChange={(e) => setReviewNotes(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
            <Button size="sm" type="submit" loading={savingGrade} disabled={!adminToken}>
              {adminToken ? 'Save Grade Review' : 'Sign in as Admin to Grade'}
            </Button>
          </div>
        </form>
      </section>

      {/* Proctoring Evidence Thumbnails */}
      {attempt.evidence && attempt.evidence.length > 0 && (
        <section className="evidence-section card" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: 'var(--text-sm)', marginBottom: '8px' }}>
            Proctoring Evidence ({attempt.evidence.length} captures)
          </h3>
          <div className="evidence-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '8px' }}>
            {attempt.evidence.map((ev) => (
              <button
                key={ev.id}
                type="button"
                className="evidence-thumb-btn"
                style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden', background: '#000', cursor: 'pointer', padding: 0 }}
                onClick={() => setPreviewEvidence(ev)}>
                <img
                  src={api.admin.evidenceUrl(ev.id)}
                  alt={`${ev.kind} capture`}
                  style={{ width: '100%', height: '60px', objectFit: 'cover' }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
                <span style={{ fontSize: '10px', display: 'block', color: 'var(--text-muted)', textAlign: 'center', padding: '2px' }}>
                  {ev.kind}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <PracticalReview attempt={attempt} instructorKey={instructorKey} />

      <section className="activity">
        <div className="activity-head">
          <h3>Activity Timeline</h3>
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

      {/* Evidence Preview Modal */}
      <Modal open={previewEvidence !== null} onClose={() => setPreviewEvidence(null)}
        title={`Proctoring Evidence: ${previewEvidence?.kind} capture`}
        footer={<Button onClick={() => setPreviewEvidence(null)}>Close</Button>}>
        {previewEvidence && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={api.admin.evidenceUrl(previewEvidence.id)}
              alt="Proctoring capture full size"
              style={{ maxWidth: '100%', maxHeight: '450px', borderRadius: '4px' }}
            />
            <p className="subtle" style={{ marginTop: '8px' }}>
              Captured at: {new Date(previewEvidence.capturedAt).toLocaleString()} · Size: {previewEvidence.byteSize} bytes
            </p>
          </div>
        )}
      </Modal>
    </aside>
  )
}
