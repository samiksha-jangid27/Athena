import { useEffect, useState } from 'react'
import './App.css'
import Readiness from './components/Readiness.jsx'
import ExamScreen from './components/ExamScreen.jsx'
import ResultScreen from './components/ResultScreen.jsx'
import InstructorDashboard from './components/InstructorDashboard.jsx'
import RecoveryScreen from './components/RecoveryScreen.jsx'
import { useCamera } from './hooks/useCamera.js'
import { useExamAttempt } from './hooks/useExamAttempt.js'
import { useTheme } from './hooks/useTheme.js'
import Logo from './components/ui/Logo.jsx'
import Button from './components/ui/Button.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'

const athena = typeof window !== 'undefined' ? window.athena : undefined

function StudentApp() {
  const camera = useCamera()
  const exam = useExamAttempt()
  const { phase } = exam

  // A recovered attempt needs the camera again after a restart.
  const needsCamera = phase === 'active' && camera.status === 'idle'
  const startCamera = camera.start
  useEffect(() => {
    if (needsCamera) startCamera()
  }, [needsCamera, startCamera])

  // Release the camera once the exam is over.
  const stopCamera = camera.stop
  useEffect(() => {
    if (phase === 'finished') stopCamera()
  }, [phase, stopCamera])

  if (phase === 'loading' || phase.startsWith('recovery')) {
    return <RecoveryScreen kind={phase} onRetry={exam.recover} onStartOver={exam.reset} />
  }
  if (phase === 'finished') {
    return <ResultScreen result={exam.result} status={exam.attempt?.status} onDone={() => {
      exam.reset()
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }} />
  }
  if (phase === 'active') return <ExamScreen exam={exam} camera={camera} athena={athena} />
  return <Readiness camera={camera} onBegin={exam.begin} athena={athena} />
}

const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' }

function App() {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const instructor = route === '#/instructor'
  const { theme, cycle } = useTheme()

  return (
    <ToastProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="app-header">
          <div className="brand"><Logo /><span>Athena</span></div>
          <nav className="app-nav" aria-label="Views">
            <a href="#/" aria-current={instructor ? undefined : 'page'}>Student</a>
            <a href="#/instructor" aria-current={instructor ? 'page' : undefined}>Instructor</a>
          </nav>
          <Button variant="ghost" size="sm" icon={THEME_ICON[theme]} onClick={cycle}
            aria-label={`Colour theme: ${theme}. Click to change.`} title={`Theme: ${theme}`} />
        </header>
        <div id="main" className="app-main">
          {instructor ? <InstructorDashboard /> : <StudentApp />}
        </div>
      </div>
    </ToastProvider>
  )
}

export default App
