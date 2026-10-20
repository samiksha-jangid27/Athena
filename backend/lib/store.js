// JSON-file storage. Simple and readable, but it lives on the same machine
// as the student, so it is NOT tamper-proof (see README).
const fs = require("fs");
const path = require("path");

function createStore({ questionsPath, sessionsPath }) {
  function readQuestions() {
    return JSON.parse(fs.readFileSync(questionsPath, "utf-8"));
  }

  function readSessions() {
    if (!fs.existsSync(sessionsPath)) return [];
    return JSON.parse(fs.readFileSync(sessionsPath, "utf-8"));
  }

  // Write to a temp file then rename, so a crash never leaves half a file.
  function saveSessions(sessions) {
    fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
    const tempPath = `${sessionsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2));
    fs.renameSync(tempPath, sessionsPath);
  }

  return { readQuestions, readSessions, saveSessions };
}

module.exports = { createStore };
