const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../app");
const { db } = require("../lib/db");

let server;
let baseUrl;

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

test("Health check endpoint returns ok and database status", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.database.status, "connected");
});

test("Authentication: admin login works and returns token with ADMIN role", async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.ATHENA_ADMIN_PASSWORD || "AdminPass123!" }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.token);
  assert.equal(data.user.role, "ADMIN");
  assert.equal(data.user.username, "admin");
});

test("Authentication: student account provisioning and student login", async () => {
  // Login as admin first
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.ATHENA_ADMIN_PASSWORD || "AdminPass123!" }),
  });
  const { token: adminToken } = await adminRes.json();

  // Create student
  const studentUser = `student_${Date.now()}`;
  const createRes = await fetch(`${baseUrl}/api/admin/students`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      username: studentUser,
      name: "Alice Tester",
      password: "StudentPass123!",
    }),
  });
  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.student.username, studentUser);

  // Student login
  const studentLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: studentUser, password: "StudentPass123!" }),
  });
  assert.equal(studentLoginRes.status, 200);
  const studentData = await studentLoginRes.json();
  assert.equal(studentData.user.role, "STUDENT");

  // Verify student cannot access admin endpoints
  const forbiddenRes = await fetch(`${baseUrl}/api/admin/exams`, {
    headers: { Authorization: `Bearer ${studentData.token}` },
  });
  assert.equal(forbiddenRes.status, 403);
});

test("Admin Exam Management: create, add MCQ questions, publish, student takes and submits exam", async () => {
  // 1. Admin login
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: process.env.ATHENA_ADMIN_PASSWORD || "AdminPass123!" }),
  });
  const { token: adminToken } = await adminRes.json();

  // 2. Create exam
  const examRes = await fetch(`${baseUrl}/api/admin/exams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title: "Advanced Electron Assessment",
      description: "Testing IPC, lifecycle, and proctoring",
      durationMinutes: 15,
      totalMarks: 50,
      passingCriteria: 25,
    }),
  });
  assert.equal(examRes.status, 201);
  const { exam } = await examRes.json();

  // 3. Add questions (the active product is MCQ-only)
  const q1Res = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      type: "MCQ",
      prompt: "What does contextIsolation do?",
      options: ["Isolates contexts", "Breaks Electron", "Enables node", "None"],
      correctAnswer: 0,
      marks: 10,
    }),
  });
  assert.equal(q1Res.status, 201);
  const { question: q1 } = await q1Res.json();

  const q2Res = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      type: "MCQ",
      prompt: "Which webPreferences setting should be enabled?",
      options: ["nodeIntegration: true", "contextIsolation: true", "webSecurity: false", "allowRunningInsecureContent: true"],
      correctAnswer: 1,
      marks: 20,
    }),
  });
  assert.equal(q2Res.status, 201);
  const { question: q2 } = await q2Res.json();

  const q3Res = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      type: "MCQ",
      prompt: "Which IPC method sends a request and awaits a promise response?",
      options: ["ipcRenderer.send", "ipcRenderer.on", "ipcRenderer.invoke", "ipcRenderer.sendSync"],
      correctAnswer: 2,
      marks: 20,
    }),
  });
  assert.equal(q3Res.status, 201);
  const { question: q3 } = await q3Res.json();

  // 4. Publish exam
  const pubRes = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(pubRes.status, 200);

  // 5. Student logs in and starts exam
  const studentUser = `student_exam_${Date.now()}`;
  await fetch(`${baseUrl}/api/admin/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: studentUser, name: "Bob Student", password: "ExamPass123!" }),
  });
  const sLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: studentUser, password: "ExamPass123!" }),
  });
  const { token: studentToken } = await sLogin.json();

  // Student starts exam
  const startRes = await fetch(`${baseUrl}/api/student/exams/${exam.id}/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  assert.equal(startRes.status, 201);
  const startData = await startRes.json();
  assert.ok(startData.token);
  assert.equal(startData.questions.length, 3);
  // Verify correct answers are NOT exposed to student!
  assert.equal(startData.questions[0].correctAnswer, undefined);
  assert.equal(startData.questions[1].correctAnswer, undefined);

  // 6. Student autosaves answers
  const attemptToken = startData.token;
  const saveRes = await fetch(`${baseUrl}/api/student/attempt/answers`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${attemptToken}`,
    },
    body: JSON.stringify({
      answers: {
        [q1.id]: 0,
        [q2.id]: 1,
        [q3.id]: 2,
      },
      flags: [q3.id],
    }),
  });
  assert.equal(saveRes.status, 200);

  // 7. Student submits exam
  const submitRes = await fetch(`${baseUrl}/api/student/attempt/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${attemptToken}`,
    },
    body: JSON.stringify({
      answers: {
        [q1.id]: 0,
        [q2.id]: 1,
        [q3.id]: 2,
      },
    }),
  });
  assert.equal(submitRes.status, 200);
  const submitData = await submitRes.json();
  assert.equal(submitData.attempt.status, "submitted");
  assert.equal(submitData.result.score, 50); // 10 + 20 + 20 = 50 full marks!

  // 8. Admin reviews attempt in attempts monitor
  const monitorRes = await fetch(`${baseUrl}/api/admin/attempts`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(monitorRes.status, 200);
  const attemptsList = await monitorRes.json();
  const studentAttempt = attemptsList.find((a) => a.sessionId === startData.sessionId);
  assert.ok(studentAttempt);
  assert.equal(studentAttempt.status, "submitted");
  assert.equal(studentAttempt.totalScore, 50);

  // 9. Admin CSV export
  const exportRes = await fetch(`${baseUrl}/api/admin/exams/${exam.id}/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(exportRes.status, 200);
  const csv = await exportRes.text();
  assert.ok(csv.includes("Session ID"));
  assert.ok(csv.includes("Bob Student"));
});
