import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { formatBytes } from '../lib/files.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import { useToast } from './ui/Toast.jsx'

const RESULT_TONE = { pass: 'success', fail: 'danger', 'not-run': 'neutral' }

// Instructor view of one attempt's practical work.
export default function PracticalReview({ attempt, instructorKey }) {
  const notify = useToast()
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setTasks(await api.practicalReview(instructorKey, attempt.sessionId))
      setError('')
    } catch {
      setError('Could not load practical work.')
    }
  }, [attempt.sessionId, instructorKey])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  // Downloads need the instructor key header, so fetch then save the blob.
  async function download(file) {
    try {
      const response = await fetch(api.fileUrl(attempt.sessionId, file.id), { headers: { 'x-instructor-key': instructorKey } })
      if (!response.ok) throw new Error()
      const url = URL.createObjectURL(await response.blob())
      const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      notify(`Could not download ${file.name}.`, 'error')
    }
  }

  async function record(task, test, status) {
    try {
      await api.recordTest(instructorKey, attempt.sessionId, task.id, test.id, status)
      notify(`Recorded “${test.name}” as ${status}.`, 'success')
      load()
    } catch (recordError) {
      notify(recordError.message || 'Could not save the result.', 'error')
    }
  }

  if (error) return <p className="subtle">{error}</p>
  if (!tasks) return <p className="subtle">Loading practical work…</p>
  if (tasks.length === 0) return null

  return tasks.map((task) => (
    <section key={task.id} className="activity" aria-label={`Practical: ${task.title}`}>
      <div className="activity-head"><h3>Practical: {task.title}</h3></div>
      {task.files.length === 0 ? <p className="subtle">No files submitted.</p> : (
        <ul className="file-list">
          {task.files.map((file) => (
            <li key={file.id}>
              <span className="file-name">{file.name}</span>
              <span className="subtle num">{formatBytes(file.size)}</span>
              <code className="hash" title={`SHA-256 ${file.sha256}`}>{file.sha256.slice(0, 10)}</code>
              <span className="subtle num">{new Date(file.uploadedAt).toLocaleTimeString()}</span>
              <Button variant="ghost" size="sm" onClick={() => download(file)}>Download</Button>
            </li>
          ))}
        </ul>
      )}
      {task.checkpoints.length > 0 && (
        <ol className="checkpoint-list">
          {task.checkpoints.map((checkpoint) => (
            <li key={checkpoint.id}>
              <time className="num subtle">{new Date(checkpoint.at).toLocaleTimeString()}</time>
              <strong>{checkpoint.label}</strong>
              <span className="subtle">{checkpoint.files.map((file) => file.name).join(', ')}</span>
            </li>
          ))}
        </ol>
      )}
      <ul className="test-list">
        {task.tests.map((test) => {
          const result = task.testResults[test.id]
          return (
            <li key={test.id} className="test-row">
              <div>
                <strong>{test.name}</strong>
                <span className="subtle">{test.description}</span>
              </div>
              <Badge tone={RESULT_TONE[result?.status || 'not-run']}>{result?.status || 'not reviewed'}</Badge>
              <div className="segmented" role="group" aria-label={`Result for ${test.name}`}>
                {['pass', 'fail'].map((status) => (
                  <button key={status} type="button" aria-pressed={result?.status === status} onClick={() => record(task, test, status)}>
                    {status === 'pass' ? 'Pass' : 'Fail'}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="subtle">Results are recorded by you after reviewing the files. Athena does not execute submitted code.</p>
    </section>
  ))
}
