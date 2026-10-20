// Starts the Athena backend. Configuration comes from environment variables.
const crypto = require("crypto");
const path = require("path");
const { createApp } = require("./app");

const PORT = Number(process.env.PORT) || 3000;

// If no instructor key is configured we generate one per run and print it,
// so there is never a hard-coded default secret.
const instructorKey =
  process.env.ATHENA_INSTRUCTOR_KEY || crypto.randomBytes(12).toString("hex");

const app = createApp({
  instructorKey,
  durationMinutes: Number(process.env.ATHENA_EXAM_MINUTES) || 10,
  examTitle: process.env.ATHENA_EXAM_TITLE || "Electron Fundamentals",
  questionsPath:
    process.env.ATHENA_QUESTIONS_PATH || path.join(__dirname, "data", "questions.json"),
  sessionsPath:
    process.env.ATHENA_SESSIONS_PATH || path.join(__dirname, "data", "sessions.json"),
});

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Athena backend running at http://127.0.0.1:${PORT}`);
  if (!process.env.ATHENA_INSTRUCTOR_KEY) {
    console.log(`Instructor key for this run: ${instructorKey}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is another Athena backend running?`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
