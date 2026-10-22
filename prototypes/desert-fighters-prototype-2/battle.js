import { CHARACTERS, TRIGGERS } from './characters.js';
import { TILES, DEFAULT_TILES } from './tiles.js';

const MAX_TURNS = 120;

// ─── Terrain ─────────────────────────────────────────────────────────────────
// opts.tiles: one tile id per slot column, front first (see tiles.js). Both sides share a column's
// tile. A card's tile is the one under its CURRENT slot; slots past the tile set are plain Dune.
//   Rock      : no ability fires from, or targets, a card on it
//   Oasis     : a card on it fires its trigger twice
//   Quicksand : after a card on it clashes, it sinks to the back of its team
//   Mirage    : other cards' abilities can't target a card on it (attacks still hit it)

let battleUid = 100000;

function makeUnit(id, side, atkBonus = 0, hpBonus = 0, rosterUid = null) {
  const def = CHARACTERS[id];
  return {
    uid: battleUid++, rosterUid, id, def, side,
    name: def.name, emoji: def.emoji,
    atk: def.atk + atkBonus, hp: def.hp + hpBonus,
    atkBonus, hpBonus,
    shield: false, usedOnce: false,
    slot: -1, clashedTurn: 0,
  };
}

/**
 * Runs one battle step by step, calling into `view` to animate.
 * Opposing front cards attack each other at the same time.
 * The gameplay modifier of who attacks first determines which side's abilities trigger first.
 * Attack triggers are applied just before the cards attack.
 */
export class Battle {
  // opts.firstSide: 'player' | 'enemy', determines who triggers abilities first
  // opts.maxTeam: { player, enemy } team slots per side (limits summons)
  // opts.tiles: ['rock', 'oasis', 'dune'] front first (default all Dune)
  constructor(playerChars, enemyDefs, view, opts = {}) {
    this.view = view;
    this.firstSide = opts.firstSide || 'player';
    this.maxTeam = opts.maxTeam || { player: 5, enemy: 5 };
    this.tiles = [...(opts.tiles || DEFAULT_TILES)].map(t => (TILES[t] ? t : 'dune'));
    this.teams = {
      player: playerChars.map(c => makeUnit(c.id, 'player', c.atkBonus || 0, c.hpBonus || 0, c.uid)),
      enemy: enemyDefs.map(e => makeUnit(e.id, 'enemy', e.atkBonus || 0, e.hpBonus || 0)),
    };
    for (const side of ['player', 'enemy']) this.teams[side].forEach((u, i) => { u.slot = i; });
    this.pendingFloats = [];
    this.hurtEvents = [];
    this.lingering = [];
    this.reserve = { player: [], enemy: [] };
    // Dead cards wait at the back of their team until the combat ends
    this.graves = { player: [], enemy: [] };
    this.pendingDead = [];
    this.turnNo = 0;
    // What the terrain did this fight (sims and the battle log read it)
    this.tileStats = { blocked: 0, oasis: 0, sank: 0, untargetable: 0, entered: 0 };
    this.api = this.makeApi();
  }

  other(side) { return side === 'player' ? 'enemy' : 'player'; }

  // ── terrain ──
  tileAt(i) { return i >= 0 && i < this.tiles.length ? this.tiles[i] : 'dune'; }

  // The tile under a card right now. A card dying this turn stands where it fell until it's gone.
  tileOf(u) {
    let i = this.teams[u.side]?.indexOf(u) ?? -1;
    if (i < 0) i = this.lingering.find(l => l.u === u)?.index ?? -1;
    return this.tileAt(i);
  }

  // Abilities can't reach a card on Rock or Mirage, except a card's own effect on itself
  canTarget(t, src) {
    if (!t) return false;
    if (t === src) return true;
    const tile = this.tileOf(t);
    return tile !== 'rock' && tile !== 'mirage';
  }

  // An ability tried to reach a card it can't target: it fizzles on that card
  async fizzle(t, src) {
    const tile = TILES[this.tileOf(t)];
    this.tileStats.untargetable++;
    this.view.float(t, `${tile.emoji} immune`, 'blocked');
    this.view.log(`${tile.emoji} ${tile.name}: ${src.name}'s ability can't target ${t.name} (${t.side})`);
    await this.view.wait(250);
  }

