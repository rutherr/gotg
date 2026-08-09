// public/js/game.js
// socket and findBtn are attached to `window` explicitly (rather than left
// as bare `const`) so auth.js -- loaded as a separate <script> tag right
// after this one -- can reliably reference them. This also makes the two
// files independently testable via jsdom's `window.eval()`, which does NOT
// share block-scoped (let/const) top-level bindings across separate eval
// calls the way real sibling <script> tags share global lexical scope.
window.socket = io();
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const boardEl = document.getElementById("board");
const trayEl = document.getElementById("tray");
const logEl = document.getElementById("log");
window.findBtn = document.getElementById("findMatchBtn");
const submitBtn = document.getElementById("submitSetupBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const chatLogEl = document.getElementById("chatLog");
const chatFormEl = document.getElementById("chatForm");
const chatInputEl = document.getElementById("chatInput");
const emoteBarEl = document.getElementById("emoteBar");
const casualtiesRedEl = document.getElementById("casualtiesRed");
const casualtiesBlueEl = document.getElementById("casualtiesBlue");

const ROWS = 8, COLS = 9;
const PIECE_COUNTS = {
  gen5: 1, gen4: 1, gen3: 1, gen2: 1, gen1: 1,
  colonel: 1, ltcolonel: 1, major: 1, captain: 1,
  "1stlt": 1, "2ndlt": 1, sergeant: 1,
  private: 6, spy: 2, flag: 1,
};
const PIECE_LABELS = {
  gen5: "Gen5", gen4: "Gen4", gen3: "Gen3", gen2: "Gen2", gen1: "Gen1",
  colonel: "Colonel", ltcolonel: "Lt.Col", major: "Major", captain: "Captain",
  "1stlt": "1st Lt", "2ndlt": "2nd Lt", sergeant: "Sergeant",
  private: "Private", spy: "Spy", flag: "Flag",
};
const EMOTES = ["👍", "😅", "😤", "🤔", "😂", "🎯", "🔥", "🙏"];

let myTeam = null;
let myToken = null;
let myRoomId = null;
let phase = "waiting";
let lastBoardView = null;
let selectedCell = null;
let selectedTrayType = null;
let placements = {};
let countdownInterval = null;

function log(msg) {
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.prepend(line);
}

// --- Theme ---
function applyThemeIcon() {
  const isDark = document.documentElement.classList.contains("dark");
  themeIcon.textContent = isDark ? "🌙" : "☀️";
}
applyThemeIcon();
themeToggleBtn.addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("gog_theme", isDark ? "dark" : "light");
  applyThemeIcon();
});

function setupZoneRows() {
  return myTeam === "blue" ? [5, 6, 7] : [0, 1, 2];
}

function buildEmptyBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      const isLight = (r + c) % 2 === 0;
      cell.className = `board-cell ${isLight ? "board-cell-light" : "board-cell-dark"}`;
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener("click", () => onCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}
buildEmptyBoard();

