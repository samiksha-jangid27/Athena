const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// This suite must only run against the disposable local PostgreSQL CI service.
const database = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (process.env.ATHENA_POSTGRES_TESTS !== '1' ||
    !['localhost', '127.0.0.1'].includes(database.hostname) || database.pathname !== '/athena_test') {
  throw new Error('Use ATHENA_POSTGRES_TESTS=1 and a local athena_test database.');
}
const { PrismaClient } = require('@prisma/client');
const { createApp } = require('../app');
const { db } = require('../lib/db');
const { generateToken, hashPassword } = require('../lib/auth');
const prisma = new PrismaClient();
const userIds = [];
const examIds = [];
let server, baseUrl, admin, adminToken;

async function call(path, { method = 'GET', token = adminToken, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function student() {
  const user = await db.users.create({
    username: `delete_test_${crypto.randomUUID()}`, name: 'Disposable PostgreSQL Test',
    passwordHash: await hashPassword('StudentTest123!'), role: 'STUDENT',
  });
  userIds.push(user.id);
  return { ...user, token: generateToken({ id: user.id, name: user.name, username: user.username, role: user.role }) };
}

test.before(async () => {
  for (let retry = 0; retry < 100; retry++) {
    admin = await db.users.findByUsername('admin');
    if (admin) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(admin, 'seeded admin exists');
  adminToken = generateToken({ id: admin.id, role: 'ADMIN' });
  await new Promise((resolve) => {
    server = createApp().listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma.attempt.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  await prisma.$disconnect();
});

test('PostgreSQL deletes an unused student, retains audit history and rejects old JWTs', async () => {
  const user = await student();
  const login = await call('/api/auth/login', { body: { username: user.username, password: 'StudentTest123!' }, method: 'POST' });
  assert.equal(login.status, 200);
  const audit = await prisma.auditLog.findFirst({ where: { userId: user.id } });
  assert.ok(audit);
  assert.equal((await call(`/api/admin/students/${user.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
  assert.equal((await prisma.auditLog.findUnique({ where: { id: audit.id } })).userId, null);
  assert.equal((await call('/api/student/exams', { token: user.token })).status, 401);
  assert.equal((await call(`/api/student/exams/${crypto.randomUUID()}/start`, { method: 'POST', token: user.token })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: user.username, password: 'StudentTest123!' } })).status, 401);
  assert.equal((await call(`/api/admin/students/${user.id}`, { method: 'DELETE' })).status, 404);
});

test('PostgreSQL preserves active and submitted exam records when deletion is requested', async () => {
  const user = await student();
  const exam = await db.exams.create({ title: 'Disposable Deletion Test', durationMinutes: 15, totalMarks: 10 });
  examIds.push(exam.id);
  const question = await db.questions.create(exam.id, { type: 'MCQ', prompt: 'Choose A', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, marks: 10, orderIndex: 0 });
  await db.exams.update(exam.id, { status: 'PUBLISHED' });
  const start = await call(`/api/student/exams/${exam.id}/start`, { method: 'POST', token: user.token });
  assert.equal(start.status, 201);
  const deletionPath = `/api/admin/students/${user.id}`;
  assert.equal((await call(deletionPath, { method: 'DELETE' })).status, 409);
  const submit = await call('/api/student/attempt/submit', { method: 'POST', token: start.body.token, body: { answers: { [question.id]: 0 } } });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.result.score, 10);
  const blocked = await call(deletionPath, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /results and evidence/);
  const stored = await prisma.attempt.findUnique({ where: { sessionId: start.body.sessionId }, include: { submittedAnswers: true } });
  assert.equal(stored.totalScore, 10);
  assert.equal(stored.submittedAnswers.length, 1);
  assert.ok(await prisma.user.findUnique({ where: { id: user.id } }));
});

test('PostgreSQL deletion rejects missing IDs, anonymous users, students and admin IDs', async () => {
  const user = await student();
  const path = `/api/admin/students/${user.id}`;
  assert.equal((await call(path, { method: 'DELETE', token: null })).status, 401);
  assert.equal((await call(path, { method: 'DELETE', token: user.token })).status, 403);
  assert.equal((await call(`/api/admin/students/${crypto.randomUUID()}`, { method: 'DELETE' })).status, 404);
  assert.equal((await call(`/api/admin/students/${admin.id}`, { method: 'DELETE' })).status, 404);
  assert.ok(await prisma.user.findUnique({ where: { id: user.id } }));
  assert.ok(await prisma.user.findUnique({ where: { id: admin.id } }));
});
