import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import { formatDuration, syncLabel } from '../lib/exam.js'
import { answerSummary, filterQuestions, keyAction, timerLevel } from '../lib/navigation.js'
import Button from './ui/Button.jsx'
import Icon from './ui/Icon.jsx'
import Callout from './ui/Callout.jsx'
import LockedPanel from './LockedPanel.jsx'
import SubmitDialog from './SubmitDialog.jsx'
import PracticalTask from './PracticalTask.jsx'
import { usePractical } from '../hooks/usePractical.js'

function Indicator({ ok, label }) {
  return <div className={`status-line ${ok ? 'ok' : 'bad'}`}><Icon name={ok ? 'check' : 'alert'} size={14} />{label}</div>
}

const FILTERS = [['all', 'All'], ['unanswered', 'Unanswered'], ['flagged', 'Flagged']]

export default function ExamScreen({ exam, camera, athena }) {
  const [current, setCurrent] = useState(0)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('questions') // questions | practical
  const practical = usePractical(exam.token)
  const practicalTask = practical.tasks?.[0]
  const [confirming, setConfirming] = useState(false)
  const [screenOk, setScreenOk] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [activeDisallowed, setActiveDisallowed] = useState([])
  const videoRef = useRef(null)
  const { logEvent } = exam
  const snapshot = camera.snapshot

  const checkRunningApps = useCallback(async () => {
    if (!athena?.checkBackgroundApps) return
    try {
      const result = await athena.checkBackgroundApps()
      if (result?.supported && result.found) {
        if (result.found.length > 0) {
          logEvent('disallowed-app-detected', `Detected running: ${result.found.join(', ')}`)
          setActiveDisallowed(result.found)
        } else {
          setActiveDisallowed([])
        }
      }
    } catch {
      // Best-effort background scan
    }
  }, [athena, logEvent])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camera.stream
  }, [camera.stream])

  // Browser-level activity signals. These are detection only: a normal
  // desktop app cannot stop the OS from switching apps.
  useEffect(() => {
    const onFullscreen = () => {
      const active = Boolean(document.fullscreenElement)
      setIsFullscreen(active)
      logEvent(active ? 'fullscreen-enter' : 'fullscreen-exit')
    }
    const onBlur = () => {
      logEvent('window-blur')
      checkRunningApps()
    }
    const onFocus = () => {
      logEvent('window-focus')
      checkRunningApps()
    }
    const onOnline = () => { setOnline(true); logEvent('network-online') }
    const onOffline = () => { setOnline(false); logEvent('network-offline') }
    document.addEventListener('fullscreenchange', onFullscreen)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [logEvent, checkRunningApps])

  // Camera interruptions.
  const previousCamera = useRef(camera.status)
  useEffect(() => {
    if (previousCamera.current === 'live' && camera.status !== 'live') logEvent('camera-lost', camera.status)
    if (previousCamera.current !== 'live' && camera.status === 'live') logEvent('camera-restored')
    previousCamera.current = camera.status
  }, [camera.status, logEvent])

  // Desktop-only evidence capture and active background application monitoring.
  const sessionId = exam.attempt?.sessionId
  useEffect(() => {
    if (!athena) return undefined
    const offScreen = athena.onScreenCaptureStatus((ok) => {
      setScreenOk(ok)
      logEvent(ok ? 'screen-capture-restored' : 'screen-capture-failed')
    })
    const offScreenSnap = athena.onScreenSnapshotCaptured?.((base64) => {
      if (exam.token && base64) {
        api.student.uploadEvidence(exam.token, 'screen', base64).catch(() => {})
      }
    })
    const offCamera = athena.onCameraSnapshotRequest(async () => {
      const bytes = await snapshot().catch(() => null)
      if (bytes) {
        athena.saveCameraSnapshot(bytes, sessionId).catch(() => {})
        if (exam.token) {
          const blob = new Blob([bytes], { type: 'image/jpeg' })
          const reader = new FileReader()
          reader.onloadend = () => {
            const base64 = reader.result
            if (base64) api.student.uploadEvidence(exam.token, 'camera', base64).catch(() => {})
          }
          reader.readAsDataURL(blob)
        }
      }
      checkRunningApps()
    })
    athena.startProctoring(sessionId)
    return () => {
      offScreen()
      if (offScreenSnap) offScreenSnap()
      offCamera()
      athena.stopProctoring()
    }
  }, [athena, sessionId, logEvent, snapshot, checkRunningApps, exam.token])

  const { questions, answers, flags, attempt, answerable, pendingLock } = exam
  const question = questions[current]
  const locked = attempt?.status === 'locked' || pendingLock
  // A resumed attempt (after a restart) starts outside fullscreen. That is
  // not a policy violation, but answering waits until fullscreen is back.
  const needsFullscreen = !isFullscreen && !locked
  const canEdit = answerable && isFullscreen
  const summary = answerSummary(questions, answers, flags)
  const level = timerLevel(exam.remaining)
  const visible = filterQuestions(questions, filter, answers, flags)
  const isLast = current === questions.length - 1
  const sync = syncLabel({ saveState: exam.saveState, lastSavedAt: exam.lastSavedAt, online })

  // Keyboard shortcuts: ← → to move, 1–9 to choose, F to flag.
  const handlersRef = useRef({})
  useLayoutEffect(() => {
    handlersRef.current = {
      next: () => setCurrent((index) => Math.min(index + 1, questions.length - 1)),
      previous: () => setCurrent((index) => Math.max(index - 1, 0)),
      flag: () => canEdit && question && exam.toggleFlag(question.id),
      choose: (index) => canEdit && question && exam.chooseAnswer(question.id, index),
    }
  })
  useEffect(() => {
    const onKey = (event) => {
      if (document.querySelector('dialog[open]')) return
      const action = keyAction(event, question?.options.length || 0)
      if (!action) return
      event.preventDefault()
      handlersRef.current[action.type](action.index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [question])

  return (
    <div className="exam">
      <header className="exam-bar">
        <div className="exam-bar-title">
          <span className="eyebrow">In progress</span>
          <strong>{exam.examTitle}</strong>
        </div>
        <div className={`timer-pill timer-${level}`} role="timer" aria-label={`Time remaining ${formatDuration(exam.remaining)}`}>
          <Icon name="clock" size={16} />
          <span>{formatDuration(exam.remaining)}</span>
        </div>
        <div className="exam-bar-right">
          <div className={`sync-state tone-${sync.tone}`} role="status">
            <Icon name={sync.tone === 'success' ? 'check' : sync.tone === 'neutral' ? 'cloud' : 'alert'} size={14} />
            {sync.text}
          </div>
          <div className="exam-bar-progress">
            <span className="num">{summary.answered}/{summary.total} answered</span>
            <div className="progress-track" aria-hidden="true"><span style={{ width: `${(summary.answered / Math.max(summary.total, 1)) * 100}%` }} /></div>
          </div>
        </div>
      </header>
      {level === 'critical' && exam.remaining > 0 && <p className="visually-hidden" role="alert">Less than one minute remaining.</p>}

      <div className="exam-body">
        <aside className="navigator" aria-label="Questions">
          {practicalTask && (
            <div className="view-tabs" role="tablist" aria-label="Exam sections">
              <button type="button" role="tab" aria-selected={view === 'questions'} onClick={() => setView('questions')}>Questions</button>
              <button type="button" role="tab" aria-selected={view === 'practical'} onClick={() => setView('practical')}>
                Practical <span className="subtle num">{practicalTask.files.length}</span>
              </button>
            </div>
          )}
          <div className="segmented" role="group" aria-label="Filter questions">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
                {value === 'unanswered' && summary.unanswered.length > 0 && <span className="count">{summary.unanswered.length}</span>}
                {value === 'flagged' && summary.flagged.length > 0 && <span className="count">{summary.flagged.length}</span>}
              </button>
            ))}
          </div>
          <div className="question-grid">
            {visible.map(({ question: item, index, answered, flagged }) => (
              <button key={item.id} type="button" onClick={() => { setView('questions'); setCurrent(index) }}
                className={`q-chip ${index === current ? 'current' : ''} ${answered ? 'answered' : ''} ${flagged ? 'flagged' : ''}`}
                aria-current={index === current ? 'true' : undefined}
                aria-label={`Question ${index + 1}${answered ? ', answered' : ', not answered'}${flagged ? ', flagged' : ''}`}>
                {index + 1}
                {flagged && <span className="q-flag" aria-hidden="true" />}
              </button>
            ))}
            {visible.length === 0 && <p className="subtle">No {filter} questions.</p>}
          </div>
          <ul className="legend" aria-hidden="true">
            <li><span className="q-chip mini answered" />Answered</li>
            <li><span className="q-chip mini" />Not answered</li>
            <li><span className="q-chip mini flagged"><span className="q-flag" /></span>Flagged</li>
          </ul>
          <p className="shortcut-hint subtle"><kbd>←</kbd> <kbd>→</kbd> move · <kbd>1</kbd>–<kbd>{question?.options.length || 4}</kbd> answer · <kbd>F</kbd> flag</p>

          <div className="monitor-panel">
            <video ref={videoRef} autoPlay playsInline muted className="camera-thumb" aria-label="Your camera" />
            <Indicator ok={camera.status === 'live'} label={camera.status === 'live' ? 'Camera on' : 'Camera interrupted'} />
            <Indicator ok={athena ? screenOk !== false : false} label={!athena ? 'Screen capture: desktop app only' : screenOk === false ? 'Screen capture blocked' : 'Screen snapshots on'} />
            <Indicator ok={isFullscreen} label={isFullscreen ? 'Fullscreen' : 'Not fullscreen'} />
            <Indicator ok={online} label={online ? 'Connected' : 'No network connection'} />
            <Indicator ok={exam.eventState.pending === 0 && exam.eventState.rejected === 0}
              label={exam.eventState.rejected ? `${exam.eventState.rejected} activity events rejected`
                : exam.eventState.pending ? `${exam.eventState.pending} activity events waiting to send` : 'Activity log synced'} />
            {camera.status !== 'live' && <Button variant="secondary" size="sm" icon="refresh" onClick={camera.start}>Reconnect camera</Button>}
          </div>
        </aside>

        <main className="question-pane">
          {exam.extensionNotice && (
            <Callout tone="success" role="status">
              <div className="row">
                <Icon name="clock" size={16} />
                <span>{exam.extensionNotice}</span>
                <Button size="sm" variant="ghost" icon="x" onClick={exam.clearExtensionNotice} aria-label="Dismiss extension notice" />
              </div>
            </Callout>
          )}
          {needsFullscreen && (
            <Callout tone="warning" role="alert">
              <strong>Fullscreen required.</strong> Return to fullscreen to continue answering.{' '}
              <Button size="sm" variant="secondary" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Enter fullscreen</Button>
            </Callout>
          )}
          {activeDisallowed.length > 0 && (
            <Callout tone="danger" role="alert">
              <div className="row">
                <strong>Disallowed application detected:</strong> {activeDisallowed.join(', ')}.
                <Button size="sm" variant="secondary" onClick={checkRunningApps}>Close & Rescan</Button>
              </div>
              <p className="subtle">Running prohibited applications during an examination violates integrity policies and has been recorded on your activity timeline.</p>
            </Callout>
          )}
          {!locked && view === 'practical' && practicalTask ? <PracticalTask task={practicalTask} practical={practical} canEdit={canEdit} /> : locked ? <LockedPanel confirmed={attempt?.status === 'locked'} isFullscreen={isFullscreen} lockedAt={exam.lockedAt} /> : (
          <article className="question-card" aria-labelledby="question-text">
            <div className="question-meta">
              <div className="row" style={{ gap: '8px', alignItems: 'center' }}>
                <span className="eyebrow">Question {current + 1} of {questions.length}</span>
                {question?.type === 'MSQ' && <span className="badge badge-accent">Multiple Select</span>}
                {question?.type === 'TRUE_FALSE' && <span className="badge badge-info">True / False</span>}
                {question?.type === 'SHORT_ANSWER' && <span className="badge badge-warning">Short Answer</span>}
                {question?.marks !== undefined && <span className="badge">{question.marks} marks</span>}
              </div>
              <Button variant={flags.includes(question?.id) ? 'secondary' : 'ghost'} size="sm" icon="flag"
                className={flags.includes(question?.id) ? 'flag-on' : ''} disabled={!canEdit}
                aria-pressed={flags.includes(question?.id)} onClick={() => exam.toggleFlag(question.id)}>
                {flags.includes(question?.id) ? 'Flagged for review' : 'Flag for review'}
              </Button>
            </div>
            <h1 id="question-text" className="question-text">{question?.question}</h1>

            {question?.type === 'SHORT_ANSWER' ? (
              <div className="short-answer-wrap">
                <label htmlFor={`sa-${question.id}`} className="field-hint" style={{ fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                  Write your answer below:
                </label>
                <textarea
                  id={`sa-${question.id}`}
                  disabled={!canEdit}
                  rows={5}
                  className="short-answer-input"
                  placeholder="Type your response here..."
                  value={answers[question.id] || ''}
                  onChange={(e) => exam.chooseAnswer(question.id, e.target.value)}
                />
                <span className="field-hint" style={{ marginTop: '4px', display: 'block', textAlign: 'right' }}>
                  {(answers[question.id] || '').length} characters
                </span>
              </div>
            ) : question?.type === 'MSQ' ? (
              <div className="options" role="group" aria-labelledby="question-text">
                {question?.options?.map((option, index) => {
                  const currentSel = Array.isArray(answers[question.id]) ? answers[question.id] : []
                  const selected = currentSel.includes(index)
                  return (
                    <button key={option} type="button" role="checkbox" aria-checked={selected} disabled={!canEdit}
                      onClick={() => {
                        const updated = selected ? currentSel.filter((i) => i !== index) : [...currentSel, index].sort()
                        exam.chooseAnswer(question.id, updated)
                      }}
                      className={`option ${selected ? 'selected' : ''}`}>
                      <span className="option-key">{selected ? '✓' : index + 1}</span>
                      <span className="option-text">{option}</span>
                      {selected && <Icon name="check" size={16} />}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="options" role="radiogroup" aria-labelledby="question-text">
                {question?.options?.map((option, index) => {
                  const selected = answers[question.id] === index
                  return (
                    <button key={option} type="button" role="radio" aria-checked={selected} disabled={!canEdit}
                      onClick={() => exam.chooseAnswer(question.id, index)} className={`option ${selected ? 'selected' : ''}`}>
                      <span className="option-key">{index + 1}</span>
                      <span className="option-text">{option}</span>
                      {selected && <Icon name="check" size={16} />}
                    </button>
                  )
                })}
              </div>
            )}
          </article>
          )}

          <nav className="question-nav" aria-label="Question navigation" hidden={view === 'practical'}>
            <Button variant="secondary" icon="arrowLeft" disabled={current === 0} onClick={() => setCurrent(current - 1)}>Previous</Button>
            {isLast
              ? <Button iconRight="arrowRight" disabled={exam.submitting} onClick={() => setConfirming(true)}>Review and submit</Button>
              : <Button iconRight="arrowRight" onClick={() => setCurrent(current + 1)}>Next</Button>}
          </nav>

          {view === 'practical' && (
            <nav className="question-nav"><span /><Button iconRight="arrowRight" onClick={() => setConfirming(true)}>Review and submit</Button></nav>
          )}
          <SubmitDialog open={confirming} summary={summary} practicalFiles={practicalTask ? practicalTask.files.length : null} submitting={exam.submitting} error={exam.submitError}
            onCancel={() => setConfirming(false)} onConfirm={exam.submit}
            onJump={(index) => { setConfirming(false); setView('questions'); setCurrent(index) }} />
        </main>
      </div>
    </div>
  )
}
