import test from 'node:test'
import assert from 'node:assert/strict'
import {
  remainingMs, formatDuration, makeEvent, canAnswer, mergeRecovered,
  withRetry, HttpError, loadLocal, saveLocal, clearLocal,
} from './exam.js'

test('remainingMs uses the server clock offset and never goes negative', () => {
  const now = Date.parse('2026-01-01T10:00:00Z')
  assert.equal(remainingMs('2026-01-01T10:01:00Z', 0, now), 60000)
  assert.equal(remainingMs('2026-01-01T10:01:00Z', 10000, now), 50000)
  assert.equal(remainingMs('2026-01-01T09:00:00Z', 0, now), 0)
  assert.equal(remainingMs(null, 0, now), 0)
})

test('formatDuration rounds up to whole seconds', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(61000), '01:01')
  assert.equal(formatDuration(500), '00:01')
})

test('makeEvent timestamps events', () => {
  const event = makeEvent('window-blur', undefined, 0)
  assert.equal(event.type, 'window-blur')
  assert.equal(event.at, '1970-01-01T00:00:00.000Z')
  assert.notEqual(event.id, makeEvent('window-blur').id)
  assert.equal(makeEvent('camera-lost', 'ended', 0).detail, 'ended')
})

test('canAnswer blocks locked, pending-lock, finished and timed-out attempts', () => {
  assert.equal(canAnswer({ status: 'in-progress', pendingLock: false, remaining: 1 }), true)
  assert.equal(canAnswer({ status: 'in-progress', pendingLock: true, remaining: 1 }), false)
  assert.equal(canAnswer({ status: 'locked', pendingLock: false, remaining: 1 }), false)
  assert.equal(canAnswer({ status: 'submitted', pendingLock: false, remaining: 1 }), false)
  assert.equal(canAnswer({ status: 'in-progress', pendingLock: false, remaining: 0 }), false)
})

test('mergeRecovered keeps unsaved local answers over server answers', () => {
  const server = { answers: { 1: 0, 2: 1 }, flags: [1] }
  assert.deepEqual(mergeRecovered(server, null), { answers: server.answers, flags: [1], recovered: false })
  const merged = mergeRecovered(server, { dirty: true, answers: { 2: 3 }, flags: [2] })
  assert.deepEqual(merged, { answers: { 1: 0, 2: 3 }, flags: [2], recovered: true })
})

test('withRetry retries network and 5xx errors but not 4xx', async () => {
  const noSleep = async () => {}
  let calls = 0
  const result = await withRetry(async () => {
    calls++
    if (calls < 3) throw new TypeError('network')
    return 'ok'
  }, { sleep: noSleep })
  assert.equal(result, 'ok')
  assert.equal(calls, 3)

  calls = 0
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(409, {}) }, { sleep: noSleep }))
  assert.equal(calls, 1)

  calls = 0
  await assert.rejects(withRetry(async () => { calls++; throw new HttpError(503, {}) }, { retries: 2, sleep: noSleep }))
  assert.equal(calls, 3)
})

test('local persistence round-trips and survives bad data', () => {
  const data = {}
  const storage = {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value },
    removeItem: (key) => { delete data[key] },
  }
  saveLocal({ token: 't', answers: { 1: 2 } }, storage)
  assert.deepEqual(loadLocal(storage), { token: 't', answers: { 1: 2 } })
  clearLocal(storage)
  assert.equal(loadLocal(storage), null)
  data['athena.attempt'] = '{broken'
  assert.equal(loadLocal(storage), null)
})

test('examPhase picks recovery, finished, active and welcome screens', async () => {
  const { examPhase } = await import('./exam.js')
  assert.equal(examPhase({ recovery: 'loading' }), 'loading')
  assert.equal(examPhase({ recovery: 'offline', token: 't' }), 'recovery-offline')
  assert.equal(examPhase({ recovery: 'stale' }), 'recovery-stale')
  assert.equal(examPhase({ recovery: 'done', token: 't', attempt: { status: 'submitted' } }), 'finished')
  assert.equal(examPhase({ recovery: 'done', token: 't', attempt: { status: 'in-progress' }, result: { correct: 1 } }), 'finished')
  assert.equal(examPhase({ recovery: 'done', token: 't', attempt: { status: 'locked' } }), 'active')
  assert.equal(examPhase({ recovery: 'done', token: 't', attempt: { status: 'expired' } }), 'active')
  assert.equal(examPhase({ recovery: 'done' }), 'welcome')
})

test('isRejection separates server refusals from network failures', async () => {
  const { isRejection } = await import('./exam.js')
  assert.equal(isRejection(new HttpError(409, {})), true)
  assert.equal(isRejection(new HttpError(503, {})), false)
  assert.equal(isRejection(new TypeError('Failed to fetch')), false)
})
