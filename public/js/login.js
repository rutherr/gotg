// public/js/login.js
// Standalone login page: create account / log in (email+password) / Google
// Sign-In / forgot-password, all funneling into a session cookie + full
// navigation into the game. Deliberately has zero dependency on socket.io
// or game.js -- a logged-out visitor should never have to load the game
// bundle at all -- and this file stays independently testable via jsdom
// (see server/loginPage.test.js), same reasoning as the game.js/auth.js
// split.

// --- Element refs ---
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginPane = document.getElementById("loginPane");
const signupPane = document.getElementById("signupPane");
const forgotStep1Pane = document.getElementById("forgotStep1Pane");
const forgotStep2Pane = document.getElementById("forgotStep2Pane");

const loginForm = document.getElementById("loginForm");
const loginEmailInput = document.getElementById("loginEmail");
const loginPasswordInput = document.getElementById("loginPassword");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

const signupForm = document.getElementById("signupForm");
const signupEmailInput = document.getElementById("signupEmail");
const signupPasswordInput = document.getElementById("signupPassword");
const signupPasswordConfirmInput = document.getElementById("signupPasswordConfirm");
const signupSubmitBtn = document.getElementById("signupSubmitBtn");

const forgotEmailInput = document.getElementById("forgotEmail");
const forgotEmailConfirm = document.getElementById("forgotEmailConfirm");
const sendResetCodeBtn = document.getElementById("sendResetCodeBtn");
const backToLoginFromForgotBtn = document.getElementById("backToLoginFromForgotBtn");

const resetCodeInput = document.getElementById("resetCode");
const newPasswordInput = document.getElementById("newPassword");
const resetPasswordBtn = document.getElementById("resetPasswordBtn");
const resendResetCodeBtn = document.getElementById("resendResetCodeBtn");
const backToLoginFromResetBtn = document.getElementById("backToLoginFromResetBtn");

const googleBtnContainer = document.getElementById("googleBtnContainer");
const googleFallbackBtn = document.getElementById("googleFallbackBtn");

const authErrorEl = document.getElementById("authError");
const authSuccessEl = document.getElementById("authSuccess");

const RESEND_COOLDOWN_SECONDS = 30;
const MIN_PASSWORD_LENGTH = 8;
let resendCooldownInterval = null;
let pendingResetEmail = null;

// --- Shared error/success messaging ---
function showAuthError(msg) {
  authSuccessEl.classList.add("hidden");
  authErrorEl.textContent = msg;
  authErrorEl.classList.remove("hidden");
}
function showAuthSuccess(msg) {
  authErrorEl.classList.add("hidden");
  authSuccessEl.textContent = msg;
  authSuccessEl.classList.remove("hidden");
}
function clearAuthMessages() {
  authErrorEl.classList.add("hidden");
  authErrorEl.textContent = "";
  authSuccessEl.classList.add("hidden");
  authSuccessEl.textContent = "";
}

// --- Pane switching ---
const ALL_PANES = [loginPane, signupPane, forgotStep1Pane, forgotStep2Pane];
function showPane(pane) {
  clearInterval(resendCooldownInterval);
  clearAuthMessages();
  for (const p of ALL_PANES) p.classList.add("hidden");
  pane.classList.remove("hidden");
}

function setActiveTab(tab) {
  tabLogin.classList.toggle("auth-tab-active", tab === "login");
  tabLogin.setAttribute("aria-selected", tab === "login" ? "true" : "false");
  tabSignup.classList.toggle("auth-tab-active", tab === "signup");
  tabSignup.setAttribute("aria-selected", tab === "signup" ? "true" : "false");
}

tabLogin.addEventListener("click", () => {
  setActiveTab("login");
  showPane(loginPane);
});
tabSignup.addEventListener("click", () => {
  setActiveTab("signup");
  showPane(signupPane);
});

forgotPasswordLink.addEventListener("click", () => {
  forgotEmailInput.value = loginEmailInput.value.trim();
  showPane(forgotStep1Pane);
});
backToLoginFromForgotBtn.addEventListener("click", () => {
  setActiveTab("login");
  showPane(loginPane);
});
backToLoginFromResetBtn.addEventListener("click", () => {
  setActiveTab("login");
  showPane(loginPane);
});

// --- Log in (email + password) ---
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthMessages();
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  if (!email) return showAuthError("Enter your email address");
  if (!password) return showAuthError("Enter your password");

  loginSubmitBtn.disabled = true;
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.ok) return showAuthError(data.error || "Could not log in");
    // Full navigation (not a fetch-driven UI swap) so the game page's
    // socket connects fresh with the just-set session cookie in its
    // handshake -- see the reconnectSocket comment that used to live in
    // auth.js before login moved to its own page.
    window.location.href = "/";
  } catch (err) {
    showAuthError("Network error — try again");
  } finally {
    loginSubmitBtn.disabled = false;
  }
});

