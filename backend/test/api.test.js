// End-to-end tests of the HTTP API against a temporary data directory.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../app");

const KEY = "test-instructor-key";
let server;
let baseUrl;
let sessionsPath;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "athena-api-"));
  sessionsPath = path.join(dir, "sessions.json");
  const app = createApp({
    instructorKey: KEY,
    questionsPath: path.join(__dirname, "..", "data", "questions.json"),
    sessionsPath,
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function call(method, url, { body, token, key, raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["x-instructor-key"] = key;
  const response = await fetch(baseUrl + url, {
    method,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: response.status, body: await response.json() };
}

async function startAttempt() {
  const { body } = await call("POST", "/exam/start", { body: { userId: "s1", name: "Sam" } });
  return body;
}

function editStoredAttempt(sessionId, change) {
  const sessions = JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
  change(sessions.find((item) => item.sessionId === sessionId));
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions));
}

test("start validates input and never returns correct answers", async () => {
  assert.equal((await call("POST", "/exam/start", { body: { userId: " ", name: "x" } })).status, 400);
  assert.equal((await call("POST", "/exam/start", { body: { userId: 5, name: "x" } })).status, 400);
  const started = await startAttempt();
  assert.equal(started.attempt.status, "in-progress");
  assert.ok(started.questions.length > 0);
  assert.ok(started.questions.every((question) => !("correctAnswer" in question)));
  const stored = fs.readFileSync(sessionsPath, "utf-8");
  assert.ok(!stored.includes(started.token), "raw token must not be stored");
});

test("student endpoints require a valid token", async () => {
  assert.equal((await call("GET", "/exam/attempt")).status, 401);
  assert.equal((await call("GET", "/exam/attempt", { token: "nope" })).status, 401);
  assert.equal((await call("PUT", "/exam/answers", { token: "nope", body: { answers: {} } })).status, 401);
});

test("malformed JSON and unknown routes return JSON errors", async () => {
  const bad = await call("POST", "/exam/start", { raw: "{oops" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /valid JSON/);
  assert.equal((await call("GET", "/missing")).status, 404);
});

test("locked attempts reject answers until an instructor unlocks", async () => {
  const { token, attempt } = await startAttempt();
  await call("POST", "/exam/events", { token, body: { events: [{ id: "x1", type: "fullscreen-exit", at: new Date().toISOString() }] } });
  const rejected = await call("PUT", "/exam/answers", { token, body: { answers: { 1: 1 } } });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.attempt.status, "locked");

  // Re-entering fullscreen does NOT unlock the attempt
  const entered = await call("POST", "/exam/events", { token, body: { events: [{ id: "x2", type: "fullscreen-enter", at: new Date().toISOString() }] } });
  assert.equal(entered.status, 200);
  assert.equal(entered.body.attempt.status, "locked");
  const stillRejected = await call("PUT", "/exam/answers", { token, body: { answers: { 1: 1 } } });
  assert.equal(stillRejected.status, 409);

  assert.equal((await call("POST", `/instructor/attempts/${attempt.sessionId}/unlock`)).status, 401);
  assert.equal((await call("POST", `/instructor/attempts/${attempt.sessionId}/unlock`, { key: "wrong" })).status, 401);
  assert.equal((await call("POST", `/instructor/attempts/${attempt.sessionId}/unlock`, { key: KEY })).status, 200);
  assert.equal((await call("PUT", "/exam/answers", { token, body: { answers: { 1: 1 } } })).status, 200);
});

test("unlocking an attempt that is not locked is a conflict", async () => {
  const { attempt } = await startAttempt();
  assert.equal((await call("POST", `/instructor/attempts/${attempt.sessionId}/unlock`, { key: KEY })).status, 409);
  assert.equal((await call("POST", "/instructor/attempts/missing/unlock", { key: KEY })).status, 404);
});

test("extensions are validated and require the instructor key", async () => {
  const { token, attempt } = await startAttempt();
  const url = `/instructor/attempts/${attempt.sessionId}/extend`;
  assert.equal((await call("POST", url, { body: { minutes: 5 } })).status, 401);
  assert.equal((await call("POST", url, { key: KEY, body: { minutes: "lots" } })).status, 409);
  assert.equal((await call("POST", url, { key: KEY, body: { minutes: 500 } })).status, 409);
  const ok = await call("POST", url, { key: KEY, body: { minutes: 5 } });
  assert.equal(Date.parse(ok.body.deadline), Date.parse(attempt.deadline) + 5 * 60000);
  const { body } = await call("GET", "/exam/attempt", { token });
  assert.equal(body.attempt.deadline, ok.body.deadline);
});

test("expired attempts reject answers but keep saved ones", async () => {
  const { token, attempt } = await startAttempt();
  await call("PUT", "/exam/answers", { token, body: { answers: { 1: 1 } } });
  editStoredAttempt(attempt.sessionId, (stored) => {
    stored.deadline = new Date(Date.now() - 60000).toISOString();
  });
  const late = await call("PUT", "/exam/answers", { token, body: { answers: { 1: 0 } } });
  assert.equal(late.status, 409);
  assert.equal(late.body.attempt.status, "expired");
  assert.deepEqual(late.body.attempt.answers, { 1: 1 });
});

test("duplicate submissions do not change the result", async () => {
  const { token } = await startAttempt();
  const first = await call("POST", "/exam/submit", { token, body: { answers: { 1: 1 } } });
  const second = await call("POST", "/exam/submit", { token, body: { answers: { 1: 0, 2: 0 } } });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.result, first.body.result);
  assert.equal(second.body.attempt.submittedAt, first.body.attempt.submittedAt);
  assert.equal((await call("PUT", "/exam/answers", { token, body: { answers: { 1: 0 } } })).status, 409);
});

test("invalid events are rejected and nothing is recorded", async () => {
  const { token, attempt } = await startAttempt();
  const bad = await call("POST", "/exam/events", { token, body: { events: [{ id: "a", type: "window-blur" }, { id: "b", type: "keystrokes" }] } });
  assert.equal(bad.status, 400);
  assert.equal((await call("POST", "/exam/events", { token, body: { events: "nope" } })).status, 400);
  const { body } = await call("GET", "/instructor/attempts", { key: KEY });
  assert.equal(body.find((item) => item.sessionId === attempt.sessionId).eventCount, 0);
});

test("events after submission are rejected with a conflict", async () => {
  const { token } = await startAttempt();
  await call("POST", "/exam/submit", { token, body: {} });
  const late = await call("POST", "/exam/events", { token, body: { events: [{ id: "z", type: "window-blur" }] } });
  assert.equal(late.status, 409);
  assert.equal(late.body.attempt.status, "submitted");
});

test("exam info is public and does not leak questions", async () => {
  const { status, body } = await call("GET", "/exam/info");
  assert.equal(status, 200);
  assert.equal(body.durationMinutes, 10);
  assert.ok(body.questionCount > 0);
  assert.ok(!("questions" in body));
});

test("practical uploads, checkpoints and instructor results", async () => {
  const { token, attempt } = await startAttempt();
  const tasks = (await call("GET", "/practical", { token })).body.tasks;
  assert.ok(tasks.length > 0);
  const taskId = tasks[0].id;
  const content = Buffer.from("console.log(1)").toString("base64");

  assert.equal((await call("POST", `/practical/${taskId}/files`, { token, body: { name: "x.exe", contentBase64: content } })).status, 400);
  const uploaded = await call("POST", `/practical/${taskId}/files`, { token, body: { name: "../preload.js", contentBase64: content } });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.file.name, "preload.js");
  assert.equal((await call("POST", `/practical/${taskId}/checkpoints`, { token, body: { label: "v1" } })).status, 201);

  const download = await fetch(`${baseUrl}/instructor/attempts/${attempt.sessionId}/files/${uploaded.body.file.id}`, { headers: { "x-instructor-key": KEY } });
  assert.equal(await download.text(), "console.log(1)");
  assert.equal((await fetch(`${baseUrl}/instructor/attempts/${attempt.sessionId}/files/${uploaded.body.file.id}`)).status, 401);

  const testId = tasks[0].tests[0].id;
  const graded = await call("PUT", `/instructor/attempts/${attempt.sessionId}/practical/${taskId}/tests/${testId}`, { key: KEY, body: { status: "pass" } });
  assert.equal(graded.body.testResults[testId].status, "pass");
  const review = await call("GET", `/instructor/attempts/${attempt.sessionId}/practical`, { key: KEY });
  assert.equal(review.body[0].checkpoints.length, 1);

  await call("POST", "/exam/submit", { token, body: {} });
  const late = await call("POST", `/practical/${taskId}/files`, { token, body: { name: "late.js", contentBase64: content } });
  assert.equal(late.status, 409);
});
