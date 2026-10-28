// Balance sim: random 3-card hands vs random 3-card enemy lineups, with the real rules (engine.mjs).
// The player sees the enemy and plays the best order of their 3 cards (tries all 6, `trials` fights each);
// the enemy plays a random order. Same dice for every config (game #i always deals the same hands),
// so two configs are compared on the same games.
//
// Per card:  power = how many win-rate points the card is worth, averaged over both sides:
//            (win% when the player holds it − overall win%) and (overall win% − win% when the enemy holds it)
// Per battle: clashes (the 6+ clash target), ties.

import { CARDS, RULES, CARD_IDS } from './cards.mjs';
import { battle, makeRng } from './engine.mjs';

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// config: { cards?: { id: partial card }, pool?: [ids] }
export function resolveConfig(config = {}) {
  const cards = structuredClone(CARDS);
  for (const [id, over] of Object.entries(config.cards || {})) {
    cards[id] = { ...cards[id], ...over, effect: over.effect ? { ...cards[id].effect, ...over.effect } : cards[id].effect };
    if (over.trigger === null) { delete cards[id].trigger; delete cards[id].effect; }
  }
  return { rules: RULES, cards, ids: config.pool || CARD_IDS };
}

const draw3 = (ids, rng) => {
  const c = [...ids], out = [];
  while (out.length < 3) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]);
  return out;
};

export function playGame(i, { rules, cards, ids }, trials, seed) {
  const deal = makeRng(seed * 7919 + i);
  const hand = draw3(ids, deal);
  const enemy = draw3(ids, deal);
  let best = null;
  for (const perm of PERMS) {
    const lineup = perm.map(k => hand[k]);
    let w = 0, l = 0;
    for (let t = 0; t < trials; t++) {
      const r = battle(lineup, enemy, { rules, cards, rng: makeRng(seed * 104729 + i * 131 + t) });
      if (r.outcome === 'win') w++; else if (r.outcome === 'lose') l++;
    }
    if (!best || w > best.w || (w === best.w && l < best.l)) best = { w, l, lineup };
  }
  const r = battle(best.lineup, enemy, { rules, cards, rng: makeRng(seed * 15485863 + i) });
  return { hand, enemy, lineup: best.lineup, ...r };
}

export function evaluate(config, { games = 3000, trials = 6, seed = 1 } = {}) {
  const cfg = resolveConfig(config);
  const per = Object.fromEntries(cfg.ids.map(id => [id, { pN: 0, pW: 0, eN: 0, eW: 0, long: 0, n: 0, front: 0 }]));
  let wins = 0, ties = 0, timeouts = 0, long = 0;
  const clashList = [];
  for (let i = 0; i < games; i++) {
    const g = playGame(i, cfg, trials, seed);
    const win = g.outcome === 'win' ? 1 : 0;
    wins += win; ties += g.outcome === 'tie'; timeouts += g.timeout;
    clashList.push(g.clashes);
    const isLong = g.clashes >= 6;
    long += isLong;
    for (const id of g.hand) { per[id].pN++; per[id].pW += win; per[id].n++; per[id].long += isLong; }
    for (const id of g.enemy) { per[id].eN++; per[id].eW += win; per[id].n++; per[id].long += isLong; }
    per[g.lineup[0]].front++;
  }
  clashList.sort((a, b) => a - b);
  const q = p => clashList[Math.min(clashList.length - 1, Math.floor(p * clashList.length))];
  const all = wins / games;
  const cardsOut = cfg.ids.map(id => {
    const c = per[id];
    const pw = c.pW / c.pN, ew = c.eW / c.eN;
    return { id, power: 100 * ((pw - all) + (all - ew)) / 2, long: 100 * c.long / c.n, front: 100 * c.front / c.pN };
  }).sort((a, b) => b.power - a.power);
  const powers = cardsOut.map(c => c.power);
  const mean = powers.reduce((a, b) => a + b, 0) / powers.length;
  return {
    win: 100 * all, ties: 100 * ties / games, timeouts: 100 * timeouts / games,
    clashes: { mean: clashList.reduce((a, b) => a + b, 0) / games, p10: q(0.1), median: q(0.5), p90: q(0.9), long: 100 * long / games },
    spread: Math.sqrt(powers.reduce((a, p) => a + (p - mean) ** 2, 0) / powers.length),
    cards: cardsOut, defs: cfg.cards,
  };
}

export const fmt = (n, d = 1) => (n >= 0 ? ' ' : '') + n.toFixed(d);

// Grade bands (win-rate points): S 15+ · A 7 to 15 · B 2 to 7 · C −5 to 2 · D below −5
export const grade = p => (p >= 15 ? 'S' : p >= 7 ? 'A' : p >= 2 ? 'B' : p >= -5 ? 'C' : 'D');

export function report(name, r, { cards = true } = {}) {
  const lines = [
    `== ${name}`,
    `clashes mean ${r.clashes.mean.toFixed(1)} · p10 ${r.clashes.p10} · median ${r.clashes.median} · p90 ${r.clashes.p90} · 6+ clashes ${r.clashes.long.toFixed(1)}% · ties ${r.ties.toFixed(1)}% (timeouts ${r.timeouts.toFixed(1)}%) · power spread (sd) ${r.spread.toFixed(1)}`,
  ];
  if (!cards) {
    const tag = c => `${c.id} ${fmt(c.power, 0).trim()}`;
    lines.push(`  top: ${r.cards.slice(0, 4).map(tag).join(', ')} · bottom: ${r.cards.slice(-3).map(tag).join(', ')}`);
  } else {
    lines.push('  card        hp/atk  grade   power   6+clash%  front%');
    for (const c of r.cards) {
      const d = r.defs[c.id];
      lines.push(`  ${c.id.padEnd(11)} ${`${d.hp}/${d.atk}`.padStart(6)}    ${grade(c.power)}    ${fmt(c.power).padStart(6)}   ${c.long.toFixed(0).padStart(5)}    ${c.front.toFixed(0).padStart(4)}`);
    }
  }
  return lines.join('\n');
}
