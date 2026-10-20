import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'

const KEY_STORAGE = 'athena.instructorKey'

export default function InstructorDashboard() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY_STORAGE) || '')
  const [draftKey, setDraftKey] = useState('')
  const [attempts, setAttempts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!key) return
    try {
      setAttempts(await api.listAttempts(key))
      setError('')
    } catch (loadError) {
      setError(loadError.status === 401 ? 'Invalid instructor key.' : 'Exam service unavailable.')
      if (loadError.status === 401) {
        sessionStorage.removeItem(KEY_STORAGE)
        setKey('')
      }
    }
  }, [key])

  useEffect(() => {
    if (!key) return undefined
    const first = setTimeout(load, 0)
    const timer = setInterval(load, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [key, load])

  async function act(action) {
    try {
      await action()
      await load()
    } catch (actionError) {
      setError(actionError.message)
    }
  }

  if (!key) {
    return (
      <main className="instructor">
        <h1>Instructor monitor</h1>
        <p>Enter the instructor key printed by the backend when it starts (or set ATHENA_INSTRUCTOR_KEY).</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          sessionStorage.setItem(KEY_STORAGE, draftKey)
          setKey(draftKey)
        }}>
          <input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="Instructor key" />
          <button className="primary-button" disabled={!draftKey}>Open monitor</button>
        </form>
        {error && <div className="error-message">{error}</div>}
      </main>
    )
  }

  const selected = attempts.find((item) => item.sessionId === selectedId)

  return (
    <main className="instructor">
      <h1>Instructor monitor</h1>
      {error && <div className="error-message">{error}</div>}
      <table>
        <thead><tr><th>Student</th><th>Status</th><th>Deadline</th><th>Score</th><th>Events</th><th>Actions</th></tr></thead>
        <tbody>
          {[...attempts].reverse().map((item) => (
            <tr key={item.sessionId} className={item.sessionId === selectedId ? 'selected' : ''} onClick={() => setSelectedId(item.sessionId)}>
              <td>{item.name}<small>{item.userId}</small></td>
              <td><span className={`status-tag ${item.status}`}>{item.status}</span></td>
              <td>{new Date(item.deadline).toLocaleTimeString()}</td>
              <td>{item.correct}/{item.attempted}</td>
              <td>{item.eventCount}</td>
              <td onClick={(event) => event.stopPropagation()}>
                {item.status === 'locked' && <button className="text-button" onClick={() => act(() => api.unlock(key, item.sessionId))}>Unlock</button>}
                {item.status !== 'submitted' && <button className="text-button" onClick={() => act(() => api.extend(key, item.sessionId, 5))}>+5 min</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {attempts.length === 0 && <p>No attempts yet.</p>}

      {selected && (
        <section className="timeline">
          <h2>Activity timeline: {selected.name}</h2>
          <ol>
            {selected.events.map((event, index) => (
              <li key={index} className={event.type}>
                <time>{new Date(event.clientAt || event.receivedAt).toLocaleTimeString()}</time>
                <span>{event.type}</span>{event.detail && <small>{event.detail}</small>}
              </li>
            ))}
          </ol>
          <p className="muted">Camera and screen evidence is stored on the student&apos;s device (userData/evidence). Uploading it for review is not implemented yet.</p>
        </section>
      )}
    </main>
  )
}
