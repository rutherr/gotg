const { resolveChallenge } = require("./gameRules");

const cases = [
  ["colonel", "captain", "attackerWins"],
  ["captain", "colonel", "defenderWins"],
  ["spy", "private", "defenderWins"],
  ["private", "spy", "attackerWins"],
  ["gen5", "spy", "defenderWins"],
  ["spy", "gen5", "attackerWins"],
  ["spy", "spy", "bothEliminated"],
  ["private", "private", "bothEliminated"],
  ["colonel", "colonel", "bothEliminated"],
  ["sergeant", "2ndlt", "defenderWins"],
  ["2ndlt", "sergeant", "attackerWins"],
  ["flag", "flag", "gameWonByAttacker"],
  ["gen5", "flag", "attackerWins"],
  ["flag", "gen5", "defenderWins"],
  ["private", "flag", "attackerWins"],
  ["flag", "private", "defenderWins"],
  ["spy", "flag", "attackerWins"],
];

let pass = 0;
for (const [a, d, expected] of cases) {
  const result = resolveChallenge(a, d);
  const ok = result === expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${a} vs ${d} -> ${result} (expected ${expected})`);
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
