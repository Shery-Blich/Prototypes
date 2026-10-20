#!/usr/bin/env node
// Headless balance simulator for Desert Fighters.
// Re-uses the REAL combat code (battle.js + characters.js) with a silent view,
// so whatever the prototype does, the sim does too.
//
//   node sim/sim.mjs                      # default: 4000 games, 3 slots
//   node sim/sim.mjs --games 20000        # more games = tighter numbers
//   node sim/sim.mjs --hp-bonus 3         # give EVERY card +3 hp (combat-length experiment)
//   node sim/sim.mjs --pool base          # only the 20 original ability cards
//   node sim/sim.mjs --pool vanilla       # only the plain cards from sim/cards.js
//   node sim/sim.mjs --order random       # player does NOT optimise order (worst-case player)
//   node sim/sim.mjs --json out.json      # also dump raw per-card numbers
//
// Model of the game:
//   * Enemy plays up to 3 cards in a random order (the designer places them in the real game).
//   * Player is dealt 3 random cards, SEES the enemy, and may play 1, 2 or 3 of them in any order.
//     With --order best (default) the player tries every arrangement a few times and keeps the best.
//   * WIN  = enemy wiped out  AND  player's total noise < enemy's total noise.

import { Battle } from '../battle.js';
import { CHARACTERS, applyCharacterOverrides, STARTER_PACK_IDS } from '../characters.js';
import { generateEncounter, ENCOUNTERS } from '../encounters.js';
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
// --enemy-set easy|medium|hard : enemies come from the designed lineups in encounters.js (else random from pool)
// --hand starter|all           : player's 3 cards drawn from the starter pack, or from the whole pool
const ENEMY_SET = args['enemy-set'] || null;
const HAND      = args.hand || 'all';
// --noise-rule  attack : (current) both front cards pay their noise every clash
//               played : each card pays its noise ONCE, when it is committed to the fight
//               step   : a card pays its noise each time it steps forward a slot (front slot is free)
//               death  : a card pays its noise when it dies
//               worm   : the Giant Worm from battle.js (WORM_RULES): shared meter, bites the loudest card.
//                        No noise comparison at the end: win = enemy wiped.
const NOISE_RULE = args['noise-rule'] || 'attack';
const WORM_EVERY = Number(args['worm-every'] || 6);
// --worm-bite N | noise | noise2   (damage per bite: fixed, = target's noise, = 2x target's noise)
const WORM_BITE_ARG = args['worm-bite'] || 'noise2';


// ─── deterministic RNG (battle.js uses Math.random) ───────────────────────────
let s = SEED >>> 0 || 1;
Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ─── silent view ──────────────────────────────────────────────────────────────
const noop = () => {};
const VIEW = { render: noop, wait: noop, log: noop, turn: noop, flash: noop, float: noop, effect: noop, noise: noop };

// ─── build the pool ───────────────────────────────────────────────────────────
applyCharacterOverrides(POOL === 'base' ? {} : CANDIDATE_OVERRIDES);
let POOL_IDS = Object.keys(CHARACTERS).filter(id => !EXCLUDE_IDS.has(id) && !CHARACTERS[id].token && !CHARACTERS[id].isCage);
if (POOL === 'vanilla') POOL_IDS = POOL_IDS.filter(id => !CHARACTERS[id].trigger);
const BASE_IDS = new Set(Object.keys(CHARACTERS).filter(id => !(id in CANDIDATE_OVERRIDES)));

