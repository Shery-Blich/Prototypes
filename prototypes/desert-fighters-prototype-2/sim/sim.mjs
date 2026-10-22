#!/usr/bin/env node
// Headless balance simulator for Desert Fighters (prototype 2: terrain tiles).
// Re-uses the REAL combat code (battle.js + characters.js) with a silent view,
// so whatever the prototype does, the sim does too. Runs in the browser through sim/run.html.
//
//   run.html?args=--pool base --games 12000           # roster sweep
//   --games 20000        # more games = tighter numbers
//   --hp-bonus 3         # give EVERY card +3 hp (combat-length experiment)
//   --pool base          # only the cards in characters.js
//   --pool vanilla       # only the plain cards from sim/cards.js
//   --order random       # player does NOT optimise order (plays the hand as dealt)
//   --tiles random       # (default) one random tile set per game, at most --max-dune Dunes (default 1)
//   --tiles rock,oasis,dune   # every game on this fixed set (dune,dune,dune = no terrain)
//
// Model of the game:
//   * Enemy plays up to 3 cards in a random order (the designer places them in the real game).
//   * The tile set is drawn right after the enemy, from the same seeded dice.
//   * Player is dealt 3 random cards, SEES the enemy and the tiles, and may play 1, 2 or 3 of them in any order.
//     With --order best (default) the player tries every arrangement a few times and keeps the best.
//   * WIN = enemy wiped out.

import { Battle } from '../battle.js';
import { CHARACTERS, applyCharacterOverrides, STARTER_PACK_IDS } from '../characters.js';
import { generateEncounter } from '../encounters.js';
import { TILE_IDS, parseTiles, randomTileSet, tileLabel } from '../tiles.js';
import { CANDIDATE_OVERRIDES, EXCLUDE_IDS } from './cards.js';

// ─── args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) =>
  a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []
).filter(x => x.length));
const GAMES    = Number(args.games || 4000);
const SLOTS    = Number(args.slots || 3);
const HP_BONUS = Number(args['hp-bonus'] || 0);
const ATK_BONUS = Number(args['atk-bonus'] || 0);
const POOL     = args.pool || 'all';
const ORDER    = args.order || 'best';
const TRIALS   = Number(args.trials || 3);   // fights per arrangement when choosing order
const SEED     = Number(args.seed || 1);
const TILES_ARG = args.tiles || 'random';
const MAX_DUNE  = Number(args['max-dune'] ?? 1);
// --enemy-set easy|medium|hard : enemies come from the designed lineups in encounters.js (else random from pool)
// --hand starter|all           : player's 3 cards drawn from the starter pack, or from the whole pool
const ENEMY_SET = args['enemy-set'] || null;
const HAND      = args.hand || 'all';

// ─── deterministic RNG (battle.js uses Math.random) ───────────────────────────
let s = SEED >>> 0 || 1;
Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

// ─── silent view ──────────────────────────────────────────────────────────────
const noop = () => {};
const VIEW = { render: noop, wait: noop, log: noop, turn: noop, flash: noop, float: noop, effect: noop };

// ─── build the pool ───────────────────────────────────────────────────────────
applyCharacterOverrides(POOL === 'base' ? {} : CANDIDATE_OVERRIDES);
let POOL_IDS = Object.keys(CHARACTERS).filter(id => !EXCLUDE_IDS.has(id) && !CHARACTERS[id].token && !CHARACTERS[id].isCage);
if (POOL === 'vanilla') POOL_IDS = POOL_IDS.filter(id => !CHARACTERS[id].trigger);
const BASE_IDS = new Set(Object.keys(CHARACTERS).filter(id => !(id in CANDIDATE_OVERRIDES)));

// ─── one fight ────────────────────────────────────────────────────────────────
async function fight(playerIds, enemyIds, tiles) {
  const mk = ids => ids.map(id => ({ id, hpBonus: HP_BONUS, atkBonus: ATK_BONUS }));
  const b = new Battle(mk(playerIds), mk(enemyIds), VIEW, { maxTeam: { player: SLOTS, enemy: SLOTS }, tiles });
  let clashes = 0;
  const origClash = b.clash.bind(b);
  b.clash = (...a) => { clashes++; return origClash(...a); };
  const r = await b.run();
  return { win: r.outcome === 'win', clashes, tileStats: r.tileStats };
}

// all ordered arrangements of 1..n cards from hand
function arrangements(hand) {
  const out = [];
  const rec = (prefix, rest) => {
    if (prefix.length) out.push(prefix);
    for (let i = 0; i < rest.length; i++) rec([...prefix, rest[i]], rest.filter((_, j) => j !== i));
  };
  rec([], hand);
  return out;
}

async function playGame(hand, enemy, tiles) {
  let lineup;
  if (ORDER === 'random') {
    lineup = hand;
  } else {
    let best = null;
    for (const arr of arrangements(hand)) {
      let w = 0;
      for (let t = 0; t < TRIALS; t++) w += (await fight(arr, enemy, tiles)).win;
      if (!best || w > best.w) best = { w, arr };
    }
    lineup = best.arr;
  }
  const r = await fight(lineup, enemy, tiles);
  return { ...r, lineup };
}

