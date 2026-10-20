import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'

const KEY_STORAGE = 'athena.instructorKey'

function readKey() {
  try {
    return sessionStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

// Instructor key (session only), polling of attempts and server clock offset.
export function useInstructorData() {
  const [key, setKey] = useState(readKey)
  const [attempts, setAttempts] = useState(null) // null = not loaded yet
  const [error, setError] = useState('')
  const [serverOffset, setServerOffset] = useState(0)

  const signIn = (value) => {
    try { sessionStorage.setItem(KEY_STORAGE, value) } catch { /* session only */ }
    setError('')
    setAttempts(null)
    setKey(value)
  }

  const signOut = useCallback((message = '') => {
    try { sessionStorage.removeItem(KEY_STORAGE) } catch { /* ignore */ }
    setKey('')
    setAttempts(null)
    setError(message)
  }, [])

  const refresh = useCallback(async () => {
    if (!key) return
    try {
      const data = await api.listAttempts(key)
      setAttempts(data)
      if (data[0]?.serverTime) setServerOffset(Date.parse(data[0].serverTime) - Date.now())
      setError('')
    } catch (loadError) {
      if (loadError.status === 401) signOut('That instructor key was not accepted.')
      else setError('The exam service is not responding. Showing the last data received.')
    }
  }, [key, signOut])

  useEffect(() => {
    if (!key) return undefined
    const first = setTimeout(refresh, 0)
    const timer = setInterval(refresh, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [key, refresh])

  return { key, attempts, error, serverOffset, signIn, signOut, refresh }
}
