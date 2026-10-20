import { useEffect, useState } from 'react'
import './App.css'
import Readiness from './components/Readiness.jsx'
import ExamScreen from './components/ExamScreen.jsx'
import ResultScreen from './components/ResultScreen.jsx'
import InstructorDashboard from './components/InstructorDashboard.jsx'
import { useCamera } from './hooks/useCamera.js'
import { useExamAttempt } from './hooks/useExamAttempt.js'

const athena = typeof window !== 'undefined' ? window.athena : undefined

function StudentApp() {
  const camera = useCamera()
  const exam = useExamAttempt()
  const status = exam.attempt?.status
  const finished = status === 'submitted' || exam.result

  // A recovered attempt needs the camera again after a restart.
  const needsCamera = exam.token && !finished && camera.status === 'idle'
  const startCamera = camera.start
  useEffect(() => {
    if (needsCamera) startCamera()
  }, [needsCamera, startCamera])

  // Release the camera once the exam is over.
  const stopCamera = camera.stop
  useEffect(() => {
    if (finished) stopCamera()
  }, [finished, stopCamera])

  if (exam.recovering) return <main className="exam-layout single"><p>Loading…</p></main>
  if (finished) {
    return <ResultScreen result={exam.result} status={status} onDone={() => {
      exam.reset()
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }} />
  }
  if (exam.token && exam.questions.length) return <ExamScreen exam={exam} camera={camera} athena={athena} />
  return <Readiness camera={camera} onBegin={exam.begin} isDesktop={Boolean(athena)} />
}

function App() {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const instructor = route === '#/instructor'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">A</span><span>Athena</span></div>
        <div className="secure-label"><span className="status-dot" /> {instructor ? 'Instructor view' : 'Monitored exam session'}</div>
        <a className="rules-link" href={instructor ? '#/' : '#/instructor'}>{instructor ? 'Student view' : 'Instructor'}</a>
      </header>
      {instructor ? <InstructorDashboard /> : <StudentApp />}
      <footer className="app-footer"><span>ATHENA / EXAM PLATFORM</span><span>v1.0.0</span></footer>
    </div>
  )
}

export default App
