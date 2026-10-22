// Terrain tiles for Desert Fighters Prototype 2.
// The lane has three slot columns (front, middle, back). Each column has ONE tile shared by both
// sides: the player's front card and the enemy's front card stand on the same tile. A card's tile is
// wherever it stands right now, so it changes when cards move. Slots past the third have no tile (Dune).
// Every tile is a RULE, never a number.

export const TILES = {
  dune:      { emoji: '🏜️', name: 'Dune',      rule: 'No rule.' },
  rock:      { emoji: '🪨', name: 'Rock',      rule: 'No ability fires from, or targets, a card here.' },
  oasis:     { emoji: '🌴', name: 'Oasis',     rule: 'A card here fires its trigger twice.' },
  quicksand: { emoji: '🌀', name: 'Quicksand', rule: 'After a card here clashes, it sinks to the back of its team.' },
  mirage:    { emoji: '🌫️', name: 'Mirage',    rule: "Other cards' abilities can't target a card here (attacks still hit it)." },
};

export const TILE_IDS = Object.keys(TILES);
export const COLUMN_NAMES = ['Front', 'Middle', 'Back'];
export const DEFAULT_TILES = ['dune', 'dune', 'dune'];

export const tileLabel = id => `${TILES[id]?.name || id} ${TILES[id]?.emoji || ''}`.trim();

// "rock,oasis,dune" -> ['rock', 'oasis', 'dune'] (unknown ids fall back to Dune)
export function parseTiles(str) {
  const ids = String(str || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [0, 1, 2].map(i => (TILES[ids[i]] ? ids[i] : 'dune'));
}

// One random tile set: every column rolls one of the five tiles, re-rolled until at most `maxDune`
// columns are Dune. `rng` must be the caller's seeded generator so sims stay deterministic.
export function randomTileSet(rng, maxDune = 1) {
  for (;;) {
    const set = [0, 1, 2].map(() => TILE_IDS[Math.floor(rng() * TILE_IDS.length)]);
    if (set.filter(t => t === 'dune').length <= maxDune) return set;
  }
}
