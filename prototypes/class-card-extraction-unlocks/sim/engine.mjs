// Combat model for the balance sim: the battle rules of ../GDD.md ("Combat"), resolved without animation.
// Synchronous and silent: no view, no timers.
//
// Rules in short:
//   * 3 slots per team, slot 0 = front. The ENEMY side always resolves first.
//   * Start phase: each side (enemy, then player) fires its 🏁 abilities, highest ATK first (ties: front first).
//   * Clash loop: 🗡️ attack ability of each front card (enemy, then player) → both fronts hit each other at
//     the same time → 💢 hurt abilities → dead cards leave (💀 death abilities fire) → the rest step forward.
//   * 💢 hurt fires on EVERY damage instance, also the one that kills the card (the card is dead but still
//     in its slot until clean-up). 💀 death fires after hurt, when the card leaves.
//   * Damage to a card that is already at 0 HP is ignored (no second hurt).
//   * MAX_CLASHES clashes without a winner = tie.

import { CARDS, RULES } from './cards.mjs';

export const MAX_CLASHES = 100;
export const FIRST_SIDE = 'enemy';

// xorshift32: seedable dice, so the same seed replays the same battle
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let k = 0; k < 4; k++) r();
  return r;
}

const other = side => (side === 'player' ? 'enemy' : 'player');

