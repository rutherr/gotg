// Rank hierarchy, highest to lowest (used for standard officer-vs-officer combat)
const RANK_ORDER = [
  "gen5", "gen4", "gen3", "gen2", "gen1",
  "colonel", "ltcolonel", "major", "captain",
  "1stlt", "2ndlt", "sergeant",
];

const RANK_VALUE = Object.fromEntries(RANK_ORDER.map((r, i) => [r, RANK_ORDER.length - i]));

const PIECE_COUNTS = {
  gen5: 1, gen4: 1, gen3: 1, gen2: 1, gen1: 1,
  colonel: 1, ltcolonel: 1, major: 1, captain: 1,
  "1stlt": 1, "2ndlt": 1, sergeant: 1,
  private: 6, spy: 2, flag: 1,
};

/**
 * Resolves a challenge between an attacking piece and a defending piece.
 * Returns one of: "attackerWins", "defenderWins", "bothEliminated", "gameWonByAttacker"
 *
 * Rules:
 * - Spy beats any officer (gen5 down to sergeant), loses to Private
 * - Private beats Spy, loses to any officer
 * - Flag is eliminated by anything; Flag vs Flag = attacking flag wins the game
 * - Officer vs officer: higher rank wins; equal rank = both eliminated
 */
function resolveChallenge(attackerType, defenderType) {
  if (attackerType === "flag" && defenderType === "flag") {
    return "gameWonByAttacker"; // challenging flag wins per official rules
  }
  if (defenderType === "flag" || attackerType === "flag") {
    // Flag loses to anything it touches or is touched by (non-flag-vs-flag case)
    return attackerType === "flag" ? "defenderWins" : "attackerWins";
  }
  if (attackerType === "spy" && defenderType === "spy") return "bothEliminated";
  if (attackerType === "spy") {
    return defenderType === "private" ? "defenderWins" : "attackerWins";
  }
  if (defenderType === "spy") {
    return attackerType === "private" ? "attackerWins" : "defenderWins";
  }
  if (attackerType === "private" && defenderType === "private") return "bothEliminated";

  // Standard officer-vs-officer comparison
  const a = RANK_VALUE[attackerType] ?? 0; // privates have no RANK_VALUE entry -> 0
  const d = RANK_VALUE[defenderType] ?? 0;
  if (a === d) return "bothEliminated";
  return a > d ? "attackerWins" : "defenderWins";
}

module.exports = { RANK_ORDER, RANK_VALUE, PIECE_COUNTS, resolveChallenge };
