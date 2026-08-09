# Game of the Generals — Online Multiplayer

An online, internationally accessible adaptation of the Filipino strategy game
Game of the Generals (Salpakan), built with a server-authoritative architecture
so hidden piece identities can never leak to the wrong client.

## Stack

- **Server**: Node.js + Express + Socket.io (real-time move sync, matchmaking, turn timers, reconnection)
- **Styling**: Tailwind CSS (compiled via PostCSS build step — no CDN/Play script in production)
- **Database**: SQLite via better-sqlite3 (accounts, match history — not yet wired up)
- **Client**: Vanilla JS + HTML (no framework needed for a grid-based board game)
- **Hosting**: Railway (same auto-deploy-on-push workflow as your other projects)

## Running it locally

```bash
npm install
npm run generate-assets                 # generates the 30 piece SVG icons
npx tailwindcss -i ./src/input.css -o ./public/css/output.css --minify
npm start
```

Open `http://localhost:3000` in two separate browser sessions (e.g. one normal
window, one incognito) to simulate two players finding a match.

To rebuild CSS automatically while editing Tailwind classes:
```bash
npx tailwindcss -i ./src/input.css -o ./public/css/output.css --watch
```

## What's built and working

- `server/gameRules.js` — full 15-rank combat resolution engine
- `server/gameRules.test.js` — **17/17 passing** against every official rule interaction
  (rank comparisons, spy/private counter, equal-rank "split", flag capture, flag-vs-flag)
- `server/setupTray.test.js` — jsdom regression test confirming the setup tray
  actually renders its 15 piece buttons on entering setup phase, and that the
  select → place flow puts a piece on the board (see "Recent fix" below)
- `server/boardState.js` — server-authoritative match state:
  - `getViewFor(team)` strips enemy piece identities before sending state to a client
  - Setup-zone and move-legality validation happens entirely server-side
  - Turn timer (60s default) with automatic turn-skip on timeout
  - Reconnection tokens: a disconnected player has 60 seconds to rejoin via the same
    match before their opponent is awarded the win
- `server/server.js` — Socket.io event wiring for matchmaking, setup, moves, rejoin
- `public/` — working client:
  - Setup phase: click a piece in the tray, then click a square in your zone to place it
    (click again to remove); Submit button enables only once all 21 pieces are placed
  - Play phase: click your piece to see legal one-square orthogonal moves highlighted,
    click a destination to move or challenge
  - Live turn timer countdown
  - Session persistence via `localStorage` — refreshing the page resumes your match
- `scripts/generate-assets.js` — generates all 30 piece icons as scalable SVGs

## Visual/UX overhaul (this session)

Built per request, in priority order chosen: visual/UX first, register/login deferred to next session (decision: login will be **required to play** once built).

1. **Dark/light mode** — `tailwind.config.js` now uses `darkMode: "class"`.
   A pre-paint inline script in `index.html` applies the saved
   `localStorage.gog_theme` (or defaults to dark) before first render, so
   there's no flash. Toggle button in the header flips `document.documentElement`'s
   `dark` class and persists the choice.
2. **Board no longer looks "half-lit"** — the old setup-phase behavior dimmed
   the opponent's three rows with `opacity-40`, which visually split the board
   in half. Replaced with `.board-cell-inzone`, a subtle sky-blue inset ring
   on *your own* placeable squares. The whole board now stays evenly lit at
   all times; the ring is the only zone indicator.
3. **Board centered, 3-column layout** — `<main>` is now
   `grid-cols-[300px_1fr_300px]` (stacks to a single column below the `xl`
   breakpoint). Left: Setup Tray + Match Log. Center: the board (capped at
   `34rem` wide, centered) plus a Fallen Soldiers strip beneath it. Right:
   Chat + Emotes.
4. **Chat + emotes** — new `chatMessage` / `sendEmote` socket events
   (`server/server.js`), room-scoped, with a fixed 8-emote allow-list
   server-side (`👍 😅 😤 🤔 😂 🎯 🔥 🙏`) so arbitrary strings can't be
   broadcast as "emotes". Client renders bubbles styled differently for your
   own team vs. the opponent's.
5. **Setup tray shows piece art, not just text** — `renderTray()` now renders
   each button as an icon (reusing the existing `assets/pieces/*.svg` set)
   stacked over a label + remaining count.
