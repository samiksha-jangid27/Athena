import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFile, formatBytes, toBase64 } from './files.js'

const task = { allowedExtensions: ['.js', '.md'], maxFileBytes: 100, maxFiles: 2, files: [] }

test('checkFile mirrors the server upload rules', () => {
  assert.equal(checkFile({ name: 'a.JS', size: 10 }, task), null)
  assert.match(checkFile({ name: 'a.exe', size: 10 }, task), /not allowed/)
  assert.match(checkFile({ name: 'Makefile', size: 10 }, task), /without an extension/)
  assert.match(checkFile({ name: 'a.js', size: 0 }, task), /empty/)
  assert.match(checkFile({ name: 'a.js', size: 101 }, task), /larger/)
  assert.match(checkFile({ name: 'a.js', size: 1 }, { ...task, files: [{}, {}] }), /at most 2/)
})

test('formatBytes and toBase64', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(toBase64(new TextEncoder().encode('hi').buffer), 'aGk=')
})
