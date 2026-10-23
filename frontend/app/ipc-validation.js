// Pure checks for IPC requests, kept separate so they can be unit tested.

export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

// Compares full origins, so "http://localhost:51730" does not pass for
// "http://localhost:5173".
export function isTrustedUrl(url, { isPackaged, devUrl }) {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    if (isPackaged) return parsed.protocol === 'file:'
    return parsed.origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

// Returns a Uint8Array view of a valid JPEG snapshot, or null.
export function toSnapshotBytes(value) {
  let bytes = null
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (!bytes || bytes.byteLength < 3 || bytes.byteLength > MAX_SNAPSHOT_BYTES) return null
  // JPEG files start with FF D8 FF.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  return bytes
}

// Determines if an in-app keyboard shortcut is prohibited during the exam.
// System shortcuts (Cmd+Tab, Mission Control, OS lock) cannot be intercepted by Electron;
// this catches in-app reloads, dev tools, source inspection, and window manipulation.
export function isProhibitedShortcut(input, { isPackaged = true } = {}) {
  if (!input || typeof input !== 'object') return false
  if (!isPackaged) return false // Dev allows dev tools and reload

  const key = (input.key || '').toLowerCase()
  const mod = Boolean(input.control || input.meta)
  const shift = Boolean(input.shift)
  const alt = Boolean(input.alt)

  // Direct function keys: F5 (reload), F12 (DevTools), F11 (fullscreen toggle), F3 (search)
  if (key === 'f5' || key === 'f12' || key === 'f11' || key === 'f3') return true

  // Reload: Ctrl+R, Cmd+R, Ctrl+Shift+R, Cmd+Shift+R
  if (mod && key === 'r') return true

  // DevTools & Console: Ctrl+Shift+I, Cmd+Option+I, Ctrl+Shift+J, Cmd+Option+J, Ctrl+Shift+C, Cmd+Option+C
  if ((mod && shift && (key === 'i' || key === 'j' || key === 'c')) || (mod && alt && (key === 'i' || key === 'j' || key === 'c'))) {
    return true
  }

  // View Source: Ctrl+U, Cmd+U
  if (mod && key === 'u') return true

  // New window / incognito: Ctrl+N, Cmd+N
  if (mod && key === 'n') return true

  // Print: Ctrl+P, Cmd+P
  if (mod && key === 'p') return true

  // Save page / Open file: Ctrl+S, Cmd+S, Ctrl+O, Cmd+O
  if (mod && (key === 's' || key === 'o')) return true

  // History navigation: Alt+Left, Alt+Right
  if (alt && (key === 'arrowleft' || key === 'arrowright')) return true

  return false
}