// ─── one fight ────────────────────────────────────────────────────────────────
async function fight(playerIds, enemyIds) {
  const mk = ids => ids.map(id => ({ id, hpBonus: HP_BONUS, atkBonus: ATK_BONUS }));
  const wormOpts = NOISE_RULE === 'worm' ? { every: WORM_EVERY, bite: WORM_BITE_ARG } : null;
  const b = new Battle(mk(playerIds), mk(enemyIds), VIEW, { maxTeam: { player: SLOTS, enemy: SLOTS }, worm: wormOpts });
  let clashes = 0;
  const origClash = b.clash.bind(b);
  b.clash = (...a) => { clashes++; return origClash(...a); };
  if (NOISE_RULE !== 'attack' && NOISE_RULE !== 'worm') {
    b.makeNoise = noop;
    if (NOISE_RULE === 'played') {
      for (const side of ['player', 'enemy']) for (const u of b.teams[side]) b.noise[side] += u.noise;
    } else {
      const origClean = b.cleanUpDeadAndStepForward.bind(b);
      b.cleanUpDeadAndStepForward = async (...a) => {
        const before = {};
        for (const side of ['player', 'enemy']) b.teams[side].forEach((u, i) => { before[u.uid] = { u, i, side }; });
        await origClean(...a);
        for (const { u, i, side } of Object.values(before)) {
          const j = b.teams[side].indexOf(u);
          if (NOISE_RULE === 'step'  && j >= 0 && j < i) b.noise[side] += u.noise * (i - j);
          if (NOISE_RULE === 'death' && j < 0)           b.noise[side] += u.noise;
        }
      };
    }
  }
  const r = await b.run();
  const fightWon = r.outcome === 'win';
  const quieter  = NOISE_RULE === 'worm' ? true : r.noise.player < r.noise.enemy;
  return { fightWon, quieter, win: fightWon && quieter, equalNoise: r.noise.player === r.noise.enemy, clashes, noise: r.noise, worm: r.worm };
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

async function playGame(hand, enemy) {
  let lineup;
  if (ORDER === 'random') {
    lineup = hand;
  } else {
    let best = null;
    for (const arr of arrangements(hand)) {
      let w = 0, fw = 0, margin = 0;
      for (let t = 0; t < TRIALS; t++) {
        const r = await fight(arr, enemy);
        w += r.win; fw += r.fightWon; margin += r.noise.enemy - r.noise.player;
      }
      const score = w * 1000 + fw * 10 + margin / TRIALS / 100;
      if (!best || score > best.score) best = { score, arr };
    }
    lineup = best.arr;
  }
  const r = await fight(lineup, enemy);
  return { ...r, lineup };
}

// ─── run ──────────────────────────────────────────────────────────────────────
const stat = () => ({ hand: 0, played: 0, win: 0, fightWon: 0, loudLoss: 0, enemyGames: 0, enemyWins: 0, front: 0 });
const cards = Object.fromEntries(POOL_IDS.map(id => [id, stat()]));
const LINEUPS = {};
const W = { bites: 0, fightsBitten: 0, killsP: 0, killsE: 0, bittenP: 0, bittenE: 0, fightsWithKill: 0 };
const g = { games: 0, win: 0, fightWon: 0, quieter: 0, equalNoise: 0, clashes: 0, loudLoss: 0, pNoise: 0, eNoise: 0, played: 0 };

const t0 = Date.now();
for (let i = 0; i < GAMES; i++) {
  const draw = n => { const c = [...POOL_IDS], out = []; while (out.length < n) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return out; };
  const handPool = HAND === 'starter' ? STARTER_PACK_IDS : POOL_IDS;
  const drawFrom = (pool, n) => { const c = [...pool], out = []; while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return out; };
  const hand = drawFrom(handPool, SLOTS);
  const enemy = ENEMY_SET ? generateEncounter(ENEMY_SET, { rng: Math.random, maxSlots: SLOTS }).map(e => e.id) : draw(SLOTS);
  const r = await playGame(hand, enemy);
  g.games++; g.win += r.win; g.fightWon += r.fightWon; g.quieter += r.quieter; g.equalNoise += r.equalNoise;
  g.clashes += r.clashes; g.loudLoss += r.fightWon && !r.quieter; g.pNoise += r.noise.player; g.eNoise += r.noise.enemy; g.played += r.lineup.length;
  W.bites += r.worm.bites; W.fightsBitten += r.worm.bites > 0; W.killsP += r.worm.kills.player; W.killsE += r.worm.kills.enemy;
  W.bittenP += r.worm.bitten.player; W.bittenE += r.worm.bitten.enemy; W.fightsWithKill += (r.worm.kills.player + r.worm.kills.enemy) > 0;
  for (const id of hand) {
    const c = cards[id]; c.hand++; c.win += r.win; c.fightWon += r.fightWon; c.loudLoss += r.fightWon && !r.quieter;
    if (r.lineup.includes(id)) c.played++;
    if (r.lineup[0] === id) c.front++;
  }
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
    id, name: d.name, base: BASE_IDS.has(id), hp: d.hp, atk: d.atk, noise: d.noise ?? 1, trigger: d.trigger || '-',
    text: d.trigger ? d.text : '(no ability)',
    hand: c.hand,
    winRate: c.win / c.hand, delta: c.win / c.hand - baseWin,
    fightWon: c.fightWon / c.hand, loudLoss: c.loudLoss / c.hand,
    played: c.played / c.hand, front: c.front / c.hand,
    enemyWin: c.enemyWins / c.enemyGames,
  };
}).filter(r => r.hand > 0).sort((a, b) => b.delta - a.delta);

