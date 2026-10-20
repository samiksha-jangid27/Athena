// Athena exam backend: Express routes on top of JSON-file storage.
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const rules = require("./lib/attempts");
const { createStore } = require("./lib/store");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function questionForStudent(question) {
  return { id: question.id, question: question.question, options: question.options };
}

function sendError(res, status, message, extra = {}) {
  return res.status(status).json({ message, ...extra });
}

function createApp({ questionsPath, sessionsPath, instructorKey, durationMinutes = 10, examTitle = "Electron Fundamentals" }) {
  if (!instructorKey) throw new Error("instructorKey is required");
  const store = createStore({ questionsPath, sessionsPath });
  const app = express();

  // Dev renderer (Vite) and the packaged file:// renderer (origin "null").
  app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173", "null"] }));
  app.use(express.json({ limit: "100kb" }));

  // Loads the attempt for the bearer token, or responds 401.
  function withAttempt(handler) {
    return (req, res) => {
      const token = (req.get("authorization") || "").replace(/^Bearer /, "");
      if (!token) return sendError(res, 401, "Missing token");
      const sessions = store.readSessions();
      const attempt = sessions.find((item) => item.tokenHash === hashToken(token));
      if (!attempt) return sendError(res, 401, "Invalid or expired session token");
      rules.refreshStatus(attempt);
      return handler(req, res, attempt, sessions);
    };
  }

  function requireInstructor(req, res, next) {
    const key = req.get("x-instructor-key") || "";
    const valid =
      key.length === instructorKey.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(instructorKey));
    if (!valid) return sendError(res, 401, "Invalid instructor key");
    next();
  }

  app.get("/", (req, res) => {
    res.json({ message: "Athena backend is running", serverTime: new Date().toISOString() });
  });

  // ---------------- Student ----------------

  // Public exam summary for the welcome screen (no questions or answers).
  app.get("/exam/info", (req, res) => {
    res.json({
      title: examTitle,
      durationMinutes,
      questionCount: store.readQuestions().length,
      lockOnFullscreenExit: true,
      snapshotIntervalSeconds: 30,
    });
  });

  app.post("/exam/start", (req, res) => {
    const { userId, name } = req.body || {};
    if (typeof userId !== "string" || typeof name !== "string" || !userId.trim() || !name.trim()) {
      return sendError(res, 400, "userId and name are required");
    }
    const sessions = store.readSessions();
    const { token, ...attempt } = rules.createAttempt({
      userId: userId.trim().slice(0, 64),
      name: name.trim().slice(0, 64),
      durationMs: durationMinutes * 60000,
    });
    attempt.tokenHash = hashToken(token);
    sessions.push(attempt);
    store.saveSessions(sessions);
    res.status(201).json({
      token,
      attempt: rules.publicAttempt(attempt),
      questions: store.readQuestions().map(questionForStudent),
    });
  });

  // Used for crash recovery and as a heartbeat (picks up time extensions).
  app.get("/exam/attempt", withAttempt((req, res, attempt, sessions) => {
    store.saveSessions(sessions); // persist any status change from refreshStatus
    res.json({
      attempt: rules.publicAttempt(attempt),
      questions: store.readQuestions().map(questionForStudent),
    });
  }));

  // Saves the full answer set. Idempotent, so the client can retry safely.
  app.put("/exam/answers", withAttempt((req, res, attempt, sessions) => {
    const error = rules.saveAnswers(attempt, req.body || {}, store.readQuestions());
    store.saveSessions(sessions);
    if (error) return sendError(res, 409, error, { attempt: rules.publicAttempt(attempt) });
    res.json({ attempt: rules.publicAttempt(attempt) });
  }));

  app.post("/exam/events", withAttempt((req, res, attempt, sessions) => {
    if (rules.isClosed(attempt)) {
      return sendError(res, 409, `attempt is ${attempt.status}`, { attempt: rules.publicAttempt(attempt) });
    }
    const error = rules.recordEvents(attempt, req.body?.events);
    if (error) return sendError(res, 400, error);
    store.saveSessions(sessions);
    res.json({ attempt: rules.publicAttempt(attempt) });
  }));

  app.post("/exam/submit", withAttempt((req, res, attempt, sessions) => {
    const questions = store.readQuestions();
    if (req.body?.answers && attempt.status === rules.STATUS.IN_PROGRESS) {
      rules.saveAnswers(attempt, req.body, questions);
    }
    rules.submit(attempt);
    store.saveSessions(sessions);
    res.json({ attempt: rules.publicAttempt(attempt), result: rules.score(attempt, questions) });
  }));

  // ---------------- Instructor ----------------

  app.use("/instructor", requireInstructor);

  app.get("/instructor/attempts", (req, res) => {
    const questions = store.readQuestions();
    const sessions = store.readSessions().map((attempt) => rules.refreshStatus(attempt));
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
      const sessions = store.readSessions();
      const attempt = sessions.find((item) => item.sessionId === req.params.sessionId);
      if (!attempt) return sendError(res, 404, "Attempt not found");
      const error = action(attempt, req.body || {});
      if (error) return sendError(res, 409, error);
      store.saveSessions(sessions);
      res.json({ status: attempt.status, deadline: attempt.deadline });
    };
  }

  app.post("/instructor/attempts/:sessionId/extend",
    instructorAction((attempt, body) => rules.extend(attempt, Number(body.minutes))));

  app.post("/instructor/attempts/:sessionId/unlock",
    instructorAction((attempt) => rules.unlock(attempt)));

  // ---------------- Errors ----------------

  app.use((req, res) => sendError(res, 404, "Not found"));

  // Malformed JSON, oversized bodies and unexpected errors return JSON,
  // never an HTML stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed") return sendError(res, 400, "Request body must be valid JSON");
    if (error.type === "entity.too.large") return sendError(res, 413, "Request body is too large");
    console.error(error);
    return sendError(res, 500, "Internal server error");
  });

  return app;
}

module.exports = { createApp, hashToken };
