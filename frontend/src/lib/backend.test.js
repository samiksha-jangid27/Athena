import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_API_HOST,
  OBSOLETE_API_HOSTS,
  isObsoleteApiUrl,
  resolveApiUrl,
  buildContentSecurityPolicy,
} from './backend.js'

test('the default backend is the live Render host, never an obsolete one', () => {
  assert.equal(DEFAULT_API_HOST, 'https://athena-backend-2a0l.onrender.com')
  assert.ok(!OBSOLETE_API_HOSTS.includes(DEFAULT_API_HOST))
  assert.ok(isObsoleteApiUrl('https://athena-exam-backend.onrender.com'))
  assert.ok(!isObsoleteApiUrl(DEFAULT_API_HOST))
  assert.ok(!isObsoleteApiUrl(''))
})

test('packaged builds ignore a stale or tampered localStorage URL', () => {
  // A leftover value pointing at the dead host (or localhost) must not win.
  assert.equal(
    resolveApiUrl({ isProd: true, envUrl: '', storedUrl: 'https://athena-exam-backend.onrender.com' }),
    DEFAULT_API_HOST
  )
  assert.equal(
    resolveApiUrl({ isProd: true, envUrl: '', storedUrl: 'http://127.0.0.1:3000' }),
    DEFAULT_API_HOST
  )
  assert.equal(resolveApiUrl({ isProd: true, envUrl: '', storedUrl: '' }), DEFAULT_API_HOST)
})

test('a build-time env URL wins in packaged builds', () => {
  assert.equal(
    resolveApiUrl({ isProd: true, envUrl: 'https://exams.example.edu/', storedUrl: 'http://127.0.0.1:3000' }),
    'https://exams.example.edu'
  )
})

test('development builds may use a saved URL but never an obsolete host', () => {
  assert.equal(resolveApiUrl({ isProd: false, storedUrl: 'http://127.0.0.1:4000/' }), 'http://127.0.0.1:4000')
  assert.equal(resolveApiUrl({ isProd: false, storedUrl: OBSOLETE_API_HOSTS[0] }), 'http://127.0.0.1:3000')
  assert.equal(resolveApiUrl({ isProd: false, envUrl: 'http://localhost:3000', storedUrl: '' }), 'http://localhost:3000')
})

test('generated CSP trusts explicit origins only, never a wildcard', () => {
  const csp = buildContentSecurityPolicy('https://exams.example.edu')
  const connect = csp.split('; ').find((directive) => directive.startsWith('connect-src '))
  assert.ok(connect.includes(DEFAULT_API_HOST), 'the live backend is trusted')
  assert.ok(connect.includes('https://exams.example.edu'), 'the configured origin is trusted')
  assert.ok(!connect.includes('*'), 'no wildcard in connect-src')
  assert.ok(!/athena-exam-backend/.test(csp), 'the obsolete host is never allowed')

  // The default (no env override) still trusts the live backend.
  assert.ok(buildContentSecurityPolicy().includes(`connect-src http://127.0.0.1:3000 ${DEFAULT_API_HOST}`))
})

test('the built index.html pins the CSP to the live backend', (t) => {
  const distIndex = fileURLToPath(new URL('../../dist/index.html', import.meta.url))
  if (!existsSync(distIndex)) {
    t.skip('run `npm run build:frontend` first to inspect the generated bundle')
    return
  }
  const html = readFileSync(distIndex, 'utf8')
  assert.match(html, /http-equiv="Content-Security-Policy"/, 'the production bundle ships a CSP')
  assert.ok(html.includes(`connect-src http://127.0.0.1:3000 ${DEFAULT_API_HOST}`), 'connect-src names the live backend')
  assert.ok(!/athena-exam-backend/.test(html), 'the obsolete host is not baked into the bundle')
})
