import { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { formatDuration } from '../lib/exam.js'
import { STATUS_LABEL, STATUS_TONE, attemptRemaining, normalizeStatus, validateExtension } from '../lib/instructor.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Field from './ui/Field.jsx'
import Modal from './ui/Modal.jsx'
import { useToast } from './ui/Toast.jsx'

function time(value) {
  return value ? new Date(value).toLocaleTimeString() : '—'
}

function EvidenceGroup({ title, items, total, urls, errors, onPreview, onImageError, onLoadEarlier }) {
  return (
    <section style={{ marginBottom: '16px' }}>
      <h3 style={{ fontSize: 'var(--text-sm)', marginBottom: '8px' }}>{title} ({total})</h3>
      {items.length === 0 ? <p className="subtle">No captures available.</p> : (
        <div className="evidence-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="evidence-thumb-btn"
              style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden', background: '#000', cursor: urls[item.id] ? 'pointer' : 'default', padding: 0 }}
              onClick={() => urls[item.id] && onPreview(item)}>
              {urls[item.id]
                ? <img src={urls[item.id]} alt={`${title} captured ${time(item.capturedAt)}`} style={{ width: '100%', height: '72px', objectFit: 'cover' }} onError={() => onImageError(item.id)} />
                : <span style={{ display: 'block', height: '72px', padding: '24px 4px 0', color: 'var(--text-muted)', fontSize: '11px' }}>{errors[item.id] || 'Loading image…'}</span>}
              <span style={{ fontSize: '10px', display: 'block', color: 'var(--text-muted)', textAlign: 'center', padding: '4px' }}>
                {time(item.capturedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
      {items.length < total && <Button variant="ghost" size="sm" onClick={onLoadEarlier}>Load earlier</Button>}
    </section>
  )
}

export default function AttemptDetail({ attempt, adminToken, instructorKey, serverOffset, now, onChanged, onClose }) {
  const notify = useToast()
  const [minutes, setMinutes] = useState('5')
  const [confirm, setConfirm] = useState(null) // 'unlock' | 'extend'
  const [busy, setBusy] = useState(false)

  // Manual grading state
  const [manualMarks, setManualMarks] = useState(String(attempt.manualScore || 0))
  const [reviewNotes, setReviewNotes] = useState(attempt.reviewNotes || '')
  const [savingGrade, setSavingGrade] = useState(false)
  const [previewEvidence, setPreviewEvidence] = useState(null)
  const [detail, setDetail] = useState(null)
  const [evidenceUrls, setEvidenceUrls] = useState({})
  const [evidenceErrors, setEvidenceErrors] = useState({})
  const [evidenceLimit, setEvidenceLimit] = useState(24)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    if (!adminToken) return undefined
    let active = true
    const load = () => api.admin.getAttempt(adminToken, attempt.sessionId)
      .then((response) => { if (active) { setDetail(response.attempt); setDetailError('') } })
      .catch((error) => { if (active) setDetailError(error.message || 'Could not load attempt details.') })
    load()
    const timer = setInterval(() => {
      if (normalizeStatus(attempt.status) === 'in-progress' || normalizeStatus(attempt.status) === 'locked') load()
    }, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [adminToken, attempt.sessionId, attempt.status])

  const reviewedAttempt = detail || attempt
  const status = normalizeStatus(reviewedAttempt.status)
  const answerByQuestion = new Map((reviewedAttempt.submittedAnswers || []).map((answer) => [answer.questionId, answer]))
  const questions = reviewedAttempt.exam?.questions || []
  const evidence = useMemo(() => [...(reviewedAttempt.evidence || [])].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)), [reviewedAttempt.evidence])
  const displayedEvidence = useMemo(() => evidence.slice(0, evidenceLimit), [evidence, evidenceLimit])
  const cameraEvidence = useMemo(() => displayedEvidence.filter((item) => item.kind === 'CAMERA'), [displayedEvidence])
  const screenEvidence = useMemo(() => displayedEvidence.filter((item) => item.kind === 'SCREEN'), [displayedEvidence])
  const handleImageError = (id) => {
    setEvidenceErrors((current) => ({ ...current, [id]: 'Image could not be displayed.' }))
  }

  useEffect(() => {
    if (!adminToken || displayedEvidence.length === 0) return undefined
    let active = true
    const urls = {}
    Promise.all(displayedEvidence.map(async (item) => {
      try {
        const blob = await api.admin.fetchEvidence(adminToken, item.id)
        const url = URL.createObjectURL(blob)
        if (active) urls[item.id] = url
        else URL.revokeObjectURL(url)
      } catch (error) {
        if (active) setEvidenceErrors((current) => ({ ...current, [item.id]: error.message || 'Image unavailable.' }))
      }
    })).then(() => { if (active) setEvidenceUrls(urls) })
    return () => {
      active = false
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [adminToken, displayedEvidence])

  const remaining = attemptRemaining({ ...reviewedAttempt, status }, serverOffset, now)
  const extensionError = validateExtension(minutes)
  const open = status !== 'submitted'

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
      {detailError && <p className="subtle" role="alert">{detailError}</p>}
      <header className="detail-head">
        <div>
          <h2 id="detail-title">{attempt.name}</h2>
          <p className="subtle">{attempt.userId}</p>
        </div>
        <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status] || status}</Badge>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close details" onClick={onClose} />
      </header>

      <dl className="detail-facts">
        <div><dt>Status</dt><dd className="num">{status}</dd></div>
        <div><dt>Time left</dt><dd className="num">{remaining === null ? '—' : formatDuration(remaining)}</dd></div>
        <div><dt>Score</dt><dd className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>{attempt.maxScore ? `${attempt.totalScore ?? 0} / ${attempt.maxScore}` : (attempt.totalScore ?? 0)}</dd></div>
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
          {status === 'locked' && (
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
              label="Manual Score Adjustment:"
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
      {reviewedAttempt.submittedAnswers && (
        <section className="answers-section card" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: 'var(--text-sm)', marginBottom: '8px' }}>Answers and unanswered questions</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Question</th><th>Answer</th><th>Marks</th></tr></thead>
              <tbody>
                {(questions.length ? questions : reviewedAttempt.submittedAnswers).map((questionOrAnswer) => {
                  const answer = questionOrAnswer.questionId ? questionOrAnswer : answerByQuestion.get(questionOrAnswer.id)
                  return (
                  <tr key={questionOrAnswer.id || questionOrAnswer.questionId}>
                    <td>{questionOrAnswer.prompt || questionOrAnswer.question?.prompt || questionOrAnswer.questionId}</td>
                    <td>{answer?.answerValue ? (() => {
                      try { return JSON.stringify(JSON.parse(answer.answerValue)) } catch { return answer.answerValue }
                    })() : 'Unanswered'}</td>
                    <td>{answer?.autoMarks ?? 0}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="evidence-section card" style={{ padding: '16px' }}>
        <EvidenceGroup
          title="Camera Photos"
          items={cameraEvidence}
          total={evidence.filter((item) => item.kind === 'CAMERA').length}
          urls={evidenceUrls}
          errors={evidenceErrors}
          onPreview={setPreviewEvidence}
          onImageError={handleImageError}
          onLoadEarlier={() => setEvidenceLimit((current) => current + 24)}
        />
        <EvidenceGroup
          title="Screen Screenshots"
          items={screenEvidence}
          total={evidence.filter((item) => item.kind === 'SCREEN').length}
          urls={evidenceUrls}
          errors={evidenceErrors}
          onPreview={setPreviewEvidence}
          onImageError={handleImageError}
          onLoadEarlier={() => setEvidenceLimit((current) => current + 24)}
        />
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
              src={evidenceUrls[previewEvidence.id]}
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
