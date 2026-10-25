// Single source of truth for which backend the desktop client talks to.
// Both the runtime client (src/services/api.js) and the production build
// (vite.config.js) import from here, so a packaged app and the Content-Security
// Policy baked into its index.html can never disagree about the trusted server.

// The live hosted backend. Everything else is treated as an override (dev) or
// a stale value that must be ignored (packaged builds).
export const DEFAULT_API_HOST = 'https://athena-backend-2a0l.onrender.com'

// Hostnames shipped by earlier builds that must never be used again: the old
// Render service no longer exists, so keeping it only produces "offline".
export const OBSOLETE_API_HOSTS = ['https://athena-exam-backend.onrender.com']

function clean(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

export function isObsoleteApiUrl(url) {
  const normalized = clean(url)
  if (!normalized) return false
  return OBSOLETE_API_HOSTS.includes(normalized)
}

// Resolves the effective API URL.
//   - Packaged (isProd) builds are pinned to the build-time value, else the
//     built-in default. A stale or tampered localStorage entry is ignored.
//   - Development builds may point at a saved URL, but never at an obsolete
//     host that would silently look "offline".
export function resolveApiUrl({ isProd, envUrl, storedUrl } = {}) {
  const env = clean(envUrl)
  const stored = clean(storedUrl)
  if (isProd) return env || DEFAULT_API_HOST
  if (stored && !isObsoleteApiUrl(stored)) return stored
  return env || 'http://127.0.0.1:3000'
}

// Builds the Content-Security-Policy injected into the production index.html.
// connect-src lists explicit origins only — never a wildcard.
export function buildContentSecurityPolicy(apiOrigin) {
  const origin = clean(apiOrigin) || 'http://127.0.0.1:3000'
  const connectSrc = [...new Set([origin, DEFAULT_API_HOST])].join(' ')
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}