  async setTile(col, id, src) {
    if (col < 0 || col >= this.tiles.length || !TILES[id] || this.tiles[col] === id) return;
    const was = this.tiles[col];
    this.tiles[col] = id;
    this.view.log(`${src.name} turns the ${['front', 'middle', 'back'][col] || `slot ${col + 1}`} tile from ${TILES[was].name} ${TILES[was].emoji} into ${TILES[id].name} ${TILES[id].emoji}`);
    this.view.tiles?.(this, [col]);
    this.view.render(this);
    await this.view.wait(400);
  }

  async swapTiles(a, b, src) {
    if (a === b || a >= this.tiles.length || b >= this.tiles.length) return;
    if (this.tiles[a] === this.tiles[b]) return;
    [this.tiles[a], this.tiles[b]] = [this.tiles[b], this.tiles[a]];
    this.view.log(`${src.name} swaps the tiles: now ${this.tiles.map(t => TILES[t].emoji).join(' ')}`);
    this.view.tiles?.(this, [a, b]);
    this.view.render(this);
    await this.view.wait(400);
  }

  // Cards that moved into a new slot (deaths, rotation, quicksand, summons) step onto that slot's
  // tile: their 🧭 abilities fire. Runs until the line stops moving (capped, in case two cards keep
  // shoving each other).
  async resolveTileEntries(sidesInOrder) {
    for (let pass = 0; pass < 6; pass++) {
      const entered = [];
      for (const side of sidesInOrder) {
        this.teams[side].forEach((u, i) => {
          if (u.slot === i) return;
          u.slot = i;
          if (i < this.tiles.length && u.hp > 0 && u.def.trigger === 'tile') entered.push(u);
        });
      }
      if (!entered.length) return;
      for (const u of entered) {
        if (!this.alive(u)) continue;
        this.tileStats.entered++;
        await this.executeTrigger(u, 'tile', { tile: this.tileOf(u) });
        await this.resolveHurtEvents(sidesInOrder);
      }
      await this.cleanUpDeadAndStepForward(sidesInOrder);
    }
  }

  // Front cards that clashed this turn and stand on Quicksand sink to the back of their team.
  // Only the cards on Quicksand when this step starts sink, each once, so the line can't spin.
  async quicksandPhase(sidesInOrder) {
    const sinking = [];
    for (const side of sidesInOrder) {
      for (const u of this.teams[side]) {
        if (u.hp > 0 && u.clashedTurn === this.turnNo && this.tileOf(u) === 'quicksand') sinking.push(u);
      }
    }
    for (const u of sinking) {
      const team = this.teams[u.side];
      const i = team.indexOf(u);
      if (i < 0 || i === team.length - 1) continue;
      team.splice(i, 1);
      team.push(u);
      this.tileStats.sank++;
      this.view.render(this);
      this.view.float(u, '🌀 Sinks', 'buff');
      this.view.log(`🌀 Quicksand: ${u.name} (${u.side}) sinks to the back`);
      await this.view.wait(400);
    }
  }

  display(side) {
    const shown = [...this.teams[side]];
    let added = 0;
    for (const { u, index } of this.lingering) {
      if (u.side !== side) continue;
      shown.splice(Math.min(index + added, shown.length), 0, u);
      added++;
    }
    return [...shown, ...this.graves[side]];
  }

  isDead(u) { return this.graves[u.side].includes(u); }

  // Cards that died this turn go to the back of their team, shown as dead.
  // Summoned tokens just vanish: they were never part of the squad.
  async buryDead() {
    if (!this.pendingDead.length) return;
    for (const u of this.pendingDead) {
      if (u.def.token) continue;
      u.dead = true;
      this.graves[u.side].push(u);
    }
    this.pendingDead = [];
    this.view.render(this);
    await this.view.wait(300);
  }

  isLingering(u) { return this.lingering.some(l => l.u === u); }
  alive(u) { return u.hp > 0 && this.teams[u.side].includes(u); }

