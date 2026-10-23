// Starts the Athena backend server.
// Configured for local development, test runners, and production hosting on Render.
const crypto = require("crypto");
const path = require("path");
const { createApp } = require("./app");
const { db } = require("./lib/db");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

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

const server = app.listen(PORT, HOST, () => {
  console.log(`Athena backend running on http://${HOST}:${PORT}`);
  console.log(`Database provider: ${db.isPostgres ? "PostgreSQL (Prisma)" : "In-Memory / Local Store"}`);
  if (!process.env.ATHENA_INSTRUCTOR_KEY) {
    console.log(`Instructor key for this session: ${instructorKey}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Please terminate the conflicting process or choose another port.`);
  } else {
    console.error("Server error:", error);
  }
  process.exit(1);
});

// Graceful shutdown handling
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down Athena backend gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  // Force exit if close takes longer than 5 seconds
  setTimeout(() => {
    console.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Optional: If spawned by an Athena Electron process, terminate if parent dies
const parentPid = Number(process.env.ATHENA_PARENT_PID);
if (parentPid) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log("Parent Electron process exited; stopping backend.");
      process.exit(0);
    }
  }, 2000).unref();
}

module.exports = server;
