import { CHARACTERS } from './characters.js';

const MAX_TEAM = 5;
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
  constructor(playerChars, enemyDefs, view) {
    this.view = view;
    this.teams = {
      player: playerChars.map(c => makeUnit(c.id, 'player', 0, 0, c.uid)),
      enemy: enemyDefs.map(e => makeUnit(e.id, 'enemy', e.atkBonus, e.hpBonus)),
    };
    this.queue = [];
    this.api = this.makeApi();
  }

  other(side) { return side === 'player' ? 'enemy' : 'player'; }
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
        b.applyDamage(t, amount, src);
        b.flushFloats();
        await b.view.wait(450);
      },
      damageMany: async (targets, amount, src) => {
        for (const t of targets) b.applyDamage(t, amount, src);
        b.flushFloats();
        await b.view.wait(550);
      },
      buff: async (t, atk, hp, src) => {
        t.atk += atk; t.hp += hp;
        b.view.render(b);
        b.view.float(t, `+${atk}/+${hp}`, 'buff');
        b.view.log(`${src.name} gives ${t === src ? 'itself' : t.name} +${atk}/+${hp}`);
        await b.view.wait(450);
      },
      shield: async (t, src) => {
        t.shield = true;
        b.view.render(b);
        b.view.float(t, '🛡 Shield', 'buff');
        b.view.log(`${src.name} gives ${t === src ? 'itself' : t.name} a Shield`);
        await b.view.wait(450);
      },
      summon: async (side, index, id) => {
        const team = b.teams[side];
        if (team.length >= MAX_TEAM) { b.view.log(`No room to summon ${CHARACTERS[id].name}`); return; }
        const u = makeUnit(id, side);
        team.splice(Math.min(index, team.length), 0, u);
        b.view.render(b);
        b.view.flash(u, 'summoned');
        b.view.log(`${u.name} is summoned (${side})`);
        await b.view.wait(450);
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
    if (amount > 0) this.fire(t, 'hurt');
  }

  fire(u, trigger, ctx = {}) {
    if (u && u.def.trigger === trigger) this.queue.push({ unit: u, trigger, ctx });
  }

  // Remove fainted units (pushing faint triggers), then run queued abilities until stable.
  async resolve() {
    for (;;) {
      await this.removeDead();
      const item = this.queue.shift();
      if (!item) break;
      const { unit, trigger, ctx } = item;
      // Faint abilities run from beyond the grave; everything else needs a living unit.
      if (trigger !== 'faint' && !this.alive(unit)) continue;
      this.view.flash(unit, 'ability');
      this.view.float(unit, '✨', 'ability');
      this.view.log(`✨ ${unit.name} (${unit.side}): ${unit.def.text}`);
      await this.view.wait(350);
      await unit.def.run(this.api, unit, ctx);
    }
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
    for (const { u } of dead) this.view.flash(u, 'dying');
    await this.view.wait(400);
    for (const { u, index } of dead) {
      const team = this.teams[u.side];
      team.splice(team.indexOf(u), 1);
      this.view.log(`💀 ${u.name} (${u.side}) faints`);
      this.fire(u, 'faint', { index });
    }
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

    this.view.turn('Start of battle');
    for (const u of this.sortedByAtk([...this.teams.player, ...this.teams.enemy])) this.fire(u, 'startOfBattle');
    await this.resolve();

    // Player always strikes first; sides then alternate.
    let side = 'player';
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
    let a = this.teams[side][0];
    this.fire(a, 'beforeAttack');
    await this.resolve();
    a = this.teams[side][0];
    const d = this.teams[this.other(side)][0];
    if (!a || !d) return;

    this.view.flash(a, side === 'player' ? 'lunge-right' : 'lunge-left');
    await this.view.wait(250);
    this.applyDamage(d, a.atk, a);
    if (d.hp <= 0) this.fire(a, 'knockOut');
    this.fire(this.teams[side][1], 'friendAheadAttacks');
    this.flushFloats();
    await this.view.wait(200);
    await this.resolve();
    await this.view.wait(300);
  }
}
