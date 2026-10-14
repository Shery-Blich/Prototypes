import { CHARACTERS, TRIGGERS } from './characters.js';

const MAX_TURNS = 120;

let battleUid = 100000;

function makeUnit(id, side, atkBonus = 0, hpBonus = 0, rosterUid = null) {
  const def = CHARACTERS[id];
  return {
    uid: battleUid++, rosterUid, id, def, side,
    name: def.name, emoji: def.emoji,
    atk: def.atk + atkBonus, hp: def.hp + hpBonus,
    atkBonus, hpBonus,
    shield: false, usedOnce: false,
  };
}

/**
 * Runs one battle step by step, calling into `view` to animate.
 * Turn based by slot: each round slot 1 fights slot 1, then slot 2 vs slot 2, and so on
 * to the end of the shorter queue; the two lane cards attack each other at the same time.
 * The gameplay modifier of who attacks first determines which side's abilities trigger first.
 * Attack triggers are applied just before the cards attack.
 */
export class Battle {
  // opts.firstSide: 'player' | 'enemy', determines who triggers abilities first
  // opts.maxTeam: { player, enemy } team slots per side (limits summons)
  constructor(playerChars, enemyDefs, view, opts = {}) {
    this.view = view;
    this.firstSide = opts.firstSide || 'player';
    this.maxTeam = opts.maxTeam || { player: 5, enemy: 5 };
    this.teams = {
      player: playerChars.map(c => makeUnit(c.id, 'player', c.atkBonus || 0, c.hpBonus || 0, c.uid)),
      enemy: enemyDefs.map(e => makeUnit(e.id, 'enemy', e.atkBonus || 0, e.hpBonus || 0)),
    };
    this.pendingFloats = [];
    this.hurtEvents = [];
    this.lingering = [];
    this.reserve = { player: [], enemy: [] };
    this.activeIndex = -1;
    this.api = this.makeApi();
  }