export function battle(playerIds, enemyIds, { rules = RULES, cards = CARDS, rng = Math.random, first = FIRST_SIDE, trace = null } = {}) {
  const mk = (id, side, slot) => {
    const d = cards[id];
    return { id, d, side, slot, hp: d.hp, atk: d.atk, lastHitBy: null, clashes: 0 };
  };
  const teams = { player: playerIds.map((id, i) => mk(id, 'player', i)), enemy: enemyIds.map((id, i) => mk(id, 'enemy', i)) };
  const order = [first, other(first)];
  const log = trace ? (...a) => trace.push(a.join(' ')) : () => {};
  let hurtQueue = [];

  const living = side => teams[side].filter(u => u.hp > 0);
  const nearest = (u, dir) => {
    const t = teams[u.side];
    for (let i = t.indexOf(u) + dir; i >= 0 && i < t.length; i += dir) if (t[i].hp > 0) return t[i];
    return null;
  };
  const pick = arr => (arr.length ? arr[Math.floor(rng() * arr.length)] : null);
  const best = (arr, score) => arr.reduce((b, u) => (b === null || score(u) > score(b) ? u : b), null); // ties: front first

  function targetsOf(u, sel) {
    const foes = living(other(u.side));
    const friends = living(u.side).filter(x => x !== u);
    switch (sel) {
      case 'friendAhead': return [nearest(u, -1)];
      case 'friendBehind': return [nearest(u, +1)];
      case 'randomFriend': return [pick(friends)];
      case 'allFriends': return friends;
      case 'highestAtkFriend': return [best(friends, x => x.atk)];
      case 'highestHpFriend': return [best(friends, x => x.hp)];
      case 'lowestHpFriend': return [best(friends, x => -x.hp)];
      case 'highestAtkEnemy': return [best(foes, x => x.atk)];
      case 'firstEnemy': return [foes[0]];
      case 'secondEnemy': return [foes[1]];
      case 'lastEnemy': return [foes[foes.length - 1]];
      case 'allEnemies': return foes;
      case 'lowestHpEnemy': return [best(foes, x => -x.hp)];
      case 'killer': return [u.lastHitBy];
      default: throw new Error(`unknown target ${sel}`);
    }
  }

  function damage(t, n, src) {
    if (!t || t.hp <= 0 || n <= 0) return;
    t.hp -= n;
    t.lastHitBy = src;
    hurtQueue.push(t);
    log(`${src.side}:${src.id} hits ${t.side}:${t.id} for ${n} -> ${t.hp}`);
  }

  function fire(u) {
    const e = u.d.effect;
    const amountOf = t => {
      if (typeof e.amount === 'number') return e.amount;
      if (e.amount === 'halfAtk') return Math.floor(t.atk / 2);
      throw new Error(`unknown amount ${e.amount}`);
    };
    const ts = targetsOf(u, e.target).filter(Boolean);
    log(`${u.side}:${u.id} ${u.d.trigger} -> ${e.kind} ${ts.map(t => t.id).join(',') || '(no target)'}`);
    for (const t of ts) {
      if (e.kind === 'hp') t.hp += amountOf(t);
      else if (e.kind === 'atk') t.atk += amountOf(t);
      else if (e.kind === 'weaken') t.atk = Math.max(rules.minAtk, t.atk - amountOf(t));
      else if (e.kind === 'setAtk') t.atk = amountOf(t);
      else if (e.kind === 'damage') damage(t, amountOf(t), u);
      else if (e.kind === 'move') {
        const team = teams[t.side];
        team.splice(team.indexOf(t), 1);
        if (e.to === 'front') team.unshift(t); else team.push(t);
      }
      // A move can carry a payload on the moved card: { kind: 'damage' | 'hp' | 'atk', amount: number }
      if (e.bonus) {
        const n = e.bonus.amount;
        if (e.bonus.kind === 'damage') damage(t, n, u);
        else t[e.bonus.kind] += n;
      }
    }
  }

  // 💢 Hurt: every damage instance since the last resolve, enemy side first. Hurt abilities can deal damage,
  // which queues more hurts: loop until quiet. A card that died from the hit still fires (it's still in its slot).
  function resolveHurts() {
    while (hurtQueue.length) {
      const batch = hurtQueue;
      hurtQueue = [];
      for (const side of order)
        for (const u of batch)
          if (u.side === side && u.d.trigger === 'hurt' && teams[side].includes(u)) fire(u);
    }
  }

  // 💀 Clean-up: dead cards leave, front to back, enemy side first; each death ability fires as its card leaves
  // (and its damage resolves hurts). Repeat until nobody is at 0 HP: death damage can kill more cards.
  function cleanUp() {
    for (let again = true; again;) {
      again = false;
      for (const side of order) {
        for (let u; (u = teams[side].find(x => x.hp <= 0));) {
          again = true;
          teams[side].splice(teams[side].indexOf(u), 1);
          log(`${side}:${u.id} dies`);
          if (u.d.trigger === 'death') { fire(u); resolveHurts(); }
        }
      }
    }
  }

  // 🏁 Start
  for (const side of order) {
    const byAtk = [...teams[side]].sort((a, b) => b.atk - a.atk); // stable: ties stay front first
    for (const u of byAtk) {
      if (u.hp > 0 && u.d.trigger === 'start') { fire(u); resolveHurts(); }
    }
  }
  cleanUp();

  // ⚔️ Clashes
  let clashes = 0;
  while (teams.player.length && teams.enemy.length && clashes < MAX_CLASHES) {
    for (const side of order) {
      const f = teams[side][0];
      if (f && f.hp > 0 && f.d.trigger === 'attack') { fire(f); resolveHurts(); }
    }
    const p = teams.player[0], e = teams.enemy[0];
    if (!p || !e || p.hp <= 0 || e.hp <= 0) { cleanUp(); continue; }
    const pAtk = p.atk, eAtk = e.atk;           // simultaneous: both hits use the ATK from before the hit
    damage(e, pAtk, p);
    damage(p, eAtk, e);
    p.clashes++; e.clashes++;
    clashes++;
    resolveHurts();
    cleanUp();
  }

  const pl = teams.player.length, en = teams.enemy.length;
  const outcome = pl && !en ? 'win' : en && !pl ? 'lose' : 'tie';
  return { outcome, clashes, timeout: clashes >= MAX_CLASHES, survivors: teams.player.map(u => u.id) };
}
