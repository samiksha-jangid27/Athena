import { HttpError } from '../lib/exam.js'
import { resolveApiUrl } from '../lib/backend.js'

const STORED_URL_KEY = 'athena.api_url'

const ENV_API_URL = import.meta.env.VITE_ATHENA_API_URL || ''

export function getApiUrl() {
  // resolveApiUrl pins packaged builds to their build-time backend, so a
  // leftover or tampered value in local storage can never repoint the exam
  // client at a different (or dead) server.
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORED_URL_KEY) : ''
  return resolveApiUrl({ isProd: import.meta.env.PROD, envUrl: ENV_API_URL, storedUrl: stored })
}

// Packaged builds are pinned to the backend they were built for, so the
// server-config dialog must not pretend a saved override takes effect.
export function isApiUrlLocked() {
  return Boolean(import.meta.env.PROD)
}

export function setApiUrl(url) {
  // Ignore edits in packaged builds: the URL is baked in at build time and a
  // stale local-storage value must never repoint the client at another server.
  if (isApiUrlLocked()) return false
  if (typeof window !== 'undefined') {
    if (!url || !url.trim()) {
      window.localStorage.removeItem(STORED_URL_KEY)
    } else {
      window.localStorage.setItem(STORED_URL_KEY, url.trim())
    }
  }
  return true
}

export const API_URL = getApiUrl()

// Turns a failed request into a short, differentiated, secret-free diagnosis.
// The message is derived from the error only; it never echoes request bodies.
export function describeConnectionError(error) {
  if (error?.name === 'AbortError') {
    return { category: 'timeout', message: 'The server did not answer in time. Check the URL or your network.' }
  }
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return { category: 'http', message: 'Reached a server, but it has no Athena API at this address (404).' }
    }
    if (error.status >= 500) {
      return { category: 'http', message: `The Athena server reported an error (HTTP ${error.status}).` }
    }
    return { category: 'http', message: error.body?.message || `The server rejected the request (HTTP ${error.status}).` }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { category: 'offline', message: 'This device appears to be offline. Reconnect and try again.' }
  }
  // fetch throws a TypeError for DNS failures, refused connections and blocked
  // origins alike, so the wording stays honest about that ambiguity.
  return {
    category: 'network',
    message: 'Could not reach the server. Check the URL, your network, or whether the backend allows this app origin.',
  }
}

