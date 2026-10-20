import { HttpError } from '../lib/exam.js'

export const API_URL = import.meta.env.VITE_ATHENA_API_URL || 'http://127.0.0.1:3000'

async function request(path, { method = 'GET', token, instructorKey, body, timeoutMs = 8000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    if (instructorKey) headers['x-instructor-key'] = instructorKey
    const response = await fetch(`${API_URL}${path}`, {
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

export const api = {
  health: () => request('/', { timeoutMs: 3000 }),
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
  practicalReview: (key, sessionId) => request(`/instructor/attempts/${encodeURIComponent(sessionId)}/practical`, { instructorKey: key }),
  recordTest: (key, sessionId, taskId, testId, status) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/practical/${encodeURIComponent(taskId)}/tests/${encodeURIComponent(testId)}`,
      { method: 'PUT', instructorKey: key, body: { status } }),
  fileUrl: (sessionId, fileId) => `${API_URL}/instructor/attempts/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}`,
  listAttempts: (key) => request('/instructor/attempts', { instructorKey: key }),
  extend: (key, sessionId, minutes) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/extend`, { method: 'POST', instructorKey: key, body: { minutes } }),
  unlock: (key, sessionId) =>
    request(`/instructor/attempts/${encodeURIComponent(sessionId)}/unlock`, { method: 'POST', instructorKey: key, body: {} }),
}
