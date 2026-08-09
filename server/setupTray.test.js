// server/setupTray.test.js
// Lightweight DOM regression test for the setup-tray rendering bug.
// Loads the real index.html + game.js into jsdom, stubs socket.io,
// and drives the exact event sequence the server sends, to confirm
// the tray populates without requiring a prior cell click.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

async function run() {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "outside-only",
    resources: "usable",
  });
  const { window } = dom;

  // Stub the io() global before game.js runs (socket.io client isn't loaded in jsdom)
  const handlers = {};
  window.io = () => ({
    on: (event, cb) => { handlers[event] = cb; },
    emit: () => {},
  });
  window.localStorage.clear();

  const gameJs = fs.readFileSync(path.join(__dirname, "../public/js/game.js"), "utf8");
  dom.window.eval(gameJs);

  // --- Test 1: "matched" arrives with phase already "setup" (second player's real flow) ---
  handlers["matched"]({ team: "blue", token: "t1", roomId: "room_test", phase: "setup" });
  let trayButtons = window.document.getElementById("tray").children.length;
  console.log(`After 'matched' (phase=setup): tray buttons = ${trayButtons} (expected 15)`);
  if (trayButtons !== 15) {
    console.error("FAIL: tray did not render on matched event with setup phase");
    process.exit(1);
  }

  // --- Test 2: subsequent boardUpdate during setup keeps tray populated ---
  handlers["boardUpdate"]({ phase: "setup", turn: null, turnDeadline: null, board: {} });
  trayButtons = window.document.getElementById("tray").children.length;
  console.log(`After 'boardUpdate' (phase=setup): tray buttons = ${trayButtons} (expected 15)`);
  if (trayButtons !== 15) {
    console.error("FAIL: tray did not render on boardUpdate with setup phase");
    process.exit(1);
  }

  // --- Test 3: select a tray piece, then click a legal board cell -> piece appears ---
  const firstBtn = window.document.getElementById("tray").children[0];
  firstBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

  const zoneRow = 5; // blue zone rows are [5,6,7]
  const cell = window.document.querySelector(`[data-row="${zoneRow}"][data-col="0"]`);
  cell.dispatchEvent(new window.Event("click", { bubbles: true }));

  const placedImg = cell.querySelector("img");
  console.log(`After placing piece: cell has image = ${!!placedImg}`);
  if (!placedImg) {
    console.error("FAIL: clicking a tray piece then a board cell did not place a piece");
    process.exit(1);
  }

  console.log("PASS: setup tray renders on entry and full select->place flow works");

  // --- Test 4: tray buttons show piece images, not just text ---
  const trayImgs = window.document.getElementById("tray").querySelectorAll("img");
  console.log(`Tray buttons with images: ${trayImgs.length} (expected 15)`);
  if (trayImgs.length !== 15) {
    console.error("FAIL: tray buttons do not render piece images");
    process.exit(1);
  }

  // --- Test 5: theme toggle flips the dark class and persists to localStorage ---
  const wasDark = window.document.documentElement.classList.contains("dark");
  window.document.getElementById("themeToggleBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
  const isDarkNow = window.document.documentElement.classList.contains("dark");
  const stored = window.localStorage.getItem("gog_theme");
  console.log(`Theme toggled: ${wasDark} -> ${isDarkNow}, stored='${stored}'`);
  if (isDarkNow === wasDark || stored !== (isDarkNow ? "dark" : "light")) {
    console.error("FAIL: theme toggle did not flip class or persist correctly");
    process.exit(1);
  }

  // --- Test 6: captured pieces render into the casualties panel ---
  handlers["boardUpdate"]({
    phase: "playing",
    turn: "blue",
    turnDeadline: null,
    board: {},
    captured: { red: ["spy"], blue: ["private", "private"] },
  });
  const redCasualties = window.document.getElementById("casualtiesRed").querySelectorAll("img").length;
  const blueCasualties = window.document.getElementById("casualtiesBlue").querySelectorAll("img").length;
  console.log(`Casualties rendered: red=${redCasualties} (expected 1), blue=${blueCasualties} (expected 2)`);
  if (redCasualties !== 1 || blueCasualties !== 2) {
    console.error("FAIL: captured pieces did not render into the casualties panel");
    process.exit(1);
  }

  console.log("PASS: tray images, theme toggle, and casualties panel all work");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
