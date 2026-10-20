// Pure attempt rules. The server is the source of truth for status,
// deadlines and answer locking; the React app only mirrors these states.
const crypto = require("crypto");

const STATUS = {
  IN_PROGRESS: "in-progress",
  LOCKED: "locked",
  SUBMITTED: "submitted",
  EXPIRED: "expired",
};

// Activity event types the client may report. Anything else is rejected.
const EVENT_TYPES = new Set([
  "exam-started",
  "fullscreen-exit",
  "fullscreen-enter",
  "window-blur",
  "window-focus",
  "camera-lost",
  "camera-restored",
  "screen-capture-failed",
  "screen-capture-restored",
  "network-offline",
  "network-online",
  "answers-recovered",
]);

// Events that immediately lock answering until an instructor unlocks.
const LOCKING_EVENTS = new Set(["fullscreen-exit"]);

// Small grace period for network latency on the final save.
const GRACE_MS = 5000;

function createAttempt({ userId, name, durationMs, now = Date.now() }) {
  return {
    sessionId: `session-${now}-${crypto.randomBytes(3).toString("hex")}`,
    token: crypto.randomBytes(24).toString("hex"),
    userId,
    name,
    startedAt: new Date(now).toISOString(),
    deadline: new Date(now + durationMs).toISOString(),
    submittedAt: null,
    status: STATUS.IN_PROGRESS,
    answers: {},
    flags: [],
    events: [],
    extensions: [],
  };
}

// Moves an attempt to "expired" once the deadline (plus grace) has passed.
function refreshStatus(attempt, now = Date.now()) {
  const open =
    attempt.status === STATUS.IN_PROGRESS || attempt.status === STATUS.LOCKED;
  if (open && now > Date.parse(attempt.deadline) + GRACE_MS) {
    attempt.status = STATUS.EXPIRED;
    attempt.submittedAt = new Date(now).toISOString();
  }
  return attempt;
}

function validateAnswers(answers, questions) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return "answers must be an object";
  }
  for (const [questionId, selected] of Object.entries(answers)) {
    const question = questions.find((q) => String(q.id) === questionId);
    if (!question) return `unknown question ${questionId}`;
    if (
      !Number.isInteger(selected) ||
      selected < 0 ||
      selected >= question.options.length
    ) {
      return `invalid answer for question ${questionId}`;
    }
  }
  return null;
}

// Returns an error message, or null when the answers were saved.
function saveAnswers(attempt, { answers, flags = [] }, questions, now = Date.now()) {
  refreshStatus(attempt, now);
  if (attempt.status !== STATUS.IN_PROGRESS) {
    return `attempt is ${attempt.status}`;
  }
  const error = validateAnswers(answers, questions);
  if (error) return error;
  if (!Array.isArray(flags) || flags.some((id) => !questions.some((q) => q.id === id))) {
    return "invalid flags";
  }
  attempt.answers = { ...answers };
  attempt.flags = [...new Set(flags)];
  attempt.lastSavedAt = new Date(now).toISOString();
  return null;
}

function recordEvents(attempt, events, now = Date.now()) {
  if (!Array.isArray(events) || events.length > 50) return "events must be an array of up to 50 items";
  for (const event of events) {
    if (!event || !EVENT_TYPES.has(event.type)) return `unknown event type ${event?.type}`;
  }
  for (const event of events) {
    const clientTime = Date.parse(event.at);
    attempt.events.push({
      type: event.type,
      clientAt: Number.isNaN(clientTime) ? null : new Date(clientTime).toISOString(),
      receivedAt: new Date(now).toISOString(),
      detail: typeof event.detail === "string" ? event.detail.slice(0, 200) : undefined,
    });
    if (LOCKING_EVENTS.has(event.type) && attempt.status === STATUS.IN_PROGRESS) {
      attempt.status = STATUS.LOCKED;
    }
  }
  return null;
}

function unlock(attempt, now = Date.now()) {
  refreshStatus(attempt, now);
  if (attempt.status !== STATUS.LOCKED) return `attempt is ${attempt.status}`;
  attempt.status = STATUS.IN_PROGRESS;
  attempt.events.push({ type: "instructor-unlocked", receivedAt: new Date(now).toISOString() });
  return null;
}

function extend(attempt, minutes, now = Date.now()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
    return "minutes must be an integer between 1 and 120";
  }
  if (attempt.status === STATUS.SUBMITTED) return "attempt is submitted";
  // Extending an expired attempt reopens it, keeping all saved answers.
  const base = Math.max(Date.parse(attempt.deadline), attempt.status === STATUS.EXPIRED ? now : 0);
  attempt.deadline = new Date(base + minutes * 60000).toISOString();
  if (attempt.status === STATUS.EXPIRED) {
    attempt.status = STATUS.IN_PROGRESS;
    attempt.submittedAt = null;
  }
  attempt.extensions.push({ minutes, at: new Date(now).toISOString() });
  attempt.events.push({ type: "time-extended", detail: `+${minutes} min`, receivedAt: new Date(now).toISOString() });
  return null;
}

function submit(attempt, now = Date.now()) {
  refreshStatus(attempt, now);
  if (attempt.status === STATUS.SUBMITTED) return null; // idempotent for retries
  attempt.status = STATUS.SUBMITTED;
  attempt.submittedAt = new Date(now).toISOString();
  return null;
}

function score(attempt, questions) {
  let correct = 0;
  for (const question of questions) {
    if (attempt.answers[question.id] === question.correctAnswer) correct += 1;
  }
  const attempted = Object.keys(attempt.answers).length;
  return { attempted, correct, wrong: attempted - correct };
}

// What the student may see: no token echo, no correct answers.
function publicAttempt(attempt, now = Date.now()) {
  return {
    sessionId: attempt.sessionId,
    status: attempt.status,
    deadline: attempt.deadline,
    serverTime: new Date(now).toISOString(),
    answers: attempt.answers,
    flags: attempt.flags,
  };
}

module.exports = {
  STATUS,
  EVENT_TYPES,
  GRACE_MS,
  createAttempt,
  refreshStatus,
  saveAnswers,
  recordEvents,
  unlock,
  extend,
  submit,
  score,
  publicAttempt,
};
