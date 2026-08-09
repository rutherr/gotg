// server/db.js
// SQLite persistence for accounts, OTP codes, and login sessions.
// This is the "not yet wired up" better-sqlite3 dependency mentioned in the
// README -- this is where it gets wired up.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.SQLITE_DIR || path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "gog.db");

// NOTE for Railway: the container filesystem is ephemeral unless this path
// is on a mounted Volume. Without one, accounts/sessions vanish on every
// redeploy. Fine for early development; mount a Volume at this path (or
// point SQLITE_DIR at one) before relying on this for real users.
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- users ---
function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function getOrCreateUser(email) {
  const existing = getUserByEmail(email);
  if (existing) return existing;
  const info = db.prepare("INSERT INTO users (email, created_at) VALUES (?, ?)").run(email, Date.now());
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

// --- otp codes (one live code per email at a time) ---
function saveOtp(email, codeHash, expiresAt) {
  db.prepare(`
    INSERT INTO otp_codes (email, code_hash, expires_at, attempts, last_sent_at)
    VALUES (@email, @codeHash, @expiresAt, 0, @now)
    ON CONFLICT(email) DO UPDATE SET
      code_hash = @codeHash, expires_at = @expiresAt, attempts = 0, last_sent_at = @now
  `).run({ email, codeHash, expiresAt, now: Date.now() });
}

function getOtp(email) {
  return db.prepare("SELECT * FROM otp_codes WHERE email = ?").get(email);
}

function incrementOtpAttempts(email) {
  db.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
}

function clearOtp(email) {
  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
}

// --- sessions ---
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  return row;
}

function deleteSession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

module.exports = {
  db,
  SESSION_TTL_MS,
  getUserByEmail,
  getOrCreateUser,
  getUserById,
  saveOtp,
  getOtp,
  incrementOtpAttempts,
  clearOtp,
  createSession,
  getSession,
  deleteSession,
};
