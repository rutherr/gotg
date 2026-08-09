// server/captured.test.js
const { Match } = require("./boardState");

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  ok ? passed++ : failed++;
}

function freshMatch() {
  const m = new Match("test_room");
  m.addPlayer("blueSocket");
  m.addPlayer("redSocket");
  m.phase = "playing";
  m.turn = "blue";
  return m;
}

// --- attackerWins: defender's piece should be captured ---
{
  const m = freshMatch();
  m.board["4,4"] = { team: "blue", type: "private", id: "b1" };
  m.board["3,4"] = { team: "red", type: "spy", id: "r1" };
  m.move("blueSocket", { row: 4, col: 4 }, { row: 3, col: 4 });
  check("attackerWins captures defender's piece", m.captured, { blue: [], red: ["spy"] });
}

// --- defenderWins: attacker's piece should be captured ---
{
  const m = freshMatch();
  m.board["4,4"] = { team: "blue", type: "private", id: "b1" };
  m.board["3,4"] = { team: "red", type: "gen5", id: "r1" };
  m.move("blueSocket", { row: 4, col: 4 }, { row: 3, col: 4 });
  check("defenderWins captures attacker's piece", m.captured, { blue: ["private"], red: [] });
}

// --- bothEliminated: both pieces captured ---
{
  const m = freshMatch();
  m.board["4,4"] = { team: "blue", type: "colonel", id: "b1" };
  m.board["3,4"] = { team: "red", type: "colonel", id: "r1" };
  m.move("blueSocket", { row: 4, col: 4 }, { row: 3, col: 4 });
  check("bothEliminated captures both pieces", m.captured, { blue: ["colonel"], red: ["colonel"] });
}

// --- gameWonByAttacker (flag vs flag): defender's flag captured ---
{
  const m = freshMatch();
  m.board["4,4"] = { team: "blue", type: "flag", id: "b1" };
  m.board["3,4"] = { team: "red", type: "flag", id: "r1" };
  m.move("blueSocket", { row: 4, col: 4 }, { row: 3, col: 4 });
  check("gameWonByAttacker captures defending flag", m.captured, { blue: [], red: ["flag"] });
}

// --- captured field is present in the client view ---
{
  const m = freshMatch();
  m.board["4,4"] = { team: "blue", type: "private", id: "b1" };
  m.board["3,4"] = { team: "red", type: "spy", id: "r1" };
  m.move("blueSocket", { row: 4, col: 4 }, { row: 3, col: 4 });
  const view = m.getViewFor("blue");
  check("captured exposed in getViewFor", view.captured, { blue: [], red: ["spy"] });
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
