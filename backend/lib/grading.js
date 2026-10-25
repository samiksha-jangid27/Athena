// Grading engine for Athena questions: MCQ, MSQ, True/False, and Short Answer.

function normalizeAnswer(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.trim();
    }
  }
  return raw;
}

function gradeQuestion(question, studentAnswerRaw) {
  const student = normalizeAnswer(studentAnswerRaw);
  const correct = normalizeAnswer(question.correctAnswer);
  const marks = Number(question.marks) || 1;

  if (student === null || student === undefined || (typeof student === "string" && !student.trim())) {
    return { isCorrect: false, marksAwarded: 0, needsManualReview: question.type === "SHORT_ANSWER" };
  }

  switch (question.type) {
    case "MCQ": {
      const isCorrect = Number(student) === Number(correct);
      return { isCorrect, marksAwarded: isCorrect ? marks : 0, needsManualReview: false };
    }

    case "MSQ": {
      const studentArr = Array.isArray(student) ? student.map(Number).sort() : [Number(student)];
      const correctArr = Array.isArray(correct) ? correct.map(Number).sort() : [Number(correct)];
      const isCorrect =
        studentArr.length === correctArr.length && studentArr.every((val, idx) => val === correctArr[idx]);
      return { isCorrect, marksAwarded: isCorrect ? marks : 0, needsManualReview: false };
    }

    case "TRUE_FALSE": {
      let isCorrect = false;
      if (typeof correct === "boolean") {
        isCorrect = Boolean(student) === correct;
      } else {
        isCorrect = Number(student) === Number(correct);
      }
      return { isCorrect, marksAwarded: isCorrect ? marks : 0, needsManualReview: false };
    }

    case "SHORT_ANSWER": {
      // If exact string matches (case-insensitive trim)
      if (typeof correct === "string" && typeof student === "string") {
        if (student.trim().toLowerCase() === correct.trim().toLowerCase()) {
          return { isCorrect: true, marksAwarded: marks, needsManualReview: false };
        }
      }
      // Otherwise mark for manual review
      return { isCorrect: null, marksAwarded: 0, needsManualReview: true };
    }

    default:
      return { isCorrect: false, marksAwarded: 0, needsManualReview: false };
  }
}

// Validates a student answer payload against the questions of that attempt's
// exam. Returns an error message, or null when the payload is acceptable.
// Only single-answer MCQs with four options are supported by the product.
function validateAnswerPayload(questions, answersMap) {
  if (answersMap === null || typeof answersMap !== "object" || Array.isArray(answersMap)) {
    return "answers must be an object mapping question ids to option indices";
  }
  const byId = new Map(questions.map((q) => [String(q.id), q]));
  for (const [questionId, value] of Object.entries(answersMap)) {
    const question = byId.get(String(questionId));
    if (!question) return `Question ${questionId} does not belong to this exam`;
    if (question.type !== "MCQ") return `Question ${questionId} is not a multiple-choice question`;
    const optionCount = Array.isArray(question.options) ? question.options.length : 0;
    if (!Number.isInteger(value) || value < 0 || value >= optionCount) {
      return `Answer for question ${questionId} must be one of the ${optionCount} options`;
    }
  }
  return null;
}

function validateFlags(questions, flagsList) {
  if (flagsList === null || flagsList === undefined) return null;
  if (!Array.isArray(flagsList)) return "flags must be an array of question ids";
  const ids = new Set(questions.map((q) => String(q.id)));
  for (const flag of flagsList) {
    if (!ids.has(String(flag))) return `Flagged question ${flag} does not belong to this exam`;
  }
  return null;
}

// Validates that a question payload is a supported single-answer MCQ with four
// options. Athena's active exam flow is multiple-choice only, so the admin
// endpoints reject anything else before it reaches the database.
// Returns an error message, or null when the payload is acceptable.
function validateMcqQuestion({ type, prompt, options, correctAnswer, marks }) {
  if (type && type !== "MCQ") {
    return "Only multiple-choice (MCQ) questions are supported";
  }
  if (!prompt || !String(prompt).trim()) return "Question prompt is required";
  if (!Array.isArray(options) || options.length !== 4) {
    return "MCQ questions require exactly four options";
  }
  if (options.some((option) => !String(option ?? "").trim())) {
    return "Every option must have text";
  }
  if (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer > 3) {
    return "Correct answer must be an option index between 1 and 4";
  }
  if (marks !== undefined && (!Number.isFinite(Number(marks)) || Number(marks) < 1)) {
    return "Marks must be at least 1";
  }
  return null;
}

function gradeAttempt(questions, submittedAnswersMap) {
  let autoScore = 0;
  let maxPossible = 0;
  let hasManualPending = false;
  const gradedItems = [];

  for (const q of questions) {
    const qMarks = Number(q.marks) || 1;
    maxPossible += qMarks;
    const studentAns = submittedAnswersMap[q.id];
    const result = gradeQuestion(q, studentAns);
    if (result.needsManualReview) hasManualPending = true;
    autoScore += result.marksAwarded;
    gradedItems.push({
      questionId: q.id,
      prompt: q.prompt,
      type: q.type,
      marks: qMarks,
      studentAnswer: studentAns,
      isCorrect: result.isCorrect,
      marksAwarded: result.marksAwarded,
      needsManualReview: result.needsManualReview,
    });
  }

  return {
    autoScore,
    maxPossible,
    hasManualPending,
    gradedItems,
  };
}

module.exports = {
  normalizeAnswer,
  gradeQuestion,
  gradeAttempt,
  validateAnswerPayload,
  validateFlags,
  validateMcqQuestion,
};
