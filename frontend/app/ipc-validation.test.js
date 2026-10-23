import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedUrl, toSnapshotBytes, MAX_SNAPSHOT_BYTES, isProhibitedShortcut } from './ipc-validation.js'

const dev = { isPackaged: false, devUrl: 'http://localhost:5173' }
const prod = { isPackaged: true, devUrl: 'http://localhost:5173' }

test('dev mode trusts only the exact Vite origin', () => {
  assert.equal(isTrustedUrl('http://localhost:5173/#/instructor', dev), true)
  assert.equal(isTrustedUrl('http://localhost:51730/', dev), false)
  assert.equal(isTrustedUrl('http://localhost:5173.evil.com/', dev), false)
  assert.equal(isTrustedUrl('https://example.com/', dev), false)
  assert.equal(isTrustedUrl('', dev), false)
  assert.equal(isTrustedUrl(undefined, dev), false)
})

test('packaged mode trusts only file:// pages', () => {
  assert.equal(isTrustedUrl('file:///Applications/Athena.app/dist/index.html', prod), true)
  assert.equal(isTrustedUrl('http://localhost:5173/', prod), false)
})

test('snapshot bytes must be a reasonably sized JPEG', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
  assert.equal(toSnapshotBytes(jpeg).byteLength, 6)
  assert.equal(toSnapshotBytes(jpeg.buffer).byteLength, 6)
  assert.equal(toSnapshotBytes(new Uint8Array([1, 2, 3, 4])), null)
  assert.equal(toSnapshotBytes('not bytes'), null)
  assert.equal(toSnapshotBytes(new Uint8Array(0)), null)
  const huge = new Uint8Array(MAX_SNAPSHOT_BYTES + 1)
  huge.set([0xff, 0xd8, 0xff])
  assert.equal(toSnapshotBytes(huge), null)
})

test('isProhibitedShortcut blocks developer tools, reloads, and window manipulation in packaged builds', () => {
  const prodEnv = { isPackaged: true }
  const devEnv = { isPackaged: false }

  // Dev mode does not block
  assert.equal(isProhibitedShortcut({ key: 'F12' }, devEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'r' }, devEnv), false)

  // Direct function keys
  assert.equal(isProhibitedShortcut({ key: 'F12' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ key: 'f5' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ key: 'F11' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ key: 'f3' }, prodEnv), true)

  // Reload shortcuts
  assert.equal(isProhibitedShortcut({ control: true, key: 'r' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ meta: true, key: 'R' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, shift: true, key: 'r' }, prodEnv), true)

  // DevTools and inspector shortcuts
  assert.equal(isProhibitedShortcut({ control: true, shift: true, key: 'I' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ meta: true, alt: true, key: 'i' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, shift: true, key: 'J' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ meta: true, alt: true, key: 'j' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, shift: true, key: 'c' }, prodEnv), true)

  // Page source, printing, saving, new windows
  assert.equal(isProhibitedShortcut({ control: true, key: 'u' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ meta: true, key: 'u' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, key: 'p' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, key: 's' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, key: 'n' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ control: true, key: 'o' }, prodEnv), true)
  assert.equal(isProhibitedShortcut({ alt: true, key: 'arrowleft' }, prodEnv), true)

  // Legitimate shortcuts and inputs MUST NOT be blocked
  assert.equal(isProhibitedShortcut({ key: 'ArrowLeft' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: 'ArrowRight' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: 'Tab' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: 'Enter' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: 'Escape' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: 'a' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ key: '1' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'c' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'v' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'x' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'a' }, prodEnv), false)
  assert.equal(isProhibitedShortcut({ control: true, key: 'z' }, prodEnv), false)
})
