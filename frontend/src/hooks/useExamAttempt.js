import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import {
  HttpError, canAnswer, clearLocal, loadLocal, makeEvent, mergeRecovered, remainingMs, saveLocal, withRetry,
} from '../lib/exam.js'

const HEARTBEAT_MS = 10000
const SAVE_DEBOUNCE_MS = 800

// Owns one exam attempt: start/recover, autosave, activity events,
// server-driven status (locks, extensions) and submission.
export function useExamAttempt() {
  const [token, setToken] = useState(null)
  const [attempt, setAttempt] = useState(null) // { status, deadline, ... } from server
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [flags, setFlags] = useState([])
  const [serverOffset, setServerOffset] = useState(0)
  const [saveState, setSaveState] = useState('saved') // saved | saving | offline | rejected
  const [pendingLock, setPendingLock] = useState(false)
  const [result, setResult] = useState(null)
  const [recovering, setRecovering] = useState(() => Boolean(loadLocal()?.token))
  const [now, setNow] = useState(() => Date.now())

  const dirtyRef = useRef(false)
  const eventsRef = useRef([])
  const stateRef = useRef({})
  // Latest values for async callbacks (timers, retries).
  useLayoutEffect(() => {
    stateRef.current = { token, answers, flags }
  }, [token, answers, flags])

  const remaining = remainingMs(attempt?.deadline, serverOffset, now)
  const answerable = canAnswer({ status: attempt?.status, pendingLock, remaining })

  const persist = useCallback((extra = {}) => {
    const { token: currentToken, answers: currentAnswers, flags: currentFlags } = stateRef.current
    if (!currentToken) return
    saveLocal({
      token: currentToken,
      answers: currentAnswers,
      flags: currentFlags,
      dirty: dirtyRef.current,
      pendingEvents: eventsRef.current,
      ...extra,
    })
  }, [])

  const applyServer = useCallback((serverAttempt) => {
    if (!serverAttempt) return
    setAttempt(serverAttempt)
    setServerOffset(Date.parse(serverAttempt.serverTime) - Date.now())
  }, [])

  // ---- Activity events: queued locally, flushed with retries ----
  const flushEvents = useCallback(async () => {
    const currentToken = stateRef.current.token
    if (!currentToken || eventsRef.current.length === 0) return
    const batch = eventsRef.current.slice(0, 50)
    try {
      const data = await withRetry(() => api.sendEvents(currentToken, batch), { retries: 2 })
      eventsRef.current = eventsRef.current.slice(batch.length)
      applyServer(data.attempt)
      if (eventsRef.current.length === 0) setPendingLock(false)
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) eventsRef.current = eventsRef.current.slice(batch.length)
    }
    persist()
  }, [applyServer, persist])

  const logEvent = useCallback((type, detail) => {
    if (!stateRef.current.token) return
    // Lock answering locally right away; the server confirms the lock.
    if (type === 'fullscreen-exit') setPendingLock(true)
    eventsRef.current.push(makeEvent(type, detail))
    persist()
    flushEvents()
  }, [flushEvents, persist])

  // ---- Answer saving ----
  const saveNow = useCallback(async () => {
    const { token: currentToken, answers: currentAnswers, flags: currentFlags } = stateRef.current
    if (!currentToken || !dirtyRef.current) return
    setSaveState('saving')
    dirtyRef.current = false
    try {
      const data = await withRetry(() => api.saveAnswers(currentToken, currentAnswers, currentFlags), { retries: 2 })
      applyServer(data.attempt)
      setSaveState('saved')
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        applyServer(error.body?.attempt)
        setSaveState('rejected')
      } else {
        dirtyRef.current = true // retried on the next heartbeat
        setSaveState('offline')
      }
    }
    persist()
  }, [applyServer, persist])

  function markDirty() {
    dirtyRef.current = true
    setSaveState('saving')
  }

  const chooseAnswer = (questionId, optionIndex) => {
    if (!answerable) return
    markDirty()
    setAnswers((current) => ({ ...current, [questionId]: optionIndex }))
  }

  const toggleFlag = (questionId) => {
    if (!answerable) return
    markDirty()
    setFlags((current) => (current.includes(questionId)
      ? current.filter((id) => id !== questionId)
      : [...current, questionId]))
  }

  // Persist every change locally first, then debounce the server save.
  useEffect(() => {
    if (!token) return undefined
    persist()
    if (!dirtyRef.current) return undefined
    const timer = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [answers, flags, token, persist, saveNow])

  // ---- Start / recover ----
  const begin = useCallback(async (userId, name) => {
    const data = await api.start(userId, name)
    dirtyRef.current = false
    eventsRef.current = []
    stateRef.current = { token: data.token, answers: {}, flags: [] }
    setToken(data.token)
    setQuestions(data.questions)
    setAnswers({})
    setFlags([])
    setResult(null)
    applyServer(data.attempt)
    logEvent('exam-started')
  }, [applyServer, logEvent])

  useEffect(() => {
    const local = loadLocal()
    if (!local?.token) return
    api.getAttempt(local.token)
      .then((data) => {
        const merged = mergeRecovered(data.attempt, local)
        dirtyRef.current = merged.recovered
        eventsRef.current = local.pendingEvents || []
        stateRef.current = { token: local.token, answers: merged.answers, flags: merged.flags }
        setToken(local.token)
        setQuestions(data.questions)
        setAnswers(merged.answers)
        setFlags(merged.flags)
        applyServer(data.attempt)
        if (data.attempt.status === 'submitted') clearLocal()
        else eventsRef.current.push(makeEvent('answers-recovered', merged.recovered ? 'unsaved local answers restored' : undefined))
      })
      .catch((error) => {
        // Unknown token (e.g. backend data reset): start fresh.
        if (error instanceof HttpError && error.status === 401) clearLocal()
      })
      .finally(() => setRecovering(false))
  }, [applyServer])

  // ---- Heartbeat: picks up extensions/unlocks, retries saves and events ----
  useEffect(() => {
    if (!token || attempt?.status === 'submitted') return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const heartbeat = setInterval(async () => {
      await flushEvents()
      await saveNow()
      try {
        const data = await api.getAttempt(token)
        applyServer(data.attempt)
      } catch {
        setSaveState((state) => (state === 'saved' ? state : 'offline'))
      }
    }, HEARTBEAT_MS)
    return () => {
      clearInterval(tick)
      clearInterval(heartbeat)
    }
  }, [token, attempt?.status, flushEvents, saveNow, applyServer])

  // ---- Submit ----
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const submit = useCallback(async () => {
    const { token: currentToken, answers: currentAnswers, flags: currentFlags } = stateRef.current
    if (!currentToken || submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await flushEvents()
      const data = await withRetry(() => api.submit(currentToken, currentAnswers, currentFlags), { retries: 3 })
      applyServer(data.attempt)
      setResult(data.result)
      clearLocal()
    } catch {
      setSubmitError('Could not reach the exam service. Your answers are saved on this device; try again.')
    } finally {
      setSubmitting(false)
    }
  }, [applyServer, flushEvents, submitting])

  // Auto-submit when time runs out.
  const timedOut = Boolean(attempt) && remaining === 0 && attempt.status !== 'submitted' && !result
  useEffect(() => {
    if (timedOut) submit()
  }, [timedOut, submit])

  const reset = () => {
    clearLocal()
    setToken(null)
    setAttempt(null)
    setQuestions([])
    setResult(null)
  }

  return {
    recovering, token, attempt, questions, answers, flags, remaining, answerable,
    pendingLock, saveState, result, submitting, submitError,
    begin, chooseAnswer, toggleFlag, logEvent, submit, reset,
  }
}