async function request(path, { method = 'GET', token, body, timeoutMs = 30000, headers: extraHeaders = {} } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const currentBase = getApiUrl().replace(/\/+$/, '')
  try {
    const headers = { ...extraHeaders }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await fetch(`${currentBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new HttpError(response.status, data)
    return data
  } finally {
    clearTimeout(timer)
  }

}

async function fetchEvidence(evidenceId, token) {
  const response = await fetch(`${getApiUrl().replace(/\/+$/, '')}/api/admin/evidence/${encodeURIComponent(evidenceId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new HttpError(response.status, body)
  }
  return response.blob()
}

async function fetchResultsCsv(examId, token) {
  const response = await fetch(`${getApiUrl().replace(/\/+$/, '')}/api/admin/exams/${encodeURIComponent(examId)}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new HttpError(response.status, body)
  }
  return response.blob()
}

export const api = {
  getApiUrl,
  setApiUrl,
  isApiUrlLocked,
  describeConnectionError,
  health: () => request('/health', { timeoutMs: 6000 }),

  // One diagnostic pass used by the server-configuration dialog: it reports the
  // effective URL, whether that URL is pinned by the build, latency, database
  // health and a differentiated failure reason.
  diagnose: async () => {
    const startedAt = Date.now()
    const base = {
      url: getApiUrl(),
      locked: isApiUrlLocked(),
      latencyMs: null,
      serverTime: null,
      database: null,
    }
    try {
      const data = await request('/health', { timeoutMs: 8000 })
      const database = data?.database || null
      const databaseOk = database?.status === 'connected'
      return {
        ...base,
        latencyMs: Date.now() - startedAt,
        serverTime: data?.serverTime || null,
        database,
        online: databaseOk,
        category: databaseOk ? 'ok' : 'database',
        message: databaseOk
          ? 'Server and database are reachable.'
          : 'The server answered, but its database is not healthy.',
      }
    } catch (error) {
      const { category, message } = describeConnectionError(error)
      return { ...base, online: false, httpStatus: error.status || null, category, message }
    }
  },

  // ---------------- Authentication ----------------
  auth: {
    login: (username, password) =>
      request('/api/auth/login', { method: 'POST', body: { username, password } }),
    bootstrapAdmin: (username, password, name) =>
      request('/api/auth/bootstrap-admin', { method: 'POST', body: { username, password, name } }),
    me: (token) => request('/api/auth/me', { token }),
  },

  // ---------------- Student API ----------------
  student: {
    listExams: (token) => request('/api/student/exams', { token }),
    startExam: (token, examId, startRequestId) =>
      request(`/api/student/exams/${encodeURIComponent(examId)}/start`, {
        method: 'POST',
        token,
        headers: { 'x-athena-start-id': startRequestId },
        timeoutMs: 30000,
      }),
    getAttempt: (attemptToken) =>
      request('/api/student/attempt', { token: attemptToken }),
    saveAnswers: (attemptToken, answers, flags) =>
      request('/api/student/attempt/answers', { method: 'PUT', token: attemptToken, body: { answers, flags } }),
    sendEvents: (attemptToken, events) =>
      request('/api/student/attempt/events', { method: 'POST', token: attemptToken, body: { events } }),
    uploadEvidence: (attemptToken, kind, base64) =>
      request('/api/student/attempt/evidence', { method: 'POST', token: attemptToken, body: { kind, base64 }, timeoutMs: 25000 }),
    submit: (attemptToken, answers, flags) =>
      request('/api/student/attempt/submit', { method: 'POST', token: attemptToken, body: { answers, flags }, timeoutMs: 30000 }),
  },

  // ---------------- Admin API ----------------
  admin: {
    listExams: (token) => request('/api/admin/exams', { token }),
    createExam: (token, data) => request('/api/admin/exams', { method: 'POST', token, body: data }),
    getExam: (token, id) => request(`/api/admin/exams/${encodeURIComponent(id)}`, { token }),
    updateExam: (token, id, data) =>
      request(`/api/admin/exams/${encodeURIComponent(id)}`, { method: 'PUT', token, body: data }),
    publishExam: (token, id) =>
      request(`/api/admin/exams/${encodeURIComponent(id)}/publish`, { method: 'POST', token }),
    unpublishExam: (token, id) =>
      request(`/api/admin/exams/${encodeURIComponent(id)}/unpublish`, { method: 'POST', token }),
    addQuestion: (token, examId, data) =>
      request(`/api/admin/exams/${encodeURIComponent(examId)}/questions`, { method: 'POST', token, body: data }),
    updateQuestion: (token, questionId, data) =>
      request(`/api/admin/questions/${encodeURIComponent(questionId)}`, { method: 'PUT', token, body: data }),
    deleteQuestion: (token, questionId) =>
      request(`/api/admin/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE', token }),
    listStudents: (token) => request('/api/admin/students', { token }),
    createStudent: (token, data) => request('/api/admin/students', { method: 'POST', token, body: data }),
    deleteStudent: (token, id) =>
      request(`/api/admin/students/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
    listAttempts: (token) => request('/api/admin/attempts', { token }),
    getAttempt: (token, id) => request(`/api/admin/attempts/${encodeURIComponent(id)}`, { token }),
    unlockAttempt: (token, id) =>
      request(`/api/admin/attempts/${encodeURIComponent(id)}/unlock`, { method: 'POST', token }),
    extendAttempt: (token, id, minutes) =>
      request(`/api/admin/attempts/${encodeURIComponent(id)}/extend`, { method: 'POST', token, body: { minutes } }),
    gradeAttempt: (token, id, data) =>
      request(`/api/admin/attempts/${encodeURIComponent(id)}/grade`, { method: 'PUT', token, body: data }),
    exportCsv: (token, id) => fetchResultsCsv(id, token),
    fetchEvidence: (token, evidenceId) => fetchEvidence(evidenceId, token),
  },

  // ---------------- Legacy practical / instructor surface ----------------
  // The active exam flow is the authenticated /api/student/* API above. These
  // endpoints back the historic practical-task and instructor tooling only.
  practical: (token) => request('/practical', { token }),
  uploadFile: (token, taskId, name, contentBase64) =>
    request(`/practical/${encodeURIComponent(taskId)}/files`, { method: 'POST', token, body: { name, contentBase64 }, timeoutMs: 30000 }),
  removeFile: (token, taskId, fileId) =>
    request(`/practical/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', token }),
  checkpoint: (token, taskId, label) =>
    request(`/practical/${encodeURIComponent(taskId)}/checkpoints`, { method: 'POST', token, body: { label } }),
  practicalReview: (key, sessionId) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/practical`, { headers: { 'x-instructor-key': key } }),
  fileUrl: (sessionId, fileId) =>
    `${getApiUrl().replace(/\/+$/, '')}/instructor/attempts/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`,
  recordTest: (key, sessionId, taskId, testId, status) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/practical/${encodeURIComponent(taskId)}/tests/${encodeURIComponent(testId)}`, {
      method: 'PUT',
      headers: { 'x-instructor-key': key },
      body: { status },
    }),
  listAttempts: (key) => request('/instructor/attempts', { headers: { 'x-instructor-key': key } }),
  extend: (key, sessionId, minutes) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/extend`, { method: 'POST', headers: { 'x-instructor-key': key }, body: { minutes } }),
  unlock: (key, sessionId) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/unlock`, { method: 'POST', headers: { 'x-instructor-key': key }, body: {} }),
}
