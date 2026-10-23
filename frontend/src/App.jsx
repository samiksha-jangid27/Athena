import { useEffect, useState } from 'react'
import LoginScreen from './components/LoginScreen.jsx'
import StudentExamCatalog from './components/StudentExamCatalog.jsx'
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
import Badge from './components/ui/Badge.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'

const athena = typeof window !== 'undefined' ? window.athena : undefined

function StudentApp({ user, token, onSignOut }) {
  const camera = useCamera()
  const exam = useExamAttempt()
  const { phase } = exam
  const [selectedExam, setSelectedExam] = useState(null)

  // A recovered attempt needs the camera again after a restart.
  const needsCamera = phase === 'active' && camera.status === 'idle'
  const startCamera = camera.start
  useEffect(() => {
    if (needsCamera) startCamera()
  }, [needsCamera, startCamera])

  // Focus mode: hide app navigation while an attempt is running.
  useEffect(() => {
    if (phase !== 'active') return undefined
    document.documentElement.dataset.focus = 'exam'
    return () => delete document.documentElement.dataset.focus
  }, [phase])

  // Release the camera once the exam is over.
  const stopCamera = camera.stop
  useEffect(() => {
    if (phase === 'finished') stopCamera()
  }, [phase, stopCamera])

  if (phase === 'loading' || phase.startsWith('recovery')) {
    return <RecoveryScreen kind={phase} onRetry={exam.recover} onStartOver={exam.reset} />
  }

  if (phase === 'finished') {
    return (
      <ResultScreen
        result={exam.result}
        attempt={exam.attempt}
        onDone={() => {
          exam.reset()
          setSelectedExam(null)
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        }}
      />
    )
  }

  if (phase === 'active') {
    return <ExamScreen exam={exam} camera={camera} athena={athena} />
  }

  // If no exam selected yet, show student's authorized exam catalog
  if (!selectedExam) {
    return (
      <StudentExamCatalog
        student={user}
        token={token}
        onSelectExam={(e) => setSelectedExam(e)}
        onSignOut={onSignOut}
      />
    )
  }

  return (
    <Readiness
      camera={camera}
      student={user}
      selectedExam={selectedExam}
      onBackToCatalog={() => setSelectedExam(null)}
      onBegin={(uId, uName, examId) => exam.begin(uId, uName, examId || selectedExam.id, token)}
      athena={athena}
    />
  )
}

const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' }

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('athena.auth_user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('athena.auth_token') || null
    } catch {
      return null
    }
  })

  const { theme, cycle } = useTheme()

  const handleLoginSuccess = (loggedInUser, userToken) => {
    setUser(loggedInUser)
    setToken(userToken)
    try {
      localStorage.setItem('athena.auth_user', JSON.stringify(loggedInUser))
      localStorage.setItem('athena.auth_token', userToken)
    } catch {
      // LocalStorage full or private browsing
    }
  }

  const handleSignOut = () => {
    setUser(null)
    setToken(null)
    try {
      localStorage.removeItem('athena.auth_user')
      localStorage.removeItem('athena.auth_token')
    } catch {
      // ignore
    }
  }

  return (
    <ToastProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="app-header">
          <div className="brand">
            <Logo />
            <span>Athena</span>
          </div>

          <div className="header-right-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
            {user && (
              <div className="user-profile-pill" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{user.name}</span>
                <Badge tone={user.role === 'ADMIN' ? 'accent' : 'success'}>
                  {user.role}
                </Badge>
                <Button variant="ghost" size="sm" icon="x" title="Sign out" onClick={handleSignOut} />
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={THEME_ICON[theme]}
              onClick={cycle}
              aria-label={`Colour theme: ${theme}. Click to change.`}
              title={`Theme: ${theme}`}
            />
          </div>
        </header>

        <div id="main" className="app-main">
          {!user ? (
            <LoginScreen onLoginSuccess={handleLoginSuccess} />
          ) : user.role === 'ADMIN' ? (
            <InstructorDashboard adminUser={user} adminToken={token} onSignOut={handleSignOut} />
          ) : (
            <StudentApp user={user} token={token} onSignOut={handleSignOut} />
          )}
        </div>
      </div>
    </ToastProvider>
  )
}

export default App
