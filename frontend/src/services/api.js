import { HttpError } from '../lib/exam.js'

const STORED_URL_KEY = 'athena.api_url'

const ENV_API_URL = (import.meta.env.VITE_ATHENA_API_URL || '').replace(/\/+$/, '')
const DEFAULT_HOST = 'https://athena-backend-2a0l.onrender.com'

export function getApiUrl() {
  // Packaged builds are pinned to the backend they were built for: a leftover
  // or tampered value in local storage must never be able to repoint the exam
  // client at a different server.
  if (import.meta.env.PROD) return ENV_API_URL || DEFAULT_HOST
  const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORED_URL_KEY) : ''
  if (stored?.trim()) return stored.trim().replace(/\/+$/, '')
  return ENV_API_URL || 'http://127.0.0.1:3000'
}

export function setApiUrl(url) {
  if (typeof window !== 'undefined') {
    if (!url || !url.trim()) {
      window.localStorage.removeItem(STORED_URL_KEY)
    } else {
      window.localStorage.setItem(STORED_URL_KEY, url.trim())
    }
  }
}

export const API_URL = getApiUrl()

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
  health: () => request('/health', { timeoutMs: 6000 }),

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

  // ---------------- Legacy Compatibility ----------------
  info: () => request('/exam/info', { timeoutMs: 3000 }),
  start: (userId, name) => request('/exam/start', { method: 'POST', body: { userId, name } }),
  getAttempt: (token) => request('/exam/attempt', { token }),
  saveAnswers: (token, answers, flags) => request('/exam/answers', { method: 'PUT', token, body: { answers, flags } }),
  sendEvents: (token, events) => request('/exam/events', { method: 'POST', token, body: { events } }),
  submit: (token, answers, flags) => request('/exam/submit', { method: 'POST', token, body: { answers, flags } }),
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
