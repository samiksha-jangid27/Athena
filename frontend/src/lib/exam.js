// Pure exam helpers (no React), so they are easy to test.

export const STORAGE_KEY = 'athena.attempt'

// Server clock is the reference; offset = serverTime - localTime.
export function remainingMs(deadline, serverOffsetMs = 0, now = Date.now()) {
  if (!deadline) return 0
  return Math.max(0, Date.parse(deadline) - (now + serverOffsetMs))
}

export function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

function eventId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Each event gets a unique id so the server can ignore retried duplicates.
export function makeEvent(type, detail, now = Date.now()) {
  const event = { id: eventId(), type, at: new Date(now).toISOString() }
  if (detail) event.detail = detail
  return event
}

// Students may answer only while the server says in-progress, no lock is
// pending locally, and time remains.
export function canAnswer({ status, pendingLock, remaining }) {
  return status === 'in-progress' && !pendingLock && remaining > 0
}

// Local answers win when they were not yet saved (e.g. crash or offline).
export function mergeRecovered(serverState, localState) {
  if (!localState || !localState.dirty) {
    return { answers: serverState.answers || {}, flags: serverState.flags || [], recovered: false }
  }
  return {
    answers: { ...serverState.answers, ...localState.answers },
    flags: localState.flags || serverState.flags || [],
    recovered: true,
  }
}

export class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`)
    this.status = status
    this.body = body
  }
}

// Retries network errors and 5xx responses; 4xx are final.
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const retryable = !(error instanceof HttpError) || error.status >= 500
      if (!retryable || attempt === retries) break
      await wait(baseDelayMs * 2 ** attempt)
    }
  }
  throw lastError
}

export function loadLocal(storage = globalThis.localStorage) {
  try {
    return JSON.parse(storage.getItem(STORAGE_KEY)) || null
  } catch {
    return null
  }
}

export function saveLocal(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable: the server copy is still the backup.
  }
}

export function clearLocal(storage = globalThis.localStorage) {
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Which screen the student should see, from the attempt state.
export function examPhase({ recovery, token, attempt, result }) {
  if (recovery === 'loading') return 'loading'
  if (recovery === 'offline') return 'recovery-offline'
  if (recovery === 'stale') return 'recovery-stale'
  if (result || attempt?.status === 'submitted') return 'finished'
  if (token && attempt) return 'active'
  return 'welcome'
}

// Splits a failed request into "try again later" vs "server said no".
export function isRejection(error) {
  return error instanceof HttpError && error.status >= 400 && error.status < 500
}

// Turns a failed "start exam" request into a message the student can act on.
// The server's own message is shown whenever it exists, so a rejected start is
// never mislabelled as a connection problem.
export function startErrorMessage(error) {
  if (error instanceof HttpError) {
    const serverMessage = error.body?.message
    if (error.status === 401) return serverMessage || 'Your sign-in has expired. Sign out, sign in again, then restart the exam.'
    if (error.status === 403) return serverMessage || 'This account is not allowed to start this exam.'
    if (error.status === 404) return serverMessage || 'This exam is no longer available. Go back and choose another exam.'
    if (error.status === 409) return serverMessage || 'This exam can no longer be started.'
    return serverMessage || `The exam service returned an error (${error.status}). Try again in a moment.`
  }
  return 'The exam could not be started because the exam service did not respond. Check your connection and try again.'
}

// Student identification rules (mirrored loosely by the server's limits).
export function validateIdentity({ name, studentId }) {
  const errors = {}
  if (!name.trim()) errors.name = 'Enter your full name.'
  else if (name.trim().length < 2) errors.name = 'Name looks too short.'
  if (!studentId.trim()) errors.studentId = 'Enter your student ID.'
  else if (!/^[A-Za-z0-9-]{3,32}$/.test(studentId.trim())) errors.studentId = 'Use 3–32 letters, numbers or dashes.'
  return errors
}

// One sentence describing answer synchronisation, for the status bar.
export function syncLabel({ saveState, lastSavedAt, online }) {
  if (!online) return { tone: 'warning', text: 'Offline · answers kept on this device' }
  if (saveState === 'saving') return { tone: 'neutral', text: 'Saving…' }
  if (saveState === 'offline') return { tone: 'warning', text: 'Retrying save · answers kept on this device' }
  if (saveState === 'rejected') return { tone: 'danger', text: 'Not saved · attempt is locked or closed' }
  // Nothing saved in this session yet, but the server copy is current.
  if (!lastSavedAt) return { tone: 'success', text: 'Up to date' }
  const time = new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return { tone: 'success', text: `Saved ${time}` }
}