function cellEl(r, c) {
  return boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`);
}

function saveSession() {
  localStorage.setItem("gog_session", JSON.stringify({ roomId: myRoomId, token: myToken }));
}
function tryResumeSession() {
  const raw = localStorage.getItem("gog_session");
  if (!raw) return false;
  try {
    const { roomId, token } = JSON.parse(raw);
    if (roomId && token) {
      socket.emit("rejoin", { roomId, token });
      return true;
    }
  } catch (_) {}
  return false;
}

function renderTray() {
  trayEl.innerHTML = "";
  const used = {};
  for (const type of Object.values(placements)) used[type] = (used[type] || 0) + 1;

  for (const [type, total] of Object.entries(PIECE_COUNTS)) {
    const remaining = total - (used[type] || 0);
    const btn = document.createElement("button");
    btn.className = `tray-btn ${selectedTrayType === type ? "tray-btn-selected" : ""} ${remaining === 0 ? "tray-btn-empty" : ""}`;
    btn.disabled = remaining === 0;

    const img = document.createElement("img");
    img.src = `assets/pieces/${myTeam}_${type}.svg`;
    img.className = "w-7 h-7";
    img.alt = type;
    btn.appendChild(img);

    const label = document.createElement("span");
    label.textContent = `${PIECE_LABELS[type] || type} (${remaining})`;
    label.className = "text-center leading-tight";
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      selectedTrayType = type;
      renderTray();
    });
    trayEl.appendChild(btn);
  }

  const totalPlaced = Object.keys(placements).length;
  const totalNeeded = Object.values(PIECE_COUNTS).reduce((a, b) => a + b, 0);
  submitBtn.disabled = totalPlaced !== totalNeeded;
  submitBtn.textContent = `Submit Setup (${totalPlaced}/${totalNeeded})`;
}

function renderSetupBoard() {
  const zone = setupZoneRows();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = cellEl(r, c);
      cell.innerHTML = "";
      const inZone = zone.includes(r);
      // The whole board stays evenly lit; we only add a subtle ring on your
      // own placeable squares instead of dimming the opponent's half.
      cell.classList.toggle("board-cell-inzone", inZone);
      const key = `${r},${c}`;
      if (placements[key]) {
        const img = document.createElement("img");
        img.src = `assets/pieces/${myTeam}_${placements[key]}.svg`;
        img.className = "w-11 h-11";
        cell.appendChild(img);
      }
    }
  }
}

function onSetupCellClick(r, c) {
  const zone = setupZoneRows();
  const key = `${r},${c}`;
  if (placements[key]) {
    delete placements[key];
    renderTray();
    renderSetupBoard();
    return;
  }
  if (!zone.includes(r)) return log("That square is outside your setup zone.");
  if (!selectedTrayType) return log("Select a piece from the tray first.");
  placements[key] = selectedTrayType;
  const used = Object.values(placements).filter((t) => t === selectedTrayType).length;
  if (used >= PIECE_COUNTS[selectedTrayType]) selectedTrayType = null;
  renderTray();
  renderSetupBoard();
}

submitBtn.addEventListener("click", () => {
  const payload = Object.entries(placements).map(([key, type]) => {
    const [row, col] = key.split(",").map(Number);
    return { row, col, type };
  });
  socket.emit("submitSetup", payload);
});

function legalDestinations(r, c) {
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(
    ([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS
  );
}

function onPlayCellClick(r, c) {
  if (!lastBoardView || lastBoardView.turn !== myTeam) return;
  const key = `${r},${c}`;
  const piece = lastBoardView.board[key];

  if (selectedCell) {
    const [sr, sc] = selectedCell;
    const isLegalTarget = legalDestinations(sr, sc).some(([lr, lc]) => lr === r && lc === c);
    if (isLegalTarget) {
      socket.emit("move", { from: { row: sr, col: sc }, to: { row: r, col: c } });
      selectedCell = null;
      renderBoard(lastBoardView.board);
      return;
    }
    selectedCell = null;
  }

  if (piece && !piece.hidden && piece.team === myTeam) {
    selectedCell = [r, c];
  }
  renderBoard(lastBoardView.board);
}

function onCellClick(r, c) {
  if (phase === "setup") onSetupCellClick(r, c);
  else if (phase === "playing") onPlayCellClick(r, c);
}

function renderBoard(board) {
  document.querySelectorAll(".board-cell").forEach((cell) => {
    cell.innerHTML = "";
    cell.classList.remove("board-cell-selected", "board-cell-legal", "board-cell-inzone");
  });
  for (const [key, piece] of Object.entries(board)) {
    const [r, c] = key.split(",").map(Number);
    const cell = cellEl(r, c);
    if (!cell) continue;
    if (piece.hidden) {
      const dot = document.createElement("div");
      dot.className = `w-8 h-8 rounded-full ${piece.team === "blue" ? "bg-team-blue" : "bg-team-red"} opacity-80`;
      cell.appendChild(dot);
    } else {
      const img = document.createElement("img");
      img.src = `assets/pieces/${piece.team}_${piece.type}.svg`;
      img.className = "w-11 h-11";
      cell.appendChild(img);
    }
  }
  if (selectedCell) {
    const [sr, sc] = selectedCell;
    cellEl(sr, sc)?.classList.add("board-cell-selected");
    for (const [lr, lc] of legalDestinations(sr, sc)) {
      cellEl(lr, lc)?.classList.add("board-cell-legal");
    }
  }
}

function renderCasualties(captured) {
  if (!captured) return;
  for (const [team, el] of [["red", casualtiesRedEl], ["blue", casualtiesBlueEl]]) {
    el.innerHTML = "";
    for (const type of captured[team] || []) {
      const img = document.createElement("img");
      img.src = `assets/pieces/${team}_${type}.svg`;
      img.className = "casualty-icon";
      img.title = PIECE_LABELS[type] || type;
      el.appendChild(img);
    }
  }
}

function updateTimer(deadline) {
  clearInterval(countdownInterval);
  if (!deadline) { timerEl.textContent = ""; return; }
  countdownInterval = setInterval(() => {
    const secs = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    timerEl.textContent = `${secs}s`;
    if (secs <= 0) clearInterval(countdownInterval);
  }, 250);
}

// --- Chat & emotes ---
function appendChatBubble(team, text) {
  const bubble = document.createElement("div");
  const isOwn = team === myTeam;
  bubble.className = `chat-bubble ${isOwn ? "chat-bubble-own" : "chat-bubble-enemy"}`;
  bubble.textContent = text;
  chatLogEl.appendChild(bubble);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function renderEmoteBar() {
  emoteBarEl.innerHTML = "";
  for (const emote of EMOTES) {
    const btn = document.createElement("button");
    btn.className = "emote-btn";
    btn.textContent = emote;
    btn.addEventListener("click", () => socket.emit("sendEmote", emote));
    emoteBarEl.appendChild(btn);
  }
}
renderEmoteBar();

chatFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInputEl.value.trim();
  if (!text) return;
  socket.emit("chatMessage", text);
  chatInputEl.value = "";
});

socket.on("chatMessage", (data) => appendChatBubble(data.team, data.text));
socket.on("emote", (data) => {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${data.team === myTeam ? "chat-bubble-own" : "chat-bubble-enemy"} emote-bubble`;
  bubble.textContent = data.emote;
  chatLogEl.appendChild(bubble);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
});

