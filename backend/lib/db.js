// Database repository layer for Athena.
// Supports Prisma PostgreSQL when DATABASE_URL is configured,
// and provides a complete in-memory fallback for offline test environments.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { hashPassword } = require("./auth");

let prismaClient = null;
const isProduction = process.env.NODE_ENV === "production";

const isPostgresConfigured = Boolean(
  process.env.DATABASE_URL &&
  (process.env.DATABASE_URL.startsWith("postgres://") ||
    process.env.DATABASE_URL.startsWith("postgresql://"))
);

if (isProduction && !isPostgresConfigured) {
  throw new Error(
    "DATABASE_URL must contain a PostgreSQL connection string in production."
  );
}

if (isPostgresConfigured) {
  try {
    const { PrismaClient } = require("@prisma/client");

    prismaClient = new PrismaClient({
      log: isProduction ? ["error"] : ["warn", "error"],
    });
  } catch (err) {
    if (isProduction) {
      throw new Error(
        `Prisma initialization failed in production: ${err.message}`
      );
    }

    console.warn(
      "Prisma initialization failed; using development fallback:",
      err.message
    );

    prismaClient = null;
  }
}

// ---------------- In-Memory / File Fallback Storage ----------------
const memoryStore = {
  users: [],
  exams: [],
  questions: [],
  attempts: [],
  submittedAnswers: [],
  activityEvents: [],
  evidence: [],
  extensions: [],
  auditLogs: [],
};

const evidenceMetadataSelect = {
  id: true,
  kind: true,
  filename: true,
  byteSize: true,
  capturedAt: true,
};