// --- Create account (email + password) ---
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthMessages();
  const email = signupEmailInput.value.trim();
  const password = signupPasswordInput.value;
  const confirm = signupPasswordConfirmInput.value;

  if (!email) return showAuthError("Enter your email address");
  if (password.length < MIN_PASSWORD_LENGTH) return showAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password !== confirm) return showAuthError("Passwords don't match");

  signupSubmitBtn.disabled = true;
  try {
    const res = await fetch("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.ok) return showAuthError(data.error || "Could not create account");
    window.location.href = "/";
  } catch (err) {
    showAuthError("Network error — try again");
  } finally {
    signupSubmitBtn.disabled = false;
  }
});

// --- Forgot password: step 1, request a code ---
function startResendCooldown(button) {
  let secondsLeft = RESEND_COOLDOWN_SECONDS;
  button.disabled = true;
  const label = button === sendResetCodeBtn ? "Send Reset Code" : "Resend code";
  button.textContent = `${label} (${secondsLeft}s)`;
  clearInterval(resendCooldownInterval);
  resendCooldownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(resendCooldownInterval);
      button.disabled = false;
      button.textContent = label;
    } else {
      button.textContent = `${label} (${secondsLeft}s)`;
    }
  }, 1000);
}

async function requestResetCode(email) {
  clearAuthMessages();
  try {
    const res = await fetch("/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!data.ok) {
      showAuthError(data.error || "Could not send reset code");
      return false;
    }
    pendingResetEmail = email;
    forgotEmailConfirm.textContent = email;
    resetCodeInput.value = "";
    newPasswordInput.value = "";
    showPane(forgotStep2Pane);
    startResendCooldown(resendResetCodeBtn);
    return true;
  } catch (err) {
    showAuthError("Network error — try again");
    return false;
  }
}

sendResetCodeBtn.addEventListener("click", () => {
  const email = forgotEmailInput.value.trim();
  if (!email) return showAuthError("Enter your email address");
  sendResetCodeBtn.disabled = true;
  requestResetCode(email).finally(() => { sendResetCodeBtn.disabled = false; });
});

resendResetCodeBtn.addEventListener("click", () => {
  if (resendResetCodeBtn.disabled || !pendingResetEmail) return;
  requestResetCode(pendingResetEmail);
});

// --- Forgot password: step 2, submit code + new password ---
resetPasswordBtn.addEventListener("click", async () => {
  clearAuthMessages();
  const code = resetCodeInput.value.trim();
  const newPassword = newPasswordInput.value;
  if (!pendingResetEmail) return;
  if (!/^\d{6}$/.test(code)) return showAuthError("Enter the 6-digit code");
  if (newPassword.length < MIN_PASSWORD_LENGTH) return showAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

  resetPasswordBtn.disabled = true;
  try {
    const res = await fetch("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: pendingResetEmail, code, newPassword }),
    });
    const data = await res.json();
    if (!data.ok) {
      showAuthError(data.error || "Could not reset password");
      return;
    }
    window.location.href = "/";
  } catch (err) {
    showAuthError("Network error — try again");
  } finally {
    resetPasswordBtn.disabled = false;
  }
});

// --- Google Sign-In ---
// Sends the ID token straight to the server for verification -- this file
// never inspects the token's contents itself (see server/googleAuth.js for
// why that matters: the client can't be trusted to self-report who it is).
async function handleGoogleCredential(response) {
  clearAuthMessages();
  try {
    const res = await fetch("/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!data.ok) return showAuthError(data.error || "Google sign-in failed");
    window.location.href = "/";
  } catch (err) {
    showAuthError("Network error — try again");
  }
}
// Exposed on window so the Google Identity Services callback (configured
// below with a string reference in some GIS versions) and manual testing
// can both reach it.
window.handleGoogleCredential = handleGoogleCredential;

async function initGoogleSignIn() {
  try {
    const res = await fetch("/auth/config", { credentials: "same-origin" });
    const data = await res.json();
    if (!data.googleClientId) return; // not configured server-side -- leave the button area empty

    // window.google is only present once https://accounts.google.com/gsi/client
    // has actually loaded (it won't in the jsdom test environment, and
    // might not yet on a slow connection) -- degrade to a disabled-looking
    // fallback rather than throwing.
    if (typeof window.google === "undefined" || !window.google.accounts?.id) {
      googleFallbackBtn.classList.remove("hidden");
      googleFallbackBtn.addEventListener("click", () => showAuthError("Google Sign-In is still loading — try again in a moment"));
      return;
    }

    window.google.accounts.id.initialize({
      client_id: data.googleClientId,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(googleBtnContainer, {
      theme: "outline",
      size: "large",
      shape: "pill",
      width: 320,
      text: "continue_with",
    });
  } catch (err) {
    // Google Sign-In being unavailable shouldn't block email+password auth.
    console.error("Could not initialize Google Sign-In:", err);
  }
}

// If an already-logged-in visitor lands here (bookmarked link, back button,
// bfcache), send them straight to the game instead of making them log in
// again. This is a convenience only -- server.js's requireGuestPage is the
// actual gate and already redirects server-side before this page is ever
// served to a logged-in visitor in the normal case.
(async function redirectIfAlreadyLoggedIn() {
  try {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    if (data.authenticated) window.location.href = "/";
  } catch (err) {
    // If the check fails, just let them log in manually.
  }
})();

initGoogleSignIn();