findBtn.addEventListener("click", () => {
  socket.emit("findMatch");
  findBtn.disabled = true;
});

socket.on("connect", () => {
  const resuming = tryResumeSession();
  if (!resuming) statusEl.textContent = "Connected — click Find Match to begin";
});

socket.on("disconnect", () => {
  statusEl.textContent = "Disconnected — attempting to reconnect...";
});

socket.on("rejoinFailed", () => {
  log("Saved session is no longer valid (server restarted or match ended). Click Find Match to start a new game.");
  localStorage.removeItem("gog_session");
  findBtn.disabled = false;
  statusEl.textContent = "Connected — click Find Match to begin";
});

socket.on("matched", (data) => {
  myTeam = data.team;
  myToken = data.token;
  myRoomId = data.roomId;
  phase = data.phase;
  saveSession();
  findBtn.disabled = true;
  statusEl.textContent = `Team: ${myTeam.toUpperCase()} — Phase: ${phase}${data.resumed ? " (resumed)" : ""}`;
  log(data.resumed ? `Resumed match ${data.roomId}` : `Matched into ${data.roomId} as ${myTeam}`);
  if (phase === "setup") {
    renderTray();
    renderSetupBoard();
  }
});

socket.on("boardUpdate", (view) => {
  phase = view.phase;
  lastBoardView = view;
  statusEl.textContent = `Team: ${myTeam || "?"} — Phase: ${phase} — Turn: ${view.turn || "-"}`;
  updateTimer(view.turnDeadline);
  renderCasualties(view.captured);
  if (phase === "setup") {
    renderTray();
    renderSetupBoard();
  } else {
    renderBoard(view.board);
  }
  if (view.winner) {
    log(`Game over. Winner: ${view.winner}`);
    localStorage.removeItem("gog_session");
    findBtn.disabled = false;
    findBtn.textContent = "Find New Match";
    clearInterval(countdownInterval);
  }
});

socket.on("challengeResult", (r) => {
  log(`Challenge: ${r.attacker} vs ${r.defender} -> ${r.outcome}`);
});

socket.on("gameOver", (data) => {
  log(`Game over. Winner: ${data.winner}${data.reason ? ` (${data.reason})` : ""}`);
  clearInterval(countdownInterval);
  localStorage.removeItem("gog_session");
  findBtn.disabled = false;
  findBtn.textContent = "Find New Match";
});

socket.on("errorMsg", (msg) => log(`Error: ${msg}`));
socket.on("opponentDisconnected", (data) => {
  log(`Opponent disconnected. They have ${data.graceSeconds}s to reconnect before you win by default.`);
});
