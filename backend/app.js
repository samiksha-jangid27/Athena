// Athena Unified Multi-Student Examination Backend.
// Express REST API with Role-Based Authentication, PostgreSQL/Prisma support,
// Exam & Question Management, Grading Engine, Proctoring Evidence, and Audit Logging.

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { db, ensureSeed } = require("./lib/db");
const {
  hashPassword,
  verifyPassword,
  generateToken,
  authenticateToken,
  requireRole,
  requireAdmin,
  requireStudent,
  hashToken,
} = require("./lib/auth");
const { gradeQuestion, gradeAttempt } = require("./lib/grading");
const { saveEvidenceFile, getEvidenceStream } = require("./lib/evidenceStorage");
const rules = require("./lib/attempts");
const practical = require("./lib/practical");
const { createStore } = require("./lib/store");

function sendError(res, status, message, extra = {}) {
  return res.status(status).json({ message, ...extra });
}

function questionForStudent(q) {
  let options = [];
  try {
    options = typeof q.options === "string" ? JSON.parse(q.options) : q.options || [];
  } catch {
    options = [];
  }
  return {
    id: q.id,
    type: q.type,
    question: q.prompt,
    options,
    marks: q.marks,
    orderIndex: q.orderIndex,
  };
}

function createApp(config = {}) {
  const {
    instructorKey = process.env.ATHENA_INSTRUCTOR_KEY || "dev-instructor-key",
    durationMinutes = Number(process.env.ATHENA_EXAM_MINUTES) || 10,
    examTitle = process.env.ATHENA_EXAM_TITLE || "Electron Fundamentals",
    questionsPath = process.env.ATHENA_QUESTIONS_PATH || path.join(__dirname, "data", "questions.json"),
    sessionsPath = process.env.ATHENA_SESSIONS_PATH || path.join(__dirname, "data", "sessions.json"),
    practicalPath = path.join(path.dirname(questionsPath), "practical.json"),
    artifactsDir = path.join(path.dirname(sessionsPath), "artifacts"),
  } = config;

  const app = express();

  // CORS configuration
  const allowedOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "null",
  ];
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost")) {
          callback(null, true);
        } else {
          callback(null, true); // Allow configured clients in production
        }
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "x-athena-bootstrap-secret"],
    })
  );

  // Body parsers
  app.use("/api/student/attempt/evidence", express.json({ limit: "5mb" }));
  app.use("/practical", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "500kb" }));

  // Helper for Legacy JSON store fallback
  const legacyStore = createStore({ questionsPath, sessionsPath });
  const readTasks = () => (fs.existsSync(practicalPath) ? JSON.parse(fs.readFileSync(practicalPath, "utf-8")) : []);
  const artifactPath = (attempt, file) => path.join(artifactsDir, attempt.sessionId, `${file.id}-${file.name}`);

  // ---------------- Health & Diagnostics ----------------
  app.get(["/", "/health", "/api/health"], async (req, res) => {
    try {
      const dbHealth = await db.checkHealth();

      const healthy =
        dbHealth.status === "connected" &&
        (process.env.NODE_ENV !== "production" || db.isPostgres);

      return res.status(healthy ? 200 : 503).json({
        status: healthy ? "ok" : "error",
        name: "Athena Examination Platform",
        version: "1.0.0",
        serverTime: new Date().toISOString(),
        database: dbHealth,
      });
    } catch (err) {
      console.error("Health check failed:", err.message);

      return res.status(503).json({
        status: "error",
        name: "Athena Examination Platform",
        database: { status: "error" },
      });
    }
  });

  // ---------------- Authentication Routes ----------------

  // Login for both Admin and Student
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return sendError(res, 400, "Username and password are required");
    }

    try {
      const user = await db.users.findByUsername(username);
      if (!user) {
        return sendError(res, 401, "Invalid username or password");
      }

      const match = await verifyPassword(password, user.passwordHash);
      if (!match) {
        return sendError(res, 401, "Invalid username or password");
      }

      const token = generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      });

      await db.audit.log({
        userId: user.id,
        action: "USER_LOGIN",
        targetType: "USER",
        targetId: user.id,
      });

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      console.error("Login error:", err);
      sendError(res, 500, "Internal server error during authentication");
    }
  });

  // Bootstrap initial admin if no users exist
  app.post("/api/auth/bootstrap-admin", async (req, res) => {
      if (process.env.NODE_ENV === "production") {
      const expected = process.env.ATHENA_ADMIN_BOOTSTRAP_SECRET || "";
      const received = req.get("x-athena-bootstrap-secret") || "";

      const expectedBuffer = Buffer.from(expected);
      const receivedBuffer = Buffer.from(received);

      if (expected.length < 32) {
        return sendError(res, 503, "Admin bootstrap is not configured");
      }

      if (
        expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
      ) {
        return sendError(res, 403, "Bootstrap authorization failed");
      }
    }
    try {
      const adminCount = await db.users.countAdmins();
      if (adminCount > 0) {
        return sendError(res, 403, "Administrator account already exists. Bootstrap is disabled.");
      }
      const { username, password, name } = req.body || {};
      if (!username || !password || !name) {
        return sendError(res, 400, "Username, password, and name are required");
      }
      if (password.length < 8) {
        return sendError(res, 400, "Password must be at least 8 characters");
      }

      const passwordHash = await hashPassword(password);
      const user = await db.users.create({
        username,
        name,
        passwordHash,
        role: "ADMIN",
      });

      const token = generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      });

      res.status(201).json({
        message: "Administrator account initialized successfully",
        token,
        user: { id: user.id, username: user.username, name: user.name, role: user.role },
      });
    } catch (err) {
      console.error("Bootstrap error:", err);
      sendError(res, 500, err.message || "Failed to initialize administrator");
    }
  });

  // Current session profile
  app.get("/api/auth/me", authenticateToken, async (req, res) => {
    res.json({ user: req.user });
  });

  // ---------------- Admin Routes ----------------

  // Admin: List all exams
  app.get("/api/admin/exams", ...requireAdmin, async (req, res) => {
    try {
      const exams = await db.exams.listAll();
      res.json({ exams });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Create exam
  app.post("/api/admin/exams", ...requireAdmin, async (req, res) => {
    try {
      const { title, description, instructions, durationMinutes, totalMarks, passingCriteria } = req.body || {};
      if (!title || !title.trim()) return sendError(res, 400, "Exam title is required");

      const exam = await db.exams.create({
        title: title.trim(),
        description,
        instructions,
        durationMinutes: Number(durationMinutes) || 10,
        totalMarks: Number(totalMarks) || 100,
        passingCriteria: Number(passingCriteria) || 50,
        status: "DRAFT",
      });

      await db.audit.log({
        userId: req.user.id,
        action: "EXAM_CREATE",
        targetType: "EXAM",
        targetId: exam.id,
      });

      res.status(201).json({ exam });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Get exam with questions
  app.get("/api/admin/exams/:id", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");
      const questions = await db.questions.listByExam(req.params.id, { includeAnswers: true });
      res.json({ exam: { ...exam, questions } });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Update exam
  app.put("/api/admin/exams/:id", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");

      const updated = await db.exams.update(req.params.id, req.body || {});
      await db.audit.log({
        userId: req.user.id,
        action: "EXAM_UPDATE",
        targetType: "EXAM",
        targetId: exam.id,
      });

      res.json({ exam: updated });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Publish exam
  app.post("/api/admin/exams/:id/publish", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");
      const questions = await db.questions.listByExam(req.params.id);
      if (questions.length === 0) {
        return sendError(res, 400, "Cannot publish an exam with no questions");
      }

      const updated = await db.exams.setStatus(req.params.id, "PUBLISHED");
      await db.audit.log({
        userId: req.user.id,
        action: "EXAM_PUBLISH",
        targetType: "EXAM",
        targetId: exam.id,
      });

      res.json({ exam: updated });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Unpublish exam
  app.post("/api/admin/exams/:id/unpublish", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");

      const updated = await db.exams.setStatus(req.params.id, "DRAFT");
      await db.audit.log({
        userId: req.user.id,
        action: "EXAM_UNPUBLISH",
        targetType: "EXAM",
        targetId: exam.id,
      });

      res.json({ exam: updated });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Add question
  app.post("/api/admin/exams/:id/questions", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");

      const { type, prompt, options, correctAnswer, marks, orderIndex, explanation } = req.body || {};
      if (!prompt || !prompt.trim()) return sendError(res, 400, "Question prompt is required");
      if (correctAnswer === undefined || correctAnswer === null) {
        return sendError(res, 400, "Correct answer is required");
      }

      const question = await db.questions.create(req.params.id, {
        type: type || "MCQ",
        prompt: prompt.trim(),
        options: options || [],
        correctAnswer,
        marks: Number(marks) || 1,
        orderIndex: Number(orderIndex) || 0,
        explanation: explanation || "",
      });

      await db.audit.log({
        userId: req.user.id,
        action: "QUESTION_CREATE",
        targetType: "QUESTION",
        targetId: question.id,
      });

      res.status(201).json({ question });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Update question
  app.put("/api/admin/questions/:id", ...requireAdmin, async (req, res) => {
    try {
      const q = await db.questions.findById(req.params.id);
      if (!q) return sendError(res, 404, "Question not found");

      const updated = await db.questions.update(req.params.id, req.body || {});
      res.json({ question: updated });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Delete question
  app.delete("/api/admin/questions/:id", ...requireAdmin, async (req, res) => {
    try {
      const deleted = await db.questions.delete(req.params.id);
      if (!deleted) return sendError(res, 404, "Question not found");
      res.json({ message: "Question deleted successfully" });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Students Management
  app.get("/api/admin/students", ...requireAdmin, async (req, res) => {
    try {
      const students = await db.users.listStudents();
      res.json({ students });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  app.post("/api/admin/students", ...requireAdmin, async (req, res) => {
    try {
      const { username, name, password } = req.body || {};
      if (!username || !name || !password) {
        return sendError(res, 400, "Username, name, and temporary password are required");
      }
      const existing = await db.users.findByUsername(username);
      if (existing) return sendError(res, 409, "A student with this username already exists");

      const passwordHash = await hashPassword(password);
      const student = await db.users.create({
        username,
        name,
        passwordHash,
        role: "STUDENT",
      });

      await db.audit.log({
        userId: req.user.id,
        action: "STUDENT_CREATE",
        targetType: "USER",
        targetId: student.id,
      });

      res.status(201).json({
        student: { id: student.id, username: student.username, name: student.name, createdAt: student.createdAt },
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  app.delete("/api/admin/students/:id", ...requireAdmin, async (req, res) => {
    try {
      const deleted = await db.users.deleteUser(req.params.id);
      if (!deleted) return sendError(res, 404, "Student not found");
      res.json({ message: "Student account deleted" });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Attempt monitoring & review
  app.get("/api/admin/attempts", ...requireAdmin, async (req, res) => {
    try {
      const attempts = await db.attempts.listAll();
      const list = attempts.map((att) => ({
        sessionId: att.sessionId,
        userId: att.user?.username || att.userId,
        name: att.name,
        status: att.status.toLowerCase(),
        startedAt: att.startedAt,
        deadline: att.deadline,
        submittedAt: att.submittedAt,
        lastSavedAt: att.lastSavedAt,
        eventCount: (att.activityEvents || []).length,
        events: att.activityEvents || [],
        extensions: att.extensions || [],
        autoScore: att.autoScore,
        manualScore: att.manualScore,
        totalScore: att.totalScore,
        isReviewed: att.isReviewed,
        serverTime: new Date().toISOString(),
      }));
      res.json(list);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  app.get("/api/admin/attempts/:id", ...requireAdmin, async (req, res) => {
    try {
      const attempt = await db.attempts.findBySessionId(req.params.id);
      if (!attempt) return sendError(res, 404, "Attempt not found");
      res.json({ attempt });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  app.post("/api/admin/attempts/:id/unlock", ...requireAdmin, async (req, res) => {
    try {
      const attempt = await db.attempts.findBySessionId(req.params.id);
      if (!attempt) return sendError(res, 404, "Attempt not found");
      await db.attempts.updateStatus(attempt.id, "IN_PROGRESS");
      await db.attempts.recordEvents(attempt.id, [
        {
          id: `unlock-${Date.now()}`,
          type: "instructor-unlocked",
          severity: "INFO",
          detail: `Unlocked by ${req.user.name}`,
        },
      ]);
      await db.audit.log({
        userId: req.user.id,
        action: "ATTEMPT_UNLOCK",
        targetType: "ATTEMPT",
        targetId: attempt.id,
      });
      res.json({ status: "in-progress" });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  app.post("/api/admin/attempts/:id/extend", ...requireAdmin, async (req, res) => {
    try {
      const { minutes } = req.body || {};
      const numMinutes = Number(minutes);
      if (!Number.isInteger(numMinutes) || numMinutes < 1 || numMinutes > 120) {
        return sendError(res, 400, "Minutes must be between 1 and 120");
      }
      const attempt = await db.attempts.findBySessionId(req.params.id);
      if (!attempt) return sendError(res, 404, "Attempt not found");

      const updated = await db.attempts.extendDeadline(attempt.id, numMinutes, req.user.name);
      await db.attempts.recordEvents(attempt.id, [
        {
          id: `extend-${Date.now()}`,
          type: "time-extended",
          severity: "INFO",
          detail: `+${numMinutes} min granted by ${req.user.name}`,
        },
      ]);

      await db.audit.log({
        userId: req.user.id,
        action: "ATTEMPT_EXTEND",
        targetType: "ATTEMPT",
        targetId: attempt.id,
        details: { minutes: numMinutes },
      });

      res.json({ deadline: updated.deadline, status: updated.status });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: Manual grading review & score adjustment
  app.put("/api/admin/attempts/:id/grade", ...requireAdmin, async (req, res) => {
    try {
      const { manualScore, reviewNotes } = req.body || {};
      const attempt = await db.attempts.findBySessionId(req.params.id);
      if (!attempt) return sendError(res, 404, "Attempt not found");

      const finalManual = Number(manualScore) || 0;
      const totalScore = (attempt.autoScore || 0) + finalManual;

      const updated = await db.attempts.updateGrade(attempt.id, {
        autoScore: attempt.autoScore,
        manualScore: finalManual,
        totalScore,
        isReviewed: true,
        reviewNotes: reviewNotes || "",
      });

      await db.audit.log({
        userId: req.user.id,
        action: "ATTEMPT_MANUAL_GRADE",
        targetType: "ATTEMPT",
        targetId: attempt.id,
        details: { manualScore: finalManual, totalScore },
      });

      res.json({ attempt: updated });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: CSV Export of Results
  app.get("/api/admin/exams/:id/export", ...requireAdmin, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam) return sendError(res, 404, "Exam not found");
      const attempts = await db.attempts.listByExam(req.params.id);

      const headers = ["Session ID", "Student ID", "Student Name", "Status", "Started At", "Submitted At", "Auto Score", "Manual Score", "Total Score", "Reviewed"];
      const rows = attempts.map((a) => [
        `"${a.sessionId}"`,
        `"${a.user?.username || a.userId}"`,
        `"${a.name.replace(/"/g, '""')}"`,
        `"${a.status}"`,
        `"${a.startedAt ? new Date(a.startedAt).toISOString() : ""}"`,
        `"${a.submittedAt ? new Date(a.submittedAt).toISOString() : ""}"`,
        a.autoScore || 0,
        a.manualScore || 0,
        a.totalScore || 0,
        a.isReviewed ? "Yes" : "No",
      ]);

      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="exam-results-${req.params.id}.csv"`);
      res.send(csv);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Admin: View Authenticated Proctoring Evidence
  app.get("/api/admin/evidence/:evidenceId", ...requireAdmin, async (req, res) => {
    try {
      let record = null;
      if (db.isPostgres) {
        // Prisma lookup
        const { PrismaClient } = require("@prisma/client");
        const pc = new PrismaClient();
        record = await pc.evidence.findUnique({ where: { id: req.params.evidenceId } });
      } else {
        const { memoryStore } = require("./lib/db");
        record = memoryStore.evidence.find((e) => e.id === req.params.evidenceId);
      }
      if (!record) return sendError(res, 404, "Evidence record not found");
      if (record.data) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, no-cache");
        return res.end(Buffer.from(record.data));
      }
      const stream = getEvidenceStream(record.storagePath);
      if (!stream) return sendError(res, 404, "Evidence file missing on server");

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, no-cache");
      stream.pipe(res);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // ---------------- Student Examination Experience ----------------

  // Student: List published exams
  app.get("/api/student/exams", ...requireStudent, async (req, res) => {
    try {
      const exams = await db.exams.listPublished();
      res.json({
        exams: exams.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          durationMinutes: e.durationMinutes,
          questionCount: e._count?.questions || 0,
        })),
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Student: Start exam attempt
  app.post("/api/student/exams/:id/start", ...requireStudent, async (req, res) => {
    try {
      const exam = await db.exams.findById(req.params.id);
      if (!exam || exam.status !== "PUBLISHED") {
        return sendError(res, 404, "Exam is not published or does not exist");
      }

      // Check if student already has an active attempt
      const existing = await db.attempts.findActiveByUserAndExam(req.user.id, exam.id);
      if (existing) {
        const questions = await db.questions.listByExam(exam.id);
        return res.json({
          message: "Resuming existing active attempt",
          sessionId: existing.sessionId,
          attempt: {
            sessionId: existing.sessionId,
            status: existing.status.toLowerCase(),
            deadline: existing.deadline,
            serverTime: new Date().toISOString(),
          },
          exam: { id: exam.id, title: exam.title, durationMinutes: exam.durationMinutes },
          questions: questions.map(questionForStudent),
        });
      }

      const sessionId = `session-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
      const token = crypto.randomBytes(24).toString("hex");
      const attempt = await db.attempts.create({
        sessionId,
        tokenHash: hashToken(token),
        examId: exam.id,
        userId: req.user.id,
        name: req.user.name,
        durationMinutes: exam.durationMinutes,
      });

      const questions = await db.questions.listByExam(exam.id);

      await db.audit.log({
        userId: req.user.id,
        action: "EXAM_ATTEMPT_START",
        targetType: "ATTEMPT",
        targetId: attempt.id,
      });

      res.status(201).json({
        token,
        sessionId,
        attempt: {
          sessionId,
          status: "in-progress",
          deadline: attempt.deadline,
          serverTime: new Date().toISOString(),
          answers: {},
          flags: [],
        },
        exam: { id: exam.id, title: exam.title, durationMinutes: exam.durationMinutes },
        questions: questions.map(questionForStudent),
      });
    } catch (err) {
      console.error("Start attempt error:", err);
      sendError(res, 500, err.message);
    }
  });

  // Student: Heartbeat / Active attempt polling
  app.get("/api/student/attempt", async (req, res) => {
    const authHeader = req.get("authorization") || "";
    const rawToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!rawToken) return sendError(res, 401, "Attempt token required");

    try {
      const attempt = await db.attempts.findByTokenHash(hashToken(rawToken));
      if (!attempt) return sendError(res, 401, "Invalid session token");

      // Check deadline expiry
      const now = Date.now();
      if (attempt.status === "IN_PROGRESS" && now > new Date(attempt.deadline).getTime() + 5000) {
        await db.attempts.updateStatus(attempt.id, "EXPIRED", new Date());
        attempt.status = "EXPIRED";
      }

      const questions = await db.questions.listByExam(attempt.examId);
      const answersMap = {};
      const flagsList = [];
      for (const sa of attempt.submittedAnswers || []) {
        try {
          answersMap[sa.questionId] = JSON.parse(sa.answerValue);
        } catch {
          answersMap[sa.questionId] = sa.answerValue;
        }
        if (sa.isFlagged) flagsList.push(sa.questionId);
      }

      res.json({
        exam: { id: attempt.examId, title: attempt.exam?.title },
        attempt: {
          sessionId: attempt.sessionId,
          status: attempt.status.toLowerCase(),
          deadline: attempt.deadline,
          serverTime: new Date().toISOString(),
          answers: answersMap,
          flags: flagsList,
        },
        questions: questions.map(questionForStudent),
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Student: Autosave answers
  app.put("/api/student/attempt/answers", async (req, res) => {
    const rawToken = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!rawToken) return sendError(res, 401, "Attempt token required");

    try {
      const attempt = await db.attempts.findByTokenHash(hashToken(rawToken));
      if (!attempt) return sendError(res, 401, "Invalid session token");

      // Reject save if locked or closed
      if (attempt.status !== "IN_PROGRESS") {
        return sendError(res, 409, `Attempt is ${attempt.status.toLowerCase()}`, {
          attempt: { status: attempt.status.toLowerCase() },
        });
      }

      // Check deadline
      if (Date.now() > new Date(attempt.deadline).getTime() + 5000) {
        await db.attempts.updateStatus(attempt.id, "EXPIRED", new Date());
        return sendError(res, 409, "Attempt is expired", { attempt: { status: "expired" } });
      }

      const { answers = {}, flags = [] } = req.body || {};
      await db.attempts.saveAnswers(attempt.id, answers, flags);

      res.json({
        attempt: {
          sessionId: attempt.sessionId,
          status: "in-progress",
          lastSavedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Student: Report integrity events
  app.post("/api/student/attempt/events", async (req, res) => {
    const rawToken = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!rawToken) return sendError(res, 401, "Attempt token required");

    try {
      const attempt = await db.attempts.findByTokenHash(hashToken(rawToken));
      if (!attempt) return sendError(res, 401, "Invalid session token");

      if (attempt.status === "SUBMITTED" || attempt.status === "EXPIRED") {
        return sendError(res, 409, `Attempt is ${attempt.status.toLowerCase()}`);
      }

      const { events } = req.body || {};
      if (Array.isArray(events) && events.length > 0) {
        await db.attempts.recordEvents(attempt.id, events);
      }

      const refreshed = await db.attempts.findById ? await db.attempts.findBySessionId(attempt.sessionId) : attempt;
      res.json({
        attempt: {
          sessionId: attempt.sessionId,
          status: refreshed.status.toLowerCase(),
        },
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // Student: Upload proctoring evidence (screen / camera snap)
  app.post("/api/student/attempt/evidence", async (req, res) => {
    const rawToken = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!rawToken) return sendError(res, 401, "Attempt token required");

    try {
      const attempt = await db.attempts.findByTokenHash(hashToken(rawToken));
      if (!attempt) return sendError(res, 401, "Invalid session token");

      const { kind = "camera", base64 } = req.body || {};
      if (!base64 || typeof base64 !== "string") {
        return sendError(res, 400, "Base64 image data is required");
      }

      const cleanBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");
      if (buffer.length > 2 * 1024 * 1024) {
        return sendError(res, 413, "Evidence file too large");
      }

      const saved = await saveEvidenceFile({
        sessionId: attempt.sessionId,
        kind,
        buffer,
      });

      await db.attempts.saveEvidence(attempt.id, {
        kind,
        storagePath: saved.storagePath,
        filename: saved.filename,
        byteSize: saved.byteSize,
        data: buffer,
      });

      res.status(201).json({ message: "Evidence received and stored safely" });
    } catch (err) {
      console.error("Evidence upload error:", err);
      sendError(res, 500, err.message);
    }
  });

  // Student: Submit exam attempt
  app.post("/api/student/attempt/submit", async (req, res) => {
    const rawToken = (req.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!rawToken) return sendError(res, 401, "Attempt token required");

    try {
      const attempt = await db.attempts.findByTokenHash(hashToken(rawToken));
      if (!attempt) return sendError(res, 401, "Invalid session token");

      if (attempt.status === "SUBMITTED") {
        // Idempotent submit
        return res.json({
          attempt: { sessionId: attempt.sessionId, status: "submitted", submittedAt: attempt.submittedAt },
          result: { score: attempt.totalScore, isReviewed: attempt.isReviewed },
        });
      }

      const { answers = {}, flags = [] } = req.body || {};
      if (attempt.status === "IN_PROGRESS") {
        await db.attempts.saveAnswers(attempt.id, answers, flags);
      }

      const questions = await db.questions.listByExam(attempt.examId, { includeAnswers: true });
      const gradingResult = gradeAttempt(questions, answers);

      const submittedAt = new Date();
      await db.attempts.updateStatus(attempt.id, "SUBMITTED", submittedAt);
      await db.attempts.updateGrade(attempt.id, {
        autoScore: gradingResult.autoScore,
        manualScore: 0,
        totalScore: gradingResult.autoScore,
        isReviewed: !gradingResult.hasManualPending,
      });

      await db.audit.log({
        userId: attempt.userId,
        action: "EXAM_SUBMIT",
        targetType: "ATTEMPT",
        targetId: attempt.id,
        details: { score: gradingResult.autoScore, max: gradingResult.maxPossible },
      });

      res.json({
        attempt: {
          sessionId: attempt.sessionId,
          status: "submitted",
          submittedAt: submittedAt.toISOString(),
        },
        result: {
          score: gradingResult.autoScore,
          maxScore: gradingResult.maxPossible,
          hasManualPending: gradingResult.hasManualPending,
        },
      });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  // ---------------- Backward Compatibility Endpoints ----------------
  // (Preserves existing legacy tests and workflows)

  function withAttempt(handler) {
    return (req, res) => {
      const token = (req.get("authorization") || "").replace(/^Bearer /, "");
      if (!token) return sendError(res, 401, "Missing token");
      const sessions = legacyStore.readSessions();
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

  app.get("/exam/info", (req, res) => {
    res.json({
      title: examTitle,
      durationMinutes,
      questionCount: legacyStore.readQuestions().length,
      lockOnFullscreenExit: true,
      snapshotIntervalSeconds: 30,
    });
  });

  app.post("/exam/start", (req, res) => {
    const { userId, name } = req.body || {};
    if (typeof userId !== "string" || typeof name !== "string" || !userId.trim() || !name.trim()) {
      return sendError(res, 400, "userId and name are required");
    }
    const sessions = legacyStore.readSessions();
    const { token, ...attempt } = rules.createAttempt({
      userId: userId.trim().slice(0, 64),
      name: name.trim().slice(0, 64),
      durationMs: durationMinutes * 60000,
    });
    attempt.tokenHash = hashToken(token);
    sessions.push(attempt);
    legacyStore.saveSessions(sessions);
    res.status(201).json({
      token,
      exam: { title: examTitle },
      attempt: rules.publicAttempt(attempt),
      questions: legacyStore.readQuestions().map(questionForStudent),
    });
  });

  app.get("/exam/attempt", withAttempt((req, res, attempt, sessions) => {
    legacyStore.saveSessions(sessions);
    res.json({
      exam: { title: examTitle },
      attempt: rules.publicAttempt(attempt),
      questions: legacyStore.readQuestions().map(questionForStudent),
    });
  }));

  app.put("/exam/answers", withAttempt((req, res, attempt, sessions) => {
    const error = rules.saveAnswers(attempt, req.body || {}, legacyStore.readQuestions());
    legacyStore.saveSessions(sessions);
    if (error) return sendError(res, 409, error, { attempt: rules.publicAttempt(attempt) });
    res.json({ attempt: rules.publicAttempt(attempt) });
  }));

  app.post("/exam/events", withAttempt((req, res, attempt, sessions) => {
    if (rules.isClosed(attempt)) {
      return sendError(res, 409, `attempt is ${attempt.status}`, { attempt: rules.publicAttempt(attempt) });
    }
    const error = rules.recordEvents(attempt, req.body?.events);
    if (error) {
      const status = error.startsWith("attempt is") ? 409 : 400;
      return sendError(res, status, error, { attempt: rules.publicAttempt(attempt) });
    }
    legacyStore.saveSessions(sessions);
    res.json({ attempt: rules.publicAttempt(attempt) });
  }));

  app.post("/exam/submit", withAttempt((req, res, attempt, sessions) => {
    const questions = legacyStore.readQuestions();
    if (req.body?.answers && attempt.status === rules.STATUS.IN_PROGRESS) {
      rules.saveAnswers(attempt, req.body, questions);
    }
    rules.submit(attempt);
    legacyStore.saveSessions(sessions);
    res.json({ attempt: rules.publicAttempt(attempt), result: rules.score(attempt, questions) });
  }));

  // Practical routes
  function withTask(handler) {
    return withAttempt((req, res, attempt, sessions) => {
      const task = readTasks().find((item) => item.id === req.params.taskId);
      if (!task) return sendError(res, 404, "Task not found");
      if (attempt.status !== rules.STATUS.IN_PROGRESS) {
        return sendError(res, 409, `attempt is ${attempt.status}`, { attempt: rules.publicAttempt(attempt) });
      }
      return handler(req, res, { attempt, sessions, task, state: practical.taskState(attempt, task.id) });
    });
  }

  function publicTask(task, state) {
    return {
      id: task.id,
      title: task.title,
      instructions: task.instructions,
      allowedExtensions: task.allowedExtensions,
      maxFileBytes: task.maxFileBytes,
      maxFiles: task.maxFiles,
      tests: task.tests.map(({ id, name, description }) => ({ id, name, description })),
      files: state.files,
      checkpoints: state.checkpoints,
    };
  }

  app.get("/practical", withAttempt((req, res, attempt) => {
    res.json({
      attempt: rules.publicAttempt(attempt),
      tasks: readTasks().map((task) => publicTask(task, attempt.practical?.[task.id] || practical.emptyState())),
    });
  }));

  app.post("/practical/:taskId/files", withTask((req, res, { attempt, sessions, task, state }) => {
    const result = practical.validateUpload(task, state, req.body || {});
    if (result.error) return sendError(res, 400, result.error);
    const target = artifactPath(attempt, result.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result.bytes);
    const file = practical.addFile(state, result.file);
    legacyStore.saveSessions(sessions);
    res.status(201).json({ file, task: publicTask(task, state) });
  }));

  app.delete("/practical/:taskId/files/:fileId", withTask((req, res, { sessions, task, state }) => {
    if (!practical.removeFile(state, req.params.fileId)) return sendError(res, 404, "File not found");
    legacyStore.saveSessions(sessions);
    res.json({ task: publicTask(task, state) });
  }));

  app.post("/practical/:taskId/checkpoints", withTask((req, res, { sessions, task, state }) => {
    const result = practical.addCheckpoint(state, req.body?.label);
    if (result.error) return sendError(res, 400, result.error);
    legacyStore.saveSessions(sessions);
    res.status(201).json({ checkpoint: result.checkpoint, task: publicTask(task, state) });
  }));

  // Legacy Instructor routes
  app.use("/instructor", requireInstructor);

  app.get("/instructor/attempts", (req, res) => {
    const questions = legacyStore.readQuestions();
    const sessions = legacyStore.readSessions().map((attempt) => rules.refreshStatus(attempt));
    res.json(
      sessions.map((attempt) => ({
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
        extensions: attempt.extensions || [],
        flags: attempt.flags || [],
        serverTime: new Date().toISOString(),
        ...rules.score(attempt, questions),
      }))
    );
  });

  function legacyInstructorAction(action) {
    return (req, res) => {
      const sessions = legacyStore.readSessions();
      const attempt = sessions.find((item) => item.sessionId === req.params.sessionId);
      if (!attempt) return sendError(res, 404, "Attempt not found");
      const error = action(attempt, req.body || {});
      if (error) return sendError(res, 409, error);
      legacyStore.saveSessions(sessions);
      res.json({ status: attempt.status, deadline: attempt.deadline });
    };
  }

  app.get("/instructor/attempts/:sessionId/practical", (req, res) => {
    const attempt = legacyStore.readSessions().find((item) => item.sessionId === req.params.sessionId);
    if (!attempt) return sendError(res, 404, "Attempt not found");
    res.json(
      readTasks().map((task) => {
        const state = attempt.practical?.[task.id] || practical.emptyState();
        return { ...publicTask(task, state), testResults: state.testResults };
      })
    );
  });

  app.get("/instructor/attempts/:sessionId/files/:fileId", (req, res) => {
    const attempt = legacyStore.readSessions().find((item) => item.sessionId === req.params.sessionId);
    if (!attempt) return sendError(res, 404, "Attempt not found");
    const files = Object.values(attempt.practical || {}).flatMap((state) => state.files);
    const file = files.find((item) => item.id === req.params.fileId);
    if (!file || !fs.existsSync(artifactPath(attempt, file))) return sendError(res, 404, "File not found");
    res.download(artifactPath(attempt, file), file.name);
  });

  app.put("/instructor/attempts/:sessionId/practical/:taskId/tests/:testId", (req, res) => {
    const sessions = legacyStore.readSessions();
    const attempt = sessions.find((item) => item.sessionId === req.params.sessionId);
    const task = readTasks().find((item) => item.id === req.params.taskId);
    if (!attempt || !task) return sendError(res, 404, "Attempt or task not found");
    const state = practical.taskState(attempt, task.id);
    const error = practical.recordTestResult(task, state, req.params.testId, req.body || {});
    if (error) return sendError(res, 400, error);
    legacyStore.saveSessions(sessions);
    res.json({ testResults: state.testResults });
  });

  app.post(
    "/instructor/attempts/:sessionId/extend",
    legacyInstructorAction((attempt, body) => rules.extend(attempt, Number(body.minutes)))
  );

  app.post(
    "/instructor/attempts/:sessionId/unlock",
    legacyInstructorAction((attempt) => rules.unlock(attempt))
  );

  // ---------------- Error handling ----------------
  app.use((req, res) => sendError(res, 404, "Endpoint not found"));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed") return sendError(res, 400, "Request body must be valid JSON");
    if (error.type === "entity.too.large") return sendError(res, 413, "Request body is too large");
    console.error("Express uncaught error:", error);
    return sendError(res, 500, "Internal server error");
  });

  return app;
}

module.exports = { createApp, hashToken };
