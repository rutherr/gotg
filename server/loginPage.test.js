// server/loginPage.test.js
// jsdom regression test for the standalone login page (public/login.html +
// public/js/login.js) that replaced the old in-page modal. Drives the same
// email -> code -> verify flow the modal used to, on its own page, plus the
// "use a different email" and client-side validation paths that are new
// here. Same reasoning as setupTray.test.js/authUi.test.js: this is exactly
// the class of bug (a render step never wired to the right event) that a
// jsdom-level test catches and a code read misses.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let passed = 0, failed = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

async function run() {
  const html = fs.readFileSync(path.join(__dirname, "../public/login.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/login.html", runScripts: "outside-only", resources: "usable" });
  const { window } = dom;
  window.localStorage.clear();

  const fetchCalls = [];
  window.fetch = async (url) => {
    fetchCalls.push(url);
    if (url === "/auth/me") return { json: async () => ({ authenticated: false }) };
    if (url === "/auth/request-otp") return { json: async () => ({ ok: true }) };
    if (url === "/auth/verify-otp") return { json: async () => ({ ok: true, email: "test@example.com" }) };
    throw new Error("unexpected fetch " + url);
  };

  const loginJs = fs.readFileSync(path.join(__dirname, "../public/js/login.js"), "utf8");
  dom.window.eval(loginJs);
  await new Promise((r) => setTimeout(r, 20));

  check("/auth/me was checked on load (already-logged-in guard)", fetchCalls.includes("/auth/me"));
  check("step 1 (email) is shown initially", !window.document.getElementById("loginStep1").classList.contains("hidden"));
  check("step 2 (code) starts hidden", window.document.getElementById("loginStep2").classList.contains("hidden"));

  window.document.getElementById("loginEmail").value = "test@example.com";
  window.document.getElementById("sendCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));

  check("/auth/request-otp was called", fetchCalls.includes("/auth/request-otp"));
  check("step 2 (code entry) shown after requesting a code", !window.document.getElementById("loginStep2").classList.contains("hidden"));
  check("step 1 hides once code was sent", window.document.getElementById("loginStep1").classList.contains("hidden"));
  check("confirmation shows the email the code was sent to", window.document.getElementById("loginEmailConfirm").textContent === "test@example.com");
  check("resend button starts on cooldown", window.document.getElementById("resendCodeBtn").disabled === true);

  window.document.getElementById("backToEmailBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  check("'use a different email' returns to step 1", !window.document.getElementById("loginStep1").classList.contains("hidden"));
  check("...and hides step 2 again", window.document.getElementById("loginStep2").classList.contains("hidden"));

  // Get back into step 2 to test the verify step.
  window.document.getElementById("sendCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));

  window.document.getElementById("loginCode").value = "bad";
  window.document.getElementById("verifyCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("a malformed code is rejected client-side without hitting the server", !fetchCalls.includes("/auth/verify-otp"));
  check("a client-side validation error is shown", !window.document.getElementById("loginError").classList.contains("hidden"));

  window.document.getElementById("loginCode").value = "123456";
  window.document.getElementById("verifyCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("/auth/verify-otp was called with a well-formed code", fetchCalls.includes("/auth/verify-otp"));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
