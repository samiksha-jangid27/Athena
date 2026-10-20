// Practical assessment rules: uploads, checkpoints and instructor test
// results. Submitted code is stored, never executed by Athena.
const crypto = require("crypto");
const path = require("path");

const TEST_STATUSES = new Set(["pass", "fail", "not-run"]);

function emptyState() {
  return { files: [], checkpoints: [], testResults: {} };
}

function taskState(attempt, taskId) {
  attempt.practical = attempt.practical || {};
  attempt.practical[taskId] = attempt.practical[taskId] || emptyState();
  return attempt.practical[taskId];
}

// Keeps letters, numbers, dot, dash and underscore; drops any path parts.
function safeFileName(name) {
  const base = path.basename(String(name || "")).replace(/[^\w.-]/g, "_").slice(0, 80);
  return base.replace(/^\.+/, "") || "file";
}

// Returns { error } or { file, bytes } for an upload request.
function validateUpload(task, state, { name, contentBase64 }) {
  if (typeof name !== "string" || !name.trim()) return { error: "File name is required" };
  if (typeof contentBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
    return { error: "File content must be base64" };
  }
  const fileName = safeFileName(name);
  const extension = path.extname(fileName).toLowerCase();
  if (!task.allowedExtensions.includes(extension)) {
    return { error: `File type ${extension || "(none)"} is not allowed` };
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0) return { error: "File is empty" };
  if (bytes.length > task.maxFileBytes) return { error: `File is larger than ${Math.round(task.maxFileBytes / 1024)} KB` };
  if (state.files.length >= task.maxFiles) return { error: `You can upload at most ${task.maxFiles} files` };
  return {
    bytes,
    file: {
      id: crypto.randomBytes(6).toString("hex"),
      name: fileName,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

function addFile(state, file, now = Date.now()) {
  const stored = { ...file, uploadedAt: new Date(now).toISOString() };
  state.files.push(stored);
  return stored;
}

function removeFile(state, fileId) {
  const index = state.files.findIndex((file) => file.id === fileId);
  if (index === -1) return null;
  return state.files.splice(index, 1)[0];
}

// A checkpoint records which files (by hash) existed at a moment in time.
function addCheckpoint(state, label, now = Date.now()) {
  if (state.files.length === 0) return { error: "Upload at least one file before saving a checkpoint" };
  if (state.checkpoints.length >= 20) return { error: "Checkpoint limit reached" };
  const checkpoint = {
    id: `cp-${state.checkpoints.length + 1}`,
    label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : `Checkpoint ${state.checkpoints.length + 1}`,
    at: new Date(now).toISOString(),
    files: state.files.map((file) => ({ id: file.id, name: file.name, sha256: file.sha256 })),
  };
  state.checkpoints.push(checkpoint);
  return { checkpoint };
}

function recordTestResult(task, state, testId, { status, note }, now = Date.now()) {
  if (!task.tests.some((test) => test.id === testId)) return "Unknown test";
  if (!TEST_STATUSES.has(status)) return "status must be pass, fail or not-run";
  state.testResults[testId] = {
    status,
    note: typeof note === "string" ? note.slice(0, 500) : "",
    at: new Date(now).toISOString(),
  };
  return null;
}

module.exports = { emptyState, taskState, safeFileName, validateUpload, addFile, removeFile, addCheckpoint, recordTestResult };
