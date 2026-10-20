const test = require("node:test");
const assert = require("node:assert/strict");
const practical = require("../lib/practical");

const task = {
  id: "p1",
  allowedExtensions: [".js", ".md"],
  maxFileBytes: 10,
  maxFiles: 2,
  tests: [{ id: "t1", name: "Works" }],
};
const b64 = (text) => Buffer.from(text).toString("base64");

test("safeFileName strips paths and unsafe characters", () => {
  assert.equal(practical.safeFileName("../../etc/passwd"), "passwd");
  assert.equal(practical.safeFileName("my file (1).js"), "my_file__1_.js");
  assert.equal(practical.safeFileName("...hidden.js"), "hidden.js");
  assert.equal(practical.safeFileName(""), "file");
});

test("validateUpload enforces type, size, count and encoding", () => {
  const state = practical.emptyState();
  assert.ok(practical.validateUpload(task, state, { name: "a.js", contentBase64: b64("ok") }).file);
  assert.match(practical.validateUpload(task, state, { name: "a.exe", contentBase64: b64("x") }).error, /not allowed/);
  assert.match(practical.validateUpload(task, state, { name: "a.js", contentBase64: b64("way too long text") }).error, /larger/);
  assert.match(practical.validateUpload(task, state, { name: "a.js", contentBase64: "" }).error, /empty/);
  assert.match(practical.validateUpload(task, state, { name: "a.js", contentBase64: "**" }).error, /base64/);
  practical.addFile(state, { id: "1", name: "a.js" });
  practical.addFile(state, { id: "2", name: "b.js" });
  assert.match(practical.validateUpload(task, state, { name: "c.js", contentBase64: b64("x") }).error, /at most 2/);
});

test("checkpoints snapshot the current files and need at least one", () => {
  const state = practical.emptyState();
  assert.match(practical.addCheckpoint(state, "first").error, /at least one file/);
  practical.addFile(state, { id: "1", name: "a.js", sha256: "abc" });
  const { checkpoint } = practical.addCheckpoint(state, "  first version ");
  assert.equal(checkpoint.label, "first version");
  assert.deepEqual(checkpoint.files, [{ id: "1", name: "a.js", sha256: "abc" }]);
  practical.removeFile(state, "1");
  assert.equal(state.checkpoints[0].files.length, 1, "checkpoint keeps its own record");
});

test("instructor test results are validated", () => {
  const state = practical.emptyState();
  assert.equal(practical.recordTestResult(task, state, "t1", { status: "pass", note: "ok" }), null);
  assert.equal(state.testResults.t1.status, "pass");
  assert.match(practical.recordTestResult(task, state, "t9", { status: "pass" }), /Unknown/);
  assert.match(practical.recordTestResult(task, state, "t1", { status: "maybe" }), /pass, fail/);
});
