import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'
import Badge from './ui/Badge.jsx'
import Callout from './ui/Callout.jsx'

export default function StudentExamCatalog({ student, token, onSelectExam, onSignOut }) {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadExams = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.student.listExams(token)
      setExams(res.exams || [])
    } catch (err) {
      setError(err.message || 'Failed to load exams from the central server.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    api.student.listExams(token)
      .then((res) => {
        if (active) setExams(res.exams || [])
      })
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load exams from the central server.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  return (
    <div className="catalog-screen">
      <header className="catalog-header">
        <div>
          <span className="eyebrow">Student Examination Center</span>
          <h1 className="display">Available Exams</h1>
          <p className="subtle">Welcome, <strong>{student.name}</strong> ({student.username}). Select your scheduled examination below.</p>
        </div>
        <div className="catalog-actions">
          <Button variant="secondary" size="sm" icon="refresh" loading={loading} onClick={loadExams}>
            Refresh
          </Button>
          <Button variant="ghost" size="sm" icon="x" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      {error && (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      )}

      {loading ? (
        <div className="empty-state">
          <span className="spinner" />
          <p>Connecting to exam server and loading authorized assessments…</p>
        </div>
      ) : exams.length === 0 ? (
        <div className="empty-state card">
          <Icon name="list" size={32} />
          <h2>No Published Exams Available</h2>
          <p>There are currently no active or published examinations assigned to you. Please contact your instructor or exam administrator.</p>
        </div>
      ) : (
        <div className="exam-card-grid">
          {exams.map((exam) => {
            const status = exam.attemptStatus
            const completed = status === 'submitted' || status === 'expired'
            const inProgress = status === 'in-progress' || status === 'locked'
            return (
            <article key={exam.id} className="exam-catalog-card">
              <div className="card-top">
                {completed
                  ? <Badge tone="success" dot>Completed</Badge>
                  : inProgress
                    ? <Badge tone="warning" dot>In progress</Badge>
                    : <Badge tone="success" dot>Published & Active</Badge>}
                <div className="exam-duration">
                  <Icon name="clock" size={14} />
                  <span>{exam.durationMinutes} minutes</span>
                </div>
              </div>

              <h2 className="exam-title">{exam.title}</h2>
              <p className="exam-desc">{exam.description || 'Standard institutional proctored assessment.'}</p>

              <div className="exam-meta-pills">
                <div className="meta-pill">
                  <span className="meta-val">{exam.questionCount}</span>
                  <span className="meta-lbl">Questions</span>
                </div>
                <div className="meta-pill">
                  <span className="meta-val">{exam.durationMinutes}m</span>
                  <span className="meta-lbl">Time Limit</span>
                </div>
                <div className="meta-pill">
                  {completed && exam.attemptMaxScore
                    ? <><span className="meta-val">{exam.attemptScore ?? 0} / {exam.attemptMaxScore}</span><span className="meta-lbl">Score</span></>
                    : <><span className="meta-val">{completed ? 'Completed' : 'Proctored'}</span><span className="meta-lbl">Integrity Guard</span></>}
                </div>
              </div>

              <div className="card-footer">
                {completed ? (
                  <p className="subtle">You have already completed this exam. It cannot be retaken.</p>
                ) : (
                  <Button
                    className="start-exam-btn"
                    iconRight="arrowRight"
                    onClick={() => onSelectExam(exam)}>
                    {inProgress ? 'Resume exam' : 'Begin Readiness & Launch'}
                  </Button>
                )}
              </div>
            </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
