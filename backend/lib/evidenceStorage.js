// Secure proctoring evidence storage module.
// Supports local filesystem storage under authenticated routes,
// with clean extension points for remote S3-compatible object storage.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EVIDENCE_DIR = process.env.ATHENA_EVIDENCE_DIR || path.join(__dirname, "../data/evidence");

function ensureEvidenceDir(sessionId, kind) {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  const safeKind = kind === "screen" ? "screen" : "camera";
  const target = path.join(EVIDENCE_DIR, safeSession, safeKind);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

async function saveEvidenceFile({ sessionId, kind, buffer }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Invalid evidence buffer");
  }
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  const dir = ensureEvidenceDir(sessionId, kind);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);

  return {
    filename,
    storagePath: filePath,
    byteSize: buffer.length,
    kind,
  };
}

function getEvidenceStream(filePath) {
  // Validate path traversal security
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(EVIDENCE_DIR))) {
    throw new Error("Access denied: path traversal detected");
  }
  if (!fs.existsSync(resolved)) {
    return null;
  }
  return fs.createReadStream(resolved);
}

module.exports = {
  saveEvidenceFile,
  getEvidenceStream,
  EVIDENCE_DIR,
};