  other(side) { return side === 'player' ? 'enemy' : 'player'; }

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
    if (amount > 0) {
      this.hurtEvents.push({ unit: t, damageAmount: amount, attacker: src });
    }
  }

  async executeTrigger(u, trigger, ctx = {}) {
    if (!u || u.def.trigger !== trigger) return;
    // Death abilities run from beyond the grave; everything else needs a living unit
    if (trigger !== 'death' && !this.alive(u)) return;

    const idx = this.teams[u.side]?.indexOf(u) ?? -1;
    const fullCtx = { index: idx, ...ctx };

    this.view.flash(u, 'ability');
    this.view.float(u, TRIGGERS[trigger].emoji, 'ability');
    this.view.log(`${TRIGGERS[trigger].emoji} ${u.name} (${u.side}): ${u.def.text}`);
    await this.view.wait(350);
    await u.def.run(this.api, u, fullCtx);
  }

  overflow(side) {
    const team = this.teams[side];
    while (team.length > this.maxTeam[side]) {
      const u = team.pop();
      this.reserve[side].unshift(u);
      this.view.log(`${u.name} (${side}) waits off-screen: no room in the team`);
    }
  }

  refill(side) {
    const team = this.teams[side];
    while (team.length < this.maxTeam[side] && this.reserve[side].length) {
      const u = this.reserve[side].shift();
      team.push(u);
      this.view.log(`${u.name} (${side}) rejoins the fight`);
    }
  }

  async despawn(u) {
    if (!this.isLingering(u)) return;
    this.view.flash(u, 'dying');
    await this.view.wait(400);
    this.lingering = this.lingering.filter(l => l.u !== u);
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

  // Resolve hurt events in side priority order
  async resolveHurtEvents(sidesInOrder) {
    while (this.hurtEvents.length > 0) {
      const currentEvents = [...this.hurtEvents];
      this.hurtEvents = [];

      for (const side of sidesInOrder) {
        const sideEvents = currentEvents.filter(ev => ev.unit.side === side);
        for (const ev of sideEvents) {
          if (this.alive(ev.unit) && ev.unit.def.trigger === 'hurt') {
            await this.executeTrigger(ev.unit, 'hurt', {
              damageAmount: ev.damageAmount,
              attacker: ev.attacker,
            });
          }
        }
      }
    }
  }

  // Check dead units and step forward in priority order
  async cleanUpDeadAndStepForward(sidesInOrder) {
    this.flushFloats();

    for (const side of sidesInOrder) {
      const team = this.teams[side];
      const deadUnits = team.filter(u => u.hp <= 0);
      if (!deadUnits.length) continue;

      for (const u of deadUnits) {
        if (u.def.trigger !== 'death') {
          this.view.flash(u, 'dying');
        }
      }
      await this.view.wait(350);

      for (const u of deadUnits) {
        const idx = team.indexOf(u);
        if (idx >= 0) team.splice(idx, 1);
        this.view.log(`💀 ${u.name} (${side}) dies`);

        if (u.def.trigger === 'death') {
          this.lingering.push({ u, index: idx });
          this.view.render(this);
          await this.executeTrigger(u, 'death', { index: idx });
          await this.despawn(u);
          // If death ability hurt someone, resolve those hurt triggers
          await this.resolveHurtEvents(sidesInOrder);
        }
      }

      // Remaining cards step forward a slot!
      this.refill(side);
      this.view.render(this);
      await this.view.wait(300);
    }
  }

  async run() {
    this.pendingFloats = [];
    this.hurtEvents = [];
    this.view.render(this);
    await this.view.wait(600);

    const sidesInOrder = [this.firstSide, this.other(this.firstSide)];
    this.view.turn('🏁 Start of match');

    // Abilities trigger in side priority order: highest attack first within a side
    for (const side of sidesInOrder) {
      for (const u of this.sortedByAtk(this.teams[side])) {
        if (u.def.trigger === 'start') {
          await this.executeTrigger(u, 'start');
          await this.resolveHurtEvents(sidesInOrder);
        }
      }
    }
    await this.cleanUpDeadAndStepForward(sidesInOrder);

    let turn = 0;
    while (this.teams.player.length && this.teams.enemy.length && turn < MAX_TURNS) {
      turn++;
      await this.round(turn, sidesInOrder);
    }

    let outcome;
    if (this.teams.player.length && !this.teams.enemy.length) {
      outcome = 'win';
      this.view.turn('🏆 Victory!');
    } else if (this.teams.enemy.length && !this.teams.player.length) {
      outcome = 'lose';
      this.view.turn('💀 Defeat!');
    } else {
      outcome = 'tie';
      this.view.turn('⚖️ Battle Tied!');
    }
    return { outcome };
  }

  // One round: slot 0 fights slot 0, then slot 1 vs slot 1, ... to the end of the queue.
  // Each card attacks at most once per round. When cards die and the rest step forward,
  // the next lane is the first slot where neither card has attacked yet this round.
  async round(turn, sidesInOrder) {
    const acted = new Set();
    this.activeIndex = -1;
    while (this.teams.player.length && this.teams.enemy.length) {
      const n = Math.min(this.teams.player.length, this.teams.enemy.length);
      let i = 0;
      while (i < n && (acted.has(this.teams.player[i]) || acted.has(this.teams.enemy[i]))) i++;
      if (i >= n) break;
      acted.add(this.teams.player[i]);
      acted.add(this.teams.enemy[i]);
      this.activeIndex = i;
      this.view.turn(`Turn ${turn} · Slot ${i + 1} clash`);
      await this.clash(i, acted, sidesInOrder);
    }
    this.activeIndex = -1;
    this.view.render(this);
  }

  async clash(i, acted, sidesInOrder) {
    if (!this.teams.player[i] || !this.teams.enemy[i]) return;
    this.view.render(this);

    // 1. Attack triggers are applied just before the cards attack, in priority order
    for (const side of sidesInOrder) {
      const unit = this.teams[side][i];
      if (unit && this.alive(unit) && unit.def.trigger === 'attack') {
        await this.executeTrigger(unit, 'attack', { index: i });
        await this.resolveHurtEvents(sidesInOrder);
      }
    }

    // Whoever is in this slot after the attack triggers fights (abilities may have moved cards)
    const uPlayer = this.teams.player[i];
    const uEnemy = this.teams.enemy[i];
    if (!uPlayer || !uEnemy || uPlayer.hp <= 0 || uEnemy.hp <= 0) {
      await this.cleanUpDeadAndStepForward(sidesInOrder);
      return;
    }
    acted.add(uPlayer);
    acted.add(uEnemy);
    this.view.render(this);

    // 2. Both cards attack each other at the same time!
    this.view.flash(uPlayer, 'lunge-right');
    this.view.flash(uEnemy, 'lunge-left');
    await this.view.wait(250);

    const playerDmg = uPlayer.atk;
    const enemyDmg = uEnemy.atk;

    this.applyDamage(uEnemy, playerDmg, uPlayer);
    this.applyDamage(uPlayer, enemyDmg, uEnemy);
    this.flushFloats();
    await this.view.wait(300);

    // 3. Hurt triggers are applied in side priority order
    await this.resolveHurtEvents(sidesInOrder);

    // 4. Check for dead units/triggers, then cards step forward a slot
    await this.cleanUpDeadAndStepForward(sidesInOrder);
    await this.view.wait(250);
  }
}
