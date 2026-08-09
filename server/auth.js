// server/auth.js
// Passwordless email+OTP login. No passwords stored anywhere -- an account
// is just an email address plus whichever session tokens are currently live
// for it. Session id lives in an httpOnly cookie so client JS never touches
// (and can't leak) the raw token.
const express = require("express");
const cookie = require("cookie");
const db = require("./db");
const { sendOtpEmail } = require("./mailer");
const {
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  generateOtp,
  hashOtp,
  verifyOtpHash,
  isEmailValid,
  normalizeEmail,
} = require("./otp");

const SESSION_COOKIE = "gog_session";

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: db.SESSION_TTL_MS, // Express's res.cookie maxAge is milliseconds, NOT seconds
    path: "/",
  };
}

// --- Shared lookup used by both the HTTP routes below and the Socket.io
// connection middleware in server.js, so "who is this request from" is
// answered exactly one way across the whole app. ---
function getUserFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  let parsed;
  try {
    parsed = cookie.parse(cookieHeader);
  } catch {
    return null;
  }
  const token = parsed[SESSION_COOKIE];
  const session = db.getSession(token);
  if (!session) return null;
  const user = db.getUserById(session.user_id);
  if (!user) return null;
  return { id: user.id, email: user.email, sessionToken: token };
}

function requireAuth(req, res, next) {
  const user = getUserFromCookieHeader(req.headers.cookie);
  if (!user) return res.status(401).json({ ok: false, error: "Not logged in" });
  req.authUser = user;
  next();
}

const router = express.Router();

router.post("/request-otp", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isEmailValid(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email address" });
  }

  const existing = db.getOtp(email);
  if (existing && Date.now() - existing.last_sent_at < RESEND_COOLDOWN_MS) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - existing.last_sent_at);
    return res.status(429).json({ ok: false, error: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code` });
  }

  const code = generateOtp();
  db.saveOtp(email, hashOtp(code), Date.now() + OTP_TTL_MS);

  try {
    await sendOtpEmail(email, code);
  } catch {
    return res.status(502).json({ ok: false, error: "Could not send the code. Try again shortly." });
  }

  res.json({ ok: true });
});

router.post("/verify-otp", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!isEmailValid(email) || !code) {
    return res.status(400).json({ ok: false, error: "Email and code are required" });
  }

  const record = db.getOtp(email);
  if (!record) {
    return res.status(400).json({ ok: false, error: "Request a new code first" });
  }
  if (Date.now() > record.expires_at) {
    db.clearOtp(email);
    return res.status(400).json({ ok: false, error: "Code expired — request a new one" });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    db.clearOtp(email);
    return res.status(429).json({ ok: false, error: "Too many attempts — request a new code" });
  }
  if (!verifyOtpHash(code, record.code_hash)) {
    db.incrementOtpAttempts(email);
    return res.status(400).json({ ok: false, error: "Incorrect code" });
  }

  db.clearOtp(email);
  const user = db.getOrCreateUser(email);
  const token = db.createSession(user.id);

  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ ok: true, email: user.email });
});

router.post("/logout", (req, res) => {
  const parsed = cookie.parse(req.headers.cookie || "");
  const token = parsed[SESSION_COOKIE];
  if (token) db.deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const user = getUserFromCookieHeader(req.headers.cookie);
  res.json(user ? { authenticated: true, email: user.email } : { authenticated: false });
});

module.exports = { router, requireAuth, getUserFromCookieHeader, SESSION_COOKIE };
