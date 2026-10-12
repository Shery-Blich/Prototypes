import { CHARACTERS, TRIGGERS } from './characters.js';

const MAX_TURNS = 120;

let battleUid = 100000;

function makeUnit(id, side, atkBonus = 0, hpBonus = 0, rosterUid = null) {
  const def = CHARACTERS[id];
  return {
    uid: battleUid++, rosterUid, id, def, side,
    name: def.name, emoji: def.emoji,
    atk: def.atk + atkBonus, hp: def.hp + hpBonus,
    shield: false, usedOnce: false,
  };
}

/**
 * Runs one battle step by step, calling into `view` to animate.
 * view: { render(battle), float(unit, text, cls), flash(unit, cls), log(msg), wait(ms), turn(text) }
 */
export class Battle {
  // opts.firstSide: 'player' | 'enemy', who makes the first attack
  // opts.maxTeam: { player, enemy } team slots per side (limits summons)
  constructor(playerChars, enemyDefs, view, opts = {}) {
    this.view = view;
    this.firstSide = opts.firstSide || 'player';
    this.maxTeam = opts.maxTeam || { player: 5, enemy: 5 };
    this.teams = {
      player: playerChars.map(c => makeUnit(c.id, 'player', 0, 0, c.uid)),
      enemy: enemyDefs.map(e => makeUnit(e.id, 'enemy', e.atkBonus, e.hpBonus)),
    };
    this.queue = [];
    // Dead units whose death ability hasn't finished yet: out of the team (untargetable), but
    // still drawn at the slot they died in until the ability is done. [{ u, index }]
    this.lingering = [];
    // Units pushed past the team slots (e.g. by summons on a full team): off-screen and out of the
    // fight, first in line to rejoin at the back when a slot frees up.
    this.reserve = { player: [], enemy: [] };
    this.api = this.makeApi();
  }

  other(side) { return side === 'player' ? 'enemy' : 'player'; }

  // What to draw for a side: the team plus lingering dead units at the slot they died in.
  display(side) {
    const shown = [...this.teams[side]];
    let added = 0;
    for (const { u, index } of this.lingering) {
      if (u.side !== side) continue;
      shown.splice(Math.min(index + added, shown.length), 0, u);
      added++;
    }
    return shown;
  }

  isLingering(u) { return this.lingering.some(l => l.u === u); }
  alive(u) { return u.hp > 0 && this.teams[u.side].includes(u); }

