// public/js/auth.js
// Loaded after game.js. Reads window.socket / window.findBtn, which
// game.js attaches explicitly to `window` for exactly this reason (see the
// comment at the top of game.js).
const socket = window.socket;
const findBtn = window.findBtn;
const authArea = document.getElementById("authArea");
const authEmailEl = document.getElementById("authEmail");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginModal = document.getElementById("loginModal");
const loginStep1 = document.getElementById("loginStep1");
const loginStep2 = document.getElementById("loginStep2");
const loginEmailInput = document.getElementById("loginEmail");
const loginEmailConfirm = document.getElementById("loginEmailConfirm");
const loginCodeInput = document.getElementById("loginCode");
const sendCodeBtn = document.getElementById("sendCodeBtn");
const verifyCodeBtn = document.getElementById("verifyCodeBtn");
const resendCodeBtn = document.getElementById("resendCodeBtn");
const closeLoginModalBtn = document.getElementById("closeLoginModalBtn");
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

function openLoginModal() {
  clearLoginError();
  loginStep1.classList.remove("hidden");
  loginStep2.classList.add("hidden");
  loginEmailInput.value = "";
  loginCodeInput.value = "";
  loginModal.classList.remove("hidden");
  loginEmailInput.focus();
}
function closeLoginModal() {
  loginModal.classList.add("hidden");
  clearInterval(resendCooldownInterval);
}

function setAuthUI(authenticated, email) {
  authEmailEl.textContent = email || "";
  authEmailEl.classList.toggle("hidden", !authenticated);
  loginBtn.classList.toggle("hidden", authenticated);
  logoutBtn.classList.toggle("hidden", !authenticated);
  findBtn.disabled = !authenticated;
  findBtn.title = authenticated ? "" : "Log in first";
}

// After a login or logout, the socket's original handshake cookie is stale
// (it connected before the cookie existed, or the cookie just changed).
// Forcing a fresh connect re-sends the current Cookie header so the server
// re-derives socket.user correctly. Any in-progress match tied to the old
// socket id is handled by the server's existing disconnect/reconnect-grace
// logic -- same path a page reload already takes.
function reconnectSocket() {
  socket.disconnect();
  socket.connect();
}

async function refreshAuthState() {
  try {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    setAuthUI(data.authenticated, data.email);
  } catch (err) {
    console.error("Could not check login state:", err);
  }
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
    pendingEmail = email;
    loginEmailConfirm.textContent = email;
    loginStep1.classList.add("hidden");
    loginStep2.classList.remove("hidden");
    loginCodeInput.value = "";
    loginCodeInput.focus();
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
    closeLoginModal();
    setAuthUI(true, data.email);
    reconnectSocket();
  } catch (err) {
    showLoginError("Network error — try again");
  } finally {
    verifyCodeBtn.disabled = false;
  }
});

loginBtn.addEventListener("click", openLoginModal);
closeLoginModalBtn.addEventListener("click", closeLoginModal);
loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) closeLoginModal(); // click on the backdrop
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (err) {
    console.error("Logout request failed:", err);
  }
  setAuthUI(false, null);
  reconnectSocket();
});

refreshAuthState();
