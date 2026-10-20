import test from 'node:test'
import assert from 'node:assert/strict'
import { countByStatus, filterAttempts, sortAttempts, attemptRemaining, criticalCount, validateExtension } from './instructor.js'

const attempts = [
  { sessionId: 'a', name: 'Asha Rao', userId: 'CS-1', status: 'locked', startedAt: '2026-01-01T10:00:00Z', deadline: '2026-01-01T10:10:00Z',
    events: [{ severity: 'critical', receivedAt: '2026-01-01T10:05:00Z' }, { severity: 'warning', receivedAt: '2026-01-01T10:02:00Z' }] },
  { sessionId: 'b', name: 'Bilal Khan', userId: 'CS-2', status: 'submitted', startedAt: '2026-01-01T10:01:00Z', deadline: '2026-01-01T10:08:00Z',
    events: [{ severity: 'info', receivedAt: '2026-01-01T10:07:00Z' }] },
  { sessionId: 'c', name: 'Chen Li', userId: 'IT-9', status: 'in-progress', startedAt: '2026-01-01T10:02:00Z', deadline: '2026-01-01T10:12:00Z', events: [] },
]

test('countByStatus only counts real attempts', () => {
  assert.deepEqual(countByStatus(attempts), { total: 3, 'in-progress': 1, locked: 1, submitted: 1, expired: 0 })
  assert.deepEqual(countByStatus([]).total, 0)
})

test('filterAttempts matches name or ID and status', () => {
  assert.deepEqual(filterAttempts(attempts, { query: 'cs-' }).map((a) => a.sessionId), ['a', 'b'])
  assert.deepEqual(filterAttempts(attempts, { query: 'chen' }).map((a) => a.sessionId), ['c'])
  assert.deepEqual(filterAttempts(attempts, { status: 'locked' }).map((a) => a.sessionId), ['a'])
})

test('sortAttempts orders by activity, deadline, name and critical events', () => {
  assert.deepEqual(sortAttempts(attempts, 'activity').map((a) => a.sessionId), ['b', 'a', 'c'])
  assert.deepEqual(sortAttempts(attempts, 'deadline').map((a) => a.sessionId), ['b', 'a', 'c'])
  assert.deepEqual(sortAttempts(attempts, 'name').map((a) => a.sessionId), ['a', 'b', 'c'])
  assert.equal(sortAttempts(attempts, 'critical')[0].sessionId, 'a')
  assert.equal(criticalCount(attempts[0]), 1)
})

test('attemptRemaining is null for closed attempts and uses the server offset', () => {
  const now = Date.parse('2026-01-01T10:09:00Z')
  assert.equal(attemptRemaining(attempts[0], 0, now), 60000)
  assert.equal(attemptRemaining(attempts[0], 30000, now), 30000)
  assert.equal(attemptRemaining(attempts[1], 0, now), null)
})

test('validateExtension matches the server limits', () => {
  assert.equal(validateExtension('5'), null)
  assert.match(validateExtension('2.5'), /whole number/)
  assert.match(validateExtension(''), /between 1 and 120/)
  assert.match(validateExtension('121'), /between 1 and 120/)
})

test('evidenceHint points to the right local evidence folder', async () => {
  const { evidenceHint } = await import('./instructor.js')
  assert.match(evidenceHint({ type: 'camera-lost' }), /camera/)
  assert.match(evidenceHint({ type: 'fullscreen-exit' }), /screen/)
  assert.equal(evidenceHint({ type: 'submitted' }), null)
})
