// public/js/auth.js
// Loaded after game.js. Reads window.socket / window.findBtn, which
// game.js attaches explicitly to `window` for exactly this reason (see the
// comment at the top of game.js).
//
// Login itself now lives on its own page (public/login.html + login.js).
// server.js's requireAuthPage guard means this page is only ever served to
// a logged-in visitor -- but a session cookie can still expire or get
// cleared while the tab stays open, so refreshAuthState() below still
// checks with the server on load and bounces to /login.html rather than
// trusting a stale page.
const socket = window.socket;
const findBtn = window.findBtn;
const authEmailEl = document.getElementById("authEmail");
const logoutBtn = document.getElementById("logoutBtn");

function setAuthUI(email) {
  authEmailEl.textContent = email || "";
  authEmailEl.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  findBtn.disabled = false;
  findBtn.title = "";
}

async function refreshAuthState() {
  try {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = "/login.html";
      return;
    }
    setAuthUI(data.email);
  } catch (err) {
    console.error("Could not check login state:", err);
  }
}

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (err) {
    console.error("Logout request failed:", err);
  }
  // Full navigation, not a UI swap -- there's nothing useful left to show
  // on this page once logged out, and login.html needs a fresh load anyway.
  window.location.href = "/login.html";
});

refreshAuthState();
