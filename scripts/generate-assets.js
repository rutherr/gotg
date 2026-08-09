const fs = require("fs");
const path = require("path");

// Piece definitions: id, display name, symbol glyph, symbol font-size tweak
const PIECES = [
  { id: "gen5", name: "Five-Star General", symbol: "★★★★★", size: 20 },
  { id: "gen4", name: "Four-Star General", symbol: "★★★★", size: 24 },
  { id: "gen3", name: "Three-Star General", symbol: "★★★", size: 28 },
  { id: "gen2", name: "Two-Star General", symbol: "★★", size: 32 },
  { id: "gen1", name: "One-Star General", symbol: "★", size: 40 },
  { id: "colonel", name: "Colonel", symbol: "●●●", size: 28 },
  { id: "ltcolonel", name: "Lieutenant Colonel", symbol: "●●", size: 32 },
  { id: "major", name: "Major", symbol: "●", size: 40 },
  { id: "captain", name: "Captain", symbol: "▲▲▲", size: 26 },
  { id: "1stlt", name: "First Lieutenant", symbol: "▲▲", size: 30 },
  { id: "2ndlt", name: "Second Lieutenant", symbol: "▲", size: 38 },
  { id: "sergeant", name: "Sergeant", symbol: "▲◦", size: 30 },
  { id: "private", name: "Private", symbol: "◦", size: 40 },
  { id: "spy", name: "Spy", symbol: "◉", size: 38 },
  { id: "flag", name: "Flag", symbol: "⚑", size: 42 },
];

const TEAMS = {
  blue: { base: "#1d4ed8", dark: "#1e3a8a", light: "#dbeafe" },
  red: { base: "#b91c1c", dark: "#7f1d1d", light: "#fee2e2" },
};

function badgeSVG(piece, team) {
  const c = TEAMS[team];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <radialGradient id="grad-${piece.id}-${team}" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="${c.base}"/>
      <stop offset="100%" stop-color="${c.dark}"/>
    </radialGradient>
  </defs>
  <circle cx="60" cy="60" r="56" fill="url(#grad-${piece.id}-${team})" stroke="${c.light}" stroke-width="3"/>
  <text x="60" y="66" font-family="Arial, sans-serif" font-size="${piece.size}" fill="${c.light}"
        text-anchor="middle" dominant-baseline="middle">${piece.symbol}</text>
</svg>`;
}

const outDir = path.join(__dirname, "..", "public", "assets", "pieces");
fs.mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const team of Object.keys(TEAMS)) {
  for (const piece of PIECES) {
    const filename = `${team}_${piece.id}.svg`;
    fs.writeFileSync(path.join(outDir, filename), badgeSVG(piece, team));
    manifest.push({ id: piece.id, name: piece.name, team, file: `assets/pieces/${filename}` });
  }
}

fs.writeFileSync(
  path.join(__dirname, "..", "public", "assets", "pieces", "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(`Generated ${manifest.length} piece icons (${PIECES.length} ranks x 2 teams).`);