if (ENEMY_SET) {
  console.log(`\nEncounter set "${ENEMY_SET}" vs ${HAND} hands · ${GAMES} games  (player-loss rate per designed lineup, front card first)`);
  for (const [k, v] of Object.entries(LINEUPS).sort((a, b) => b[1].loss / b[1].n - a[1].loss / a[1].n))
    console.log(`  ${(100 * v.loss / v.n).toFixed(0).padStart(3)}% loss · ${(v.clashes / v.n).toFixed(1)} clashes · ${k.split(' › ').map(id => CHARACTERS[id]?.name || id).join(' › ')}`);
}
console.log(`\nDesert Fighters balance sim · ${GAMES} games · pool=${POOL} (${POOL_IDS.length} cards) · slots=${SLOTS} · hp+${HP_BONUS} · noise-rule=${NOISE_RULE} · enemies=${ENEMY_SET || 'random'} · hand=${HAND} · order=${ORDER} · ${secs}s\n`);
console.log(`Overall:  player WIN ${pct(g.win, g.games)}   fight won ${pct(g.fightWon, g.games)}   quieter ${pct(g.quieter, g.games)}   won-fight-but-too-loud ${pct(g.loudLoss, g.games)}   equal noise ${pct(g.equalNoise, g.games)}`);
console.log(`          avg clashes/fight ${(g.clashes / g.games).toFixed(2)}   avg cards played ${(g.played / g.games).toFixed(2)}   avg noise player ${(g.pNoise / g.games).toFixed(1)} / enemy ${(g.eNoise / g.games).toFixed(1)}\n`);
if (NOISE_RULE === 'worm') console.log(`Worm:     every ${WORM_EVERY} noise, bite ${WORM_BITE_ARG} · bites/fight ${(W.bites / g.games).toFixed(2)} · fights with a bite ${pct(W.fightsBitten, g.games)} · fights where the worm KILLED something ${pct(W.fightsWithKill, g.games)}\n          bites on player ${pct(W.bittenP, W.bites)} / enemy ${pct(W.bittenE, W.bites)} · kills: player cards ${(W.killsP / g.games).toFixed(2)}/fight, enemy cards ${(W.killsE / g.games).toFixed(2)}/fight\n`);
console.log('ΔWin  = win rate when this card is in the player\'s hand, minus the overall win rate (positive = good card for the player)');
console.log('Played= how often the player chose to actually field it · Front= how often it was put in front · Loud= won the fight but lost on noise');
console.log('AsEnemy = how often the PLAYER LOSES when this card is on the enemy team (higher = scarier as an enemy)\n');
console.log(' ΔWin  Win  Played Front Loud AsEnemy  hp/atk/noise  trig    name          ability');
for (const r of rows) {
  const dw = ((r.delta * 100 > 0 ? '+' : '') + (r.delta * 100).toFixed(1)).padStart(5);
  console.log(`${dw}  ${pct(r.winRate, 1)}  ${pct(r.played, 1)}  ${pct(r.front, 1)}  ${pct(r.loudLoss, 1)}  ${pct(r.enemyWin, 1)}    ${String(r.hp).padStart(2)}/${String(r.atk).padStart(2)}/${String(r.noise).padStart(2)}      ${r.trigger.padEnd(6)}  ${(r.base ? '' : '*') + r.name}`.padEnd(100) + r.text);
}
console.log('\n(* = candidate card from sim/cards.js, not in the prototype yet)');

if (args.json) {
  const fs = await import('node:fs');
  fs.writeFileSync(args.json, JSON.stringify({ config: { GAMES, SLOTS, HP_BONUS, ATK_BONUS, POOL, ORDER, NOISE_RULE }, overall: g, worm: W, cards: rows }, null, 2));
  console.log(`\nwrote ${args.json}`);
}
