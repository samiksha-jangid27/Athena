import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { formatDuration } from '../lib/exam.js'
import {
  STATUS_LABEL,
  STATUS_TONE,
  attemptRemaining,
  countByStatus,
  criticalCount,
  filterAttempts,
  lastActivity,
  sortAttempts,
} from '../lib/instructor.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Callout from './ui/Callout.jsx'
import Field from './ui/Field.jsx'
import Icon from './ui/Icon.jsx'
import Modal from './ui/Modal.jsx'
import { useToast } from './ui/Toast.jsx'
import AttemptDetail from './AttemptDetail.jsx'

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

const STATUS_FILTERS = [
  ['all', 'All'],
  ['in-progress', 'In progress'],
  ['locked', 'Locked'],
  ['submitted', 'Submitted'],
  ['expired', 'Expired'],
]

export default function InstructorDashboard({ adminUser, adminToken, onSignOut }) {
  const notify = useToast()
  const now = useNow()

  // Navigation tab: 'attempts' | 'exams' | 'students'
  const [activeTab, setActiveTab] = useState('attempts')

  // Attempts state
  const [attempts, setAttempts] = useState([])
  const [loadingAttempts, setLoadingAttempts] = useState(true)
  const [attemptsError, setAttemptsError] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('activity')
  const [selectedId, setSelectedId] = useState(null)

  // Exams management state
  const [exams, setExams] = useState([])
  const [loadingExams, setLoadingExams] = useState(false)
  const [showCreateExam, setShowCreateExam] = useState(false)
  const [newExamTitle, setNewExamTitle] = useState('')
  const [newExamDesc, setNewExamDesc] = useState('')
  const [newExamDuration, setNewExamDuration] = useState('15')
  const [newExamMarks, setNewExamMarks] = useState('100')
  const [creatingExam, setCreatingExam] = useState(false)

  // Question editor state
  const [selectedExamForQuestions, setSelectedExamForQuestions] = useState(null)
  const [examQuestions, setExamQuestions] = useState([])
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [showAddQuestion, setShowAddQuestion] = useState(false)
  const [qType, setQType] = useState('MCQ')
  const [qPrompt, setQPrompt] = useState('')
  const [qOption1, setQOption1] = useState('')
  const [qOption2, setQOption2] = useState('')
  const [qOption3, setQOption3] = useState('')
  const [qOption4, setQOption4] = useState('')
  const [qCorrect, setQCorrect] = useState('0')
  const [qMarks, setQMarks] = useState('10')
  const [addingQuestion, setAddingQuestion] = useState(false)

  // Students management state
  const [students, setStudents] = useState([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [newStudentUser, setNewStudentUser] = useState('')
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentPass, setNewStudentPass] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)

  // Load attempts
  const refreshAttempts = async () => {
    try {
      let list = []
      if (adminToken) {
        list = await api.admin.listAttempts(adminToken)
      } else {
        list = await api.listAttempts('test')
      }
      setAttempts(list || [])
      setAttemptsError(null)
    } catch (err) {
      setAttemptsError(err.message || 'Failed to load attempts')
    } finally {
      setLoadingAttempts(false)
    }
  }

  // Load exams
  const refreshExams = async () => {
    if (!adminToken) return
    setLoadingExams(true)
    try {
      const res = await api.admin.listExams(adminToken)
      setExams(res.exams || [])
    } catch (err) {
      notify(err.message || 'Failed to load exams', 'error')
    } finally {
      setLoadingExams(false)
    }
  }

  // Load students
  const refreshStudents = async () => {
    if (!adminToken) return
    setLoadingStudents(true)
    try {
      const res = await api.admin.listStudents(adminToken)
      setStudents(res.students || [])
    } catch (err) {
      notify(err.message || 'Failed to load students', 'error')
    } finally {
      setLoadingStudents(false)
    }
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const list = adminToken ? await api.admin.listAttempts(adminToken) : await api.listAttempts('test')
        if (active) {
          setAttempts(list || [])
          setAttemptsError(null)
          setLoadingAttempts(false)
        }
      } catch (err) {
        if (active) {
          setAttemptsError(err.message || 'Failed to load attempts')
          setLoadingAttempts(false)
        }
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [adminToken])

  useEffect(() => {
    let active = true
    if (activeTab === 'exams' && adminToken) {
      api.admin.listExams(adminToken)
        .then((res) => { if (active) { setExams(res.exams || []); setLoadingExams(false) } })
        .catch(() => { if (active) setLoadingExams(false) })
    }
    if (activeTab === 'students' && adminToken) {
      api.admin.listStudents(adminToken)
        .then((res) => { if (active) { setStudents(res.students || []); setLoadingStudents(false) } })
        .catch(() => { if (active) setLoadingStudents(false) })
    }
    return () => {
      active = false
    }
  }, [activeTab, adminToken])

  // Create exam action
  const handleCreateExam = async (e) => {
    e.preventDefault()
    if (!newExamTitle.trim()) return
    setCreatingExam(true)
    try {
      await api.admin.createExam(adminToken, {
        title: newExamTitle.trim(),
        description: newExamDesc.trim(),
        durationMinutes: Number(newExamDuration) || 10,
        totalMarks: Number(newExamMarks) || 100,
        passingCriteria: 50,
      })
      notify(`Exam "${newExamTitle}" created successfully.`, 'success')
      setShowCreateExam(false)
      setNewExamTitle('')
      setNewExamDesc('')
      refreshExams()
    } catch (err) {
      notify(err.message || 'Failed to create exam', 'error')
    } finally {
      setCreatingExam(false)
    }
  }

  // Publish / Unpublish Exam
  const handleTogglePublish = async (exam) => {
    try {
      if (exam.status === 'PUBLISHED') {
        await api.admin.unpublishExam(adminToken, exam.id)
        notify(`Exam unpublished.`, 'info')
      } else {
        await api.admin.publishExam(adminToken, exam.id)
        notify(`Exam published for students.`, 'success')
      }
      refreshExams()
    } catch (err) {
      notify(err.message || 'Could not update publication state', 'error')
    }
  }

  // Open Question Manager for Exam
  const openQuestionManager = async (exam) => {
    setSelectedExamForQuestions(exam)
    setLoadingQuestions(true)
    try {
      const res = await api.admin.getExam(adminToken, exam.id)
      setExamQuestions(res.exam?.questions || [])
    } catch (err) {
      notify(err.message || 'Failed to load questions', 'error')
    } finally {
      setLoadingQuestions(false)
    }
  }

  // Add Question Action
  const handleAddQuestion = async (e) => {
    e.preventDefault()
    if (!qPrompt.trim()) return
    setAddingQuestion(true)
    try {
      let options = []
      let correct = qCorrect

      if (qType === 'MCQ' || qType === 'MSQ') {
        options = [qOption1, qOption2, qOption3, qOption4].filter(Boolean)
        if (qType === 'MSQ') {
          // split comma separated indices
          correct = qCorrect.split(',').map((x) => Number(x.trim())).filter((n) => !isNaN(n))
        } else {
          correct = Number(qCorrect) || 0
        }
      } else if (qType === 'TRUE_FALSE') {
        options = ['True', 'False']
        correct = Number(qCorrect) || 0
      } else if (qType === 'SHORT_ANSWER') {
        options = []
        correct = qCorrect.trim()
      }

      await api.admin.addQuestion(adminToken, selectedExamForQuestions.id, {
        type: qType,
        prompt: qPrompt.trim(),
        options,
        correctAnswer: correct,
        marks: Number(qMarks) || 1,
      })

      notify('Question added successfully.', 'success')
      setShowAddQuestion(false)
      setQPrompt('')
      openQuestionManager(selectedExamForQuestions)
      refreshExams()
    } catch (err) {
      notify(err.message || 'Failed to add question', 'error')
    } finally {
      setAddingQuestion(false)
    }
  }

  // Delete Question
  const handleDeleteQuestion = async (qId) => {
    try {
      await api.admin.deleteQuestion(adminToken, qId)
      notify('Question removed.', 'info')
      openQuestionManager(selectedExamForQuestions)
      refreshExams()
    } catch (err) {
      notify(err.message || 'Failed to delete question', 'error')
    }
  }

  // Create Student
  const handleAddStudent = async (e) => {
    e.preventDefault()
    if (!newStudentUser || !newStudentName || !newStudentPass) return
    setAddingStudent(true)
    try {
      await api.admin.createStudent(adminToken, {
        username: newStudentUser.trim(),
        name: newStudentName.trim(),
        password: newStudentPass,
      })
      notify(`Student account ${newStudentUser} created.`, 'success')
      setShowAddStudent(false)
      setNewStudentUser('')
      setNewStudentName('')
      setNewStudentPass('')
      refreshStudents()
    } catch (err) {
      notify(err.message || 'Failed to create student', 'error')
    } finally {
      setAddingStudent(false)
    }
  }

  const counts = countByStatus(attempts)
  const rows = sortAttempts(filterAttempts(attempts, { query, status }), sort)
  const selected = attempts.find((item) => item.sessionId === selectedId)

  return (
    <main className="monitor">
      <header className="monitor-head">
        <div>
          <span className="eyebrow">Athena Administration</span>
          <h1>Central Command</h1>
          <p className="subtle">
            Logged in as <strong>{adminUser?.name || 'Administrator'}</strong>. Connected to shared backend.
          </p>
        </div>

        <nav className="segmented admin-nav-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'attempts'}
            onClick={() => setActiveTab('attempts')}>
            <Icon name="list" size={14} /> Attempt Monitor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'exams'}
            onClick={() => setActiveTab('exams')}>
            <Icon name="check" size={14} /> Exam Management
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'students'}
            onClick={() => setActiveTab('students')}>
            <Icon name="user" size={14} /> Students
          </button>
        </nav>

        <Button variant="ghost" size="sm" icon="x" onClick={onSignOut}>
          Sign out
        </Button>
      </header>

      {/* TAB 1: ATTEMPT MONITOR */}
      {activeTab === 'attempts' && (
        <>
          <div className="monitor-stats-bar">
            <dl className="monitor-counts" aria-label="Attempt statistics">
              <div>
                <dt>Total Attempts</dt>
                <dd className="num">{counts.total}</dd>
              </div>
              <div>
                <dt>In Progress</dt>
                <dd className="num">{counts['in-progress']}</dd>
              </div>
              <div className={counts.locked ? 'alert' : ''}>
                <dt>Locked</dt>
                <dd className="num">{counts.locked}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd className="num">{counts.submitted}</dd>
              </div>
            </dl>
          </div>

          {attemptsError && <Callout tone="warning" role="alert">{attemptsError}</Callout>}

          <div className="monitor-toolbar">
            <label className="search">
              <Icon name="user" size={16} />
              <input
                type="search"
                placeholder="Search by student name or ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>

            <div className="segmented" role="group" aria-label="Filter status">
              {STATUS_FILTERS.map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={status === val}
                  onClick={() => setStatus(val)}>
                  {lbl}
                </button>
              ))}
            </div>

            <label className="sort">
              <span>Sort:</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="activity">Latest activity</option>
                <option value="critical">Critical events</option>
                <option value="deadline">Deadline</option>
                <option value="name">Student name</option>
              </select>
            </label>
          </div>

          <div className="monitor-body">
            <div className="table-wrap">
              {loadingAttempts ? (
                <p className="row muted table-message" role="status">
                  <span className="spinner" /> Loading real-time student attempts…
                </p>
              ) : rows.length === 0 ? (
                <div className="empty-state">
                  <Icon name="list" size={24} />
                  <strong>No attempts match your filters</strong>
                  <span>Attempts will appear here as soon as students begin their assessments.</span>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Status</th>
                      <th>Time Remaining</th>
                      <th>Answered</th>
                      <th>Critical Alerts</th>
                      <th>Score</th>
                      <th>Last Sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((att) => {
                      const remaining = attemptRemaining(att, 0, now)
                      const critical = criticalCount(att)
                      const isSelected = att.sessionId === selectedId
                      return (
                        <tr
                          key={att.sessionId}
                          aria-selected={isSelected}
                          onClick={() => setSelectedId(att.sessionId)}>
                          <td>
                            <button
                              type="button"
                              className="row-link"
                              onClick={() => setSelectedId(att.sessionId)}>
                              {att.name}
                            </button>
                            <small>{att.userId}</small>
                          </td>
                          <td>
                            <Badge tone={STATUS_TONE[att.status]} dot>
                              {STATUS_LABEL[att.status]}
                            </Badge>
                          </td>
                          <td className={`num ${remaining !== null && remaining < 60000 ? 'urgent' : ''}`}>
                            {remaining === null ? '—' : formatDuration(remaining)}
                          </td>
                          <td className="num">{att.attempted ?? (att.answers ? Object.keys(att.answers).length : 0)}</td>
                          <td className="num">
                            {critical ? <Badge tone="danger">{critical}</Badge> : '0'}
                          </td>
                          <td className="num" style={{ fontWeight: 650 }}>
                            {att.totalScore ?? att.correct ?? '—'}
                          </td>
                          <td className="num subtle">
                            {new Date(lastActivity(att)).toLocaleTimeString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {selected && (
              <AttemptDetail
                key={selected.sessionId}
                attempt={selected}
                adminToken={adminToken}
                serverOffset={0}
                now={now}
                onChanged={refreshAttempts}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
        </>
      )}

      {/* TAB 2: EXAM MANAGEMENT */}
      {activeTab === 'exams' && (
        <section className="exam-admin-panel">
          <div className="section-head-bar">
            <div>
              <h2>Configured Exams</h2>
              <p className="subtle">Create, schedule, configure question sets, and publish assessments.</p>
            </div>
            <Button icon="check" onClick={() => setShowCreateExam(true)}>
              Create New Exam
            </Button>
          </div>

          <div className="table-wrap">
            {loadingExams ? (
              <p className="row muted table-message"><span className="spinner" /> Loading examinations…</p>
            ) : exams.length === 0 ? (
              <div className="empty-state">
                <Icon name="check" size={24} />
                <strong>No exams created yet</strong>
                <span>Click "Create New Exam" above to add your first assessment.</span>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Title & Description</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Questions</th>
                    <th>Attempts</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.map((exam) => (
                    <tr key={exam.id}>
                      <td>
                        <strong>{exam.title}</strong>
                        <small>{exam.description || 'No description provided'}</small>
                      </td>
                      <td>
                        <Badge tone={exam.status === 'PUBLISHED' ? 'success' : 'neutral'} dot>
                          {exam.status}
                        </Badge>
                      </td>
                      <td className="num">{exam.durationMinutes} min</td>
                      <td className="num">{exam._count?.questions || 0}</td>
                      <td className="num">{exam._count?.attempts || 0}</td>
                      <td>
                        <div className="row" style={{ gap: '6px' }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openQuestionManager(exam)}>
                            Questions ({exam._count?.questions || 0})
                          </Button>
                          <Button
                            size="sm"
                            variant={exam.status === 'PUBLISHED' ? 'ghost' : 'primary'}
                            onClick={() => handleTogglePublish(exam)}>
                            {exam.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                          </Button>
                          <a
                            href={api.admin.exportUrl(exam.id)}
                            download
                            className="btn btn-sm btn-secondary"
                            style={{ textDecoration: 'none' }}>
                            CSV Results
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: STUDENT MANAGEMENT */}
      {activeTab === 'students' && (
        <section className="student-admin-panel">
          <div className="section-head-bar">
            <div>
              <h2>Enrolled Students</h2>
              <p className="subtle">Provision student login accounts for authorized test-takers.</p>
            </div>
            <Button icon="user" onClick={() => setShowAddStudent(true)}>
              Provision Student Account
            </Button>
          </div>

          <div className="table-wrap">
            {loadingStudents ? (
              <p className="row muted table-message"><span className="spinner" /> Loading enrolled students…</p>
            ) : students.length === 0 ? (
              <div className="empty-state">
                <Icon name="user" size={24} />
                <strong>No students provisioned yet</strong>
                <span>Provision student accounts so they can sign in from the downloaded Athena DMG.</span>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Student ID / Username</th>
                    <th>Full Name</th>
                    <th>Date Enrolled</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((st) => (
                    <tr key={st.id}>
                      <td><code>{st.username}</code></td>
                      <td><strong>{st.name}</strong></td>
                      <td className="subtle">{new Date(st.createdAt).toLocaleDateString()}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="btn-danger"
                          onClick={async () => {
                            if (window.confirm(`Delete student account ${st.username}?`)) {
                              await api.admin.deleteStudent(adminToken, st.id)
                              notify('Student deleted.', 'info')
                              refreshStudents()
                            }
                          }}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* CREATE EXAM MODAL */}
      <Modal
        open={showCreateExam}
        title="Create New Examination"
        onClose={() => setShowCreateExam(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowCreateExam(false)}>Cancel</Button>
            <Button loading={creatingExam} onClick={handleCreateExam}>Save Exam</Button>
          </>
        )}>
        <form onSubmit={handleCreateExam} className="modal-form-grid">
          <Field label="Exam Title" value={newExamTitle} required onChange={(e) => setNewExamTitle(e.target.value)} />
          <Field label="Description / Instructions" value={newExamDesc} onChange={(e) => setNewExamDesc(e.target.value)} />
          <div className="form-grid">
            <Field label="Duration (Minutes)" type="number" min="1" value={newExamDuration} onChange={(e) => setNewExamDuration(e.target.value)} />
            <Field label="Total Marks" type="number" min="1" value={newExamMarks} onChange={(e) => setNewExamMarks(e.target.value)} />
          </div>
        </form>
      </Modal>

      {/* QUESTIONS MANAGEMENT MODAL */}
      <Modal
        open={selectedExamForQuestions !== null}
        title={`Questions: ${selectedExamForQuestions?.title}`}
        onClose={() => setSelectedExamForQuestions(null)}
        footer={(
          <Button variant="secondary" onClick={() => setSelectedExamForQuestions(null)}>Done</Button>
        )}>
        <div className="question-manager-content">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: '16px' }}>
            <span className="subtle">{examQuestions.length} questions in this assessment</span>
            <Button size="sm" icon="check" onClick={() => setShowAddQuestion(true)}>Add Question</Button>
          </div>

          {loadingQuestions ? (
            <p className="subtle"><span className="spinner" /> Loading question items…</p>
          ) : examQuestions.length === 0 ? (
            <p className="subtle">No questions added yet. Click "Add Question" above to configure your question set.</p>
          ) : (
            <div className="questions-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {examQuestions.map((q, idx) => (
                <div key={q.id} className="card" style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="row" style={{ gap: '6px' }}>
                      <span className="badge badge-accent">Q{idx + 1}</span>
                      <span className="badge">{q.type}</span>
                      <span className="badge">{q.marks} pts</span>
                    </div>
                    <strong style={{ display: 'block', marginTop: '4px' }}>{q.prompt}</strong>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteQuestion(q.id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ADD QUESTION MODAL */}
      <Modal
        open={showAddQuestion}
        title="Add Question to Exam"
        onClose={() => setShowAddQuestion(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowAddQuestion(false)}>Cancel</Button>
            <Button loading={addingQuestion} onClick={handleAddQuestion}>Add to Exam</Button>
          </>
        )}>
        <form onSubmit={handleAddQuestion} className="modal-form-grid">
          <Field label="Question Type" as="select" value={qType} onChange={(e) => setQType(e.target.value)}>
            <select value={qType} onChange={(e) => setQType(e.target.value)} style={{ width: '100%', height: '36px' }}>
              <option value="MCQ">Multiple Choice (Single Answer)</option>
              <option value="MSQ">Multiple Select (One or more answers)</option>
              <option value="TRUE_FALSE">True / False</option>
              <option value="SHORT_ANSWER">Short Answer / Essay</option>
            </select>
          </Field>

          <Field label="Question Prompt" value={qPrompt} required onChange={(e) => setQPrompt(e.target.value)} />

          {(qType === 'MCQ' || qType === 'MSQ') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Field label="Option 1" value={qOption1} onChange={(e) => setQOption1(e.target.value)} />
              <Field label="Option 2" value={qOption2} onChange={(e) => setQOption2(e.target.value)} />
              <Field label="Option 3" value={qOption3} onChange={(e) => setQOption3(e.target.value)} />
              <Field label="Option 4" value={qOption4} onChange={(e) => setQOption4(e.target.value)} />
              <Field
                label={qType === 'MCQ' ? 'Correct Option Index (0 for Option 1, 1 for Option 2...)' : 'Correct Option Indices (comma-separated, e.g. 0,2)'}
                value={qCorrect}
                onChange={(e) => setQCorrect(e.target.value)}
              />
            </div>
          )}

          {qType === 'TRUE_FALSE' && (
            <Field label="Correct Choice (0 for True, 1 for False)" value={qCorrect} onChange={(e) => setQCorrect(e.target.value)} />
          )}

          {qType === 'SHORT_ANSWER' && (
            <Field label="Objective Reference Answer or Grading Guidance" value={qCorrect} onChange={(e) => setQCorrect(e.target.value)} />
          )}

          <Field label="Marks" type="number" value={qMarks} onChange={(e) => setQMarks(e.target.value)} />
        </form>
      </Modal>

      {/* PROVISION STUDENT MODAL */}
      <Modal
        open={showAddStudent}
        title="Provision Student Account"
        onClose={() => setShowAddStudent(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setShowAddStudent(false)}>Cancel</Button>
            <Button loading={addingStudent} onClick={handleAddStudent}>Create Student</Button>
          </>
        )}>
        <form onSubmit={handleAddStudent} className="modal-form-grid">
          <Field label="Student ID / Username" value={newStudentUser} placeholder="e.g. student01" required onChange={(e) => setNewStudentUser(e.target.value)} />
          <Field label="Student Full Name" value={newStudentName} placeholder="e.g. Jane Doe" required onChange={(e) => setNewStudentName(e.target.value)} />
          <Field label="Temporary Password" type="password" value={newStudentPass} placeholder="••••••••••••" required onChange={(e) => setNewStudentPass(e.target.value)} />
        </form>
      </Modal>
    </main>
  )
}
