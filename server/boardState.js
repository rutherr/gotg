// server/boardState.js
const { PIECE_COUNTS, resolveChallenge } = require("./gameRules");

const BOARD_ROWS = 8;
const BOARD_COLS = 9;

function expandRoster() {
  const roster = [];
  for (const [type, count] of Object.entries(PIECE_COUNTS)) {
    for (let i = 0; i < count; i++) roster.push(type);
  }
  return roster; // 21 pieces
}

const TURN_SECONDS = 60;
const RECONNECT_GRACE_MS = 60_000;

function makeToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

class Match {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = {}; // socketId -> { team, ready, token }
    this.tokenToTeam = {}; // reconnect token -> team
    this.disconnectedTeams = {}; // team -> timeout handle
    this.board = {}; // "row,col" -> { team, type, id }
    this.captured = { blue: [], red: [] }; // team -> array of piece types eliminated (belonging to that team)
    this.phase = "waiting"; // waiting -> setup -> playing -> finished
    this.turn = null; // team whose turn it is
    this.winner = null;
    this.turnDeadline = null; // epoch ms
  }

  addPlayer(socketId) {
    const teams = Object.values(this.players).map((p) => p.team);
    const team = teams.includes("blue") ? "red" : "blue";
    const token = makeToken();
    this.players[socketId] = { team, ready: false, token };
    this.tokenToTeam[token] = team;
    if (Object.keys(this.players).length === 2) this.phase = "setup";
    return { team, token };
  }

  // Re-attach a reconnecting socket to its existing team/state using its token.
  rejoin(socketId, token) {
    const team = this.tokenToTeam[token];
    if (!team) return null;
    // Remove any stale entry for this team under an old socket id
    for (const [sid, p] of Object.entries(this.players)) {
      if (p.team === team && sid !== socketId) delete this.players[sid];
    }
    this.players[socketId] = { team, ready: this.phase !== "setup" || this._teamReady(team), token };
    if (this.disconnectedTeams[team]) {
      clearTimeout(this.disconnectedTeams[team]);
      delete this.disconnectedTeams[team];
    }
    return team;
  }

  _teamReady(team) {
    return Object.entries(this.board).some(([, p]) => p.team === team);
  }

  markDisconnected(team, onExpire) {
    this.disconnectedTeams[team] = setTimeout(() => {
      this.phase = "finished";
      this.winner = team === "blue" ? "red" : "blue";
      onExpire();
    }, RECONNECT_GRACE_MS);
  }

  startTurnTimer(onTimeout) {
    this.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    clearTimeout(this._timerHandle);
    this._timerHandle = setTimeout(() => {
      if (this.phase !== "playing") return;
      this.turn = this.turn === "blue" ? "red" : "blue";
      this.startTurnTimer(onTimeout);
      onTimeout();
    }, TURN_SECONDS * 1000);
  }

  // Player submits their full 21-piece placement for their own 3 back rows.
  submitSetup(socketId, placements) {
    const team = this.players[socketId]?.team;
    if (!team || this.phase !== "setup") return { ok: false, error: "Not in setup phase" };

    const roster = expandRoster();
    if (placements.length !== roster.length) {
      return { ok: false, error: `Expected ${roster.length} placements` };
    }
    // Validate every submitted piece type matches the required roster (order-independent)
    const submittedTypes = placements.map((p) => p.type).sort();
    const requiredTypes = [...roster].sort();
    if (JSON.stringify(submittedTypes) !== JSON.stringify(requiredTypes)) {
      return { ok: false, error: "Invalid roster: piece counts do not match official 21-piece set" };
    }
    // Validate zone: blue = rows 5-7, red = rows 0-2 (example convention)
    const validRows = team === "blue" ? [5, 6, 7] : [0, 1, 2];
    for (const p of placements) {
      if (!validRows.includes(p.row) || p.col < 0 || p.col >= BOARD_COLS) {
        return { ok: false, error: "Placement outside your setup zone" };
      }
      const key = `${p.row},${p.col}`;
      if (this.board[key]) return { ok: false, error: "Duplicate square in placement" };
      this.board[key] = { team, type: p.type, id: `${team}-${p.type}-${Math.random().toString(36).slice(2, 7)}` };
    }
    this.players[socketId].ready = true;

    const bothReady = Object.values(this.players).every((p) => p.ready);
    if (bothReady) {
      this.phase = "playing";
      this.turn = "blue"; // blue always opens; could randomize
    }
    return { ok: true, phase: this.phase };
  }

  // Returns a board view for a given team: own pieces fully visible,
  // enemy pieces show only { team, occupied: true } -- never their type.
  getViewFor(team) {
    const view = {};
    for (const [key, piece] of Object.entries(this.board)) {
      view[key] = piece.team === team
        ? { team: piece.team, type: piece.type }
        : { team: piece.team, hidden: true };
    }
    return {
      phase: this.phase,
      turn: this.turn,
      board: view,
      winner: this.winner,
      turnDeadline: this.turnDeadline,
      captured: this.captured,
    };
  }

  move(socketId, from, to) {
    const team = this.players[socketId]?.team;
    if (!team) return { ok: false, error: "Unknown player" };
    if (this.phase !== "playing") return { ok: false, error: "Game is not in play phase" };
    if (this.turn !== team) return { ok: false, error: "Not your turn" };

    const fromKey = `${from.row},${from.col}`;
    const toKey = `${to.row},${to.col}`;
    const moving = this.board[fromKey];
    if (!moving || moving.team !== team) return { ok: false, error: "No your piece at source square" };

    const rowDiff = Math.abs(from.row - to.row);
    const colDiff = Math.abs(from.col - to.col);
    const isOrthogonalStep = (rowDiff + colDiff === 1);
    if (!isOrthogonalStep) return { ok: false, error: "Illegal move: one orthogonal square only" };

    const target = this.board[toKey];
    let result = null;

    if (!target) {
      // simple move
      delete this.board[fromKey];
      this.board[toKey] = moving;
    } else if (target.team === team) {
      return { ok: false, error: "Square occupied by your own piece" };
    } else {
      // challenge
      const outcome = resolveChallenge(moving.type, target.type);
      result = { outcome, attacker: moving.type, defender: target.type };
      delete this.board[fromKey];
      if (outcome === "attackerWins" || outcome === "gameWonByAttacker") {
        this.board[toKey] = moving;
        this.captured[target.team].push(target.type);
      } else if (outcome === "defenderWins") {
        // attacker's piece is removed, defender stays
        this.captured[team].push(moving.type);
      } else if (outcome === "bothEliminated") {
        delete this.board[toKey];
        this.captured[team].push(moving.type);
        this.captured[target.team].push(target.type);
      }
      if (outcome === "gameWonByAttacker" || (target.type === "flag" && outcome === "attackerWins")) {
        this.phase = "finished";
        this.winner = team;
      }
    }

    this.turn = this.turn === "blue" ? "red" : "blue";
    return { ok: true, result, phase: this.phase, winner: this.winner };
  }
}

module.exports = { Match, expandRoster, BOARD_ROWS, BOARD_COLS };
