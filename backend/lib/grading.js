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
};