// Seed initial default questions if available
function loadDefaultQuestions() {
  const jsonPath = process.env.ATHENA_QUESTIONS_PATH || path.join(__dirname, "../data/questions.json");
  if (fs.existsSync(jsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

let seeded = false;
async function ensureSeed(dbInstance) {
  if (seeded) return;
  seeded = true;
  const adminCount = await dbInstance.users.countAdmins();
  if (adminCount === 0) {
    const defaultPassword = process.env.ATHENA_ADMIN_PASSWORD || "AdminPass123!";
    const defaultUsername = process.env.ATHENA_ADMIN_USERNAME || "admin";
    const hashed = await hashPassword(defaultPassword);
    await dbInstance.users.create({
      username: defaultUsername,
      name: "Default Administrator",
      passwordHash: hashed,
      role: "ADMIN",
    });
    console.log(`[Athena DB] Initial admin account initialized: ${defaultUsername}`);
  }

  // Ensure at least one default exam exists
  const exams = await dbInstance.exams.listAll();
  if (exams.length === 0) {
    const exam = await dbInstance.exams.create({
      title: process.env.ATHENA_EXAM_TITLE || "Electron Fundamentals",
      description: "Core assessment covering Electron processes, IPC security, and desktop lifecycle.",
      instructions: "Answer all questions to the best of your ability. Leaving fullscreen will lock the exam.",
      durationMinutes: Number(process.env.ATHENA_EXAM_MINUTES) || 15,
      totalMarks: 100,
      passingCriteria: 60,
      status: "PUBLISHED",
    });

    const defaultQs = loadDefaultQuestions();
    if (defaultQs.length > 0) {
      for (let i = 0; i < defaultQs.length; i++) {
        const q = defaultQs[i];
        await dbInstance.questions.create(exam.id, {
          type: "MCQ",
          prompt: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          marks: 20,
          orderIndex: i + 1,
        });
      }
    } else {
      // Add a set of default questions across multiple types
      await dbInstance.questions.create(exam.id, {
        type: "MCQ",
        prompt: "Which Electron process is responsible for creating BrowserWindow instances?",
        options: ["Renderer Process", "Main Process", "Utility Process", "Preload Process"],
        correctAnswer: 1,
        marks: 25,
        orderIndex: 1,
      });
      await dbInstance.questions.create(exam.id, {
        type: "MSQ",
        prompt: "Which of the following are secure Electron webPreferences settings?",
        options: ["contextIsolation: true", "nodeIntegration: true", "sandbox: true", "webSecurity: false"],
        correctAnswer: [0, 2],
        marks: 25,
        orderIndex: 2,
      });
      await dbInstance.questions.create(exam.id, {
        type: "TRUE_FALSE",
        prompt: "In Electron, preload scripts run with access to both Node.js and DOM by default when contextIsolation is enabled.",
        options: ["True", "False"],
        correctAnswer: 1,
        marks: 25,
        orderIndex: 3,
      });
      await dbInstance.questions.create(exam.id, {
        type: "SHORT_ANSWER",
        prompt: "Explain how IPC communication is secured between renderer and main processes.",
        options: [],
        correctAnswer: "Use contextBridge in preload script with explicit channels and validate all inputs in ipcMain handlers.",
        marks: 25,
        orderIndex: 4,
      });
    }
  }
}

// ---------------- Database Service API ----------------
const db = {
  isPostgres: Boolean(prismaClient),

  async checkHealth() {
    if (prismaClient) {
      try {
        await prismaClient.$queryRaw`SELECT 1`;
        return { status: "connected", provider: "postgresql" };
      } catch (err) {
        return { status: "error", provider: "postgresql", error: err.message };
      }
    }
    return { status: "connected", provider: "memory-store" };
  },

  users: {
    async findByUsername(username) {
      if (!username) return null;
      const lower = username.toLowerCase().trim();
      if (prismaClient) {
        return prismaClient.user.findFirst({
          where: { username: { equals: lower, mode: "insensitive" } },
        });
      }
      return memoryStore.users.find((u) => u.username.toLowerCase() === lower) || null;
    },

    async findById(id) {
      if (prismaClient) {
        return prismaClient.user.findUnique({ where: { id } });
      }
      return memoryStore.users.find((u) => u.id === id) || null;
    },

    async create({ username, name, passwordHash, role = "STUDENT" }) {
      const lower = username.toLowerCase().trim();
      if (prismaClient) {
        return prismaClient.user.create({
          data: { username: lower, name: name.trim(), passwordHash, role },
        });
      }
      const existing = memoryStore.users.find((u) => u.username.toLowerCase() === lower);
      if (existing) {
        const error = new Error("User already exists");
        error.code = "P2002";
        throw error;
      }
      const user = {
        id: crypto.randomUUID(),
        username: lower,
        name: name.trim(),
        passwordHash,
        role,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore.users.push(user);
      return user;
    },

    async listStudents() {
      if (prismaClient) {
        return prismaClient.user.findMany({
          where: { role: "STUDENT" },
          select: { id: true, username: true, name: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
      }
      return memoryStore.users
        .filter((u) => u.role === "STUDENT")
        .map(({ id, username, name, createdAt }) => ({ id, username, name, createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async countAdmins() {
      if (prismaClient) {
        return prismaClient.user.count({ where: { role: "ADMIN" } });
      }
      return memoryStore.users.filter((u) => u.role === "ADMIN").length;
    },

    async countAll() {
      if (prismaClient) {
        return prismaClient.user.count();
      }
      return memoryStore.users.length;
    },

    async deleteUser(id) {
      if (prismaClient) {
        return prismaClient.user.delete({ where: { id } });
      }
      const idx = memoryStore.users.findIndex((u) => u.id === id);
      if (idx !== -1) {
        return memoryStore.users.splice(idx, 1)[0];
      }
      return null;
    },
  },

  exams: {
    async listAll() {
      if (prismaClient) {
        return prismaClient.exam.findMany({
          include: {
            questions: { select: { id: true, marks: true } },
            _count: { select: { attempts: true, questions: true } },
          },
          orderBy: { createdAt: "desc" },
        });
      }
      return memoryStore.exams
        .map((exam) => {
          const qs = memoryStore.questions.filter((q) => q.examId === exam.id);
          const atts = memoryStore.attempts.filter((a) => a.examId === exam.id);
          return {
            ...exam,
            questions: qs.map((q) => ({ id: q.id, marks: q.marks })),
            _count: { attempts: atts.length, questions: qs.length },
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async listPublished() {
      if (prismaClient) {
        return prismaClient.exam.findMany({
          where: { status: "PUBLISHED" },
          include: {
            _count: { select: { questions: true } },
          },
          orderBy: { createdAt: "desc" },
        });
      }
      return memoryStore.exams
        .filter((e) => e.status === "PUBLISHED")
        .map((exam) => {
          const qs = memoryStore.questions.filter((q) => q.examId === exam.id);
          return {
            ...exam,
            _count: { questions: qs.length },
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async findById(id) {
      if (prismaClient) {
        return prismaClient.exam.findUnique({
          where: { id },
          include: {
            questions: { orderBy: { orderIndex: "asc" } },
            attempts: {
              include: { user: { select: { id: true, username: true, name: true } } },
            },
          },
        });
      }
      const exam = memoryStore.exams.find((e) => e.id === id);
      if (!exam) return null;
      const questions = memoryStore.questions
        .filter((q) => q.examId === id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const attempts = memoryStore.attempts
        .filter((a) => a.examId === id)
        .map((att) => {
          const user = memoryStore.users.find((u) => u.id === att.userId);
          return {
            ...att,
            user: user ? { id: user.id, username: user.username, name: user.name } : null,
          };
        });
      return { ...exam, questions, attempts };
    },

    async create(data) {
      const examData = {
        title: data.title,
        description: data.description || "",
        instructions: data.instructions || "",
        durationMinutes: Number(data.durationMinutes) || 10,
        totalMarks: Number(data.totalMarks) || 100,
        passingCriteria: Number(data.passingCriteria) || 50,
        status: data.status || "DRAFT",
        scheduledStart: data.scheduledStart ? new Date(data.scheduledStart) : null,
        scheduledEnd: data.scheduledEnd ? new Date(data.scheduledEnd) : null,
      };
      if (prismaClient) {
        return prismaClient.exam.create({ data: examData });
      }
      const exam = {
        id: crypto.randomUUID(),
        ...examData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore.exams.push(exam);
      return exam;
    },

    async update(id, data) {
      if (prismaClient) {
        return prismaClient.exam.update({ where: { id }, data });
      }
      const exam = memoryStore.exams.find((e) => e.id === id);
      if (!exam) throw new Error("Exam not found");
      Object.assign(exam, data, { updatedAt: new Date() });
      return exam;
    },

    async setStatus(id, status) {
      if (prismaClient) {
        return prismaClient.exam.update({ where: { id }, data: { status } });
      }
      const exam = memoryStore.exams.find((e) => e.id === id);
      if (!exam) throw new Error("Exam not found");
      exam.status = status;
      exam.updatedAt = new Date();
      return exam;
    },

    async delete(id) {
      if (prismaClient) {
        return prismaClient.exam.delete({ where: { id } });
      }
      const idx = memoryStore.exams.findIndex((e) => e.id === id);
      if (idx !== -1) {
        memoryStore.questions = memoryStore.questions.filter((q) => q.examId !== id);
        return memoryStore.exams.splice(idx, 1)[0];
      }
      return null;
    },
  },

  questions: {
    async listByExam(examId, { includeAnswers = false } = {}) {
      let qs = [];
      if (prismaClient) {
        qs = await prismaClient.question.findMany({
          where: { examId },
          orderBy: { orderIndex: "asc" },
        });
      } else {
        qs = memoryStore.questions
          .filter((q) => q.examId === examId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
      }

      return qs.map((q) => {
        let options = [];
        try {
          options = typeof q.options === "string" ? JSON.parse(q.options) : q.options || [];
        } catch {
          options = [];
        }
        let correctAnswer = undefined;
        if (includeAnswers) {
          try {
            correctAnswer = typeof q.correctAnswer === "string" ? JSON.parse(q.correctAnswer) : q.correctAnswer;
          } catch {
            correctAnswer = q.correctAnswer;
          }
        }
        return {
          id: q.id,
          examId: q.examId,
          type: q.type,
          prompt: q.prompt,
          options,
          marks: q.marks,
          orderIndex: q.orderIndex,
          explanation: includeAnswers ? q.explanation : undefined,
          ...(includeAnswers ? { correctAnswer } : {}),
        };
      });
    },

    async findById(id) {
      if (prismaClient) {
        return prismaClient.question.findUnique({ where: { id } });
      }
      return memoryStore.questions.find((q) => q.id === id) || null;
    },

    async create(examId, data) {
      const optionsStr = typeof data.options === "string" ? data.options : JSON.stringify(data.options || []);
      const answerStr = typeof data.correctAnswer === "string" ? data.correctAnswer : JSON.stringify(data.correctAnswer);
      const qData = {
        examId,
        type: data.type || "MCQ",
        prompt: data.prompt,
        options: optionsStr,
        correctAnswer: answerStr,
        marks: Number(data.marks) || 1,
        orderIndex: Number(data.orderIndex) || 0,
        explanation: data.explanation || "",
      };
      if (prismaClient) {
        return prismaClient.question.create({ data: qData });
      }
      const q = {
        id: crypto.randomUUID(),
        ...qData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      memoryStore.questions.push(q);
      return q;
    },

    async update(id, data) {
      const updateData = { ...data };
      if (data.options !== undefined && typeof data.options !== "string") {
        updateData.options = JSON.stringify(data.options);
      }
      if (data.correctAnswer !== undefined && typeof data.correctAnswer !== "string") {
        updateData.correctAnswer = JSON.stringify(data.correctAnswer);
      }
      if (prismaClient) {
        return prismaClient.question.update({ where: { id }, data: updateData });
      }
      const q = memoryStore.questions.find((item) => item.id === id);
      if (!q) throw new Error("Question not found");
      Object.assign(q, updateData, { updatedAt: new Date() });
      return q;
    },

    async delete(id) {
      if (prismaClient) {
        return prismaClient.question.delete({ where: { id } });
      }
      const idx = memoryStore.questions.findIndex((q) => q.id === id);
      if (idx !== -1) return memoryStore.questions.splice(idx, 1)[0];
      return null;
    },
  },

  attempts: {
    async findBySessionId(sessionId) {
      if (prismaClient) {
        return prismaClient.attempt.findUnique({
          where: { sessionId },
          include: {
            user: { select: { id: true, username: true, name: true } },
            exam: { include: { questions: { select: { id: true, prompt: true, marks: true } } } },
            submittedAnswers: true,
            activityEvents: { orderBy: { seq: "asc" } },
            evidence: { select: evidenceMetadataSelect, orderBy: { capturedAt: "desc" } },
            extensions: true,
          },
        });
      }
      const attempt = memoryStore.attempts.find((a) => a.sessionId === sessionId);
      if (!attempt) return null;
      const user = memoryStore.users.find((u) => u.id === attempt.userId);
      const exam = memoryStore.exams.find((e) => e.id === attempt.examId);
      if (exam) {
        exam.questions = memoryStore.questions
          .filter((question) => question.examId === attempt.examId)
          .map(({ id, prompt, marks }) => ({ id, prompt, marks }));
      }
      const submittedAnswers = memoryStore.submittedAnswers.filter((sa) => sa.attemptId === attempt.id);
      const activityEvents = memoryStore.activityEvents
        .filter((ae) => ae.attemptId === attempt.id)
        .sort((a, b) => a.seq - b.seq);
      const evidence = memoryStore.evidence
        .filter((ev) => ev.attemptId === attempt.id)
        .map(({ id, kind, filename, byteSize, capturedAt }) => ({ id, kind, filename, byteSize, capturedAt }))
        .sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
      const extensions = memoryStore.extensions.filter((ex) => ex.attemptId === attempt.id);
      return {
        ...attempt,
        user: user ? { id: user.id, username: user.username, name: user.name } : null,
        exam,
        submittedAnswers,
        activityEvents,
        evidence,
        extensions,
      };
    },

    async findByTokenHash(tokenHash) {
      if (prismaClient) {
        return prismaClient.attempt.findUnique({
          where: { tokenHash },
          include: {
            user: true,
            exam: true,
            submittedAnswers: true,
            activityEvents: true,
            extensions: true,
          },
        });
      }
      const attempt = memoryStore.attempts.find((a) => a.tokenHash === tokenHash);
      if (!attempt) return null;
      const user = memoryStore.users.find((u) => u.id === attempt.userId);
      const exam = memoryStore.exams.find((e) => e.id === attempt.examId);
      const submittedAnswers = memoryStore.submittedAnswers.filter((sa) => sa.attemptId === attempt.id);
      const activityEvents = memoryStore.activityEvents.filter((ae) => ae.attemptId === attempt.id);
      const extensions = memoryStore.extensions.filter((ex) => ex.attemptId === attempt.id);
      return { ...attempt, user, exam, submittedAnswers, activityEvents, extensions };
    },

    async findActiveByUserAndExam(userId, examId) {
      if (prismaClient) {
        return prismaClient.attempt.findFirst({
          where: {
            userId,
            examId,
            status: { in: ["IN_PROGRESS", "LOCKED"] },
          },
          include: { submittedAnswers: true, extensions: true },
        });
      }
      return (
        memoryStore.attempts.find(
          (a) => a.userId === userId && a.examId === examId && (a.status === "IN_PROGRESS" || a.status === "LOCKED")
        ) || null
      );
    },

    async updateTokenHash(id, tokenHash) {
      if (prismaClient) {
        return prismaClient.attempt.update({ where: { id }, data: { tokenHash } });
      }
      const attempt = memoryStore.attempts.find((item) => item.id === id);
      if (!attempt) throw new Error("Attempt not found");
      attempt.tokenHash = tokenHash;
      attempt.updatedAt = new Date();
      return attempt;
    },

    async listByExam(examId) {
      if (prismaClient) {
        return prismaClient.attempt.findMany({
          where: { examId },
          include: {
            user: { select: { id: true, username: true, name: true } },
            activityEvents: true,
            extensions: true,
            submittedAnswers: true,
          },
          orderBy: { startedAt: "desc" },
        });
      }
      return memoryStore.attempts
        .filter((a) => a.examId === examId)
        .map((att) => {
          const user = memoryStore.users.find((u) => u.id === att.userId);
          const activityEvents = memoryStore.activityEvents.filter((ae) => ae.attemptId === att.id);
          const extensions = memoryStore.extensions.filter((ex) => ex.attemptId === att.id);
          const submittedAnswers = memoryStore.submittedAnswers.filter((sa) => sa.attemptId === att.id);
          return {
            ...att,
            user: user ? { id: user.id, username: user.username, name: user.name } : null,
            activityEvents,
            extensions,
            submittedAnswers,
          };
        })
        .sort((a, b) => b.startedAt - a.startedAt);
    },

    async listAll() {
      if (prismaClient) {
        return prismaClient.attempt.findMany({
          include: {
            user: { select: { id: true, username: true, name: true } },
            exam: { select: { id: true, title: true } },
            activityEvents: true,
            extensions: true,
            submittedAnswers: true,
          },
          orderBy: { startedAt: "desc" },
        });
      }
      return memoryStore.attempts
        .map((att) => {
          const user = memoryStore.users.find((u) => u.id === att.userId);
          const exam = memoryStore.exams.find((e) => e.id === att.examId);
          const activityEvents = memoryStore.activityEvents.filter((ae) => ae.attemptId === att.id);
          const extensions = memoryStore.extensions.filter((ex) => ex.attemptId === att.id);
          const submittedAnswers = memoryStore.submittedAnswers.filter((sa) => sa.attemptId === att.id);
          return {
            ...att,
            user: user ? { id: user.id, username: user.username, name: user.name } : null,
            exam: exam ? { id: exam.id, title: exam.title } : null,
            activityEvents,
            extensions,
            submittedAnswers,
          };
        })
        .sort((a, b) => b.startedAt - a.startedAt);
    },

    async create({ sessionId, tokenHash, examId, userId, name, durationMinutes }) {
      const now = new Date();
      const deadline = new Date(now.getTime() + durationMinutes * 60 * 1000);
      const data = {
        sessionId,
        tokenHash,
        examId,
        userId,
        name,
        status: "IN_PROGRESS",
        startedAt: now,
        deadline,
        autoScore: 0,
        manualScore: 0,
        totalScore: 0,
        isReviewed: false,
      };
      if (prismaClient) {
        return prismaClient.attempt.create({ data });
      }
      const att = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      memoryStore.attempts.push(att);
      return att;
    },

    async updateStatus(id, status, submittedAt = null) {
      const data = { status, updatedAt: new Date() };
      if (submittedAt) data.submittedAt = submittedAt;
      if (prismaClient) {
        return prismaClient.attempt.update({ where: { id }, data });
      }
      const att = memoryStore.attempts.find((a) => a.id === id);
      if (!att) throw new Error("Attempt not found");
      att.status = status;
      if (submittedAt) att.submittedAt = submittedAt;
      att.updatedAt = new Date();
      return att;
    },

    async extendDeadline(id, minutes, grantedBy = "Admin") {
      if (prismaClient) {
        const attempt = await prismaClient.attempt.findUnique({ where: { id } });
        if (!attempt) throw new Error("Attempt not found");
        const currentDeadline = new Date(attempt.deadline).getTime();
        const newDeadline = new Date(currentDeadline + minutes * 60 * 1000);
        await prismaClient.attemptExtension.create({
          data: { attemptId: id, minutes, grantedBy },
        });
        return prismaClient.attempt.update({
          where: { id },
          data: {
            deadline: newDeadline,
            status: attempt.status === "EXPIRED" ? "IN_PROGRESS" : attempt.status,
            submittedAt: attempt.status === "EXPIRED" ? null : attempt.submittedAt,
          },
        });
      }
      const att = memoryStore.attempts.find((a) => a.id === id);
      if (!att) throw new Error("Attempt not found");
      const currentDeadline = new Date(att.deadline).getTime();
      att.deadline = new Date(currentDeadline + minutes * 60 * 1000);
      if (att.status === "EXPIRED") {
        att.status = "IN_PROGRESS";
        att.submittedAt = null;
      }
      memoryStore.extensions.push({
        id: crypto.randomUUID(),
        attemptId: id,
        minutes,
        grantedBy,
        grantedAt: new Date(),
      });
      att.updatedAt = new Date();
      return att;
    },

    async saveAnswers(attemptId, answersMap, flagsList = []) {
      const now = new Date();
      if (prismaClient) {
        // Upsert submitted answers
        for (const [questionId, value] of Object.entries(answersMap)) {
          const isFlagged = flagsList.includes(questionId) || flagsList.includes(Number(questionId));
          const answerValue = typeof value === "string" ? value : JSON.stringify(value);
          await prismaClient.submittedAnswer.upsert({
            where: {
              attemptId_questionId: { attemptId, questionId: String(questionId) },
            },
            update: { answerValue, isFlagged, savedAt: now },
            create: {
              attemptId,
              questionId: String(questionId),
              answerValue,
              isFlagged,
              savedAt: now,
            },
          });
        }
        return prismaClient.attempt.update({
          where: { id: attemptId },
          data: { lastSavedAt: now },
        });
      }

      // Memory implementation
      for (const [questionId, value] of Object.entries(answersMap)) {
        const qIdStr = String(questionId);
        const isFlagged = flagsList.includes(questionId) || flagsList.includes(Number(questionId));
        const answerValue = typeof value === "string" ? value : JSON.stringify(value);
        const existing = memoryStore.submittedAnswers.find(
          (sa) => sa.attemptId === attemptId && sa.questionId === qIdStr
        );
        if (existing) {
          existing.answerValue = answerValue;
          existing.isFlagged = isFlagged;
          existing.savedAt = now;
        } else {
          memoryStore.submittedAnswers.push({
            id: crypto.randomUUID(),
            attemptId,
            questionId: qIdStr,
            answerValue,
            isFlagged,
            autoMarks: 0,
            manualMarks: 0,
            savedAt: now,
          });
        }
      }
      const att = memoryStore.attempts.find((a) => a.id === attemptId);
      if (att) att.lastSavedAt = now;
      return att;
    },

    async recordEvents(attemptId, events) {
      const now = new Date();
      let locked = false;
      if (prismaClient) {
        const count = await prismaClient.activityEvent.count({ where: { attemptId } });
        let seq = count + 1;
        for (const ev of events) {
          try {
            await prismaClient.activityEvent.create({
              data: {
                attemptId,
                eventId: ev.id,
                seq: seq++,
                type: ev.type,
                severity: ev.severity || "INFO",
                clientAt: ev.at ? new Date(ev.at) : null,
                receivedAt: now,
                detail: ev.detail ? String(ev.detail).slice(0, 500) : null,
              },
            });
            if (ev.type === "fullscreen-exit") locked = true;
          } catch {
            // Ignore duplicate eventId
          }
        }
        if (locked) {
          await prismaClient.attempt.update({
            where: { id: attemptId },
            data: { status: "LOCKED" },
          });
        }
        return;
      }

      const existingEvents = memoryStore.activityEvents.filter((e) => e.attemptId === attemptId);
      const seenIds = new Set(existingEvents.map((e) => e.eventId));
      let seq = existingEvents.length + 1;
      for (const ev of events) {
        if (seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        memoryStore.activityEvents.push({
          id: crypto.randomUUID(),
          attemptId,
          eventId: ev.id,
          seq: seq++,
          type: ev.type,
          severity: (ev.severity || "INFO").toUpperCase(),
          clientAt: ev.at ? new Date(ev.at) : null,
          receivedAt: now,
          detail: ev.detail ? String(ev.detail).slice(0, 500) : null,
        });
        if (ev.type === "fullscreen-exit") locked = true;
      }
      if (locked) {
        const att = memoryStore.attempts.find((a) => a.id === attemptId);
        if (att && att.status === "IN_PROGRESS") att.status = "LOCKED";
      }
    },

    async saveEvidence(attemptId, { kind, storagePath, filename, byteSize, data: evidenceData }) {
      const recordData = {
        attemptId,
        kind: kind.toUpperCase(),
        storagePath,
        filename,
        data: evidenceData || null,
        byteSize: byteSize || 0,
        capturedAt: new Date(),
      };
      if (prismaClient) {
        return prismaClient.evidence.create({ data: recordData });
      }
      const record = { id: crypto.randomUUID(), ...recordData };
      memoryStore.evidence.push(record);
      return record;
    },

    async findEvidenceById(id) {
      if (prismaClient) {
        return prismaClient.evidence.findUnique({
          where: { id },
          select: { id: true, storagePath: true, data: true },
        });
      }
      const record = memoryStore.evidence.find((item) => item.id === id);
      return record ? { id: record.id, storagePath: record.storagePath, data: record.data || null } : null;
    },

    async updateGrade(attemptId, { autoScore, manualScore, totalScore, isReviewed = true, reviewNotes = "" }) {
      const data = {
        autoScore,
        manualScore,
        totalScore,
        isReviewed,
        reviewNotes,
        updatedAt: new Date(),
      };
      if (prismaClient) {
        return prismaClient.attempt.update({ where: { id: attemptId }, data });
      }
      const att = memoryStore.attempts.find((a) => a.id === attemptId);
      if (!att) throw new Error("Attempt not found");
      Object.assign(att, data);
      return att;
    },
  },

  audit: {
    async log({ userId, action, targetType, targetId, details }) {
      const data = {
        userId: userId || null,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        details: typeof details === "object" ? JSON.stringify(details) : details ? String(details) : null,
        createdAt: new Date(),
      };
      if (prismaClient) {
        return prismaClient.auditLog.create({ data }).catch((err) => {
          console.error("Audit log failed:", err.message);
        });
      }
      const entry = { id: crypto.randomUUID(), ...data };
      memoryStore.auditLogs.push(entry);
      return entry;
    },

    async list({ limit = 50 } = {}) {
      if (prismaClient) {
        return prismaClient.auditLog.findMany({
          take: limit,
          orderBy: { createdAt: "desc" },
          include: { user: { select: { id: true, username: true, name: true } } },
        });
      }
      return memoryStore.auditLogs
        .map((entry) => {
          const user = entry.userId ? memoryStore.users.find((u) => u.id === entry.userId) : null;
          return { ...entry, user };
        })
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
  },
};

// Auto-seed default admin and default exam on startup
ensureSeed(db).catch((err) => console.error("Initial seeding error:", err));

module.exports = { db, memoryStore, ensureSeed };