6. **Captured pieces / fallen soldiers** — `Match` now tracks
   `this.captured = { blue: [], red: [] }` in `server/boardState.js`, pushed
   to on every combat outcome (`attackerWins`, `defenderWins`,
   `bothEliminated`, `gameWonByAttacker`) and exposed via `getViewFor()`.
   Client renders these as small icons in the Fallen Soldiers strip. This is
   safe to reveal to both players since a piece's identity is already
   revealed to both sides the moment it's involved in a challenge
   (`challengeResult` already broadcasts both types).

**Testing**: added `server/captured.test.js` (5 cases, one per combat outcome
+ view exposure — this caught a mistaken test fixture of mine on the first
run, since `gen5` attacking a `spy` is actually `defenderWins`, not
`attackerWins`, per the existing rules engine) and extended
`server/setupTray.test.js` with 3 more DOM checks: tray buttons contain
`<img>` elements, the theme toggle flips the `dark` class and persists to
`localStorage`, and a `boardUpdate` with a `captured` payload renders the
right number of icons into each casualties column. `npm test` now runs
17 (rules) + 5 (captured) + 8 (tray/theme/casualties DOM) = 30 checks.

## Follow-up (this session): "still don't see the pieces" after the tray fix

The server log from the report showed sockets connecting and then disconnecting
within seconds — with **`room=-`**, meaning `findMatch` was never called for
any of them. The tray only ever populates once `phase === "setup"`, which only
happens after **two** players are matched — a single tab that never clicks
"Find Match" (or whose old session fails to resume) will always show an empty
tray, correctly. This matches the screenshot: status still read "Not connected"
because the header text is a static default that's only ever overwritten by
the `"matched"` event — so it gave zero feedback about whether the socket
itself was connected.

Two real (small) bugs did fall out of that investigation, now fixed:

1. **`public/js/game.js`**: the status line never reflected an actual live
   connection — it just sat on the HTML's hardcoded `"Not connected"` until
   a match happened. Now `"connect"` sets it to `"Connected — click Find Match
   to begin"` and `"disconnect"` sets it to `"Disconnected — attempting to
   reconnect..."`, so the UI actually tells you what state the socket is in.
2. **Stale `localStorage` session after a server restart**: if you'd matched
   in an earlier run, `gog_session` still holds that old `roomId`/`token`. On
   reload the client auto-attempts `rejoin`; since the server's in-memory
   `matches` object is wiped on restart, that rejoin always fails — but it
   failed **silently** into the generic `errorMsg` channel with no recovery,
   leaving the stale session in `localStorage` forever and the Find Match
   button never re-armed automatically until you noticed and clicked it anyway.
   Server now emits a distinct `"rejoinFailed"` event; client listens for it,
   clears `gog_session`, and resets the status/button so you can start fresh.

**To actually test the setup phase and see the tray**: open two separate
browser sessions (a normal window + an incognito window, or two different
browsers) pointed at `localhost:3000`, and click **Find Match** in both. Only
then does the match reach `phase: "setup"` and the tray populate.

## Recent fix (previous session)

**Bug**: Setup Tray was completely empty on entering setup phase — no piece
buttons rendered, so players couldn't place anything. Root cause: `renderTray()`
was only ever called from inside `onSetupCellClick()`, which itself returns
early if no piece type is already selected. Since nothing called `renderTray()`
when the phase first transitioned to `"setup"`, the tray had no buttons to
click in the first place — a catch-22.

**Fix**: `public/js/game.js` now calls `renderTray()` (alongside the existing
`renderSetupBoard()`) in two places:
- the `socket.on("matched", ...)` handler, when `data.phase === "setup"`
  (covers the second player, who enters setup immediately on match)
- the `socket.on("boardUpdate", ...)` handler, whenever `view.phase === "setup"`
  (covers every subsequent setup-phase update)

**Verification**: added `server/setupTray.test.js`, a jsdom-based DOM
regression test that loads the real `index.html` + `game.js`, stubs
`socket.io`, and drives the exact `matched` → `boardUpdate` → click sequence
the server sends. It asserts the tray renders all 15 piece-type buttons on
entry (not just after a click) and that the full select-a-piece → place-on-board
flow produces a piece image on the board. Wired into `npm test` alongside the
existing 17-case rules engine suite (18/18 passing). `jsdom` added as a
devDependency.

