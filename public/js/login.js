// public/js/login.js
// Standalone login page: email -> OTP code -> session cookie -> redirect
// into the game. Deliberately has zero dependency on socket.io or game.js
// -- a logged-out visitor should never have to load the game bundle at all,
// and this file should stay independently testable via jsdom (see
// server/loginPage.test.js), same reasoning as the game.js/auth.js split.
const loginStep1 = document.getElementById("loginStep1");
const loginStep2 = document.getElementById("loginStep2");
const loginEmailInput = document.getElementById("loginEmail");
const loginEmailConfirm = document.getElementById("loginEmailConfirm");
const loginCodeInput = document.getElementById("loginCode");
const sendCodeBtn = document.getElementById("sendCodeBtn");
const verifyCodeBtn = document.getElementById("verifyCodeBtn");
const resendCodeBtn = document.getElementById("resendCodeBtn");
const backToEmailBtn = document.getElementById("backToEmailBtn");
const loginErrorEl = document.getElementById("loginError");

const RESEND_COOLDOWN_SECONDS = 30;
let resendCooldownInterval = null;
let pendingEmail = null;

function showLoginError(msg) {
  loginErrorEl.textContent = msg;
  loginErrorEl.classList.remove("hidden");
}
function clearLoginError() {
  loginErrorEl.classList.add("hidden");
  loginErrorEl.textContent = "";
}

function showStep1() {
  clearInterval(resendCooldownInterval);
  loginStep2.classList.add("hidden");
  loginStep1.classList.remove("hidden");
  loginCodeInput.value = "";
  clearLoginError();
  loginEmailInput.focus();
}

function showStep2(email) {
  pendingEmail = email;
  loginEmailConfirm.textContent = email;
  loginStep1.classList.add("hidden");
  loginStep2.classList.remove("hidden");
  loginCodeInput.value = "";
  loginCodeInput.focus();
}

function startResendCooldown() {
  let secondsLeft = RESEND_COOLDOWN_SECONDS;
  resendCodeBtn.disabled = true;
  resendCodeBtn.textContent = `Resend code (${secondsLeft}s)`;
  clearInterval(resendCooldownInterval);
  resendCooldownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(resendCooldownInterval);
      resendCodeBtn.disabled = false;
      resendCodeBtn.textContent = "Resend code";
    } else {
      resendCodeBtn.textContent = `Resend code (${secondsLeft}s)`;
    }
  }, 1000);
}

async function requestCode(email) {
  clearLoginError();
  sendCodeBtn.disabled = true;
  try {
    const res = await fetch("/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!data.ok) {
      showLoginError(data.error || "Could not send code");
      return false;
    }
    showStep2(email);
    startResendCooldown();
    return true;
  } catch (err) {
    showLoginError("Network error — try again");
    return false;
  } finally {
    sendCodeBtn.disabled = false;
  }
}

sendCodeBtn.addEventListener("click", () => {
  const email = loginEmailInput.value.trim();
  if (!email) return showLoginError("Enter your email address");
  requestCode(email);
});

resendCodeBtn.addEventListener("click", () => {
  if (resendCodeBtn.disabled || !pendingEmail) return;
  requestCode(pendingEmail);
});

backToEmailBtn.addEventListener("click", showStep1);

verifyCodeBtn.addEventListener("click", async () => {
  const code = loginCodeInput.value.trim();
  if (!pendingEmail) return;
  if (!/^\d{6}$/.test(code)) return showLoginError("Enter the 6-digit code");
  clearLoginError();
  verifyCodeBtn.disabled = true;
  try {
    const res = await fetch("/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: pendingEmail, code }),
    });
    const data = await res.json();
    if (!data.ok) {
      showLoginError(data.error || "Incorrect code");
      return;
    }
    // Full navigation (not a fetch-driven UI swap) so the game page's
    // socket connects fresh with the just-set session cookie in its
    // handshake -- see the reconnectSocket comment that used to live in
    // auth.js before login moved to its own page.
    window.location.href = "/";
  } catch (err) {
    showLoginError("Network error — try again");
  } finally {
    verifyCodeBtn.disabled = false;
  }
});

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
