// Regression tests for the MCQ-only student exam flow and the admin review
// surface. These run against the in-memory repository fallback (the same code
// path the app uses when PostgreSQL is not configured), so they never touch a
// live database.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../app");
const { db, memoryStore } = require("../lib/db");
const { generateToken } = require("../lib/auth");

const ADMIN_PASSWORD = process.env.ATHENA_ADMIN_PASSWORD || "AdminPass123!";
const STUDENT_PASSWORD = "StudentPass123!";

let server;
let baseUrl;
let adminCache = null;
let seq = 0;

function unique(prefix) {
  seq += 1;
  return `${prefix}_${Date.now()}_${seq}`;
}

async function call(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { res, data };
}

// The default admin is seeded asynchronously at module load, so wait for it.
async function adminToken() {
  if (adminCache) return adminCache;
  for (let i = 0; i < 50; i += 1) {
    const { data } = await call("/api/auth/login", {
      method: "POST",
      body: { username: "admin", password: ADMIN_PASSWORD },
    });
    if (data && data.token) {
      adminCache = data.token;
      return adminCache;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Admin account was not seeded in time");
}

async function createStudent(admin, username = unique("student")) {
  const { res } = await call("/api/admin/students", {
    method: "POST",
    token: admin,
    body: { username, name: `Student ${username}`, password: STUDENT_PASSWORD },
  });
  assert.equal(res.status, 201);
  const login = await call("/api/auth/login", {
    method: "POST",
    body: { username, password: STUDENT_PASSWORD },
  });
  assert.ok(login.data.token);
  return login.data.token;
}

// Builds a published exam made only of four-option MCQs.
async function createPublishedMcqExam(admin, { marks = 10, count = 1, passing = 50 } = {}) {
  const { data: created } = await call("/api/admin/exams", {
    method: "POST",
    token: admin,
    body: {
      title: unique("MCQ Exam"),
      durationMinutes: 15,
      totalMarks: marks * count,
      passingCriteria: passing,
    },
  });
  const exam = created.exam;
  const questions = [];
  for (let i = 0; i < count; i += 1) {
    const { data } = await call(`/api/admin/exams/${exam.id}/questions`, {
      method: "POST",
      token: admin,
      body: {
        type: "MCQ",
        prompt: `Question ${i + 1}`,
        options: ["Option A", "Option B", "Option C", "Option D"],
        correctAnswer: 0,
        marks,
        orderIndex: i + 1,
      },
    });
    assert.equal(data.question.type, "MCQ");
    questions.push(data.question);
  }
  const publish = await call(`/api/admin/exams/${exam.id}/publish`, { method: "POST", token: admin });
  assert.equal(publish.res.status, 200);
  return { exam, questions };
}

async function startExam(token, examId, startId) {
  return call(`/api/student/exams/${examId}/start`, {
    method: "POST",
    token,
    headers: startId ? { "x-athena-start-id": startId } : {},
  });
}

test.before(async () => {
  const app = createApp({ instructorKey: "test-instructor-key" });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("catalogue lists MCQ metadata and a single attempt is started then resumed", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 2, marks: 10 });

  const { res: catRes, data: cat } = await call("/api/student/exams", { token: student });
  assert.equal(catRes.status, 200);
  const listed = cat.exams.find((e) => e.id === exam.id);
  assert.ok(listed, "published exam appears in the catalogue");
  assert.equal(listed.questionCount, 2);
  assert.equal(listed.durationMinutes, 15);
  assert.equal(listed.passingCriteria, 50);
  assert.equal(listed.attemptStatus, undefined, "no attempt yet");

  const startId = "start-request-0123456789abcdef";
  const first = await startExam(student, exam.id, startId);
  assert.equal(first.res.status, 201);
  assert.ok(first.data.token);
  assert.equal(first.data.attempt.status, "in-progress");
  assert.equal(first.data.questions.length, 2);
  assert.equal(first.data.questions[0].correctAnswer, undefined, "answers never leak before submit");
  assert.equal(first.data.exam.passingCriteria, 50);

  const again = await startExam(student, exam.id, startId);
  assert.equal(again.res.status, 200);
  assert.equal(again.data.message, "Resuming existing active attempt");
  assert.equal(again.data.sessionId, first.data.sessionId);

  const withoutId = await startExam(student, exam.id);
  assert.equal(withoutId.res.status, 200);
  assert.equal(withoutId.data.sessionId, first.data.sessionId);

  const attempts = await db.attempts.listByExam(exam.id);
  assert.equal(attempts.length, 1, "exactly one server-side attempt exists");
});

test("autosaved MCQ answers and flags are restored from the server", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 2, marks: 5 });

  const start = await startExam(student, exam.id);
  const attemptToken = start.data.token;
  const answers = { [questions[0].id]: 0, [questions[1].id]: 2 };

  const save = await call("/api/student/attempt/answers", {
    method: "PUT",
    token: attemptToken,
    body: { answers, flags: [questions[1].id] },
  });
  assert.equal(save.res.status, 200);

  const { res, data } = await call("/api/student/attempt", { token: attemptToken });
  assert.equal(res.status, 200);
  assert.equal(data.attempt.status, "in-progress");
  assert.deepEqual(data.attempt.answers, answers);
  assert.deepEqual(data.attempt.flags, [questions[1].id]);
});

