// Pure helpers for the question navigator and submission summary.

export function questionState(question, answers, flags) {
  return {
    answered: answers[question.id] !== undefined,
    flagged: flags.includes(question.id),
  }
}

// filter: all | unanswered | flagged. Keeps original indices for jumping.
export function filterQuestions(questions, filter, answers, flags) {
  return questions
    .map((question, index) => ({ question, index, ...questionState(question, answers, flags) }))
    .filter((item) => filter === 'all'
      || (filter === 'unanswered' && !item.answered)
      || (filter === 'flagged' && item.flagged))
}

export function answerSummary(questions, answers, flags) {
  const unanswered = []
  const flagged = []
  questions.forEach((question, index) => {
    const state = questionState(question, answers, flags)
    if (!state.answered) unanswered.push(index)
    if (state.flagged) flagged.push(index)
  })
  return { total: questions.length, answered: questions.length - unanswered.length, unanswered, flagged }
}

// Timer urgency for styling and screen-reader announcements.
export function timerLevel(remainingMs) {
  if (remainingMs <= 60000) return 'critical'
  if (remainingMs <= 5 * 60000) return 'warning'
  return 'normal'
}

// Maps a key press to an exam action, or null. Ignores typing in fields.
export function keyAction(event, optionCount) {
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return null
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.key === 'ArrowRight') return { type: 'next' }
  if (event.key === 'ArrowLeft') return { type: 'previous' }
  if (event.key === 'f' || event.key === 'F') return { type: 'flag' }
  const number = Number(event.key)
  if (Number.isInteger(number) && number >= 1 && number <= optionCount) return { type: 'choose', index: number - 1 }
  return null
}
