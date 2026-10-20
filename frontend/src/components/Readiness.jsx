import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'

const CAMERA_TEXT = {
  idle: 'Not checked yet',
  requesting: 'Waiting for permission…',
  live: 'Camera is working',
  denied: 'Permission denied. Allow camera access in system settings, then try again.',
  error: 'No camera found or it is in use by another app.',
  lost: 'Camera stopped. Check the connection and try again.',
}

export default function Readiness({ camera, onBegin, isDesktop }) {
  const videoRef = useRef(null)
  const [service, setService] = useState(null)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const check = () => api.health()
      .then(() => !cancelled && setService(true))
      .catch(() => !cancelled && setService(false))
    check()
    const timer = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camera.stream
  }, [camera.stream])

  const ready = service && camera.status === 'live' && agreed && name.trim() && studentId.trim()

  async function start() {
    setStarting(true)
    setError('')
    try {
      await document.documentElement.requestFullscreen()
      await onBegin(studentId.trim(), name.trim())
    } catch (startError) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setError(startError?.message?.includes('ullscreen')
        ? 'Fullscreen is required to start the exam.'
        : 'The exam could not be started. Check the exam service and try again.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <main className="setup-layout">
      <section className="welcome-panel">
        <div className="eyebrow">Before you begin</div>
        <h1>Exam<br /><em>instructions.</em></h1>
        <ol className="instructions">
          <li>The exam is timed. It submits automatically when time runs out.</li>
          <li>Answers save automatically. If the app closes, reopen it to continue.</li>
          <li>Stay in fullscreen. Leaving fullscreen <strong>locks your answers</strong> until an instructor unlocks them.</li>
          <li>Switching apps and camera interruptions are recorded with timestamps.</li>
          <li>While the exam runs, Athena saves a camera photo and a screenshot about every 30 seconds{isDesktop ? '' : ' (screenshots only in the desktop app)'}. They stay on this device.</li>
        </ol>
      </section>

      <section className="setup-card">
        <div className="card-heading">
          <div><div className="eyebrow">Readiness check</div><h2>Prepare your workspace</h2></div>
          <span className={`connection-pill ${service === false ? 'offline' : ''}`}>
            <span className="status-dot" />
            {service === null ? 'Checking service' : service ? 'Service ready' : 'Service offline'}
          </span>
        </div>

        <div className="form-row">
          <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} /></label>
          <label>Student ID<input value={studentId} onChange={(event) => setStudentId(event.target.value)} maxLength={64} /></label>
        </div>

        <div className="check-list">
          <div className={`check-item ${camera.status === 'live' ? 'complete' : ''}`}>
            <div className="check-icon">{camera.status === 'live' ? '✓' : '01'}</div>
            <div className="check-copy"><h3>Camera</h3><p>{CAMERA_TEXT[camera.status]}</p></div>
            <button className="text-button" disabled={camera.status === 'live' || camera.status === 'requesting'} onClick={camera.start}>
              {camera.status === 'live' ? 'Ready' : 'Check camera'}
            </button>
          </div>
          <video ref={videoRef} autoPlay playsInline muted className={`camera-preview ${camera.stream ? '' : 'hidden'}`} />
          <label className="agree">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            I have read the instructions and agree to camera and screen monitoring during this exam.
          </label>
        </div>

        {service === false && <div className="error-message" role="alert">Exam service is offline. Start the backend (npm start in backend/) and wait a moment.</div>}
        {error && <div className="error-message" role="alert">{error}</div>}

        <button className="primary-button start-button" disabled={!ready || starting} onClick={start}>
          {starting ? 'Opening exam…' : 'Enter fullscreen and start'}<span>↗</span>
        </button>
      </section>
    </main>
  )
}
