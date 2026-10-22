// Shared sim engine: the REAL combat code (battle.js + characters.js) with a silent view.
// No animations, no timers: battle.js only waits through view.wait, which is a no-op here.
// Used by combos-worker.mjs (3-card combo search). sim.mjs still has its own copy of this loop.

import { Battle } from '../battle.js';
import { CHARACTERS, applyCharacterOverrides } from '../characters.js';
import { parseTiles, randomTileSet } from '../tiles.js';
import { CANDIDATE_OVERRIDES, EXCLUDE_IDS } from './cards.js';

const noop = () => {};
export const VIEW = { render: noop, wait: noop, log: noop, turn: noop, flash: noop, float: noop, effect: noop };

// xorshift32, seedable. reseed(i) makes game #i use the same dice for every lineup (common random numbers),
// so two triples facing game #i meet the same enemy, the same tiles and the same rolls: fairer comparisons.
let s = 1;
export function reseed(seed) { s = (seed >>> 0) || 1; for (let k = 0; k < 4; k++) rand(); }
export function rand() { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }
Math.random = rand;

export function buildPool(pool = 'base') {
  applyCharacterOverrides(pool === 'base' ? {} : CANDIDATE_OVERRIDES);
  let ids = Object.keys(CHARACTERS).filter(id => !EXCLUDE_IDS.has(id) && !CHARACTERS[id].token && !CHARACTERS[id].isCage);
  if (pool === 'vanilla') ids = ids.filter(id => !CHARACTERS[id].trigger);
  return ids;
}

export function drawFrom(pool, n) {
  const c = [...pool], out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
  return out;
}

// --tiles random | rock,oasis,dune : the tile set of one game, drawn right after its enemy
export function drawTiles(cfg) {
  return cfg.tiles === 'random' ? randomTileSet(rand, cfg.maxDune ?? 1) : parseTiles(cfg.tiles);
}

// all ordered arrangements of 1..n cards from hand
export function arrangements(hand) {
  const out = [];
  const rec = (prefix, rest) => {
    if (prefix.length) out.push(prefix);
    for (let i = 0; i < rest.length; i++) rec([...prefix, rest[i]], rest.filter((_, j) => j !== i));
  };
  rec([], hand);
  return out;
}

export async function fight(playerIds, enemyIds, cfg, tiles) {
  const mk = ids => ids.map(id => ({ id, hpBonus: cfg.hpBonus || 0, atkBonus: cfg.atkBonus || 0 }));
  const b = new Battle(mk(playerIds), mk(enemyIds), VIEW, { maxTeam: { player: cfg.slots, enemy: cfg.slots }, tiles });
  const r = await b.run();
  return { win: r.outcome === 'win', tileStats: r.tileStats };
}

// Player sees the enemy AND the tiles and tries every arrangement of 1..3 of their cards, `trials` fights each, keeps the best.
export async function playGame(hand, enemy, cfg, tiles) {
  let best = null;
  for (const arr of arrangements(hand)) {
    let w = 0;
    for (let t = 0; t < cfg.trials; t++) w += (await fight(arr, enemy, cfg, tiles)).win;
    if (!best || w > best.w) best = { w, arr };
  }
  const r = await fight(best.arr, enemy, cfg, tiles);
  return { ...r, lineup: best.arr };
}
