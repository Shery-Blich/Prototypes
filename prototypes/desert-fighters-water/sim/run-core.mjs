// Level-run simulator engine: whole expeditions on the real map (map.js), the real encounters
// (encounters.js) and the real combat (battle.js), with the water rules from water.js.
// Used by runs-worker.mjs. Same run rules as main.js:
//   * squad = the starter pack, up to 3 in a fight + 10 in camp; the whole squad is available at prep
//   * each step: walk to an unvisited neighbour that can still reach an extraction point
//   * battle node: see the enemy, then field 1-3 cards (in order) or evacuate (free, keeps every card)
//   * win: recruit from the defeated lineup (easy 1, medium 2, hard 3 picks) · lose: the fielded cards are lost
//   * 2 or fewer cards left after a fight: forced evacuation · extraction node: run complete
//   * score = 25 per win + 50 if the run succeeds (the game's run XP without its 22 per card played:
//     with water, playing cards is the spend, so paying XP for it would reward burning water). XP is still reported.
// Water (water.js): off = no limit · mana = one run supply, fielding spends the cards' water ·
//                   uses = each card has its own water, -1 per fight it is fielded in, 0 = can't be fielded

import { CHARACTERS, STARTER_PACK_IDS, RECRUITABLE, XP_CONFIG } from '../characters.js';
import { TEAM_SLOTS } from '../battle.js';
import { generateEncounter } from '../encounters.js';
import { MAP_NODES, canReachExtraction } from '../map.js';
import { waterOf, powerOf, RUN_WATER, USES_CURVES } from '../water.js';
import { fight, reseed, rand, getRng, setRng } from './core.mjs';

const CAMP_MAX = 10;
const SQUAD_MAX = TEAM_SLOTS + CAMP_MAX;
const PICKS = { easy: 1, medium: 2, hard: 3 };          // DIFFICULTIES[..].pickCount in main.js
const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };

// ─── win-rate estimates (memoised, on their own dice so the run's stream is untouched) ─────────
const memo = new Map();
const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const memoSize = () => memo.size;

async function winRate(ids, enemy, cfg) {
  const key = ids.join(',') + '>' + enemy.join(',');
  let p = memo.get(key);
  if (p !== undefined) return p;
  const saved = getRng();
  reseed(hash(key) ^ cfg.seed);
  let w = 0;
  for (let t = 0; t < cfg.est; t++) w += (await fight(ids, enemy, cfg)).win;
  setRng(saved);
  p = w / cfg.est;
  memo.set(key, p);
  return p;
}

// ─── water ─────────────────────────────────────────────────────────────────────
const cost = (id, cfg) => waterOf(id, cfg.mode, cfg.flat);
// uses: cfg.usesCurve picks a tuning curve from water.js; else cfg.usesOffset shifts every card's uses (min 1)
const usesOf = (id, cfg) => (cfg.usesCurve && cfg.flat == null ? USES_CURVES[cfg.usesCurve](powerOf(id)) : Math.max(1, cost(id, cfg) + (cfg.usesOffset || 0)));

function canField(cards, st, cfg) {
  if (cfg.mode === 'mana') return cards.reduce((a, c) => a + cost(c.id, cfg), 0) <= st.water;
  if (cfg.mode === 'uses') return cards.every(c => c.uses > 0);
  return true;
}

function spend(cards, st, cfg) {
  if (cfg.mode === 'mana') st.water -= cards.reduce((a, c) => a + cost(c.id, cfg), 0);
  if (cfg.mode === 'uses') for (const c of cards) c.uses--;
}

const newCard = (id, st, cfg) => ({ uid: st.nextUid++, id, uses: cfg.mode === 'uses' ? usesOf(id, cfg) : Infinity });

