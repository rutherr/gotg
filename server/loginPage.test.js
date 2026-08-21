// server/loginPage.test.js
// jsdom regression test for the standalone login page (public/login.html +
// public/js/login.js): tabbed log in / create account, the forgot-password
// flow, and the /auth/config fetch that gates the Google button. Same
// reasoning as setupTray.test.js/authUi.test.js: this is exactly the class
// of bug (a render step never wired to the right event, or a top-level
// const colliding across sibling <script> tags) that a jsdom-level test
// catches and a code read misses.
//
// window.google is intentionally never defined here (runScripts:
// "outside-only" means the real accounts.google.com/gsi/client tag never
// executes) -- this doubles as coverage that login.js degrades to the
// fallback button instead of throwing when Google's script hasn't loaded.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let passed = 0, failed = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

function loadPage(fetchImpl) {
  const html = fs.readFileSync(path.join(__dirname, "../public/login.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/login.html", runScripts: "outside-only", resources: "usable" });
  const { window } = dom;
  window.localStorage.clear();
  window.fetch = fetchImpl;
  const loginJs = fs.readFileSync(path.join(__dirname, "../public/js/login.js"), "utf8");
  dom.window.eval(loginJs);
  return dom;
}

async function run() {
  const fetchCalls = [];
  const dom = loadPage(async (url) => {
    fetchCalls.push(url);
    if (url === "/auth/me") return { json: async () => ({ authenticated: false }) };
    if (url === "/auth/config") return { json: async () => ({ googleClientId: "test-client-id.apps.googleusercontent.com" }) };
    if (url === "/auth/login") return { json: async () => ({ ok: true, email: "test@example.com" }) };
    if (url === "/auth/signup") return { json: async () => ({ ok: true, email: "new@example.com" }) };
    if (url === "/auth/request-password-reset") return { json: async () => ({ ok: true }) };
    if (url === "/auth/reset-password") return { json: async () => ({ ok: true, email: "test@example.com" }) };
    throw new Error("unexpected fetch " + url);
  });
  const { window } = dom;
  await new Promise((r) => setTimeout(r, 20));

  check("/auth/me was checked on load (already-logged-in guard)", fetchCalls.includes("/auth/me"));
  check("/auth/config was fetched to decide whether to show the Google button", fetchCalls.includes("/auth/config"));
  check("window.google being undefined falls back to the visible Google button instead of throwing",
    !window.document.getElementById("googleFallbackBtn").classList.contains("hidden"));

  // --- Log In is the default tab ---
  check("Log In pane is shown initially", !window.document.getElementById("loginPane").classList.contains("hidden"));
  check("Create Account pane starts hidden", window.document.getElementById("signupPane").classList.contains("hidden"));
  check("Log In tab starts active", window.document.getElementById("tabLogin").classList.contains("auth-tab-active"));

  // --- Switching to the Create Account tab ---
  window.document.getElementById("tabSignup").dispatchEvent(new window.Event("click", { bubbles: true }));
  check("Create Account pane shows after clicking its tab", !window.document.getElementById("signupPane").classList.contains("hidden"));
  check("Log In pane hides once Create Account is active", window.document.getElementById("loginPane").classList.contains("hidden"));
  check("Create Account tab becomes active", window.document.getElementById("tabSignup").classList.contains("auth-tab-active"));

  // --- Signup validation: mismatched passwords never hit the server ---
  window.document.getElementById("signupEmail").value = "new@example.com";
  window.document.getElementById("signupPassword").value = "longenoughpassword";
  window.document.getElementById("signupPasswordConfirm").value = "different";
  window.document.getElementById("signupForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("mismatched passwords are rejected client-side without hitting the server", !fetchCalls.includes("/auth/signup"));
  check("a client-side validation error is shown", !window.document.getElementById("authError").classList.contains("hidden"));

  // --- Signup success path ---
  window.document.getElementById("signupPasswordConfirm").value = "longenoughpassword";
  window.document.getElementById("signupForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("/auth/signup was called once passwords match", fetchCalls.includes("/auth/signup"));

  // --- Back to Log In tab, submit credentials ---
  window.document.getElementById("tabLogin").dispatchEvent(new window.Event("click", { bubbles: true }));
  window.document.getElementById("loginEmail").value = "test@example.com";
  window.document.getElementById("loginPassword").value = "hunter22";
  window.document.getElementById("loginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("/auth/login was called with the entered credentials", fetchCalls.includes("/auth/login"));

  // --- Forgot password flow ---
  window.document.getElementById("forgotPasswordLink").dispatchEvent(new window.Event("click", { bubbles: true }));
  check("forgot-password step 1 shows after clicking the link", !window.document.getElementById("forgotStep1Pane").classList.contains("hidden"));
  check("email typed into the login form carries over to the forgot-password field",
    window.document.getElementById("forgotEmail").value === "test@example.com");

  window.document.getElementById("sendResetCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("/auth/request-password-reset was called", fetchCalls.includes("/auth/request-password-reset"));
  check("forgot-password step 2 shows after requesting a code", !window.document.getElementById("forgotStep2Pane").classList.contains("hidden"));
  check("resend button starts on cooldown", window.document.getElementById("resendResetCodeBtn").disabled === true);

  window.document.getElementById("resetCode").value = "bad";
  window.document.getElementById("resetPasswordBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("a malformed reset code is rejected client-side without hitting the server", !fetchCalls.includes("/auth/reset-password"));

  window.document.getElementById("resetCode").value = "123456";
  window.document.getElementById("newPassword").value = "brandnewpassword";
  window.document.getElementById("resetPasswordBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("/auth/reset-password was called with a well-formed code and new password", fetchCalls.includes("/auth/reset-password"));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