  makeApi() {
    const b = this;
    return {
      team: side => b.teams[side],
      enemiesOf: u => b.teams[b.other(u.side)].filter(x => x.hp > 0),
      friendsOf: u => b.teams[u.side].filter(x => x !== u && x.hp > 0),
      allUnits: () => [...b.teams.player, ...b.teams.enemy].filter(x => x.hp > 0),
      friendAhead: u => { const t = b.teams[u.side]; return t[t.indexOf(u) - 1] || null; },
      friendBehind: u => { const t = b.teams[u.side]; const i = t.indexOf(u); return i < 0 ? null : (t[i + 1] || null); },
      randomOf: arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null,

      // Each effect first plays its arrow animation (view.effect), then applies.
      damage: async (t, amount, src) => {
        await b.view.effect(src, [{ unit: t, fx: { hp: -amount } }]);
        b.applyDamage(t, amount, src);
        b.flushFloats();
        b.view.render(b);
        await b.view.wait(350);
      },
      damageMany: async (targets, amount, src) => {
        await b.view.effect(src, targets.map(t => ({ unit: t, fx: { hp: -amount } })));
        for (const t of targets) b.applyDamage(t, amount, src);
        b.flushFloats();
        b.view.render(b);
        await b.view.wait(450);
      },
      buff: async (t, atk, hp, src) => {
        await b.view.effect(src, [{ unit: t, fx: { atk, hp } }]);
        t.atk += atk; t.hp += hp;
        b.view.render(b);
        const atkPart = atk !== 0 ? `${atk > 0 ? '+' : ''}${atk}⚔` : '';
        const hpPart  = hp  !== 0 ? `${hp  > 0 ? '+' : ''}${hp}❤`  : '';
        const label   = [atkPart, hpPart].filter(Boolean).join('/') || '+0';
        b.view.float(t, label, 'buff');
        b.view.log(`${src.name} gives ${t === src ? 'itself' : t.name} ${label}`);
        await b.view.wait(350);
      },
      shield: async (t, src) => {
        await b.view.effect(src, [{ unit: t, fx: { shield: true } }]);
        t.shield = true;
        b.view.render(b);
        b.view.float(t, '🛡 Shield', 'buff');
        b.view.log(`${src.name} gives ${t === src ? 'itself' : t.name} a Shield`);
        await b.view.wait(350);
      },
      // The summoned card appears first, then the arrow leads into it.
      summon: async (side, index, id, src) => {
        const team = b.teams[side];
        const u = makeUnit(id, side);
        team.splice(Math.min(index, team.length), 0, u);
        b.overflow(side);
        b.view.render(b);
        await b.view.effect(src, [{ unit: u, label: `+${u.emoji} ${u.atk}/${u.hp}` }]);
        b.view.render(b);
        b.view.flash(u, 'summoned');
        b.view.log(`${u.name} is summoned (${side})`);
        await b.view.wait(450);
      },

      // ── New for Class Card Extraction ──────────────────────────────────
      // Move `target` to the last position in its team.
      pushToLast: async (target, src) => {
        const team = b.teams[target.side];
        const i = team.indexOf(target);
        if (i < 0 || i === team.length - 1) return;
        team.splice(i, 1);
        team.push(target);
        b.view.render(b);
        b.view.float(target, '⬇ Last', 'buff');
        b.view.log(`${src.name} pushes ${target.name} to last position`);
        await b.view.wait(400);
      },
      // Move `target` to the front (index 0) of its team.
      bringToFront: async (target, src) => {
        const team = b.teams[target.side];
        const i = team.indexOf(target);
        if (i <= 0) return;
        team.splice(i, 1);
        team.unshift(target);
        b.view.render(b);
        b.view.float(target, '⬆ Front', 'buff');
        b.view.log(`${src.name} brings ${target.name} to front`);
        await b.view.wait(400);
      },
      // Set target's ATK to a specific value (can lower or raise).
      setAtk: async (target, newAtk, src) => {
        const delta = newAtk - target.atk;
        if (delta === 0) return;
        await b.view.effect(src, [{ unit: target, fx: { atk: delta } }]);
        target.atk = Math.max(0, newAtk);
        b.view.render(b);
        b.view.float(target, `ATK→${target.atk}`, delta < 0 ? 'dmg' : 'buff');
        b.view.log(`${src.name} sets ${target.name}'s ATK to ${target.atk}`);
        await b.view.wait(350);
      },
      // Halve target's ATK (rounded down, minimum 0).
      halveAtk: async (target, src) => {
        const newAtk = Math.floor(target.atk / 2);
        const delta = newAtk - target.atk;
        if (delta === 0) return;
        await b.view.effect(src, [{ unit: target, fx: { atk: delta } }]);
        target.atk = newAtk;
        b.view.render(b);
        b.view.float(target, `ATK÷2→${target.atk}`, 'dmg');
        b.view.log(`${src.name} halves ${target.name}'s ATK to ${target.atk}`);
        await b.view.wait(350);
      },
    };
  }

  applyDamage(t, amount, src) {
    if (t.hp <= 0) return;
    if (t.shield && amount > 0) {
      t.shield = false;
      this.view.log(`${t.name}'s Shield blocks ${amount} damage from ${src.name}`);
      this.pendingFloats.push([t, 'Blocked!', 'blocked']);
      return;
    }
    t.hp -= amount;
    this.view.log(`${src.name} deals ${amount} to ${t.name} (${t.side})`);
    this.pendingFloats.push([t, `-${amount}`, 'dmg']);
    if (amount > 0) this.fire(t, 'hurt', { damageAmount: amount, attacker: src });
  }

  fire(u, trigger, ctx = {}) {
    if (u && u.def.trigger === trigger) {
      const idx = this.teams[u.side]?.indexOf(u) ?? -1;
      this.queue.push({ unit: u, trigger, ctx: { index: idx, ...ctx } });
    }
  }

  // Remove dead units (pushing death triggers), then run queued abilities until stable.
  async resolve() {
    for (;;) {
      await this.removeDead();
      const item = this.queue.shift();
      if (!item) break;
      const { unit, trigger, ctx } = item;
      // Death abilities run from beyond the grave; everything else needs a living unit.
      if (trigger !== 'death' && !this.alive(unit)) continue;
      this.view.flash(unit, 'ability');
      this.view.float(unit, TRIGGERS[trigger].emoji, 'ability');
      this.view.log(`${TRIGGERS[trigger].emoji} ${unit.name} (${unit.side}): ${unit.def.text}`);
      await this.view.wait(350);
      await unit.def.run(this.api, unit, ctx);
      if (trigger === 'death') await this.despawn(unit);
    }
  }