// ─── run ──────────────────────────────────────────────────────────────────────
const stat = () => ({ hand: 0, played: 0, win: 0, enemyGames: 0, enemyWins: 0, front: 0 });
const cards = Object.fromEntries(POOL_IDS.map(id => [id, stat()]));
const LINEUPS = {};
const PAIRS = {};       // 'idA|idB' (both in hand) -> { n, win, both: both fielded }
const WIN_USE = {};     // id -> times fielded in a won fight
const TILE_CLASS = {};  // tile -> class -> cards of that class starting a WON fight on that tile
const TS = { blocked: 0, oasis: 0, sank: 0, untargetable: 0, entered: 0 };
const g = { games: 0, win: 0, clashes: 0, played: 0 };

const t0 = Date.now();
for (let i = 0; i < GAMES; i++) {
  const draw = n => { const c = [...POOL_IDS], out = []; while (out.length < n) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return out; };
  const handPool = HAND === 'starter' ? STARTER_PACK_IDS : POOL_IDS;
  const drawFrom = (pool, n) => { const c = [...pool], out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return out; };
  const hand = drawFrom(handPool, SLOTS);
  const enemy = ENEMY_SET ? generateEncounter(ENEMY_SET, { rng: Math.random, maxSlots: SLOTS }).map(e => e.id) : draw(SLOTS);
  const tiles = TILES_ARG === 'random' ? randomTileSet(Math.random, MAX_DUNE) : parseTiles(TILES_ARG);
  const r = await playGame(hand, enemy, tiles);
  g.games++; g.win += r.win; g.clashes += r.clashes; g.played += r.lineup.length;
  for (const k in TS) TS[k] += r.tileStats[k];
  for (const id of hand) {
    const c = cards[id]; c.hand++; c.win += r.win;
    if (r.lineup.includes(id)) c.played++;
    if (r.lineup[0] === id) c.front++;
  }
  const sorted = [...hand].sort();
  for (let a = 0; a < sorted.length; a++) for (let b = a + 1; b < sorted.length; b++) {
    const p = (PAIRS[sorted[a] + '|' + sorted[b]] ??= { n: 0, win: 0, both: 0 });
    p.n++; p.win += r.win; p.both += r.lineup.includes(sorted[a]) && r.lineup.includes(sorted[b]);
  }
  if (r.win) r.lineup.forEach((id, slot) => {
    WIN_USE[id] = (WIN_USE[id] || 0) + 1;
    const t = (TILE_CLASS[tiles[slot] || 'dune'] ??= {}), cls = CHARACTERS[id].class || 'plain';
    t[cls] = (t[cls] || 0) + 1;
  });
  for (const id of enemy) { if (cards[id]) { cards[id].enemyGames++; cards[id].enemyWins += !r.win; } }
  if (ENEMY_SET) { const k = enemy.join(' › '); (LINEUPS[k] ??= { n: 0, loss: 0, clashes: 0 }); LINEUPS[k].n++; LINEUPS[k].loss += !r.win; LINEUPS[k].clashes += r.clashes; }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// ─── report ───────────────────────────────────────────────────────────────────
const pct = (a, b) => b ? (100 * a / b).toFixed(0).padStart(3) + '%' : '  - ';
const baseWin = g.win / g.games;
const rows = POOL_IDS.map(id => {
  const c = cards[id], d = CHARACTERS[id];
  return {
    id, name: d.name, base: BASE_IDS.has(id), hp: d.hp, atk: d.atk, trigger: d.trigger || '-',
    text: d.trigger ? d.text : '(no ability)',
    hand: c.hand,
    winRate: c.win / c.hand, delta: c.win / c.hand - baseWin,
    played: c.played / c.hand, front: c.front / c.hand,
    enemyWin: c.enemyWins / c.enemyGames,
  };
}).filter(r => r.hand > 0).sort((a, b) => b.delta - a.delta);

if (ENEMY_SET) {
  console.log(`\nEncounter set "${ENEMY_SET}" vs ${HAND} hands · ${GAMES} games  (player-loss rate per designed lineup, front card first)`);
  for (const [k, v] of Object.entries(LINEUPS).sort((a, b) => b[1].loss / b[1].n - a[1].loss / a[1].n))
    console.log(`  ${(100 * v.loss / v.n).toFixed(0).padStart(3)}% loss · ${(v.clashes / v.n).toFixed(1)} clashes · ${k.split(' › ').map(id => CHARACTERS[id]?.name || id).join(' › ')}`);
}
const tilesDesc = TILES_ARG === 'random' ? `random (≤${MAX_DUNE} Dune)` : parseTiles(TILES_ARG).join(',');
console.log(`\nDesert Fighters balance sim · ${GAMES} games · pool=${POOL} (${POOL_IDS.length} cards) · slots=${SLOTS} · hp+${HP_BONUS} · tiles=${tilesDesc} · enemies=${ENEMY_SET || 'random'} · hand=${HAND} · order=${ORDER} · seed ${SEED} · ${secs}s\n`);
console.log(`Overall:  player WIN ${pct(g.win, g.games)}   avg clashes/fight ${(g.clashes / g.games).toFixed(2)}   avg cards played ${(g.played / g.games).toFixed(2)}`);
const per = k => (TS[k] / g.games).toFixed(2);
console.log(`Terrain per fight: 🪨 abilities silenced ${per('blocked')} · 🌴 extra triggers ${per('oasis')} · 🌀 sinks ${per('sank')} · 🌫️/🪨 targets dodged ${per('untargetable')} · 🧭 tile entries fired ${per('entered')}\n`);
console.log('ΔWin  = win rate when this card is in the player\'s hand, minus the overall win rate (positive = good card for the player)');
console.log('Played= how often the player chose to actually field it · Front= how often it was put in front');
console.log('AsEnemy = how often the PLAYER LOSES when this card is on the enemy team (higher = scarier as an enemy)\n');
console.log(' ΔWin  Win  Played Front AsEnemy  hp/atk  trig    name          ability');
for (const r of rows) {
  const dw = ((r.delta * 100 > 0 ? '+' : '') + (r.delta * 100).toFixed(1)).padStart(5);
  console.log(`${dw}  ${pct(r.winRate, 1)}  ${pct(r.played, 1)}  ${pct(r.front, 1)}  ${pct(r.enemyWin, 1)}    ${String(r.hp).padStart(2)}/${String(r.atk).padStart(2)}   ${r.trigger.padEnd(6)}  ${(r.base ? '' : '*') + r.name}`.padEnd(92) + r.text);
}
console.log('\n(* = candidate card from sim/cards.js, not in the prototype yet)');

// ─── variety ──────────────────────────────────────────────────────────────────
// Card spread: how far cards sit from average (lower SD / more cards within ±5 = more cards worth taking).
// Win diversity: exp(entropy) of which cards are fielded in WON fights = "effective number" of winning cards.
// Synergy: a pair's win rate when both are in hand, minus what their two solo ΔWins predict.
//   A big positive number means the pair is better together than apart (a real combo).
{
  const deltas = rows.map(r => r.delta * 100);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length);
  const within = deltas.filter(d => Math.abs(d) <= 5).length;
  const uses = Object.values(WIN_USE), total = uses.reduce((a, b) => a + b, 0);
  const effCards = Math.exp(-uses.reduce((a, u) => a + (u / total) * Math.log(u / total), 0));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const MIN_N = Math.max(30, Math.floor(GAMES * 3 / (POOL_IDS.length * (POOL_IDS.length - 1) / 2) * 0.5));
  const syn = Object.entries(PAIRS).filter(([, p]) => p.n >= MIN_N).map(([k, p]) => {
    const [a, b] = k.split('|');
    const expected = baseWin + byId[a].delta + byId[b].delta;
    return { a, b, n: p.n, syn: (p.win / p.n - expected) * 100, both: p.both / p.n };
  }).sort((x, y) => y.syn - x.syn);
  const seAvg = 100 * Math.sqrt(baseWin * (1 - baseWin) / (syn.reduce((a, s) => a + s.n, 0) / (syn.length || 1)));
  const strong = syn.filter(s => s.syn >= 2.5 * seAvg && s.both >= 0.5);
  console.log(`\nVariety:  card ΔWin spread SD ${sd.toFixed(1)} · cards within ±5: ${within}/${rows.length} · effective winning cards ${effCards.toFixed(1)}/${rows.length}`);
  console.log(`          combos: ${syn.length} pairs measured (≥${MIN_N} hands each, ±${seAvg.toFixed(1)} noise) · strong combos (synergy ≥ +${(2.5 * seAvg).toFixed(1)}, fielded together ≥50%): ${strong.length}`);
  const nm = id => CHARACTERS[id].name;
  for (const s of syn.slice(0, 8)) console.log(`          ${('+' + s.syn.toFixed(1)).padStart(6)}  together ${pct(s.both, 1)}  ${nm(s.a)} + ${nm(s.b)}`);
}

// ─── solved-tile check ───────────────────────────────────────────────────────
console.log(`\nSolved-tile check (cards fielded in won fights, by the tile of their starting slot; "solved" = one class > 70%)`);
for (const t of TILE_IDS) {
  const by = Object.entries(TILE_CLASS[t] || {}).sort((a, b) => b[1] - a[1]);
  const total = by.reduce((a, [, n]) => a + n, 0);
  if (!total) { console.log(`  ${tileLabel(t).padEnd(12)}      0`); continue; }
  const share = by[0][1] / total;
  console.log(`  ${tileLabel(t).padEnd(12)}${String(total).padStart(7)}  ${by[0][0].padEnd(8)} ${pct(share, 1)}   then ${by.slice(1, 3).map(([c, n]) => `${c} ${pct(n, total)}`).join(', ')}${share > 0.7 ? '   ← SOLVED' : ''}`);
}
