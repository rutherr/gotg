// server/otp.js
// Pure helpers for one-time-password generation and verification.
// No DB or network calls in here on purpose -- keeps this trivially unit
// testable (see server/auth.test.js) and keeps auth.js focused on wiring.
const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

// Peppers the hash so a leaked DB row alone isn't enough to brute-force
// (attempts are also capped server-side, but defense in depth is cheap here).
function getPepper() {
  return process.env.SESSION_SECRET || "dev-insecure-pepper-change-me";
}

function generateOtp() {
  // Rejection-free: pull a random int in [0, 999999] and zero-pad.
  const n = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return String(n).padStart(OTP_LENGTH, "0");
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(`${code}:${getPepper()}`).digest("hex");
}

function verifyOtpHash(code, hash) {
  const candidate = Buffer.from(hashOtp(code));
  const expected = Buffer.from(hash || "");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function isEmailValid(email) {
  // Deliberately simple -- full RFC 5322 validation is a trap. This just
  // filters obvious junk before we spend a SendGrid send on it.
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

module.exports = {
  OTP_LENGTH,
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  generateOtp,
  hashOtp,
  verifyOtpHash,
  isEmailValid,
  normalizeEmail,
};
