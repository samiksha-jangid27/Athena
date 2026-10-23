import test from 'node:test'
import assert from 'node:assert/strict'
import { filterQuestions, answerSummary, timerLevel, keyAction } from './navigation.js'

const questions = [{ id: 1 }, { id: 2 }, { id: 3 }]
const answers = { 1: 0, 3: 2 }
const flags = [2, 3]

test('filterQuestions keeps original indices', () => {
  assert.deepEqual(filterQuestions(questions, 'all', answers, flags).map((item) => item.index), [0, 1, 2])
  assert.deepEqual(filterQuestions(questions, 'unanswered', answers, flags).map((item) => item.index), [1])
  assert.deepEqual(filterQuestions(questions, 'flagged', answers, flags).map((item) => item.index), [1, 2])
})

test('answerSummary lists unanswered and flagged questions', () => {
  assert.deepEqual(answerSummary(questions, answers, flags), { total: 3, answered: 2, unanswered: [1], flagged: [1, 2] })
  assert.deepEqual(answerSummary([], {}, []), { total: 0, answered: 0, unanswered: [], flagged: [] })
})

test('answerSummary handles MSQ arrays and Short Answer strings', () => {
  const mixedQuestions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }, { id: 'q4' }]
  const mixedAnswers = {
    q1: [0, 2], // MSQ answered
    q2: [],     // MSQ empty (unanswered)
    q3: 'An explanation', // Short answer text
    q4: '   ',  // Short answer whitespace only (unanswered)
  }
  const summary = answerSummary(mixedQuestions, mixedAnswers, ['q1'])
  assert.equal(summary.answered, 2)
  assert.deepEqual(summary.unanswered, [1, 3])
  assert.deepEqual(summary.flagged, [0])
})

test('timerLevel escalates at five minutes and one minute', () => {
  assert.equal(timerLevel(10 * 60000), 'normal')
  assert.equal(timerLevel(5 * 60000), 'warning')
  assert.equal(timerLevel(60000), 'critical')
  assert.equal(timerLevel(0), 'critical')
})

test('keyAction maps shortcuts and ignores typing and modifiers', () => {
  const key = (k, extra = {}) => ({ key: k, target: { tagName: 'BODY' }, ...extra })
  assert.deepEqual(keyAction(key('ArrowRight'), 4), { type: 'next' })
  assert.deepEqual(keyAction(key('ArrowLeft'), 4), { type: 'previous' })
  assert.deepEqual(keyAction(key('f'), 4), { type: 'flag' })
  assert.deepEqual(keyAction(key('3'), 4), { type: 'choose', index: 2 })
  assert.deepEqual(keyAction(key('a'), 4), { type: 'choose', index: 0 })
  assert.deepEqual(keyAction(key('D'), 4), { type: 'choose', index: 3 })
  assert.equal(keyAction(key('e'), 4), null)
  assert.equal(keyAction(key('5'), 4), null)
  assert.equal(keyAction(key('1', { target: { tagName: 'TEXTAREA' } }), 4), null)
  assert.equal(keyAction(key('r', { metaKey: true }), 4), null)
})
