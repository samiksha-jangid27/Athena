// Authentication and authorization utilities for Athena.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const isProduction = process.env.NODE_ENV === "production";
const configuredSecret = process.env.ATHENA_JWT_SECRET;

if (isProduction && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error(
    "ATHENA_JWT_SECRET must be set to at least 32 characters in production."
  );
}

const JWT_SECRET =
  configuredSecret || "athena-dev-jwt-secret-replace-in-production";

async function hashPassword(plain) {
  if (typeof plain !== "string" || !plain.trim()) throw new Error("Password must be a non-empty string");
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(plain, hash);
}

function generateToken(payload, expiresIn = "12h") {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function authenticateToken(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }
  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ message: "Invalid or expired session token" });
  }
  req.user = payload;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ message: `Access denied: requires ${role} role` });
    }
    next();
  };
}

const requireAdmin = [authenticateToken, requireRole("ADMIN")];
const requireStudent = [authenticateToken, requireRole("STUDENT")];

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyJwt,
  hashToken,
  authenticateToken,
  requireRole,
  requireAdmin,
  requireStudent,
};