Also: `node_modules` in the handed-off zip had a corrupted `tailwindcss` bin
shim (`node_modules/.bin/tailwindcss` pointed at a stub, not the real CLI
entry). Did a clean `rm -rf node_modules package-lock.json && npm install` to
fix it — `npm run build:css` now works from a clean clone.

## What's NOT built yet

1. **Register/Login (next up)** — accounts, sessions, and password auth using
   `better-sqlite3` (installed but not wired in yet). Decision from this
   session: login will be **required to play** — no anonymous Find Match
   once this ships. Will need: users table, register/login pages, session
   handling, and gating `findMatch` server-side on an authenticated session.
2. Persistent match history tied to accounts
3. Matchmaking by skill/rank — currently just pairs whoever is waiting
4. Spectator mode
5. Deployment Dockerfile (same native-compilation issue better-sqlite3 caused on
   PGA-DAMIS will likely resurface on Railway; reuse that Dockerfile pattern)
6. Automated end-to-end tests (Socket.io integration tests, not just the rules/DOM unit tests)

## Asset resources (for anything beyond the generated SVG icons)

- **Free/CC0 game art & textures**: kenney.nl, opengameart.org
- **Free sound effects**: freesound.org, mixkit.co
- **Fonts**: fonts.google.com — Rajdhani is already wired in via `index.html`
- **AI-generated illustrated art** (if you want painted/illustrated visuals beyond flat
  vector design): Midjourney, DALL-E, or Stable Diffusion, used externally to produce
  image files you then drop into `public/assets/`

## Quality attributes — ISO/IEC 25010 mapping

ISO/IEC 25010 defines eight product quality characteristics. Here's how the current
architecture addresses each one, and where the known gaps are — useful as-is for
capstone-style documentation.

| Characteristic | How it's addressed | Known gap |
|---|---|---|
| **Functional Suitability** | Combat rules match the official 21-piece ruleset exactly, verified by a 17-case automated test covering every rank interaction and edge case (flag-vs-flag, equal-rank split, spy/private counter) | Win-by-flag-reaching-baseline condition (an official alternate win condition) is not yet implemented — only flag capture is |
| **Performance Efficiency** | Match state is held in memory per room (no DB round-trip per move); SVG assets are lightweight (~500 bytes each) instead of raster images | No load testing yet for concurrent match volume |
| **Compatibility** | Standard web stack (HTML/CSS/JS + WebSockets) runs in any modern browser without plugins; Socket.io auto-negotiates transport | Not yet tested on older/low-end mobile browsers |
| **Usability** | Legal moves are visually highlighted; turn/phase status is always visible; setup tray shows remaining piece counts to prevent invalid submissions | No onboarding/tutorial for players unfamiliar with the original game's rules |
| **Reliability** | Reconnection tokens let a dropped player resume an in-progress match instead of losing it instantly; turn timer prevents a stalled opponent from freezing the match indefinitely | No persistence across a server restart — in-memory state is lost if the process crashes |
| **Security** | Enemy piece identity is never sent to the wrong client — enforced server-side, not just hidden in the UI, so it can't be bypassed via browser dev tools; all moves are re-validated server-side regardless of what the client requests | No authentication yet, so match tokens are the only access control; no rate-limiting on socket events yet |
| **Maintainability** | Rules, board state, and networking are in separate modules; combat logic is independently unit-tested and has zero UI dependencies, so it can be reused or ported without touching the server; a jsdom DOM regression test now guards the client-side setup-tray rendering path, catching the class of bug (missing render call on a state transition) that shipped last session | Still no Socket.io integration/E2E test suite — the jsdom test drives the client in isolation with stubbed events, it doesn't exercise the real server |
| **Portability** | Node.js + Express run identically on Linux/Mac/Windows; no OS-specific code paths | better-sqlite3 requires native compilation per platform — same issue that needed a Dockerfile fix on PGA-DAMIS will apply here once the DB layer is wired in |

## Note on the name

"Game of the Generals" / "Salpakan" is Sofronio H. Pasola Jr.'s original title.
If this is going to be published or monetized internationally, it's worth checking
trademark status before finalizing branding.