// Starting squad: the whole starter pack (cfg.squad 0), or cfg.squad cards drawn from the starter pack
// (cfg.squadPool 'starter') or from every recruitable card ('all', like newRun's 4 random cards in main.js).
// Drawn from the run's own dice, so every policy starts run #i with the same squad.
export function newRun(cfg) {
  const st = { roster: [], water: cfg.mode === 'mana' ? cfg.water : Infinity, node: 'start', visited: ['start'], battleNum: 0,
    wins: 0, fights: 0, cardsPlayed: 0, nextUid: 1, end: null, success: false, fielded: [], wonLineups: [], enemyShift: cfg.enemyShift || 0 };
  let ids = STARTER_PACK_IDS;
  if (cfg.squad) {
    const pool = [...(cfg.squadPool === 'all' ? RECRUITABLE : STARTER_PACK_IDS)];
    ids = [];
    while (ids.length < cfg.squad && pool.length) ids.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  st.roster = ids.map(id => newCard(id, st, cfg));
  return st;
}

const clone = st => ({ ...st, roster: st.roster.map(c => ({ ...c })), visited: [...st.visited], fielded: [], wonLineups: [] });

export function score(st) {
  return XP_CONFIG.levelCleared * st.wins + XP_CONFIG.runCompletionBonus * (st.success ? 1 : 0);
}

// The game's own run XP (finalizeRunXp in main.js), for the report
export function xp(st) {
  return XP_CONFIG.cardPlayed * st.cardsPlayed + XP_CONFIG.levelCleared * st.wins + XP_CONFIG.runCompletionBonus * (st.success ? 1 : 0);
}

// ─── options ───────────────────────────────────────────────────────────────────
export function nextNodes(st) {
  return (MAP_NODES[st.node]?.neighbors || []).filter(n => !st.visited.includes(n) && canReachExtraction(n, st.visited));
}

// Every legal ordered lineup of 1..3 squad cards. Copies of the same card are interchangeable: one
// lineup per id sequence, using the copy with the most water left.
export async function legalLineups(st, enemy, cfg) {
  const cards = [...st.roster].sort((a, b) => b.uses - a.uses);
  const out = [], seen = new Set();
  const rec = (prefix) => {
    if (prefix.length) {
      const key = prefix.map(c => c.id).join(',');
      if (!seen.has(key) && canField(prefix, st, cfg)) { seen.add(key); out.push({ cards: prefix, ids: prefix.map(c => c.id) }); }
    }
    if (prefix.length === TEAM_SLOTS) return;
    for (const c of cards) if (!prefix.includes(c)) rec([...prefix, c]);
  };
  rec([]);
  for (const l of out) {
    l.p = await winRate(l.ids, enemy.ids, cfg);
    l.cost = cfg.mode === 'mana' ? l.ids.reduce((a, id) => a + cost(id, cfg), 0) : l.ids.length;
  }
  // Best first: highest win rate, then the cheapest in water, then the fewest cards
  return out.sort((a, b) => b.p - a.p || a.cost - b.cost || a.ids.length - b.ids.length);
}

// ─── steps ─────────────────────────────────────────────────────────────────────
function endRun(st, reason, success) { st.end = reason; st.success = success; }

export function enemyFor(st, nodeId) {
  const base = st.battleNum === 1 ? 'easy' : MAP_NODES[nodeId].difficulty;   // battle 1 is always easy
  // enemyShift moves every encounter up the designed tiers (easy → medium → hard), never adds stats
  const tiers = ['easy', 'medium', 'hard'];
  const diff = tiers[Math.min(2, tiers.indexOf(base) + (st.enemyShift || 0))];
  return { diff, ids: generateEncounter(diff, { rng: rand, maxSlots: TEAM_SLOTS }).map(e => e.id) };
}

// Walk onto a node. A battle node returns its enemy (the prep screen); extraction ends the run.
export function walk(st, nodeId) {
  const node = MAP_NODES[nodeId];
  if (node.type === 'extract') {
    st.node = nodeId; st.visited.push(nodeId);
    endRun(st, 'extracted', true);
    return null;
  }
  st.battleNum++;
  return enemyFor(st, nodeId);
}

// Recruits: the strongest candidates first; a full squad swaps out its weakest card (a dry card first)
function recruit(st, candidates, picks, cfg) {
  const value = c => (cfg.mode === 'uses' && c.uses <= 0 ? -1e9 : powerOf(c.id));
  const ranked = [...candidates].sort((a, b) => powerOf(b) - powerOf(a)).slice(0, picks);
  for (const id of ranked) {
    if (st.roster.length < SQUAD_MAX) { st.roster.push(newCard(id, st, cfg)); continue; }
    const weakest = st.roster.reduce((a, c) => (value(c) < value(a) ? c : a));
    if (value(weakest) < powerOf(id)) st.roster[st.roster.indexOf(weakest)] = newCard(id, st, cfg);
  }
}

// Fight with `lineup` (or evacuate when lineup is null), then arrive on the node.
export async function resolve(st, nodeId, enemy, lineup, cfg) {
  if (!lineup) { endRun(st, st.dry ? 'dry' : 'evac', st.wins > 0); return null; }
  const r = await fight(lineup.ids, enemy.ids, cfg);
  st.fights++; st.cardsPlayed += lineup.ids.length;
  spend(lineup.cards, st, cfg);
  st.fielded.push(...lineup.ids);
  st.node = nodeId; st.visited.push(nodeId);
  if (r.outcome === 'win') {
    st.wins++;
    st.wonLineups.push([...lineup.ids].sort().join('+'));
    const pool = cfg.recruit === 'random' ? Array.from({ length: 3 }, () => RECRUITABLE[Math.floor(rand() * RECRUITABLE.length)]) : enemy.ids;
    recruit(st, pool, PICKS[enemy.diff], cfg);
  } else if (r.outcome === 'lose') {
    const lost = new Set(lineup.cards.map(c => c.uid));
    st.roster = st.roster.filter(c => !lost.has(c.uid));
  }
  if (st.roster.length === 0) endRun(st, 'wiped', false);
  else if (st.roster.length <= 2) endRun(st, 'forced', false);
  return r.outcome;
}

// ─── policies ──────────────────────────────────────────────────────────────────
// greedy : the route with the most battles (easier first on ties), extract only at its end; field the
//          lineup with the best win rate now (cheapest among equals); evacuate only when dry.
// random : any legal node, any legal lineup.
// plan   : every decision (where to walk, which lineup, or evacuate) is scored by `rollouts` greedy
//          playouts of the rest of the run; the best average XP wins. plan − greedy = value of planning.
// Most battles on any route from nodeId to an extraction point (−Infinity if none gets out)
function battlesAhead(nodeId, visited) {
  const node = MAP_NODES[nodeId];
  if (node.type === 'extract') return 0;
  const seen = [...visited, nodeId];
  let best = -Infinity;
  for (const n of node.neighbors) if (!seen.includes(n)) best = Math.max(best, battlesAhead(n, seen));
  return best + 1;
}

// Greedy walks the route with the most battles left (it never extracts while a battle is ahead);
// ties go to the easier battle. The planner can still choose a shorter route or evacuate.
function greedyNode(opts, st) {
  const rank = n => [-battlesAhead(n, st.visited), DIFF_RANK[MAP_NODES[n].difficulty] ?? 9];
  return [...opts].sort((a, b) => { const ra = rank(a), rb = rank(b); return ra[0] - rb[0] || ra[1] - rb[1]; })[0];
}

async function playOut(st, cfg) {
  while (!st.end) {
    const opts = nextNodes(st);
    if (!opts.length) { endRun(st, 'stuck', st.wins > 0); break; }
    const nodeId = greedyNode(opts, st);
    const enemy = walk(st, nodeId);
    if (!enemy) break;
    const lineups = await legalLineups(st, enemy, cfg);
    st.dry = !lineups.length;
    await resolve(st, nodeId, enemy, lineups[0] || null, cfg);
  }
  return score(st);
}

// Average XP of `apply(copy)` followed by greedy play, over cfg.rollouts playouts. Rollout r uses the
// same dice for every option (common random numbers), so options are compared on equal luck.
async function rolloutValue(st, apply, cfg, salt) {
  const saved = getRng();
  let total = 0;
  for (let r = 0; r < cfg.rollouts; r++) {
    reseed(hash(`${cfg.seed}|${salt}|${r}`));
    const copy = clone(st);
    await apply(copy);
    total += copy.end ? score(copy) : await playOut(copy, cfg);
  }
  setRng(saved);
  return total / cfg.rollouts;
}

// Candidate lineups for the planner: the top few by win rate, the best of each size, and the cheapest
// lineup within 10 points of the best (the "save water" option).
function candidates(lineups, cfg) {
  if (!lineups.length) return [];
  const set = new Set(lineups.slice(0, cfg.k));
  for (let n = 1; n <= TEAM_SLOTS; n++) { const b = lineups.find(l => l.ids.length === n); if (b) set.add(b); }
  const near = lineups.filter(l => l.p >= lineups[0].p - 0.1).sort((a, b) => a.cost - b.cost || b.p - a.p)[0];
  if (near) set.add(near);
  return [...set];
}

// One real run with `policy`. Records every prep decision for the depth metrics.
export async function playRun(cfg, policy, runIndex) {
  reseed(hash(`run|${cfg.seed}|${runIndex}`));
  const st = newRun(cfg);
  const decisions = [];
  let step = 0;
  while (!st.end) {
    const opts = nextNodes(st);
    if (!opts.length) { endRun(st, 'stuck', st.wins > 0); break; }

    let nodeId;
    if (policy === 'random') nodeId = opts[Math.floor(rand() * opts.length)];
    else if (policy === 'greedy' || opts.length === 1) nodeId = greedyNode(opts, st);
    else {
      // Planner: walking on decides the enemy too, so each option is played out from the walk
      let best = null;
      for (const n of opts) {
        const v = await rolloutValue(st, async c => {
          const e = walk(c, n);
          if (!e) return;
          const ls = await legalLineups(c, e, cfg);
          c.dry = !ls.length;
          await resolve(c, n, e, ls[0] || null, cfg);
        }, cfg, `${runIndex}|node|${step}`);
        if (!best || v > best.v) best = { n, v };
      }
      nodeId = best.n;
    }

    const enemy = walk(st, nodeId);
    if (!enemy) break;
    const lineups = await legalLineups(st, enemy, cfg);
    st.dry = !lineups.length;
    const d = { battle: st.battleNum, diff: enemy.diff, legal: lineups.length, bestP: lineups[0]?.p ?? 0,
      close: lineups.filter(l => l.p >= (lineups[0]?.p ?? 0) - 0.05).length, water: st.water };

    let pick = null;
    if (policy === 'random') pick = lineups.length ? lineups[Math.floor(rand() * lineups.length)] : null;
    else if (policy === 'greedy') pick = lineups[0] || null;
    else if (lineups.length) {
      // Planner: each candidate lineup, plus evacuating now
      const opts2 = [...candidates(lineups, cfg), null];
      const vals = [];
      for (const l of opts2) vals.push(await rolloutValue(st, c => resolve(c, nodeId, enemy, l && { ...l, cards: l.cards.map(x => c.roster.find(y => y.uid === x.uid)) }, cfg), cfg, `${runIndex}|prep|${step}`));
      const bi = vals.indexOf(Math.max(...vals));
      pick = opts2[bi];
      const bv = vals[bi];
      d.options = opts2.length;
      d.closeValue = vals.filter(v => v >= bv - cfg.closeXp).length;   // options within closeXp of the best run value
      d.deviates = pick === null || pick.p < lineups[0].p - 1e-9;       // planner gave up win rate now (or evacuated)
      d.evac = pick === null;
      d.spread = bv - Math.min(...vals);
      // A real decision: a lineup choice can be a mistake (some candidate lineup is > closeXp worse than
      // the best option), and yet there is more than one good answer (2+ options within closeXp).
      const lineupVals = vals.slice(0, -1);
      d.stakes = bv - Math.min(...lineupVals) > cfg.closeXp;
      d.real = d.stakes && d.closeValue >= 2;
      // Trap: the obvious play (best win rate now = opts2[0]) is more than closeXp worse than the best option
      d.trap = bv - vals[0] > cfg.closeXp;
      d.trapCost = bv - vals[0];
    }
    if (pick) { d.p = pick.p; d.size = pick.ids.length; d.cost = pick.cost; }
    d.outcome = await resolve(st, nodeId, enemy, pick, cfg);
    decisions.push(d);
    step++;
  }
  return {
    policy, run: runIndex, score: score(st), xp: xp(st), wins: st.wins, fights: st.fights, cardsPlayed: st.cardsPlayed,
    end: st.end, success: st.success, extracted: st.success || st.end === 'forced' || st.end === 'evac' || st.end === 'dry' ? st.roster.length : 0,
    squadLeft: st.roster.length, waterLeft: cfg.mode === 'mana' ? st.water : null,
    usesLeft: cfg.mode === 'uses' ? st.roster.reduce((a, c) => a + c.uses, 0) : null,
    fielded: st.fielded, wonLineups: st.wonLineups, decisions,
  };
}