test("submission is graded server-side, persists the score, and retries idempotently", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 3, marks: 10 });

  const start = await startExam(student, exam.id);
  const attemptToken = start.data.token;
  // Two correct, one wrong.
  const answers = { [questions[0].id]: 0, [questions[1].id]: 1, [questions[2].id]: 0 };

  const submit = await call("/api/student/attempt/submit", {
    method: "POST",
    token: attemptToken,
    body: { answers },
  });
  assert.equal(submit.res.status, 200);
  assert.equal(submit.data.attempt.status, "submitted");
  assert.equal(submit.data.result.score, 20);
  assert.equal(submit.data.result.maxScore, 30);
  assert.equal(submit.data.result.attempted, 3);
  assert.equal(submit.data.result.correct, 2);
  const submittedAt = submit.data.attempt.submittedAt;
  assert.ok(submittedAt);

  const retry = await call("/api/student/attempt/submit", {
    method: "POST",
    token: attemptToken,
    body: {},
  });
  assert.equal(retry.res.status, 200);
  assert.equal(retry.data.result.score, 20, "retry returns the saved result unchanged");
  assert.equal(retry.data.result.maxScore, 30);
  assert.equal(retry.data.attempt.submittedAt, submittedAt, "submission time is not rewritten");

  const { data: attempts } = await call("/api/admin/attempts", { token: admin });
  const row = attempts.find((a) => a.sessionId === start.data.sessionId);
  assert.ok(row);
  assert.equal(row.status, "submitted");
  assert.equal(row.totalScore, 20);
  assert.equal(row.maxScore, 30);
});

test("a submitted student cannot retake the exam and the result survives a refresh", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 2, marks: 10 });

  const start = await startExam(student, exam.id, "submit-once-0123456789abcdef");
  const attemptToken = start.data.token;
  await call("/api/student/attempt/submit", {
    method: "POST",
    token: attemptToken,
    body: { answers: { [questions[0].id]: 0, [questions[1].id]: 0 } },
  });

  // Retake with the original start id...
  const blocked = await startExam(student, exam.id, "submit-once-0123456789abcdef");
  assert.equal(blocked.res.status, 409);
  assert.equal(blocked.data.attemptStatus, "submitted");
  assert.match(blocked.data.message, /already completed/);
  assert.equal(blocked.data.score, 20);

  // ...and with a brand new start id (e.g. a fresh relaunch of the app).
  const blockedAgain = await startExam(student, exam.id, "fresh-attempt-0123456789ab");
  assert.equal(blockedAgain.res.status, 409);

  // A refresh / restart loads the saved result instead of reopening the quiz.
  const { data: refreshed } = await call("/api/student/attempt", { token: attemptToken });
  assert.equal(refreshed.attempt.status, "submitted");
  assert.ok(refreshed.result, "stored result is returned");
  assert.equal(refreshed.result.score, 20);
  assert.equal(refreshed.result.maxScore, 20);

  // The catalogue shows the exam as completed with its score.
  const { data: cat } = await call("/api/student/exams", { token: student });
  const listed = cat.exams.find((e) => e.id === exam.id);
  assert.equal(listed.attemptStatus, "submitted");
  assert.equal(listed.attemptScore, 20);
  assert.equal(listed.attemptMaxScore, 20);

  const attempts = await db.attempts.listByExam(exam.id);
  assert.equal(attempts.length, 1, "no duplicate attempt was created");
});

