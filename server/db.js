// server/db.js
// SQLite persistence for accounts, password-reset codes, and login sessions.
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

// --- One-time schema migration: OTP-only accounts -> password/Google accounts ---
// The original `users` table had no password_hash/google_id/display_name
// columns. Rather than carry ALTER TABLE ADD COLUMN branching forever for
// what was pre-launch test data, this does a single destructive migration
// the first time the new columns are missing: existing users/sessions are
// wiped (nobody had a password to lose -- OTP login is gone) and the tables
// are recreated with the new shape. This only ever runs once per database
// file; after the first boot on the new schema, table_info already has the
// columns and this is a no-op.
function needsMigration() {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (cols.length === 0) return false; // fresh DB, CREATE TABLE below handles it
  return !cols.some((c) => c.name === "password_hash");
}

if (needsMigration()) {
  console.warn(
    "[db] Migrating users table to the password/Google-auth schema -- " +
    "dropping existing users/sessions (OTP-only accounts, nothing recoverable)."
  );
  db.exec(`
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,        -- NULL if the account was created via Google only
    google_id TEXT UNIQUE,     -- NULL if the account was created via password only
    display_name TEXT,
    created_at INTEGER NOT NULL
  );

  -- Password-reset codes. (Formerly login OTP codes -- same shape, repurposed
  -- now that login itself is password/Google-based. One live code per email.)
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

function getUserByGoogleId(googleId) {
  return db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function createUserWithPassword(email, passwordHash) {
  const info = db
    .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
    .run(email, passwordHash, Date.now());
  return getUserById(info.lastInsertRowid);
}

function createUserWithGoogle(email, googleId, displayName) {
  const info = db
    .prepare("INSERT INTO users (email, google_id, display_name, created_at) VALUES (?, ?, ?, ?)")
    .run(email, googleId, displayName || null, Date.now());
  return getUserById(info.lastInsertRowid);
}

function linkGoogleToUser(userId, googleId) {
  db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(googleId, userId);
  return getUserById(userId);
}

function setUserPassword(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

// --- password-reset codes (one live code per email at a time) ---
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

// Used after a password reset (and available for a future "log out
// everywhere" button) -- a reset should invalidate any session tokens that
// leaked or were left logged in elsewhere before the password changed.
function deleteAllSessionsForUser(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

module.exports = {
  db,
  SESSION_TTL_MS,
  getUserByEmail,
  getUserByGoogleId,
  getUserById,
  createUserWithPassword,
  createUserWithGoogle,
  linkGoogleToUser,
  setUserPassword,
  saveOtp,
  getOtp,
  incrementOtpAttempts,
  clearOtp,
  createSession,
  getSession,
  deleteSession,
  deleteAllSessionsForUser,
};
