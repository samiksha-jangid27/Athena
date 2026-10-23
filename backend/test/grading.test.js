const test = require("node:test");
const assert = require("node:assert/strict");
const { gradeQuestion, gradeAttempt } = require("../lib/grading");

test("MCQ grading awards marks for exact choice and 0 otherwise", () => {
  const q = { type: "MCQ", marks: 10, correctAnswer: 2, prompt: "Test MCQ" };
  assert.deepEqual(gradeQuestion(q, 2), { isCorrect: true, marksAwarded: 10, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, "2"), { isCorrect: true, marksAwarded: 10, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, 1), { isCorrect: false, marksAwarded: 0, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, null), { isCorrect: false, marksAwarded: 0, needsManualReview: false });
});

test("MSQ grading handles multiple selections regardless of order", () => {
  const q = { type: "MSQ", marks: 20, correctAnswer: [0, 2], prompt: "Test MSQ" };
  assert.deepEqual(gradeQuestion(q, [0, 2]), { isCorrect: true, marksAwarded: 20, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, [2, 0]), { isCorrect: true, marksAwarded: 20, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, [0]), { isCorrect: false, marksAwarded: 0, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, [0, 1, 2]), { isCorrect: false, marksAwarded: 0, needsManualReview: false });
});

test("TRUE_FALSE grading evaluates boolean options accurately", () => {
  const q = { type: "TRUE_FALSE", marks: 5, correctAnswer: 0, prompt: "Is Electron cross-platform?" };
  assert.deepEqual(gradeQuestion(q, 0), { isCorrect: true, marksAwarded: 5, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, 1), { isCorrect: false, marksAwarded: 0, needsManualReview: false });
});

test("SHORT_ANSWER matches exact case-insensitive string or marks for manual review", () => {
  const q = { type: "SHORT_ANSWER", marks: 15, correctAnswer: "IPC Bridge", prompt: "Name the bridge" };
  assert.deepEqual(gradeQuestion(q, "ipc bridge"), { isCorrect: true, marksAwarded: 15, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, "  IPC Bridge  "), { isCorrect: true, marksAwarded: 15, needsManualReview: false });
  assert.deepEqual(gradeQuestion(q, "Different explanation"), { isCorrect: null, marksAwarded: 0, needsManualReview: true });
});

test("gradeAttempt aggregates full exam scoring accurately", () => {
  const questions = [
    { id: "q1", type: "MCQ", marks: 10, correctAnswer: 1, prompt: "Q1" },
    { id: "q2", type: "MSQ", marks: 20, correctAnswer: [1, 3], prompt: "Q2" },
    { id: "q3", type: "SHORT_ANSWER", marks: 30, correctAnswer: "Model", prompt: "Q3" },
  ];
  const answers = {
    q1: 1,
    q2: [3, 1],
    q3: "custom description",
  };
  const result = gradeAttempt(questions, answers);
  assert.equal(result.autoScore, 30);
  assert.equal(result.maxPossible, 60);
  assert.equal(result.hasManualPending, true);
  assert.equal(result.gradedItems.length, 3);
});
