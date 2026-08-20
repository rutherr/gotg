// server/authUi.test.js
// jsdom regression test for the main page's account header (email display +
// Log Out) now that login itself lives on its own page (public/login.html +
// public/js/login.js, covered by server/loginPage.test.js). This loads the
// real index.html + game.js + auth.js, stubs socket.io and fetch, and
// drives the flow a logged-in visitor's browser takes -- plus the fallback
// redirect for a session that turns out to be invalid after all.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

let passed = 0, failed = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? passed++ : failed++;
}

function loadPage(fetchImpl) {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", resources: "usable" });
  const { window } = dom;
  window.io = () => ({ on: () => {}, emit: () => {}, disconnect: () => {}, connect: () => {} });
  window.localStorage.clear();
  window.fetch = fetchImpl;
  const gameJs = fs.readFileSync(path.join(__dirname, "../public/js/game.js"), "utf8");
  dom.window.eval(gameJs);
  const authJs = fs.readFileSync(path.join(__dirname, "../public/js/auth.js"), "utf8");
  dom.window.eval(authJs);
  return dom;
}

async function run() {
  // --- Case 1: a logged-in visitor loads the page ---
  const fetchCalls = [];
  const dom = loadPage(async (url) => {
    fetchCalls.push(url);
    if (url === "/auth/me") return { json: async () => ({ authenticated: true, email: "test@example.com" }) };
    if (url === "/auth/logout") return { json: async () => ({ ok: true }) };
    throw new Error("unexpected fetch " + url);
  });
  const { window } = dom;
  await new Promise((r) => setTimeout(r, 20));

  check("no login modal exists on this page anymore", window.document.getElementById("loginModal") === null);
  check("no login button exists on this page anymore", window.document.getElementById("loginBtn") === null);
  check("/auth/me was checked on page load", fetchCalls.includes("/auth/me"));
  check("header shows the logged-in email", window.document.getElementById("authEmail").textContent === "test@example.com");
  check("email label is no longer hidden", !window.document.getElementById("authEmail").classList.contains("hidden"));
  check("Log Out button is visible", !window.document.getElementById("logoutBtn").classList.contains("hidden"));
  check("Find Match is enabled once the session is confirmed", window.document.getElementById("findMatchBtn").disabled === false);

  window.document.getElementById("logoutBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check("logging out calls /auth/logout", fetchCalls.includes("/auth/logout"));

  // --- Case 2: the session turns out to be invalid (e.g. cookie expired
  // while the tab was open) -- should fall back to the login page rather
  // than leave a broken logged-out-looking game page up. jsdom doesn't
  // implement real cross-page navigation (window.location is read-only in
  // this jsdom version), so this checks the redirect branch ran -- the
  // UI was never switched into its "authenticated" state -- rather than
  // asserting the literal navigation target.
  const dom2 = loadPage(async (url) => {
    if (url === "/auth/me") return { json: async () => ({ authenticated: false }) };
    throw new Error("unexpected fetch " + url);
  });
  const win2 = dom2.window;
  await new Promise((r) => setTimeout(r, 20));
  check(
    "an invalid session never shows the authenticated header (redirect branch ran instead)",
    win2.document.getElementById("authEmail").classList.contains("hidden") &&
      win2.document.getElementById("findMatchBtn").disabled === true
  );

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
