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
  "disallowed-app-detected",
]);

// How serious each event is, for the instructor timeline.
const SEVERITY = {
  "fullscreen-exit": "critical",
  "camera-lost": "critical",
  "disallowed-app-detected": "critical",
  "screen-capture-failed": "warning",
  "window-blur": "warning",
  "network-offline": "warning",
  "answers-recovered": "warning",
};

function severityOf(type) {
  return SEVERITY[type] || "info";
}

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

function isClosed(attempt) {
  return attempt.status === STATUS.SUBMITTED || attempt.status === STATUS.EXPIRED;
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

// Records client events. Each event carries a client-generated id so a
// retried request never records the same event twice.
function recordEvents(attempt, events, now = Date.now()) {
  refreshStatus(attempt, now);
  if (isClosed(attempt)) {
    return `attempt is ${attempt.status}`;
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
    return "events must be an array of 1 to 50 items";
  }
  for (const event of events) {
    if (!event || !EVENT_TYPES.has(event.type)) return `unknown event type ${event?.type}`;
    if (typeof event.id !== "string" || !/^[\w-]{1,64}$/.test(event.id)) return "each event needs a valid id";
  }
  const seen = new Set(attempt.events.map((item) => item.id).filter(Boolean));
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const clientTime = Date.parse(event.at);
    attempt.events.push({
      id: event.id,
      seq: attempt.events.length + 1,
      attemptId: attempt.sessionId,
      type: event.type,
      severity: severityOf(event.type),
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

// Server-generated events (instructor actions) share the same shape.
function serverEvent(attempt, type, detail, now) {
  attempt.events.push({
    id: `server-${attempt.events.length + 1}`,
    seq: attempt.events.length + 1,
    attemptId: attempt.sessionId,
    type,
    severity: "info",
    receivedAt: new Date(now).toISOString(),
    detail,
  });
}

function unlock(attempt, now = Date.now()) {
  refreshStatus(attempt, now);
  if (attempt.status !== STATUS.LOCKED) return `attempt is ${attempt.status}`;
  attempt.status = STATUS.IN_PROGRESS;
  serverEvent(attempt, "instructor-unlocked", undefined, now);
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
  serverEvent(attempt, "time-extended", `+${minutes} min`, now);
  return null;
}

function submit(attempt, now = Date.now()) {
  refreshStatus(attempt, now);
  if (attempt.status === STATUS.SUBMITTED) return null; // idempotent for retries
  attempt.status = STATUS.SUBMITTED;
  attempt.submittedAt = new Date(now).toISOString();
  serverEvent(attempt, "submitted", undefined, now);
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
  severityOf,
  isClosed,
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
