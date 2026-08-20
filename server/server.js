// server/server.js
require("dotenv").config();
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Match } = require("./boardState");
const { router: authRouter, getUserFromCookieHeader } = require("./auth");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use("/auth", authRouter);

// --- Page-level auth gate ---
// This is the actual login redirect: a logged-out visitor hitting "/" is
// sent to the login page before any game assets load, and a logged-in
// visitor hitting the login page is bounced straight into the game.
// (login.js's own client-side "already logged in" check is just a
// convenience for a stale/bfcache page load -- this is what actually
// enforces it.)
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function requireAuthPage(req, res, next) {
  if (!getUserFromCookieHeader(req.headers.cookie)) return res.redirect("/login.html");
  next();
}
function requireGuestPage(req, res, next) {
  if (getUserFromCookieHeader(req.headers.cookie)) return res.redirect("/");
  next();
}

app.get(["/", "/index.html"], requireAuthPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/login.html", requireGuestPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

// { index: false } so express.static doesn't fall back to auto-serving
// public/index.html for "/" -- that would bypass requireAuthPage above.
// Everything else (css/js/assets/socket.io client) still serves normally.
app.use(express.static(PUBLIC_DIR, { index: false }));

const matches = {}; // roomId -> Match
const socketToRoom = {}; // socketId -> roomId

function log(...args) {
  const ts = new Date().toISOString().split("T")[1].split(".")[0]; // HH:MM:SS
  console.log(`[${ts}]`, ...args);
}

function broadcastBoard(match) {
  for (const [sid, p] of Object.entries(match.players)) {
    io.to(sid).emit("boardUpdate", match.getViewFor(p.team));
  }
}

function findOrCreateRoom() {
  for (const [roomId, match] of Object.entries(matches)) {
    if (Object.keys(match.players).length < 2 && match.phase === "waiting") {
      return roomId;
    }
  }
  const roomId = `room_${Math.random().toString(36).slice(2, 8)}`;
  matches[roomId] = new Match(roomId);
  log(`Created room=${roomId}`);
  return roomId;
}

// Attach the logged-in user (if any) to every socket from its handshake
// cookie. This never rejects the connection -- the page still loads and the
// socket still connects for a logged-out visitor, they just can't findMatch
// yet. socket.user is looked up server-side from the session table, so a
// client can't spoof who it is by sending a fake email in an event payload.
io.use((socket, next) => {
  socket.user = getUserFromCookieHeader(socket.handshake.headers.cookie);
  next();
});

io.on("connection", (socket) => {
  log(`Socket connected id=${socket.id}${socket.user ? ` user=${socket.user.email}` : ""}`);

  socket.on("findMatch", () => {
    if (!socket.user) {
      log(`findMatch REJECTED: socket=${socket.id} not logged in`);
      return socket.emit("errorMsg", "Please log in to find a match.");
    }
    const roomId = findOrCreateRoom();
    const match = matches[roomId];
    const { team, token } = match.addPlayer(socket.id);
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);
    log(`findMatch: socket=${socket.id} joined room=${roomId} as team=${team} (players now ${Object.keys(match.players).length}/2, phase=${match.phase})`);
    socket.emit("matched", { roomId, team, token, phase: match.phase });
    broadcastBoard(match);
  });

  // Client presents its saved token after a reload/reconnect to resume its match.
  socket.on("rejoin", ({ roomId, token }) => {
    const match = matches[roomId];
    if (!match) {
      log(`rejoin FAILED: room=${roomId} does not exist (socket=${socket.id})`);
      return socket.emit("rejoinFailed", "Match no longer exists");
    }
    const team = match.rejoin(socket.id, token);
    if (!team) {
      log(`rejoin FAILED: invalid token for room=${roomId} (socket=${socket.id})`);
      return socket.emit("rejoinFailed", "Invalid session");
    }
    socketToRoom[socket.id] = roomId;
    socket.join(roomId);
    log(`rejoin OK: socket=${socket.id} resumed room=${roomId} as team=${team}, phase=${match.phase}`);
    socket.emit("matched", { roomId, team, token, phase: match.phase, resumed: true });
    broadcastBoard(match);
  });

  socket.on("submitSetup", (placements) => {
    const roomId = socketToRoom[socket.id];
    const match = matches[roomId];
    if (!match) {
      log(`submitSetup FAILED: no match for socket=${socket.id}`);
      return socket.emit("errorMsg", "No active match");
    }
    const res = match.submitSetup(socket.id, placements);
    if (!res.ok) {
      log(`submitSetup REJECTED room=${roomId} socket=${socket.id}: ${res.error}`);
      return socket.emit("errorMsg", res.error);
    }
    log(`submitSetup OK room=${roomId} socket=${socket.id} -> phase=${res.phase}`);
    if (res.phase === "playing") {
      match.startTurnTimer(() => broadcastBoard(match));
    }
    broadcastBoard(match);
  });

  socket.on("move", ({ from, to }) => {
    const roomId = socketToRoom[socket.id];
    const match = matches[roomId];
    if (!match) {
      log(`move FAILED: no match for socket=${socket.id}`);
      return socket.emit("errorMsg", "No active match");
    }
    const res = match.move(socket.id, from, to);
    if (!res.ok) {
      log(`move REJECTED room=${roomId} socket=${socket.id}: ${res.error}`);
      return socket.emit("errorMsg", res.error);
    }
    log(`move OK room=${roomId} socket=${socket.id} (${from.row},${from.col})->(${to.row},${to.col})${res.result ? ` challenge=${res.result.attacker}vs${res.result.defender}->${res.result.outcome}` : ""}`);
    if (res.phase === "playing") match.startTurnTimer(() => broadcastBoard(match));
    broadcastBoard(match);
    if (res.result) io.to(roomId).emit("challengeResult", res.result);
    if (res.winner) {
      log(`Game finished room=${roomId} winner=${res.winner}`);
      io.to(roomId).emit("gameOver", { winner: res.winner });
    }
  });

  socket.on("chatMessage", (text) => {
    const roomId = socketToRoom[socket.id];
    const match = matches[roomId];
    if (!match) return;
    const team = match.players[socket.id]?.team;
    if (!team) return;
    const clean = String(text || "").slice(0, 200).trim();
    if (!clean) return;
    io.to(roomId).emit("chatMessage", { team, text: clean, at: Date.now() });
  });

  const ALLOWED_EMOTES = ["👍", "😅", "😤", "🤔", "😂", "🎯", "🔥", "🙏"];
  socket.on("sendEmote", (emote) => {
    const roomId = socketToRoom[socket.id];
    const match = matches[roomId];
    if (!match) return;
    const team = match.players[socket.id]?.team;
    if (!team || !ALLOWED_EMOTES.includes(emote)) return;
    io.to(roomId).emit("emote", { team, emote, at: Date.now() });
  });

  socket.on("disconnect", () => {
    const roomId = socketToRoom[socket.id];
    const match = matches[roomId];
    log(`Socket disconnected id=${socket.id} room=${roomId || "-"}`);
    if (match) {
      const team = match.players[socket.id]?.team;
      delete match.players[socket.id];
      const matchWasActive = match.phase === "setup" || match.phase === "playing";
      if (team && matchWasActive) {
        log(`Player disconnected mid-match room=${roomId} team=${team} — starting 60s forfeit grace period`);
        socket.to(roomId).emit("opponentDisconnected", { graceSeconds: 60 });
        match.markDisconnected(team, () => {
          log(`Forfeit timeout expired room=${roomId} — winner=${match.winner}`);
          io.to(roomId).emit("gameOver", { winner: match.winner, reason: "opponentTimedOut" });
        });
      } else if (team) {
        log(`Player left room=${roomId} team=${team} before match started — no forfeit awarded`);
      }
      if (Object.keys(match.players).length === 0 && match.phase === "waiting") {
        delete matches[roomId];
        log(`Removed empty waiting room=${roomId}`);
      }
    }
    delete socketToRoom[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => log(`Game of the Generals server running on port ${PORT}`));
