// Pure helpers for the instructor monitor. All numbers come from real attempts.

export const STATUS_LABEL = { 'in-progress': 'In progress', locked: 'Locked', submitted: 'Submitted', expired: 'Expired' }
export const STATUS_TONE = { 'in-progress': 'info', locked: 'danger', submitted: 'success', expired: 'warning' }

export function criticalCount(attempt) {
  return attempt.events.filter((event) => event.severity === 'critical').length
}

export function lastActivity(attempt) {
  const times = attempt.events.map((event) => Date.parse(event.receivedAt)).filter(Boolean)
  times.push(Date.parse(attempt.lastSavedAt) || 0, Date.parse(attempt.startedAt) || 0)
  return Math.max(...times)
}

export function countByStatus(attempts) {
  const counts = { total: attempts.length, 'in-progress': 0, locked: 0, submitted: 0, expired: 0 }
  for (const attempt of attempts) counts[attempt.status] = (counts[attempt.status] || 0) + 1
  return counts
}

export function filterAttempts(attempts, { query = '', status = 'all' }) {
  const needle = query.trim().toLowerCase()
  return attempts.filter((attempt) => (status === 'all' || attempt.status === status)
    && (!needle || attempt.name.toLowerCase().includes(needle) || attempt.userId.toLowerCase().includes(needle)))
}

// sort: activity | deadline | name | critical
export function sortAttempts(attempts, sort) {
  const sorted = [...attempts]
  if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'deadline') sorted.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))
  else if (sort === 'critical') sorted.sort((a, b) => criticalCount(b) - criticalCount(a) || lastActivity(b) - lastActivity(a))
  else sorted.sort((a, b) => lastActivity(b) - lastActivity(a))
  return sorted
}

// Remaining time for open attempts, using the server clock offset.
export function attemptRemaining(attempt, serverOffsetMs, now = Date.now()) {
  if (attempt.status !== 'in-progress' && attempt.status !== 'locked') return null
  return Math.max(0, Date.parse(attempt.deadline) - (now + serverOffsetMs))
}

export function validateExtension(value) {
  const minutes = Number(value)
  if (!Number.isInteger(minutes)) return 'Enter a whole number of minutes.'
  if (minutes < 1 || minutes > 120) return 'Choose between 1 and 120 minutes.'
  return null
}

export const EVENT_LABEL = {
  'exam-started': 'Exam started',
  'fullscreen-exit': 'Left fullscreen',
  'fullscreen-enter': 'Returned to fullscreen',
  'window-blur': 'Athena lost focus',
  'window-focus': 'Athena regained focus',
  'camera-lost': 'Camera interrupted',
  'camera-restored': 'Camera restored',
  'screen-capture-failed': 'Screen capture failed',
  'screen-capture-restored': 'Screen capture restored',
  'network-offline': 'Network lost',
  'network-online': 'Network restored',
  'answers-recovered': 'Attempt resumed after restart',
  'disallowed-app-detected': 'Disallowed application detected',
  'instructor-unlocked': 'Unlocked by instructor',
  'time-extended': 'Time extended',
  submitted: 'Submitted',
}

// Where to find evidence for an event. Evidence stays on the student's
// device, so this is a reference, not a link.
export function evidenceHint(event) {
  if (event.type === 'camera-lost' || event.type === 'camera-restored') return 'Camera photos: <userData>/evidence/camera'
  if (event.type.startsWith('screen-capture') || event.type === 'window-blur' || event.type === 'fullscreen-exit' || event.type === 'disallowed-app-detected') {
    return 'Screenshots: <userData>/evidence/screen'
  }
  return null
}
