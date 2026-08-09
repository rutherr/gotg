// server/authUi.test.js
// jsdom regression test for the login-modal UI flow (email -> OTP code ->
// logged-in state). Loads the real index.html + game.js + auth.js, stubs
// socket.io and fetch, and drives the exact click sequence a real user
// would. This exists because the class of bug this project cares about
// most -- a render/update function that's wired to the wrong (or no)
// event -- is exactly what a DOM-level test catches and a code read misses.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let passed = 0, failed = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

async function run() {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", resources: "usable" });
  const { window } = dom;

  window.io = () => ({ on: () => {}, emit: () => {}, disconnect: () => {}, connect: () => {} });
  window.localStorage.clear();

  const fetchCalls = [];
  window.fetch = async (url, opts) => {
    fetchCalls.push(url);
    if (url === "/auth/me") return { json: async () => ({ authenticated: false }) };
    if (url === "/auth/request-otp") return { json: async () => ({ ok: true }) };
    if (url === "/auth/verify-otp") return { json: async () => ({ ok: true, email: "test@example.com" }) };
    throw new Error("unexpected fetch " + url);
  };

  const gameJs = fs.readFileSync(path.join(__dirname, "../public/js/game.js"), "utf8");
  dom.window.eval(gameJs);
  const authJs = fs.readFileSync(path.join(__dirname, "../public/js/auth.js"), "utf8");
  dom.window.eval(authJs);

  await new Promise((r) => setTimeout(r, 20));

  const findBtn = window.document.getElementById("findMatchBtn");
  const loginModal = window.document.getElementById("loginModal");

  check("Find Match starts disabled when logged out", findBtn.disabled === true);
  check("/auth/me was checked on page load", fetchCalls.includes("/auth/me"));

  window.document.getElementById("loginBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  check("login modal opens on Log In click", !loginModal.classList.contains("hidden"));

  window.document.getElementById("loginEmail").value = "test@example.com";
  window.document.getElementById("sendCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("step 2 (code entry) shown after requesting a code", !window.document.getElementById("loginStep2").classList.contains("hidden"));
  check("/auth/request-otp was called", fetchCalls.includes("/auth/request-otp"));

  window.document.getElementById("loginCode").value = "123456";
  window.document.getElementById("verifyCodeBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));

  check("/auth/verify-otp was called", fetchCalls.includes("/auth/verify-otp"));
  check("modal closes after a successful verify", loginModal.classList.contains("hidden"));
  check("Find Match is enabled after login", findBtn.disabled === false);
  check("header shows the logged-in email", window.document.getElementById("authEmail").textContent === "test@example.com");
  check("Log Out button is now visible", !window.document.getElementById("logoutBtn").classList.contains("hidden"));
  check("Log In button is now hidden", window.document.getElementById("loginBtn").classList.contains("hidden"));

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
