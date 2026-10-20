// Athena exam backend: a small Express server backed by JSON files.
// Good enough for local development and demos; see README for what a
// production deployment still needs.
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const rules = require("./lib/attempts");

const PORT = Number(process.env.PORT) || 3000;
const DURATION_MINUTES = Number(process.env.ATHENA_EXAM_MINUTES) || 10;

// Instructor endpoints need this key. If none is configured we generate one
// per run and print it, so there is never a hard-coded default secret.
const INSTRUCTOR_KEY =
  process.env.ATHENA_INSTRUCTOR_KEY || crypto.randomBytes(12).toString("hex");

const questionsPath =
  process.env.ATHENA_QUESTIONS_PATH || path.join(__dirname, "data", "questions.json");
const sessionsPath =
  process.env.ATHENA_SESSIONS_PATH || path.join(__dirname, "data", "sessions.json");

function readQuestions() {
  return JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
}

function readSessions() {
  if (!fs.existsSync(sessionsPath)) return [];
  return JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
}

// Write to a temp file then rename, so a crash never leaves half a file.
function saveSessions(sessions) {
  const tempPath = `${sessionsPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2));
  fs.renameSync(tempPath, sessionsPath);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function questionForStudent(question) {
  return { id: question.id, question: question.question, options: question.options };
}

const app = express();

// Dev renderer (Vite) and the packaged file:// renderer (origin "null").
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
app.use(express.json({ limit: "100kb" }));

// Loads the attempt for the bearer token, or responds 401.
function withAttempt(handler) {
  return (req, res) => {
    const token = (req.get("authorization") || "").replace(/^Bearer /, "");
    if (!token) return res.status(401).json({ message: "Missing token" });
    const sessions = readSessions();
    const attempt = sessions.find((item) => item.tokenHash === hashToken(token));
    if (!attempt) return res.status(401).json({ message: "Invalid token" });
    rules.refreshStatus(attempt);
    return handler(req, res, attempt, sessions);
  };
}

function requireInstructor(req, res, next) {
  const key = req.get("x-instructor-key") || "";
  const valid =
    key.length === INSTRUCTOR_KEY.length &&
    crypto.timingSafeEqual(Buffer.from(key), Buffer.from(INSTRUCTOR_KEY));
  if (!valid) return res.status(401).json({ message: "Invalid instructor key" });
  next();
}

app.get("/", (req, res) => {
  res.json({ message: "Athena backend is running", serverTime: new Date().toISOString() });
});

// ---------------- Student ----------------

app.post("/exam/start", (req, res) => {
  const { userId, name } = req.body || {};
  if (typeof userId !== "string" || typeof name !== "string" || !userId.trim() || !name.trim()) {
    return res.status(400).json({ message: "userId and name are required" });
  }
  const sessions = readSessions();
  const { token, ...attempt } = rules.createAttempt({
    userId: userId.trim().slice(0, 64),
    name: name.trim().slice(0, 64),
    durationMs: DURATION_MINUTES * 60000,
  });
  attempt.tokenHash = hashToken(token);
  sessions.push(attempt);
  saveSessions(sessions);
  res.status(201).json({
    token,
    attempt: rules.publicAttempt(attempt),
    questions: readQuestions().map(questionForStudent),
  });
});

// Used for crash recovery and as a heartbeat (picks up time extensions).
app.get("/exam/attempt", withAttempt((req, res, attempt, sessions) => {
  saveSessions(sessions); // persist any status change from refreshStatus
  res.json({
    attempt: rules.publicAttempt(attempt),
    questions: readQuestions().map(questionForStudent),
  });
}));

// Saves the full answer set. Idempotent, so the client can retry safely.
app.put("/exam/answers", withAttempt((req, res, attempt, sessions) => {
  const error = rules.saveAnswers(attempt, req.body || {}, readQuestions());
  saveSessions(sessions);
  if (error) return res.status(409).json({ message: error, attempt: rules.publicAttempt(attempt) });
  res.json({ attempt: rules.publicAttempt(attempt) });
}));

app.post("/exam/events", withAttempt((req, res, attempt, sessions) => {
  const error = rules.recordEvents(attempt, req.body?.events);
  if (error) return res.status(400).json({ message: error });
  saveSessions(sessions);
  res.json({ attempt: rules.publicAttempt(attempt) });
}));

app.post("/exam/submit", withAttempt((req, res, attempt, sessions) => {
  if (req.body?.answers && attempt.status === rules.STATUS.IN_PROGRESS) {
    rules.saveAnswers(attempt, req.body, readQuestions());
  }
  rules.submit(attempt);
  saveSessions(sessions);
  res.json({ attempt: rules.publicAttempt(attempt), result: rules.score(attempt, readQuestions()) });
}));

// ---------------- Instructor ----------------

app.use("/instructor", requireInstructor);

app.get("/instructor/attempts", (req, res) => {
  const questions = readQuestions();
  const sessions = readSessions().map((attempt) => rules.refreshStatus(attempt));
  res.json(sessions.map((attempt) => ({
    sessionId: attempt.sessionId,
    userId: attempt.userId,
    name: attempt.name,
    status: attempt.status,
    startedAt: attempt.startedAt,
    deadline: attempt.deadline,
    submittedAt: attempt.submittedAt,
    lastSavedAt: attempt.lastSavedAt || null,
    eventCount: (attempt.events || []).length,
    events: attempt.events || [],
    ...rules.score(attempt, questions),
  })));
});

function instructorAction(action) {
  return (req, res) => {
    const sessions = readSessions();
    const attempt = sessions.find((item) => item.sessionId === req.params.sessionId);
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    const error = action(attempt, req.body || {});
    if (error) return res.status(409).json({ message: error });
    saveSessions(sessions);
    res.json({ status: attempt.status, deadline: attempt.deadline });
  };
}

app.post("/instructor/attempts/:sessionId/extend",
  instructorAction((attempt, body) => rules.extend(attempt, Number(body.minutes))));

app.post("/instructor/attempts/:sessionId/unlock",
  instructorAction((attempt) => rules.unlock(attempt)));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Athena backend running at http://127.0.0.1:${PORT}`);
  if (!process.env.ATHENA_INSTRUCTOR_KEY) {
    console.log(`Instructor key for this run: ${INSTRUCTOR_KEY}`);
  }
});
