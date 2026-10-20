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

  const dirtyRef = useRef(false)
  const eventsRef = useRef([])
  const submittingRef = useRef(false)
  const stateRef = useRef({})
  // Latest values for async callbacks (timers, retries).
  useLayoutEffect(() => {
    stateRef.current = { token, answers, flags }
  }, [token, answers, flags])

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
    } catch (error) {
      if (!isRejection(error)) {
        // Network problem: keep the events queued and try again later.
        setEventState({ pending: eventsRef.current.length, rejected: 0 })
        persist()
        return
      }
      // The server refused them; drop them but say so instead of
      // pretending they were recorded.
      eventsRef.current = eventsRef.current.slice(batch.length)
      setEventState((state) => ({ ...state, rejected: state.rejected + batch.length }))
      applyServer(error.body?.attempt)
    }
    if (eventsRef.current.length === 0) setPendingLock(false)
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
    const { token: currentToken, answers: currentAnswers, flags: currentFlags } = stateRef.current
    if (!currentToken || !dirtyRef.current) return
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
  const loadAttempt = useCallback((data, newToken, local) => {
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

  const begin = useCallback(async (userId, name) => {
    const data = await api.start(userId, name)
    loadAttempt(data, data.token, null)
    logEvent('exam-started')
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
    } catch {
      submittingRef.current = false
      setSubmitError('Could not reach the exam service. Your answers are saved on this device. Try again.')
    } finally {
      setSubmitting(false)
    }
  }, [applyServer, flushEvents])

  // Auto-submit once when time runs out.
  const timedOut = active && remaining === 0
  useEffect(() => {
    if (timedOut) submit()
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
  }, [])

  return {
    phase, token, attempt, questions, examTitle, answers, flags, remaining, answerable,
    pendingLock, lockedAt, saveState, lastSavedAt, eventState, result, submitting, submitError,
    begin, recover, chooseAnswer, toggleFlag, logEvent, submit, reset,
  }
}
