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
