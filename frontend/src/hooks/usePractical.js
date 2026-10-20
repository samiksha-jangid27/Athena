import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { checkFile, toBase64 } from '../lib/files.js'

// Loads practical tasks for the attempt and wraps upload/checkpoint calls.
export function usePractical(token) {
  const [tasks, setTasks] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.practical(token)
      setTasks(data.tasks)
    } catch {
      setError('Could not load the practical task. It will retry automatically.')
    }
  }, [token])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  const replaceTask = (task) => setTasks((current) => current.map((item) => (item.id === task.id ? task : item)))

  async function run(action) {
    setBusy(true)
    setError('')
    try {
      const data = await action()
      if (data?.task) replaceTask(data.task)
      return true
    } catch (actionError) {
      setError(actionError.message || 'The request failed. Try again.')
      if (actionError.status === 409) load()
      return false
    } finally {
      setBusy(false)
    }
  }

  const upload = async (task, file) => {
    const problem = checkFile(file, task)
    if (problem) {
      setError(problem)
      return false
    }
    return run(async () => api.uploadFile(token, task.id, file.name, toBase64(await file.arrayBuffer())))
  }

  return {
    tasks, busy, error,
    upload,
    remove: (task, fileId) => run(() => api.removeFile(token, task.id, fileId)),
    checkpoint: (task, label) => run(() => api.checkpoint(token, task.id, label)),
  }
}