  makeApi() {
    const b = this;
    return {
      team: side => b.teams[side],
      // Target lists only hold cards an ability can reach (not on Rock / Mirage)
      enemiesOf: u => b.teams[b.other(u.side)].filter(x => x.hp > 0 && b.canTarget(x, u)),
      friendsOf: u => b.teams[u.side].filter(x => x !== u && x.hp > 0 && b.canTarget(x, u)),
      allUnits: () => [...b.teams.player, ...b.teams.enemy].filter(x => x.hp > 0),
      // Positional: the card right ahead / behind, or nothing if it can't be targeted
      friendAhead: u => { const t = b.teams[u.side]; const f = t[t.indexOf(u) - 1] || null; return b.canTarget(f, u) ? f : null; },
      friendBehind: u => { const t = b.teams[u.side]; const i = t.indexOf(u); const f = i < 0 ? null : (t[i + 1] || null); return b.canTarget(f, u) ? f : null; },
      randomOf: arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null,
      tileOf: u => b.tileOf(u),
      tiles: () => [...b.tiles],
      setTile: (col, id, src) => b.setTile(col, id, src),
      swapTiles: (a, c, src) => b.swapTiles(a, c, src),

      damage: async (t, amount, src) => {
        if (!b.canTarget(t, src)) return b.fizzle(t, src);
        await b.view.effect(src, [{ unit: t, fx: { hp: -amount } }]);
        b.applyDamage(t, amount, src);
        b.flushFloats();
        b.view.render(b);
        await b.view.wait(350);
      },
      damageMany: async (targets, amount, src) => {
        targets = targets.filter(t => b.canTarget(t, src));
        if (!targets.length) return;
        await b.view.effect(src, targets.map(t => ({ unit: t, fx: { hp: -amount } })));
        for (const t of targets) b.applyDamage(t, amount, src);
        b.flushFloats();
        b.view.render(b);
        await b.view.wait(450);
      },
      buff: async (t, atk, hp, src) => {
        if (!b.canTarget(t, src)) return b.fizzle(t, src);
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
        if (!b.canTarget(t, src)) return b.fizzle(t, src);
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
        u.slot = team.indexOf(u);
        b.overflow(side);
        b.view.render(b);
        await b.view.effect(src, [{ unit: u, label: `+${u.emoji} ${u.atk}/${u.hp}` }]);
        b.view.render(b);
        b.view.flash(u, 'summoned');
        b.view.log(`${u.name} is summoned (${side})`);
        await b.view.wait(450);
      },
      pushToLast: async (target, src) => {
        if (!b.canTarget(target, src)) return b.fizzle(target, src);
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
        if (!b.canTarget(target, src)) return b.fizzle(target, src);
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
      // Moves a card to slot `index` of its own team (the others close up around it)
      moveTo: async (target, index, src) => {
        if (!b.canTarget(target, src)) return b.fizzle(target, src);
        const team = b.teams[target.side];
        const i = team.indexOf(target);
        const j = Math.min(index, team.length - 1);
        if (i < 0 || i === j) return;
        team.splice(i, 1);
        team.splice(j, 0, target);
        b.view.render(b);
        b.view.float(target, `➜ ${TILES[b.tileAt(j)].emoji}`, 'buff');
        b.view.log(`${src.name} moves ${target === src ? 'itself' : target.name} onto the ${TILES[b.tileAt(j)].name}`);
        await b.view.wait(400);
      },
      setAtk: async (target, newAtk, src) => {
        if (!b.canTarget(target, src)) return b.fizzle(target, src);
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
        if (!b.canTarget(target, src)) return b.fizzle(target, src);
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

    const tile = this.tileOf(u);
    if (tile === 'rock') {
      this.tileStats.blocked++;
      this.view.float(u, '🪨 Silenced', 'blocked');
      this.view.log(`🪨 Rock: ${u.name}'s ${TRIGGERS[trigger].emoji} ability doesn't fire`);
      await this.view.wait(250);
      return;
    }
    // Oasis: the trigger fires twice (the second time only if the card can still act)
    const times = tile === 'oasis' ? 2 : 1;
    for (let k = 0; k < times; k++) {
      if (k > 0) {
        if (trigger !== 'death' && !this.alive(u)) break;
        this.tileStats.oasis++;
        this.view.log(`🌴 Oasis: ${u.name}'s ability fires again`);
      }
      const idx = this.teams[u.side]?.indexOf(u) ?? -1;
      const fullCtx = { index: idx, ...ctx };
      this.view.flash(u, 'ability');
      this.view.float(u, k > 0 ? `🌴 ${TRIGGERS[trigger].emoji}` : TRIGGERS[trigger].emoji, 'ability');
      this.view.log(`${TRIGGERS[trigger].emoji} ${u.name} (${u.side}): ${u.def.text}`);
      await this.view.wait(350);
      await u.def.run(this.api, u, fullCtx);
    }
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
        this.pendingDead.push(u);
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
    this.view.tiles?.(this);
    this.view.render(this);
    await this.view.wait(600);

    const sidesInOrder = [this.firstSide, this.other(this.firstSide)];
    this.view.turn('🏁 Start of match');
    this.view.log(`Terrain: ${this.tiles.map((t, i) => `${['Front', 'Middle', 'Back'][i] || i + 1} ${TILES[t].emoji} ${TILES[t].name}`).join(' · ')}`);

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
    await this.resolveTileEntries(sidesInOrder);
    await this.buryDead();

    while (this.teams.player.length && this.teams.enemy.length && this.turnNo < MAX_TURNS) {
      this.turnNo++;
      this.view.turn(`Turn ${this.turnNo} · Clash`);
      await this.clash(sidesInOrder);
      await this.buryDead();
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
    return { outcome, tiles: [...this.tiles], tileStats: { ...this.tileStats } };
  }

  async clash(sidesInOrder) {
    const pUnit = this.teams.player[0];
    const eUnit = this.teams.enemy[0];
    if (!pUnit || !eUnit) return;

    // 1. Attack triggers are applied just before the cards attack, in priority order
    for (const side of sidesInOrder) {
      const frontUnit = this.teams[side][0];
      if (frontUnit && this.alive(frontUnit) && frontUnit.def.trigger === 'attack') {
        await this.executeTrigger(frontUnit, 'attack', { index: 0 });
        await this.resolveHurtEvents(sidesInOrder);
      }
    }

    // Check if both sides still have front units ready to clash
    const uPlayer = this.teams.player[0];
    const uEnemy = this.teams.enemy[0];
    if (!uPlayer || !uEnemy || uPlayer.hp <= 0 || uEnemy.hp <= 0) {
      await this.cleanUpDeadAndStepForward(sidesInOrder);
      await this.resolveTileEntries(sidesInOrder);
      return;
    }

    // 2. Both cards attack each other at the same time (the damage is simultaneous: both hits land
    //    even if one card dies). Visually it's told in steps: clash, enemy takes damage, then player.
    const playerDmg = uPlayer.atk;
    const enemyDmg = uEnemy.atk;
    uPlayer.clashedTurn = uEnemy.clashedTurn = this.turnNo;

    if (this.view.clash) await this.view.clash(uPlayer, uEnemy);
    else { this.view.flash(uPlayer, 'lunge-right'); this.view.flash(uEnemy, 'lunge-left'); }
    await this.view.wait(250);

    this.applyDamage(uEnemy, playerDmg, uPlayer);
    this.flushFloats();
    await this.view.wait(550);

    this.applyDamage(uPlayer, enemyDmg, uEnemy);
    this.flushFloats();
    await this.view.wait(550);

    // 3. Hurt triggers are applied in side priority order
    await this.resolveHurtEvents(sidesInOrder);

    // 4. Check for dead units/triggers, then cards step forward a slot
    await this.cleanUpDeadAndStepForward(sidesInOrder);

    // 5. Survivors that clashed on Quicksand sink, then everyone who moved steps onto a new tile
    await this.quicksandPhase(sidesInOrder);
    await this.resolveTileEntries(sidesInOrder);
    await this.view.wait(250);
  }
}