  // Too many units for the slots: the back of the line waits in reserve.
  overflow(side) {
    const team = this.teams[side];
    while (team.length > this.maxTeam[side]) {
      const u = team.pop();
      this.reserve[side].unshift(u);
      this.view.log(`${u.name} (${side}) waits off-screen: no room in the team`);
    }
  }

  // Slots freed up: reserve units rejoin at the back.
  refill(side) {
    const team = this.teams[side];
    while (team.length < this.maxTeam[side] && this.reserve[side].length) {
      const u = this.reserve[side].shift();
      team.push(u);
      this.view.log(`${u.name} (${side}) rejoins the fight`);
    }
  }

  // A lingering unit's death ability is done: play its death and remove its card.
  async despawn(u) {
    if (!this.isLingering(u)) return;
    this.view.flash(u, 'dying');
    await this.view.wait(400);
    this.lingering = this.lingering.filter(l => l.u !== u);
    this.view.render(this);
  }

  async removeDead() {
    this.flushFloats();
    const dead = [];
    for (const side of ['player', 'enemy']) {
      const team = this.teams[side];
      let survivorsAhead = 0;
      for (const u of team) {
        if (u.hp <= 0) dead.push({ u, index: survivorsAhead });
        else survivorsAhead++;
      }
    }
    if (!dead.length) return;
    // Units with a death ability stay on screen until it has played (see despawn).
    const hasDeath = u => u.def.trigger === 'death';
    for (const { u } of dead) if (!hasDeath(u)) this.view.flash(u, 'dying');
    await this.view.wait(400);
    for (const { u, index } of dead) {
      const team = this.teams[u.side];
      team.splice(team.indexOf(u), 1);
      if (hasDeath(u)) this.lingering.push({ u, index });
      this.view.log(`💀 ${u.name} (${u.side}) dies`);
      this.fire(u, 'death', { index });
    }
    for (const side of ['player', 'enemy']) this.refill(side);
    this.view.render(this);
  }

  flushFloats() {
    if (!this.pendingFloats.length) return;
    this.view.render(this);
    for (const [u, text, cls] of this.pendingFloats) {
      this.view.float(u, text, cls);
      if (cls === 'dmg') this.view.flash(u, 'hit');
    }
    this.pendingFloats = [];
  }

  sortedByAtk(units) {
    return [...units].sort((a, b) => b.atk - a.atk);
  }

  async run() {
    this.pendingFloats = [];
    this.view.render(this);
    await this.view.wait(600);

    this.view.turn('🏁 Start of match');
    // Player's start abilities first, then the enemy's; highest attack first within a side.
    for (const side of ['player', 'enemy']) {
      for (const u of this.sortedByAtk(this.teams[side])) this.fire(u, 'start');
    }
    await this.resolve();

    // The first side was rolled before the battle (gameplay modifier); sides then alternate.
    let side = this.firstSide;
    let turn = 0;
    while (this.teams.player.length && this.teams.enemy.length && turn < MAX_TURNS) {
      turn++;
      this.view.turn(`Turn ${turn} · ${side === 'player' ? 'YOU attack' : 'ENEMY attacks'}`);
      await this.attack(side);
      side = this.other(side);
    }

    // No ties: if both sides are wiped (or the turn cap is hit), the player wins.
    return this.teams.enemy.length && !this.teams.player.length ? 'lose' : 'win';
  }

  async attack(side) {
    const a = this.teams[side][0];
    const d = this.teams[this.other(side)][0];
    if (!a || !d) return;

    // Pass the current index for abilities that need it (summoner etc.)
    const aCtx = { index: this.teams[a.side].indexOf(a) };
    const dCtx = { index: this.teams[d.side].indexOf(d) };

    this.view.flash(a, side === 'player' ? 'lunge-right' : 'lunge-left');
    await this.view.wait(250);
    // Queued before the hit, so the attacker's ability resolves before the defender's hurt.
    this.fire(a, 'attack', aCtx);
    this.applyDamage(d, a.atk, a);
    this.flushFloats();
    await this.view.wait(200);
    await this.resolve();
    await this.view.wait(300);
  }
}
