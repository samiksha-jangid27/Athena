import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../lib/exam.js'

const SAVE_TEXT = { saved: 'All answers saved', saving: 'Saving…', offline: 'Offline, saved on this device', rejected: 'Not saved: answers are locked' }

function Indicator({ ok, label }) {
  return <div className={`indicator ${ok ? 'ok' : 'bad'}`}><span className="status-dot" />{label}</div>
}

export default function ExamScreen({ exam, camera, athena }) {
  const [current, setCurrent] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [screenOk, setScreenOk] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const videoRef = useRef(null)
  const { logEvent } = exam
  const snapshot = camera.snapshot

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
    const onBlur = () => logEvent('window-blur')
    const onFocus = () => logEvent('window-focus')
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
  }, [logEvent])

  // Camera interruptions.
  const previousCamera = useRef(camera.status)
  useEffect(() => {
    if (previousCamera.current === 'live' && camera.status !== 'live') logEvent('camera-lost', camera.status)
    if (previousCamera.current !== 'live' && camera.status === 'live') logEvent('camera-restored')
    previousCamera.current = camera.status
  }, [camera.status, logEvent])

  // Desktop-only evidence capture, with a visible indicator.
  useEffect(() => {
    if (!athena) return undefined
    const offScreen = athena.onScreenCaptureStatus((ok) => {
      setScreenOk(ok)
      logEvent(ok ? 'screen-capture-restored' : 'screen-capture-failed')
    })
    const offCamera = athena.onCameraSnapshotRequest(async () => {
      const bytes = await snapshot().catch(() => null)
      if (bytes) athena.saveCameraSnapshot(bytes).catch(() => {})
    })
    athena.startProctoring()
    return () => {
      offScreen()
      offCamera()
      athena.stopProctoring()
    }
  }, [athena, logEvent, snapshot])

  const { questions, answers, flags, attempt, answerable, pendingLock } = exam
  const question = questions[current]
  const answeredCount = Object.keys(answers).length
  const locked = attempt?.status === 'locked' || pendingLock
  // A resumed attempt (after a restart) starts outside fullscreen. That is
  // not a policy violation, but answering waits until fullscreen is back.
  const needsFullscreen = !isFullscreen && !locked
  const canEdit = answerable && isFullscreen
  const lowTime = exam.remaining < 60000

  return (
    <main className="exam-layout">
      <aside className="exam-sidebar">
        <div className={`timer ${lowTime ? 'low' : ''}`}><span>Time remaining</span><strong>{formatDuration(exam.remaining)}</strong></div>
        <div className="sidebar-progress">
          <div className="progress-label"><span>Answered</span><strong>{answeredCount}/{questions.length}</strong></div>
          <div className="progress-track"><span style={{ width: `${(answeredCount / questions.length) * 100}%` }} /></div>
        </div>
        <div className="question-grid">
          {questions.map((item, index) => (
            <button key={item.id} onClick={() => setCurrent(index)}
              className={`question-number ${index === current ? 'active' : ''} ${answers[item.id] !== undefined ? 'answered' : ''} ${flags.includes(item.id) ? 'flagged' : ''}`}>
              {String(index + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <video ref={videoRef} autoPlay playsInline muted className="camera-thumb" />
          <Indicator ok={camera.status === 'live'} label={camera.status === 'live' ? 'Camera on' : 'Camera interrupted'} />
          <Indicator ok={athena ? screenOk !== false : false} label={!athena ? 'Screen capture: desktop app only' : screenOk === false ? 'Screen capture blocked' : 'Screen snapshots on'} />
          <Indicator ok={isFullscreen} label={isFullscreen ? 'Fullscreen' : 'Not fullscreen'} />
          <Indicator ok={online && exam.saveState !== 'offline'} label={SAVE_TEXT[exam.saveState]} />
          <Indicator ok={exam.eventState.pending === 0 && exam.eventState.rejected === 0}
            label={exam.eventState.rejected ? `${exam.eventState.rejected} activity events rejected`
              : exam.eventState.pending ? `${exam.eventState.pending} activity events waiting to send` : 'Activity log synced'} />
          {camera.status !== 'live' && <button className="text-button" onClick={camera.start}>Reconnect camera</button>}
        </div>
      </aside>

      <section className="question-area">
        {needsFullscreen && (
          <div className="lock-banner" role="alert">
            <strong>Fullscreen required.</strong> Return to fullscreen to continue answering.
            <button className="secondary-button" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Enter fullscreen</button>
          </div>
        )}
        {locked && (
          <div className="lock-banner" role="alert">
            <strong>Answers locked.</strong> You left fullscreen.
            {' '}{isFullscreen ? 'Waiting for your instructor to unlock this attempt.' : 'Return to fullscreen, then ask your instructor to unlock.'}
            {!isFullscreen && <button className="secondary-button" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Return to fullscreen</button>}
          </div>
        )}
        <div className="question-topline">
          <span>Question {current + 1} <small>of {questions.length}</small></span>
          <button className={`flag-button ${flags.includes(question?.id) ? 'on' : ''}`} disabled={!canEdit} onClick={() => exam.toggleFlag(question.id)}>
            {flags.includes(question?.id) ? '⚑ Flagged for review' : '⚐ Flag for review'}
          </button>
        </div>

        <div className="question-card">
          <h2>{question?.question}</h2>
          <div className="option-list">
            {question?.options.map((option, index) => (
              <button key={option} disabled={!canEdit} onClick={() => exam.chooseAnswer(question.id, index)}
                className={`option ${answers[question.id] === index ? 'selected' : ''}`}>
                <span className="option-key">{String.fromCharCode(65 + index)}</span>
                <span>{option}</span>
                <span className="option-check">{answers[question.id] === index ? '✓' : ''}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="question-actions">
          <button className="secondary-button" disabled={current === 0} onClick={() => setCurrent(current - 1)}>← Previous</button>
          {current < questions.length - 1
            ? <button className="primary-button" onClick={() => setCurrent(current + 1)}>Next <span>→</span></button>
            : <button className="primary-button" disabled={exam.submitting} onClick={() => setConfirming(true)}>Review and submit <span>↗</span></button>}
        </div>

        {confirming && (
          <div className="confirm-box">
            <p>{answeredCount} of {questions.length} answered{flags.length ? `, ${flags.length} flagged for review` : ''}. You cannot change answers after submitting.</p>
            <div className="question-actions">
              <button className="secondary-button" onClick={() => setConfirming(false)}>Keep working</button>
              <button className="primary-button" disabled={exam.submitting} onClick={exam.submit}>{exam.submitting ? 'Submitting…' : 'Submit exam'}</button>
            </div>
          </div>
        )}
        {exam.submitError && <div className="error-message" role="alert">{exam.submitError}</div>}
      </section>
    </main>
  )
}
