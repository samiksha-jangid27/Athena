const test = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../lib/attempts");

const questions = [
  { id: 1, options: ["a", "b"], correctAnswer: 1 },
  { id: 2, options: ["a", "b", "c"], correctAnswer: 0 },
];
const START = Date.parse("2026-01-01T10:00:00Z");
const TEN_MIN = 10 * 60000;

function newAttempt() {
  return rules.createAttempt({ userId: "s1", name: "Sam", durationMs: TEN_MIN, now: START });
}

test("new attempt is in progress with a deadline and token", () => {
  const attempt = newAttempt();
  assert.equal(attempt.status, "in-progress");
  assert.equal(Date.parse(attempt.deadline), START + TEN_MIN);
  assert.equal(attempt.token.length, 48);
});

test("answers save, validate and are scored server-side", () => {
  const attempt = newAttempt();
  assert.equal(rules.saveAnswers(attempt, { answers: { 1: 1, 2: 2 }, flags: [2] }, questions, START), null);
  assert.deepEqual(rules.score(attempt, questions), { attempted: 2, correct: 1, wrong: 1 });
  assert.deepEqual(attempt.flags, [2]);
  assert.match(rules.saveAnswers(attempt, { answers: { 1: 5 } }, questions, START), /invalid answer/);
  assert.match(rules.saveAnswers(attempt, { answers: { 9: 0 } }, questions, START), /unknown question/);
  assert.match(rules.saveAnswers(attempt, { answers: {}, flags: [9] }, questions, START), /invalid flags/);
});

test("answers are rejected after the deadline plus grace", () => {
  const attempt = newAttempt();
  const late = START + TEN_MIN + rules.GRACE_MS + 1;
  assert.match(rules.saveAnswers(attempt, { answers: { 1: 0 } }, questions, late), /expired/);
  assert.equal(attempt.status, "expired");
});

test("saving within the grace period still works", () => {
  const attempt = newAttempt();
  assert.equal(rules.saveAnswers(attempt, { answers: { 1: 0 } }, questions, START + TEN_MIN + 1000), null);
});

test("fullscreen exit locks answers until an instructor unlocks", () => {
  const attempt = newAttempt();
  const at = new Date(START).toISOString();
  assert.equal(rules.recordEvents(attempt, [{ id: "e1", type: "fullscreen-exit", at }], START), null);
  assert.equal(attempt.status, "locked");
  assert.match(rules.saveAnswers(attempt, { answers: { 1: 0 } }, questions, START), /locked/);
  assert.equal(rules.unlock(attempt, START), null);
  assert.equal(attempt.status, "in-progress");
  assert.equal(attempt.events[0].clientAt, at);
});

test("unknown event types are rejected without recording anything", () => {
  const attempt = newAttempt();
  assert.match(rules.recordEvents(attempt, [{ id: "a", type: "window-blur" }, { id: "b", type: "keylog" }], START), /unknown event/);
  assert.match(rules.recordEvents(attempt, [{ type: "window-blur" }], START), /valid id/);
  assert.match(rules.recordEvents(attempt, [], START), /1 to 50/);
  assert.equal(attempt.events.length, 0);
});

test("retried events are recorded once, with severity and attempt id", () => {
  const attempt = newAttempt();
  const batch = [{ id: "e1", type: "window-blur" }, { id: "e2", type: "camera-lost", detail: "ended" }];
  rules.recordEvents(attempt, batch, START);
  rules.recordEvents(attempt, batch, START + 1000);
  assert.equal(attempt.events.length, 2);
  assert.deepEqual(attempt.events.map((event) => event.severity), ["warning", "critical"]);
  assert.equal(attempt.events[1].attemptId, attempt.sessionId);
  assert.equal(attempt.events[1].seq, 2);
});

test("extension moves the deadline and keeps answers", () => {
  const attempt = newAttempt();
  rules.saveAnswers(attempt, { answers: { 1: 1 } }, questions, START);
  assert.equal(rules.extend(attempt, 5, START), null);
  assert.equal(Date.parse(attempt.deadline), START + TEN_MIN + 5 * 60000);
  assert.deepEqual(attempt.answers, { 1: 1 });
  assert.match(rules.extend(attempt, 0, START), /between 1 and 120/);
});

test("extending an expired attempt reopens it from now", () => {
  const attempt = newAttempt();
  const late = START + TEN_MIN + rules.GRACE_MS + 60000;
  rules.refreshStatus(attempt, late);
  assert.equal(rules.extend(attempt, 3, late), null);
  assert.equal(attempt.status, "in-progress");
  assert.equal(Date.parse(attempt.deadline), late + 3 * 60000);
});

test("submit is idempotent and blocks further changes", () => {
  const attempt = newAttempt();
  assert.equal(rules.submit(attempt, START), null);
  assert.equal(rules.submit(attempt, START + 1000), null);
  assert.equal(attempt.submittedAt, new Date(START).toISOString());
  assert.match(rules.saveAnswers(attempt, { answers: { 1: 0 } }, questions, START), /submitted/);
  assert.match(rules.extend(attempt, 5, START), /submitted/);
});
