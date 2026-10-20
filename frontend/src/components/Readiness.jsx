import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import { validateIdentity } from '../lib/exam.js'
import Button from './ui/Button.jsx'
import Card from './ui/Card.jsx'
import Badge from './ui/Badge.jsx'
import Callout from './ui/Callout.jsx'
import Field from './ui/Field.jsx'
import Icon from './ui/Icon.jsx'

const STEPS = ['Welcome', 'Your details', 'System check', 'Consent']

const CAMERA = {
  idle: { tone: 'neutral', label: 'Not checked', help: 'Athena needs your camera for the whole exam.' },
  requesting: { tone: 'info', label: 'Waiting', help: 'Allow camera access in the prompt.' },
  live: { tone: 'success', label: 'Working', help: 'Make sure your face is clearly visible.' },
  denied: { tone: 'danger', label: 'Blocked', help: 'Camera permission was denied. Allow Athena in System Settings → Privacy & Security → Camera, then try again.' },
  error: { tone: 'danger', label: 'Unavailable', help: 'No camera was found, or another app is using it. Close other video apps and try again.' },
  lost: { tone: 'danger', label: 'Disconnected', help: 'The camera stopped. Reconnect it and try again.' },
}

function useServiceStatus() {
  const [info, setInfo] = useState(null)
  const [online, setOnline] = useState(null)
  useEffect(() => {
    let cancelled = false
    const check = () => api.info()
      .then((data) => { if (!cancelled) { setInfo(data); setOnline(true) } })
      .catch(() => { if (!cancelled) setOnline(false) })
    check()
    const timer = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return { info, online }
}

function Stepper({ step }) {
  return (
    <ol className="stepper" aria-label="Setup progress">
      {STEPS.map((label, index) => (
        <li key={label} className={index === step ? 'current' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}>
          <span className="stepper-dot">{index < step ? <Icon name="check" size={12} /> : index + 1}</span>
          <span className="stepper-label">{label}</span>
        </li>
      ))}
    </ol>
  )
}

function CheckRow({ icon, title, status, tone, children, action }) {
  return (
    <div className="check-row">
      <span className={`check-icon tone-${tone}`}><Icon name={icon} /></span>
      <div className="check-text">
        <div className="row"><strong>{title}</strong><Badge tone={tone} dot>{status}</Badge></div>
        <p className="subtle">{children}</p>
      </div>
      {action}
    </div>
  )
}

export default function Readiness({ camera, onBegin, athena }) {
  const { info, online } = useServiceStatus()
  const [step, setStep] = useState(0)
  const [identity, setIdentity] = useState({ name: '', studentId: '' })
  const [touched, setTouched] = useState(false)
  const [screen, setScreen] = useState(athena ? { state: 'idle' } : { state: 'unsupported' })
  const [agreed, setAgreed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const videoRef = useRef(null)
  const headingRef = useRef(null)

  const errors = validateIdentity(identity)
  const cam = CAMERA[camera.status]

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camera.stream
  }, [camera.stream, step])

  // Move focus to the step heading so screen readers announce the change.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  async function checkScreen() {
    setScreen({ state: 'checking' })
    try {
      const result = await athena.checkScreenCapture()
      setScreen({ state: result.canCapture ? 'ok' : 'blocked', ...result })
    } catch {
      setScreen({ state: 'blocked' })
    }
  }

  const screenReady = screen.state === 'ok' || screen.state === 'unsupported'
  const checksReady = online && camera.status === 'live' && screenReady

  async function start() {
    setStarting(true)
    setError('')
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      setStarting(false)
      setError('Athena could not enter fullscreen. Fullscreen is required for this exam.')
      return
    }
    try {
      await onBegin(identity.studentId.trim(), identity.name.trim())
    } catch {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setError('The exam could not be started because the exam service did not respond. Try again in a moment.')
      setStarting(false)
    }
  }

  return (
    <main className="readiness">
      <Stepper step={step} />

      {step === 0 && (
        <Card className="readiness-card">
          <div className="eyebrow">Welcome</div>
          <h1 className="display" tabIndex={-1} ref={headingRef}>{info?.title || 'Your exam'}</h1>
          <div className="exam-facts">
            <div><Icon name="clock" /><strong>{info ? `${info.durationMinutes} minutes` : '—'}</strong><span>Time limit</span></div>
            <div><Icon name="list" /><strong>{info ? info.questionCount : '—'}</strong><span>Questions</span></div>
            <div><Icon name="lock" /><strong>Fullscreen</strong><span>Required</span></div>
          </div>
          <h2 className="section-title">Before you begin</h2>
          <ul className="rule-list">
            <li>The timer is set by the exam server. When it reaches zero, your exam is submitted automatically.</li>
            <li>Your answers save automatically. If Athena closes or your connection drops, reopen it to continue where you left off.</li>
            <li><strong>Leaving fullscreen locks your answers</strong> until an instructor unlocks your attempt.</li>
            <li>You can flag questions to review them later. Flags do not affect your score.</li>
          </ul>
          {online === false && <Callout tone="danger" role="alert">The exam service is offline. Start the backend, or ask your instructor. This page checks again every few seconds.</Callout>}
          <div className="card-actions">
            <Button iconRight="arrowRight" onClick={() => setStep(1)} disabled={!online}>Get started</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="readiness-card" as="form" onSubmit={(event) => {
          event.preventDefault()
          setTouched(true)
          if (Object.keys(errors).length === 0) setStep(2)
        }}>
          <div className="eyebrow">Step 2 of 4</div>
          <h1 className="display" tabIndex={-1} ref={headingRef}>Your details</h1>
          <p className="muted">These identify your attempt to your instructor.</p>
          <div className="form-grid">
            <Field label="Full name" autoComplete="name" value={identity.name} maxLength={64}
              onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              error={touched ? errors.name : undefined} />
            <Field label="Student ID" value={identity.studentId} maxLength={32} hint="For example CS-2041"
              onChange={(event) => setIdentity({ ...identity, studentId: event.target.value })}
              error={touched ? errors.studentId : undefined} />
          </div>
          <div className="card-actions">
            <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(0)}>Back</Button>
            <Button type="submit" iconRight="arrowRight">Continue</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="readiness-card">
          <div className="eyebrow">Step 3 of 4</div>
          <h1 className="display" tabIndex={-1} ref={headingRef}>System check</h1>
          <div className="check-grid">
            <div className="check-list">
              <CheckRow icon="cloud" title="Exam service" tone={online ? 'success' : online === false ? 'danger' : 'neutral'}
                status={online ? 'Connected' : online === false ? 'Offline' : 'Checking'}>
                {online ? 'Answers will be saved to the exam server.' : 'Athena cannot reach the exam server yet.'}
              </CheckRow>
              <CheckRow icon="camera" title="Camera" tone={cam.tone} status={cam.label}
                action={camera.status !== 'live' && (
                  <Button variant="secondary" size="sm" loading={camera.status === 'requesting'} onClick={camera.start}>
                    {camera.status === 'idle' ? 'Check camera' : 'Try again'}
                  </Button>
                )}>
                {cam.help}
              </CheckRow>
              <CheckRow icon="screen" title="Screen capture"
                tone={screen.state === 'ok' ? 'success' : screen.state === 'blocked' ? 'danger' : screen.state === 'unsupported' ? 'warning' : 'neutral'}
                status={{ idle: 'Not checked', checking: 'Checking', ok: 'Working', blocked: 'Blocked', unsupported: 'Desktop only' }[screen.state]}
                action={athena && screen.state !== 'ok' && (
                  <Button variant="secondary" size="sm" loading={screen.state === 'checking'} onClick={checkScreen}>
                    {screen.state === 'blocked' ? 'Check again' : 'Check screen'}
                  </Button>
                )}>
                {screen.state === 'blocked'
                  ? (screen.platform === 'darwin'
                    ? 'Allow Athena in System Settings → Privacy & Security → Screen Recording, restart Athena, then check again.'
                    : 'Athena could not capture the screen. Close screen-sharing apps and check again.')
                  : screen.state === 'unsupported'
                    ? 'You are using the browser preview. Screenshots only work in the Athena desktop app.'
                    : 'Athena saves a screenshot about every 30 seconds during the exam.'}
              </CheckRow>
            </div>
            <div className={`camera-frame ${camera.status === 'live' ? 'live' : ''}`}>
              <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
              {camera.status !== 'live' && <div className="camera-placeholder"><Icon name="camera" size={28} /><span>Camera preview</span></div>}
            </div>
          </div>
          <div className="card-actions">
            <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(1)}>Back</Button>
            <Button iconRight="arrowRight" disabled={!checksReady} onClick={() => setStep(3)}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card className="readiness-card">
          <div className="eyebrow">Step 4 of 4</div>
          <h1 className="display" tabIndex={-1} ref={headingRef}>Monitoring and consent</h1>
          <div className="consent-columns">
            <div>
              <h2 className="section-title">During the exam, Athena records</h2>
              <ul className="rule-list">
                <li>A camera photo about every 30 seconds</li>
                <li>A screenshot about every 30 seconds (desktop app)</li>
                <li>Timestamped events: leaving fullscreen, switching windows, camera or screen-capture interruptions, connection loss</li>
              </ul>
            </div>
            <div>
              <h2 className="section-title">Athena does not record</h2>
              <ul className="rule-list">
                <li>Your keystrokes or microphone</li>
                <li>Anything before you start or after you submit</li>
                <li>Video streams. The preview stays on your device</li>
              </ul>
            </div>
          </div>
          <p className="subtle">Photos and screenshots are stored on this device in Athena’s data folder. A visible indicator shows while monitoring is active.</p>
          <label className="consent-check">
            <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
            <span>I understand the exam rules and agree to this monitoring for the duration of the exam.</span>
          </label>
          {error && <Callout tone="danger" role="alert">{error}</Callout>}
          <div className="card-actions">
            <Button variant="ghost" icon="arrowLeft" onClick={() => setStep(2)}>Back</Button>
            <Button size="lg" iconRight="arrowRight" disabled={!agreed || !checksReady} loading={starting} onClick={start}>
              Enter fullscreen and start
            </Button>
          </div>
        </Card>
      )}
    </main>
  )
}
