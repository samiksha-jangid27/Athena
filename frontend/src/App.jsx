import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_URL = 'http://127.0.0.1:3000'

function App() {
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [timer, setTimer] = useState(0)
  const [backendConnected, setBackendConnected] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [questions, setQuestions] = useState([])
  const [userAnswers, setUserAnswers] = useState({})
  const [examSubmitted, setExamSubmitted] = useState(false)
  const [examResult, setExamResult] = useState(null)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const videoRef = useRef(null)
  const athena = typeof window !== 'undefined' ? window.athena : null
  const examStarted = questions.length > 0
  const answeredCount = Object.keys(userAnswers).length
  const activeQuestion = questions[currentQuestion]
  const progress = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0
  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timer / 60).toString().padStart(2, '0')
    const seconds = Math.floor(timer % 60).toString().padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [timer])

  const saveVideoScreenShots = useCallback(async () => {
    const track = videoRef.current?.srcObject?.getVideoTracks()[0]
    if (!track || !athena) return
    try {
      const imageCapture = new ImageCapture(track)
      const blob = await imageCapture.takePhoto()
      athena.storeCameraSnapImageOnDisk(await blob.arrayBuffer())
    } catch (error) {
      console.error('Failed to capture image via ImageCapture:', error)
    }
  }, [athena])

  useEffect(() => {
    fetch(`${API_URL}/`)
      .then((response) => setBackendConnected(response.ok))
      .catch(() => setBackendConnected(false))
    if (!athena) return undefined
    const removeTimerListener = athena.registerListenerForTimerTickFromMain(setTimer)
    const removeCameraListener = athena.registerListenerForCameraSnapFromMain(saveVideoScreenShots)
    return () => {
      removeTimerListener?.()
      removeCameraListener?.()
    }
  }, [athena, saveVideoScreenShots])

  async function getCameraAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraEnabled(true)
      setErrorMessage('')
    } catch (error) {
      console.error('Error accessing camera:', error)
      setErrorMessage('Camera access is required before starting the exam.')
    }
  }

  async function enableFullScreen() {
    try {
      await document.documentElement.requestFullscreen()
      setFullScreen(true)
      setErrorMessage('')
    } catch (error) {
      console.error('Error enabling full screen:', error)
      setErrorMessage('Fullscreen permission is required before starting the exam.')
    }
  }

  async function startExamSession() {
    setIsStarting(true)
    setErrorMessage('')
    try {
      const startResponse = await fetch(`${API_URL}/exam/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'student-101', name: 'Student' }),
      })
      if (!startResponse.ok) throw new Error('Could not start session')
      const startData = await startResponse.json()
      const questionResponse = await fetch(`${API_URL}/exam/mcq`)
      if (!questionResponse.ok) throw new Error('Could not load questions')
      setSessionId(startData.sessionId)
      setQuestions(await questionResponse.json())
      setCurrentQuestion(0)
      setBackendConnected(true)
    } catch (error) {
      console.error('Error connecting to exam backend:', error)
      setBackendConnected(false)
      setErrorMessage('The exam service is unavailable. Start the backend on port 3000 and try again.')
    } finally {
      setIsStarting(false)
    }
  }

  async function beginExam() {
    if (!athena || isStarting) return
    try {
      await athena.startTimerOnMain()
      await startExamSession()
    } catch (error) {
      console.error('Error starting timer:', error)
      setErrorMessage('The desktop exam session could not be started.')
    }
  }

  async function chooseAnswer(optionIndex) {
    if (!activeQuestion || examSubmitted) return
    setUserAnswers((answers) => ({ ...answers, [activeQuestion.id]: optionIndex }))
    if (!sessionId) return
    try {
      await fetch(`${API_URL}/exam/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, questionId: activeQuestion.id, selectedAnswer: optionIndex }),
      })
    } catch (error) {
      console.error('Error submitting answer:', error)
    }
  }

  async function handleExamSubmit() {
    if (!sessionId || isSubmitting) return
    setIsSubmitting(true)
    try {
      const response = await fetch(`${API_URL}/exam/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }),
      })
      if (!response.ok) throw new Error('Could not submit exam')
      const data = await response.json()
      setExamResult(data.result)
      setExamSubmitted(true)
    } catch (error) {
      console.error('Error submitting exam:', error)
      setErrorMessage('We could not submit your exam. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">A</span><span>Athena</span></div><div className="secure-label"><span className="status-dot" /> Secure assessment environment</div><button className="rules-link" onClick={() => athena?.showRules()}>View rules</button></header>
      {!examStarted ? <main className="setup-layout">
        <section className="welcome-panel"><div className="eyebrow">Assessment workspace</div><h1>Focus on what<br /><em>you know.</em></h1><p className="lead">Set up your environment, then move through the assessment at your own pace.</p><div className="welcome-meta"><span>5 questions</span><span className="meta-separator" /><span>~10 minutes</span></div></section>
        <section className="setup-card"><div className="card-heading"><div><div className="eyebrow">Before you begin</div><h2>Prepare your workspace</h2></div><span className={`connection-pill ${backendConnected === false ? 'offline' : ''}`}><span className="status-dot" />{backendConnected === null ? 'Checking service' : backendConnected ? 'Service ready' : 'Service offline'}</span></div><p className="card-intro">We need two permissions to keep your assessment secure.</p><div className="check-list">
          <div className={`check-item ${cameraEnabled ? 'complete' : ''}`}><div className="check-icon">{cameraEnabled ? '✓' : '01'}</div><div className="check-copy"><h3>Camera access</h3><p>Your camera stays on while you work.</p></div><button className="text-button" disabled={cameraEnabled} onClick={getCameraAccess}>{cameraEnabled ? 'Ready' : 'Allow access'}</button><video ref={videoRef} autoPlay playsInline muted className="video-preview" /></div>
          <div className={`check-item ${fullScreen ? 'complete' : ''}`}><div className="check-icon">{fullScreen ? '✓' : '02'}</div><div className="check-copy"><h3>Fullscreen mode</h3><p>Stay in the assessment window.</p></div><button className="text-button" disabled={fullScreen} onClick={enableFullScreen}>{fullScreen ? 'Ready' : 'Enable'}</button></div>
        </div>{errorMessage && <div className="error-message" role="alert">{errorMessage}</div>}<button className="primary-button start-button" disabled={!cameraEnabled || !fullScreen || backendConnected !== true || isStarting} onClick={beginExam}>{isStarting ? 'Opening assessment...' : 'Start assessment'}<span>↗</span></button><div className="privacy-note"><span>◈</span> Your activity is monitored to protect assessment integrity.</div></section>
      </main> : <main className="exam-layout">
        <aside className="exam-sidebar"><div className="sidebar-label">Current assessment</div><h1>Electron<br /><em>fundamentals</em></h1><div className="sidebar-progress"><div className="progress-label"><span>Progress</span><strong>{progress}%</strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div><div className="question-grid">{questions.map((question, index) => <button key={question.id} className={`question-number ${index === currentQuestion ? 'active' : ''} ${userAnswers[question.id] !== undefined ? 'answered' : ''}`} onClick={() => setCurrentQuestion(index)}>{String(index + 1).padStart(2, '0')}</button>)}</div><div className="sidebar-footer"><div className="live-indicator"><span className="status-dot" /> Monitoring active</div><div className="timer"><span>Time elapsed</span><strong>{formattedTime}</strong></div></div></aside>
        <section className="question-area"><div className="question-topline"><span>Question {String(currentQuestion + 1).padStart(2, '0')} <small>of {String(questions.length).padStart(2, '0')}</small></span><span>{answeredCount} answered</span></div>
          {examSubmitted ? <div className="result-card"><div className="result-badge">✓</div><div className="eyebrow">Assessment complete</div><h2>Well done.</h2><p>Your responses have been recorded and your result is ready.</p><div className="result-stats"><div><strong>{examResult?.correct ?? 0}</strong><span>Correct</span></div><div><strong>{examResult?.wrong ?? 0}</strong><span>Incorrect</span></div><div><strong>{examResult?.attempted ?? 0}</strong><span>Attempted</span></div></div><button className="primary-button" onClick={() => window.location.reload()}>Return to start <span>↗</span></button></div> : <><div className="question-card"><div className="eyebrow">Knowledge check</div><h2>{activeQuestion?.question}</h2><div className="option-list">{activeQuestion?.options.map((option, index) => <button key={option} className={`option ${userAnswers[activeQuestion.id] === index ? 'selected' : ''}`} onClick={() => chooseAnswer(index)}><span className="option-key">{String.fromCharCode(65 + index)}</span><span>{option}</span><span className="option-check">{userAnswers[activeQuestion.id] === index ? '✓' : ''}</span></button>)}</div></div><div className="question-actions"><button className="secondary-button" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((value) => value - 1)}>← Previous</button>{currentQuestion === questions.length - 1 ? <button className="primary-button" disabled={isSubmitting} onClick={handleExamSubmit}>{isSubmitting ? 'Submitting...' : 'Submit assessment'} <span>↗</span></button> : <button className="primary-button" onClick={() => setCurrentQuestion((value) => value + 1)}>Next question <span>→</span></button>}</div></>}
          {errorMessage && examSubmitted === false && <div className="error-message" role="alert">{errorMessage}</div>}
        </section>
      </main>}
      <footer className="app-footer"><span>ATHENA / SECURE EXAM PLATFORM</span><span>v1.0.0</span></footer>
    </div>
  )
}

export default App