test("concurrent start requests reuse one attempt", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam } = await createPublishedMcqExam(admin, { count: 1, marks: 10 });
  const startId = "race-condition-0123456789ab";

  const results = await Promise.all(
    Array.from({ length: 5 }, () => startExam(student, exam.id, startId))
  );

  const sessionIds = new Set(results.map((r) => r.data.sessionId));
  assert.equal(sessionIds.size, 1, "all responses point at one attempt");
  const tokens = new Set(results.map((r) => r.data.token));
  assert.equal(tokens.size, 1, "all responses share one attempt token");
  assert.ok(results.some((r) => r.res.status === 201));

  const attempts = await db.attempts.listByExam(exam.id);
  assert.equal(attempts.length, 1, "concurrent starts did not duplicate the attempt");
});

test("an overdue attempt is expired and submitting it auto-scores the saved answers", async (t) => {
  if (db.isPostgres) {
    t.skip("deadline manipulation requires the in-memory store");
    return;
  }
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 2, marks: 10 });

  const start = await startExam(student, exam.id);
  const attemptToken = start.data.token;
  // Answer one question correctly, leave the second unanswered.
  await call("/api/student/attempt/answers", {
    method: "PUT",
    token: attemptToken,
    body: { answers: { [questions[0].id]: 0 } },
  });

  // Simulate the countdown reaching zero.
  const stored = memoryStore.attempts.find((a) => a.sessionId === start.data.sessionId);
  stored.deadline = new Date(Date.now() - 60_000);

  const expiredView = await call("/api/student/attempt", { token: attemptToken });
  assert.equal(expiredView.data.attempt.status, "expired");

  const auto = await call("/api/student/attempt/submit", {
    method: "POST",
    token: attemptToken,
    body: { answers: {} },
  });
  assert.equal(auto.res.status, 200);
  assert.equal(auto.data.attempt.status, "submitted");
  assert.equal(auto.data.result.score, 10);
  assert.equal(auto.data.result.maxScore, 20);
});

test("camera and screen evidence is stored durably and read only by admins", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam } = await createPublishedMcqExam(admin, { count: 1, marks: 10 });

  const start = await startExam(student, exam.id);
  const attemptToken = start.data.token;
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const base64 = jpegBytes.toString("base64");

  const camera = await call("/api/student/attempt/evidence", {
    method: "POST",
    token: attemptToken,
    body: { kind: "camera", base64 },
  });
  assert.equal(camera.res.status, 201);
  const screen = await call("/api/student/attempt/evidence", {
    method: "POST",
    token: attemptToken,
    body: { kind: "screen", base64: `data:image/jpeg;base64,${base64}` },
  });
  assert.equal(screen.res.status, 201);

  const { data: detail } = await call(`/api/admin/attempts/${start.data.sessionId}`, { token: admin });
  const evidence = detail.attempt.evidence;
  assert.equal(evidence.length, 2);
  for (const item of evidence) {
    assert.ok(item.id);
    assert.ok(item.capturedAt, "capture time is recorded");
    assert.ok(["CAMERA", "SCREEN"].includes(item.kind));
  }

  const cameraRecord = evidence.find((e) => e.kind === "CAMERA");
  const imageRes = await fetch(`${baseUrl}/api/admin/evidence/${cameraRecord.id}`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  assert.equal(imageRes.status, 200);
  assert.equal(imageRes.headers.get("content-type"), "image/jpeg");
  const returned = Buffer.from(await imageRes.arrayBuffer());
  assert.deepEqual(returned, jpegBytes, "stored bytes round-trip exactly");

  const asStudent = await fetch(`${baseUrl}/api/admin/evidence/${cameraRecord.id}`, {
    headers: { Authorization: `Bearer ${student}` },
  });
  assert.equal(asStudent.status, 403, "students cannot read admin evidence");

  const anonymous = await fetch(`${baseUrl}/api/admin/evidence/${cameraRecord.id}`);
  assert.equal(anonymous.status, 401, "evidence requires authentication");
});

