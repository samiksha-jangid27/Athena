import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../services/api.js'
import {
  canAnswer, clearLocal, examPhase, isRejection, loadLocal, makeEvent, mergeRecovered, remainingMs, saveLocal, withRetry,
} from '../lib/exam.js'

const HEARTBEAT_MS = 10000
const SAVE_DEBOUNCE_MS = 800

// Owns one exam attempt: start/recover, autosave, activity events,
// server-driven status (locks, extensions) and submission.
export function useExamAttempt() {
  const [token, setToken] = useState(null)
  const [attempt, setAttempt] = useState(null) // { status, deadline, ... } from server
  const [questions, setQuestions] = useState([])
  const [examTitle, setExamTitle] = useState('')
  const [answers, setAnswers] = useState({})
  const [flags, setFlags] = useState([])
  const [serverOffset, setServerOffset] = useState(0)
  // saved | saving | offline | rejected
  const [saveState, setSaveState] = useState('saved')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  // Events are only "synced" once the server has accepted them.
  const [eventState, setEventState] = useState({ pending: 0, rejected: 0 })
  const [pendingLock, setPendingLock] = useState(false)
  const [lockedAt, setLockedAt] = useState(null)
  const [result, setResult] = useState(null)
  // loading | offline | stale | done
  const [recovery, setRecovery] = useState(() => (loadLocal()?.token ? 'loading' : 'done'))
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [extensionNotice, setExtensionNotice] = useState(null)

  const dirtyRef = useRef(false)
  const eventsRef = useRef([])
  const prevDeadlineRef = useRef(null)
  const submittingRef = useRef(false)
  const startRequestIdRef = useRef(null)
  const stateRef = useRef({})
  // Latest values for async callbacks (timers, retries).
  useLayoutEffect(() => {
    stateRef.current = { token, answers, flags, attempt, pendingLock }
  }, [token, answers, flags, attempt, pendingLock])

  const remaining = remainingMs(attempt?.deadline, serverOffset, now)
  const answerable = canAnswer({ status: attempt?.status, pendingLock, remaining })
  const phase = examPhase({ recovery, token, attempt, result })

  const persist = useCallback(() => {
    const current = stateRef.current
    if (!current.token) return
    saveLocal({
      token: current.token,
      answers: current.answers,
      flags: current.flags,
      dirty: dirtyRef.current,
      pendingEvents: eventsRef.current,
    })
  }, [])

  const applyServer = useCallback((serverAttempt) => {
    if (!serverAttempt) return
    if (prevDeadlineRef.current && serverAttempt.deadline) {
      const prev = Date.parse(prevDeadlineRef.current)
      const current = Date.parse(serverAttempt.deadline)
      if (current > prev) {
        const addedMin = Math.round((current - prev) / 60000)
        setExtensionNotice(`Time extended: +${addedMin} minute${addedMin === 1 ? '' : 's'} added to your exam.`)
      }
    }
    prevDeadlineRef.current = serverAttempt.deadline
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
      if (data.attempt?.status === 'locked' || !eventsRef.current.some((e) => e.type === 'fullscreen-exit')) {
        setPendingLock(false)
      }
    } catch (error) {
      if (!isRejection(error)) {
        // Network problem: keep the events queued and try again later.
        setEventState({ pending: eventsRef.current.length, rejected: 0 })
        persist()
        return
      }
      // The server refused them (e.g. attempt is already submitted or expired); drop them
      eventsRef.current = eventsRef.current.slice(batch.length)
      setEventState((state) => ({ ...state, rejected: state.rejected + batch.length }))
      setPendingLock(false)
      applyServer(error.body?.attempt)
    }
    setEventState((state) => ({ ...state, pending: eventsRef.current.length }))
    persist()
  }, [applyServer, persist])

  const logEvent = useCallback((type, detail) => {
    if (!stateRef.current.token) return
    // Lock answering locally right away; the server confirms the lock.
    if (type === 'fullscreen-exit') {
      setPendingLock(true)
      setLockedAt(Date.now())
    }
    eventsRef.current.push(makeEvent(type, detail))
    setEventState((state) => ({ ...state, pending: eventsRef.current.length }))
    persist()
    flushEvents()
  }, [flushEvents, persist])

  // ---- Answer saving ----
  const saveNow = useCallback(async () => {
    const { token: currentToken, answers: currentAnswers, flags: currentFlags, attempt: currentAttempt, pendingLock: currentPendingLock } = stateRef.current
    if (!currentToken || !dirtyRef.current) return
    if (currentPendingLock || currentAttempt?.status === 'locked') return
    // If there are pending events (e.g. exit event), flush them first so the server locks first
    if (eventsRef.current.length > 0) {
      await flushEvents()
    }
    if (stateRef.current.attempt?.status === 'locked' || stateRef.current.pendingLock) return
    setSaveState('saving')
    dirtyRef.current = false
    try {
      const data = await withRetry(() => api.saveAnswers(currentToken, currentAnswers, currentFlags), { retries: 2 })
      applyServer(data.attempt)
      setSaveState('saved')
      setLastSavedAt(Date.now())
    } catch (error) {
      if (isRejection(error)) {
        applyServer(error.body?.attempt)
        setSaveState('rejected')
      } else {
        dirtyRef.current = true // retried on the next heartbeat
        setSaveState('offline')
      }
    }
    persist()
  }, [applyServer, flushEvents, persist])

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
  const loadAttempt = useCallback((data, newToken, local) => {
    if (!data?.token || !data.attempt || !Array.isArray(data.questions)) {
      throw new Error('The exam service returned an incomplete attempt. Please retry.')
    }
    const merged = mergeRecovered(data.attempt, local)
    dirtyRef.current = merged.recovered
    eventsRef.current = local?.pendingEvents || []
    submittingRef.current = false
    stateRef.current = { token: newToken, answers: merged.answers, flags: merged.flags }
    setToken(newToken)
    setQuestions(data.questions)
    setExamTitle(data.exam?.title || 'Exam')
    setAnswers(merged.answers)
    setFlags(merged.flags)
    setResult(null)
    setPendingLock(false)
    setSaveState(merged.recovered ? 'saving' : 'saved')
    setEventState({ pending: eventsRef.current.length, rejected: 0 })
    applyServer(data.attempt)
    return merged.recovered
  }, [applyServer])

  const begin = useCallback(async (userId, name, examId, studentJwt) => {
    if (!startRequestIdRef.current) {
      startRequestIdRef.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    let data
    if (studentJwt && examId) {
      data = await withRetry(
        () => api.student.startExam(studentJwt, examId, startRequestIdRef.current),
        { retries: 3, baseDelayMs: 750 },
      )
    } else {
      data = await withRetry(() => api.start(userId, name), { retries: 3, baseDelayMs: 750 })
    }
    loadAttempt(data, data.token, null)
    setTimeout(() => logEvent('exam-started'), 0)
  }, [loadAttempt, logEvent])

  const recover = useCallback(async () => {
    const local = loadLocal()
    if (!local?.token) {
      setRecovery('done')
      return
    }
    setRecovery('loading')
    try {
      const data = await api.getAttempt(local.token)
      const recovered = loadAttempt(data, local.token, local)
      if (data.attempt.status === 'submitted') clearLocal()
      else eventsRef.current.push(makeEvent('answers-recovered', recovered ? 'unsaved local answers restored' : undefined))
      setRecovery('done')
    } catch (error) {
      // 401: the backend no longer knows this attempt (stale session).
      setRecovery(isRejection(error) ? 'stale' : 'offline')
    }
  }, [loadAttempt])

  useEffect(() => {
    if (!loadLocal()?.token) return undefined
    const timer = setTimeout(recover, 0)
    return () => clearTimeout(timer)
  }, [recover])

  // ---- Heartbeat: picks up extensions/unlocks, retries saves and events ----
  const active = phase === 'active'
  useEffect(() => {
    if (!active) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const heartbeat = setInterval(async () => {
      await flushEvents()
      await saveNow()
      try {
        const data = await api.getAttempt(stateRef.current.token)
        applyServer(data.attempt)
      } catch {
        setSaveState((state) => (state === 'saved' ? state : 'offline'))
      }
    }, HEARTBEAT_MS)
    return () => {
      clearInterval(tick)
      clearInterval(heartbeat)
    }
  }, [active, flushEvents, saveNow, applyServer])

  // ---- Submit (guarded so double clicks and auto-submit cannot race) ----
  const submit = useCallback(async () => {
    const { token: currentToken, answers: currentAnswers, flags: currentFlags } = stateRef.current
    if (!currentToken || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      await flushEvents()
      const data = await withRetry(() => api.submit(currentToken, currentAnswers, currentFlags), { retries: 3 })
      applyServer(data.attempt)
      setResult(data.result)
      clearLocal()
      return true
    } catch {
      submittingRef.current = false
      setSubmitError('Could not reach the exam service. Your answers are saved on this device. Try again.')
      return false
    } finally {
      setSubmitting(false)
    }
  }, [applyServer, flushEvents])

  // Auto-submit once when time runs out.
  const timedOut = active && remaining === 0
  useEffect(() => {
    if (!timedOut) return undefined
    const timer = setTimeout(() => {
      submit()
    }, 0)
    return () => clearTimeout(timer)
  }, [timedOut, submit])

  const reset = useCallback(() => {
    clearLocal()
    dirtyRef.current = false
    eventsRef.current = []
    submittingRef.current = false
    setToken(null)
    setAttempt(null)
    setQuestions([])
    setAnswers({})
    setFlags([])
    setResult(null)
    setRecovery('done')
    startRequestIdRef.current = null
  }, [])

  return {
    phase, token, attempt, questions, examTitle, answers, flags, remaining, answerable,
    pendingLock, lockedAt, saveState, lastSavedAt, eventState, result, submitting, submitError,
    extensionNotice, clearExtensionNotice: () => setExtensionNotice(null),
    begin, recover, chooseAnswer, toggleFlag, logEvent, submit, reset,
  }
}
