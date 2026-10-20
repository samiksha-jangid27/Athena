import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedUrl, toSnapshotBytes, MAX_SNAPSHOT_BYTES } from './ipc-validation.js'

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
