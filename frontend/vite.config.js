import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { buildContentSecurityPolicy } from './src/lib/backend.js'

// Strict Content-Security-Policy for the packaged app. It is only added to
// production builds because Vite's dev server needs inline scripts for HMR.
// The allowed origins come from the same module the runtime client uses, so the
// bundled app and its CSP always agree on the trusted backend.
const API_ORIGIN = process.env.VITE_ATHENA_API_URL || 'http://127.0.0.1:3000'
const CSP = buildContentSecurityPolicy(API_ORIGIN)

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
