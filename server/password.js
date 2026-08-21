// server/password.js
// Pure helpers for password hashing/verification and strength validation.
// No DB or network calls in here on purpose -- same reasoning as
// server/otp.js: keeps this trivially unit testable (see
// server/password.test.js) and keeps auth.js focused on wiring.
//
// Uses Node's built-in crypto.scrypt rather than pulling in bcrypt/argon2 --
// no extra native dependency to compile alongside better-sqlite3, and the
// project already hand-rolls OTP hashing the same way. Stored format is
// "scrypt:<saltHex>:<hashHex>" so it's self-describing -- a future KDF
// change doesn't need a silent-format migration, it can just branch on the
// prefix.
const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 8;
// Not a security limit (scrypt has no real cap) -- just keeps the hashing
// cost bounded against someone pasting in a megabyte of text.
const MAX_PASSWORD_LENGTH = 72;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== "string" || !stored || typeof stored !== "string") return false;
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  let expected, candidate;
  try {
    expected = Buffer.from(hashHex, "hex");
    candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function isPasswordValid(password) {
  return (
    typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  isPasswordValid,
};