test("admin manages MCQ questions and exports an authenticated CSV", async () => {
  const admin = await adminToken();
  const student = await createStudent(admin);
  const { exam, questions } = await createPublishedMcqExam(admin, { count: 2, marks: 10 });

  const update = await call(`/api/admin/questions/${questions[0].id}`, {
    method: "PUT",
    token: admin,
    body: { prompt: "Updated prompt" },
  });
  assert.equal(update.res.status, 200);

  const added = await call(`/api/admin/exams/${exam.id}/questions`, {
    method: "POST",
    token: admin,
    body: { type: "MCQ", prompt: "Temporary", options: ["A", "B", "C", "D"], correctAnswer: 1, marks: 10 },
  });
  assert.equal(added.res.status, 201);
  const removed = await call(`/api/admin/questions/${added.data.question.id}`, {
    method: "DELETE",
    token: admin,
  });
  assert.equal(removed.res.status, 200);

  assert.equal((await call(`/api/admin/exams/${exam.id}/unpublish`, { method: "POST", token: admin })).res.status, 200);
  assert.equal((await call(`/api/admin/exams/${exam.id}/publish`, { method: "POST", token: admin })).res.status, 200);

  const start = await startExam(student, exam.id);
  await call("/api/student/attempt/submit", {
    method: "POST",
    token: start.data.token,
    body: { answers: { [questions[0].id]: 0, [questions[1].id]: 1 } },
  });

  const anonymousExport = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/export`);
  assert.equal(anonymousExport.status, 401);
  const studentExport = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/export`, {
    headers: { Authorization: `Bearer ${student}` },
  });
  assert.equal(studentExport.status, 403);

  const csvRes = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/export`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  assert.equal(csvRes.status, 200);
  const csv = await csvRes.text();
  const header = csv.split("\n")[0];
  assert.match(header, /Score/);
  assert.match(header, /Max Score/);
  assert.match(csv, /submitted/);
  assert.match(csv, /10/, "the persisted score is exported");
});

test("invalid, expired and wrong-role tokens are rejected clearly", async () => {
  const admin = await adminToken();

  assert.equal((await call("/api/admin/exams")).res.status, 401);
  assert.equal((await call("/api/admin/exams", { token: "not-a-jwt" })).res.status, 401);

  const expired = generateToken({ id: "x", username: "x", name: "x", role: "ADMIN" }, "-1s");
  assert.equal((await call("/api/admin/exams", { token: expired })).res.status, 401);

  const student = await createStudent(admin);
  assert.equal((await call("/api/admin/exams", { token: student })).res.status, 403);

  const badLogin = await call("/api/auth/login", {
    method: "POST",
    body: { username: "admin", password: "definitely-wrong" },
  });
  assert.equal(badLogin.res.status, 401);
  assert.match(badLogin.data.message, /Invalid username or password/);

  assert.equal((await call("/api/auth/login", { method: "POST", body: {} })).res.status, 400);
  assert.equal((await call("/api/student/attempt")).res.status, 401);
  assert.equal((await call("/api/student/attempt/answers", { method: "PUT", body: {} })).res.status, 401);
  assert.equal((await call("/api/nope", { token: admin })).res.status, 404);
});

test("repository failures surface as clear 500 errors", async () => {
  const admin = await adminToken();
  const original = db.exams.listAll;
  db.exams.listAll = async () => {
    throw new Error("simulated database outage");
  };
  try {
    const { res, data } = await call("/api/admin/exams", { token: admin });
    assert.equal(res.status, 500);
    assert.match(data.message, /simulated database outage/);
  } finally {
    db.exams.listAll = original;
  }
});
