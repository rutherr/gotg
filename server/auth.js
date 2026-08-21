// server/auth.js
// Account auth: email+password (create account / log in) and Google
// Sign-In, plus a password-reset flow that reuses the existing OTP
// infrastructure (server/otp.js) as reset codes. Session id lives in an
// httpOnly cookie so client JS never touches (and can't leak) the raw
// token -- same session model as before, only how a session gets created
// has changed.
const express = require("express");
const cookie = require("cookie");
const db = require("./db");
const { sendPasswordResetEmail } = require("./mailer");
const { verifyGoogleIdToken, GOOGLE_CLIENT_ID } = require("./googleAuth");
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
const { hashPassword, verifyPassword, isPasswordValid, MIN_PASSWORD_LENGTH } = require("./password");

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

// Logs the user in: creates a session, sets the cookie, and shapes the
// standard success response. Every route below that ends in "the visitor
// is now logged in" (signup, login, google, reset-password) funnels
// through this so the cookie options and response shape can't drift apart.
function logInAs(res, user) {
  const token = db.createSession(user.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ ok: true, email: user.email });
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

// login.html/login.js are static files (no server-side templating in this
// app), so the Google Client ID -- needed client-side to render the
// "Sign in with Google" button -- gets fetched at runtime instead of being
// baked into the HTML. It's not a secret (it's meant to be public; Google's
// own docs embed it directly in client-side script tags), so exposing it
// via an unauthenticated GET is fine.
router.get("/config", (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

// --- Create account (email + password) ---
router.post("/signup", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isEmailValid(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email address" });
  }
  if (!isPasswordValid(password)) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ ok: false, error: "An account with this email already exists" });
  }

  const user = db.createUserWithPassword(email, hashPassword(password));
  logInAs(res, user);
});

// --- Log in (email + password) ---
router.post("/login", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isEmailValid(email) || !password) {
    return res.status(400).json({ ok: false, error: "Email and password are required" });
  }

  const user = db.getUserByEmail(email);
  // Same generic message whether the email doesn't exist or the password
  // is wrong -- don't let this endpoint be used to enumerate accounts.
  const genericError = { ok: false, error: "Incorrect email or password" };
  if (!user) return res.status(400).json(genericError);

  if (!user.password_hash) {
    // A real, useful distinction (not an enumeration risk -- "sign in with
    // Google instead" is standard UX, e.g. Gmail does the same thing) for
    // an account that was created via Google and never set a password.
    return res.status(400).json({ ok: false, error: "This account uses Google Sign-In — use the Google button below" });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(400).json(genericError);
  }

  logInAs(res, user);
});

// --- Google Sign-In ---
// body: { credential } -- the ID token from Google Identity Services
// (see public/js/login.js's google button callback).
router.post("/google", async (req, res) => {
  const credential = req.body?.credential;
  let profile;
  try {
    profile = await verifyGoogleIdToken(credential);
  } catch (err) {
    console.error("[auth] Google credential verification failed:", err.message);
    return res.status(400).json({ ok: false, error: "Google sign-in failed — try again" });
  }

  let user = db.getUserByGoogleId(profile.googleId);
  if (!user) {
    const existingByEmail = db.getUserByEmail(profile.email);
    if (existingByEmail) {
      // Same email already has a password account -- link Google to it
      // rather than erroring, so someone who signed up with a password
      // can also use "Continue with Google" afterward without confusion.
      user = db.linkGoogleToUser(existingByEmail.id, profile.googleId);
    } else {
      user = db.createUserWithGoogle(profile.email, profile.googleId, profile.name);
    }
  }

  logInAs(res, user);
});

// --- Forgot password: request a reset code ---
router.post("/request-password-reset", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isEmailValid(email)) {
    return res.status(400).json({ ok: false, error: "Enter a valid email address" });
  }

  const user = db.getUserByEmail(email);
  const existingCode = db.getOtp(email);
  if (existingCode && Date.now() - existingCode.last_sent_at < RESEND_COOLDOWN_MS) {
    const waitMs = RESEND_COOLDOWN_MS - (Date.now() - existingCode.last_sent_at);
    return res.status(429).json({ ok: false, error: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another code` });
  }

  // Always respond ok (even if no account exists) so this endpoint can't be
  // used to enumerate registered emails -- but only actually generate/send
  // a code when there's a real account behind it.
  if (!user) return res.json({ ok: true });

  const code = generateOtp();
  db.saveOtp(email, hashOtp(code), Date.now() + OTP_TTL_MS);

  try {
    await sendPasswordResetEmail(email, code);
  } catch {
    return res.status(502).json({ ok: false, error: "Could not send the code. Try again shortly." });
  }

  res.json({ ok: true });
});

// --- Forgot password: consume the code and set a new password ---
router.post("/reset-password", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  const newPassword = String(req.body?.newPassword || "");

  if (!isEmailValid(email) || !code) {
    return res.status(400).json({ ok: false, error: "Email and code are required" });
  }
  if (!isPasswordValid(newPassword)) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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

  const user = db.getUserByEmail(email);
  if (!user) {
    // Account must have existed when the code was requested (request-password-reset
    // won't send a code otherwise) -- this would only happen if it were deleted
    // in between, which nothing in this app currently does. Handled defensively.
    db.clearOtp(email);
    return res.status(400).json({ ok: false, error: "Request a new code first" });
  }

  db.clearOtp(email);
  db.setUserPassword(user.id, hashPassword(newPassword));
  // A password reset should invalidate any other sessions that were left
  // logged in (e.g. on a device that had access to the old password).
  db.deleteAllSessionsForUser(user.id);

  logInAs(res, user);
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
