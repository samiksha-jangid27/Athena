import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Strict Content-Security-Policy for the packaged app. It is only added to
// production builds because Vite's dev server needs inline scripts for HMR.
const API_ORIGIN = process.env.VITE_ATHENA_API_URL || 'http://127.0.0.1:3000'
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  `connect-src ${API_ORIGIN} https://athena-backend-2a0l.onrender.com`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy() {
  return {
    name: 'athena-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: './',
})
