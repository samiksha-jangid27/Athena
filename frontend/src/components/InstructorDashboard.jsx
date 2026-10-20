import { useEffect, useState } from 'react'
import { useInstructorData } from '../hooks/useInstructorData.js'
import { formatDuration } from '../lib/exam.js'
import {
  STATUS_LABEL, STATUS_TONE, attemptRemaining, countByStatus, criticalCount, filterAttempts, lastActivity, sortAttempts,
} from '../lib/instructor.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Callout from './ui/Callout.jsx'
import Field from './ui/Field.jsx'
import Icon from './ui/Icon.jsx'
import AttemptDetail from './AttemptDetail.jsx'

function SignIn({ onSubmit, error }) {
  const [value, setValue] = useState('')
  return (
    <main className="center-screen">
      <form className="final-panel" onSubmit={(event) => { event.preventDefault(); if (value) onSubmit(value) }}>
        <p className="eyebrow">Instructor</p>
        <h1 className="display">Open the exam monitor</h1>
        <p className="muted">Enter the instructor key printed by the backend when it starts, or the value of <code>ATHENA_INSTRUCTOR_KEY</code>. It is kept for this window session only.</p>
        <Field label="Instructor key" type="password" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} error={error || undefined} />
        <Button type="submit" disabled={!value}>Open monitor</Button>
      </form>
    </main>
  )
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

const STATUS_FILTERS = [['all', 'All'], ['in-progress', 'In progress'], ['locked', 'Locked'], ['submitted', 'Submitted'], ['expired', 'Expired']]

export default function InstructorDashboard() {
  const data = useInstructorData()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('activity')
  const [selectedId, setSelectedId] = useState(null)

  if (!data.key) return <SignIn onSubmit={data.signIn} error={data.error} />

  const attempts = data.attempts || []
  const counts = countByStatus(attempts)
  const rows = sortAttempts(filterAttempts(attempts, { query, status }), sort)
  const selected = attempts.find((item) => item.sessionId === selectedId)

  return (
    <main className="monitor">
      <header className="monitor-head">
        <div>
          <p className="eyebrow">Instructor monitor</p>
          <h1>Attempts</h1>
        </div>
        <dl className="monitor-counts" aria-label="Attempt counts">
          <div><dt>Total</dt><dd className="num">{counts.total}</dd></div>
          <div><dt>In progress</dt><dd className="num">{counts['in-progress']}</dd></div>
          <div className={counts.locked ? 'alert' : ''}><dt>Locked</dt><dd className="num">{counts.locked}</dd></div>
          <div><dt>Submitted</dt><dd className="num">{counts.submitted}</dd></div>
        </dl>
        <Button variant="ghost" size="sm" onClick={() => data.signOut()}>Sign out</Button>
      </header>

      {data.error && <Callout tone="warning" role="alert">{data.error}</Callout>}

      <div className="monitor-toolbar">
        <label className="search">
          <Icon name="user" size={16} />
          <span className="visually-hidden">Search attempts</span>
          <input type="search" placeholder="Search name or student ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="segmented" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>
          ))}
        </div>
        <label className="sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="activity">Latest activity</option>
            <option value="critical">Critical events</option>
            <option value="deadline">Deadline</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      <div className="monitor-body">
        <div className="table-wrap">
          {data.attempts === null ? (
            <p className="row muted table-message" role="status"><span className="spinner" aria-hidden="true" />Loading attempts…</p>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <Icon name="list" size={24} />
              <strong>{attempts.length ? 'No attempts match these filters' : 'No attempts yet'}</strong>
              <span>{attempts.length ? 'Clear the search or choose another status.' : 'Attempts appear here as soon as a student starts the exam.'}</span>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Student</th><th>Status</th><th>Time left</th><th>Answered</th><th>Critical</th><th>Last activity</th></tr>
              </thead>
              <tbody>
                {rows.map((attempt) => {
                  const remaining = attemptRemaining(attempt, data.serverOffset, now)
                  const critical = criticalCount(attempt)
                  return (
                    <tr key={attempt.sessionId} aria-selected={attempt.sessionId === selectedId}
                      onClick={() => setSelectedId(attempt.sessionId)}>
                      <td>
                        <button type="button" className="row-link" onClick={() => setSelectedId(attempt.sessionId)}>{attempt.name}</button>
                        <small>{attempt.userId}</small>
                      </td>
                      <td><Badge tone={STATUS_TONE[attempt.status]} dot>{STATUS_LABEL[attempt.status]}</Badge></td>
                      <td className={`num ${remaining !== null && remaining < 60000 ? 'urgent' : ''}`}>{remaining === null ? '—' : formatDuration(remaining)}</td>
                      <td className="num">{attempt.attempted}</td>
                      <td className="num">{critical ? <Badge tone="danger">{critical}</Badge> : '0'}</td>
                      <td className="num subtle">{new Date(lastActivity(attempt)).toLocaleTimeString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <AttemptDetail key={selected.sessionId} attempt={selected} instructorKey={data.key} serverOffset={data.serverOffset}
            now={now} onChanged={data.refresh} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </main>
  )
}
