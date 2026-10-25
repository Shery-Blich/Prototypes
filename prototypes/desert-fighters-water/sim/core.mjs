// Shared sim engine: the REAL combat code (battle.js + characters.js) with a silent view.
// No animations, no timers: battle.js only waits through view.wait, which is a no-op here.
// Used by combos-worker.mjs (3-card combo search). sim.mjs still has its own copy of this loop.

import { Battle } from '../battle.js';
import { CHARACTERS, applyCharacterOverrides } from '../characters.js';
import { CANDIDATE_OVERRIDES, EXCLUDE_IDS } from './cards.js';

const noop = () => {};
export const VIEW = { render: noop, wait: noop, log: noop, turn: noop, flash: noop, float: noop, effect: noop };

// xorshift32, seedable. reseed(i) makes game #i use the same dice for every lineup (common random numbers),
// so two triples facing game #i meet the same enemy and the same rolls: fairer comparisons.
let s = 1;
export function reseed(seed) { s = (seed >>> 0) || 1; for (let k = 0; k < 4; k++) rand(); }
export function rand() { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }
Math.random = rand;
// Save / restore the dice, so a side calculation (a win-rate estimate) doesn't shift the main stream
export const getRng = () => s;
export const setRng = v => { s = v; };

// strip: card ids that lose their ability (control runs: "is it the new ability, or just losing the old one?")
export function buildPool(pool = 'base', strip = []) {
  const overrides = { ...(pool === 'base' ? {} : CANDIDATE_OVERRIDES) };
  for (const id of strip) overrides[id] = { ...overrides[id], trigger: null, preset: null, run: undefined, preview: undefined, text: '(no ability)' };
  applyCharacterOverrides(overrides);
  let ids = Object.keys(CHARACTERS).filter(id => !EXCLUDE_IDS.has(id) && !CHARACTERS[id].token && !CHARACTERS[id].isCage);
  if (pool === 'vanilla') ids = ids.filter(id => !CHARACTERS[id].trigger);
  return ids;
}

export function drawFrom(pool, n) {
  const c = [...pool], out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
  return out;
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

export async function fight(playerIds, enemyIds, cfg) {
  const mk = ids => ids.map(id => ({ id, hpBonus: cfg.hpBonus || 0, atkBonus: cfg.atkBonus || 0 }));
  const b = new Battle(mk(playerIds), mk(enemyIds), VIEW);
  const r = await b.run();
  return { win: r.outcome === 'win', outcome: r.outcome };
}

// Player sees the enemy and tries every arrangement of 1..3 of their cards, `trials` fights each, keeps the best.
export async function playGame(hand, enemy, cfg) {
  let best = null;
  for (const arr of arrangements(hand)) {
    let w = 0;
    for (let t = 0; t < cfg.trials; t++) w += (await fight(arr, enemy, cfg)).win;
    if (!best || w > best.w) best = { w, arr };
  }
  const r = await fight(best.arr, enemy, cfg);
  return { ...r, lineup: best.arr };
}
