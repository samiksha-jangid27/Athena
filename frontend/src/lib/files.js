// File helpers for practical uploads.

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Checks a file against the task rules before uploading, so students get
// an instant message. The server repeats these checks.
export function checkFile(file, task) {
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : ''
  if (!task.allowedExtensions.includes(extension)) return `${file.name}: ${extension || 'files without an extension'} not allowed`
  if (file.size === 0) return `${file.name} is empty`
  if (file.size > task.maxFileBytes) return `${file.name} is larger than ${formatBytes(task.maxFileBytes)}`
  if (task.files.length >= task.maxFiles) return `You can upload at most ${task.maxFiles} files`
  return null
}

export function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
