// server/effects.test.js
// jsdom regression test for public/js/effects.js: combat-reveal flash on
// the board + background music toggle + SFX dispatch. Stubs
// HTMLMediaElement.play/pause (jsdom doesn't implement real media
// playback) so playback attempts can be counted, and drives the actual
// socket events game.js already listens for -- same DOM-level approach as
// setupTray.test.js/authUi.test.js.
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

  let playCalls = 0;
  window.HTMLMediaElement.prototype.play = function () {
    playCalls++;
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {};

  const socketHandlers = {};
  window.io = () => ({
    on: (event, cb) => { (socketHandlers[event] = socketHandlers[event] || []).push(cb); },
    emit: () => {},
    disconnect: () => {},
    connect: () => {},
  });
  window.localStorage.clear();

  const gameJs = fs.readFileSync(path.join(__dirname, "../public/js/game.js"), "utf8");
  dom.window.eval(gameJs);
  const effectsJs = fs.readFileSync(path.join(__dirname, "../public/js/effects.js"), "utf8");
  dom.window.eval(effectsJs);

  function emit(event, payload) {
    (socketHandlers[event] || []).forEach((cb) => cb(payload));
  }

  // game.js builds an empty 8x9 board immediately on load (before any match
  // exists) so there's already a real cell at every (row, col) -- just grab
  // the one we're about to flash instead of creating a duplicate.
  const cell = window.document.querySelector('[data-row="3"][data-col="4"]');

  emit("challengeResult", { attacker: "spy", defender: "private", outcome: "attackerWins", row: 3, col: 4 });
  check("combat flash class is applied to the target cell", cell.classList.contains("cell-combat-flash"));
  check("an SFX play was attempted for the outcome", playCalls === 1);

  emit("challengeResult", { attacker: "private", defender: "private", outcome: "bothEliminated", row: 3, col: 4 });
  check("re-flashing the same cell plays another SFX", playCalls === 2);

  emit("gameOver", { winner: "red" });
  check("a game-over SFX was attempted", playCalls === 3);

  // --- Music toggle ---
  const musicBtn = window.document.getElementById("musicToggleBtn");
  check("music starts off with no saved preference", musicBtn.getAttribute("aria-pressed") === "false");

  musicBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("clicking the music toggle turns it on", musicBtn.getAttribute("aria-pressed") === "true");
  check("turning music on attempts playback", playCalls === 4);
  check("the preference is saved", window.localStorage.getItem("gog_music") === "on");

  musicBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("clicking again turns it back off", musicBtn.getAttribute("aria-pressed") === "false");
  check("the preference is saved as off", window.localStorage.getItem("gog_music") === "off");

  // --- A malformed event must not break the page ---
  let threw = false;
  try {
    emit("challengeResult", { attacker: "spy", defender: "flag", outcome: "gameWonByAttacker" }); // no row/col
  } catch (err) {
    threw = true;
  }
  check("a challengeResult with no row/col does not throw", !threw);

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
