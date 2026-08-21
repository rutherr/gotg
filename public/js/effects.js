// public/js/effects.js
// Purely cosmetic layer on top of game.js's socket events: a combat-reveal
// flash on the board cell where a challenge happened, plus background
// music and short SFX. Has no game logic of its own and never touches
// hidden piece data -- it only reacts to events game.js already receives
// (challengeResult, gameOver) -- so it can be deleted wholesale without
// breaking gameplay.
//
// Loaded as its own <script> tag (see index.html), same-realm as game.js
// and auth.js -- top-level `const`/`let` names must not collide with
// theirs (classic <script> tags share one lexical scope; game.js's own
// header comment explains why window.socket exists for exactly this
// reason). Uses `fxSocket`, not `socket`, because auth.js already owns
// that name.
//
// NOTE ON AUDIO ASSETS: this file expects files under public/assets/audio/
// (see AUDIO_BASE/SFX_FILES below) that are NOT included in this change --
// source your own short, freely-licensed clips (e.g. freesound.org,
// kenney.nl/assets, opengameart.org -- filter for CC0) and drop them in
// with these exact filenames. Every playback call below is wrapped so a
// missing file, an unsupported format, or a browser autoplay block
// degrades to silence instead of a console error storm or a broken page.
const fxSocket = window.socket;
const musicToggleBtn = document.getElementById("musicToggleBtn");
const musicIcon = document.getElementById("musicIcon");

const AUDIO_BASE = "assets/audio/";
const SFX_FILES = {
  attackerWins: "attacker-wins.mp3",
  defenderWins: "defender-wins.mp3",
  bothEliminated: "both-eliminated.mp3",
  gameWonByAttacker: "flag-captured.mp3",
  gameOver: "game-over.mp3",
};

const bgm = new Audio(AUDIO_BASE + "bgm.mp3");
bgm.loop = true;
bgm.volume = 0.35;

const sfxCache = {};
function getSfx(name) {
  if (!sfxCache[name]) {
    const audio = new Audio(AUDIO_BASE + SFX_FILES[name]);
    audio.volume = 0.6;
    sfxCache[name] = audio;
  }
  return sfxCache[name];
}

// Best-effort playback: a 404 (asset not added yet), a browser autoplay
// block, or an unsupported format should never surface as an uncaught
// error or interrupt gameplay -- just log once and move on.
function safePlay(audio) {
  try {
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch((err) => console.warn("[effects] audio playback skipped:", err?.message || err));
    }
  } catch (err) {
    console.warn("[effects] audio playback skipped:", err?.message || err);
  }
}

function playSfx(name) {
  if (!SFX_FILES[name]) return;
  const audio = getSfx(name);
  audio.currentTime = 0;
  safePlay(audio);
}

// --- Music toggle ---
function setMusicUI(on) {
  musicToggleBtn.setAttribute("aria-pressed", String(on));
  musicIcon.textContent = on ? "🔊" : "🔇";
}

function setMusicEnabled(on) {
  localStorage.setItem("gog_music", on ? "on" : "off");
  setMusicUI(on);
  if (on) {
    safePlay(bgm);
  } else {
    bgm.pause();
  }
}

musicToggleBtn.addEventListener("click", () => {
  setMusicEnabled(musicToggleBtn.getAttribute("aria-pressed") !== "true");
});

// Music defaults to reflecting the saved preference in the icon only.
// Browsers block autoplay-with-sound regardless of what we saved last
// time, so actual playback still needs a fresh click on this page load
// (the handler above) -- this just avoids the icon lying about state.
setMusicUI(localStorage.getItem("gog_music") === "on");

// --- Combat reveal flash ---
function flashCell(row, col) {
  if (row === undefined || col === undefined) return;
  const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  if (!cell) return;
  cell.classList.remove("cell-combat-flash");
  // Force reflow so re-adding the class restarts the animation even when
  // the same cell flashes twice in quick succession.
  void cell.offsetWidth;
  cell.classList.add("cell-combat-flash");
}

fxSocket.on("challengeResult", (r) => {
  flashCell(r.row, r.col);
  playSfx(r.outcome);
});

fxSocket.on("gameOver", () => {
  playSfx("gameOver");
});
