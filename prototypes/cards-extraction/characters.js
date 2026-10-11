// Character definitions. Abilities follow Super Auto Pets style triggers:
//   startOfBattle, beforeAttack, hurt, faint, knockOut, friendAheadAttacks
// Each ability's `run(api, self, ctx)` is async so the battle can animate it.

export const CHARACTERS = {
  archer: {
    name: 'Archer', emoji: '🏹', atk: 2, hp: 2,
    trigger: 'startOfBattle', text: 'Start of battle: deal 1 damage to a random enemy.',
    async run(api, self) {
      const t = api.randomOf(api.enemiesOf(self));
      if (t) await api.damage(t, 1, self);
    },
  },
  bard: {
    name: 'Bard', emoji: '🎻', atk: 1, hp: 3,
    trigger: 'startOfBattle', text: 'Start of battle: give the friend ahead +2 attack.',
    async run(api, self) {
      const t = api.friendAhead(self);
      if (t) await api.buff(t, 2, 0, self);
    },
  },
  medic: {
    name: 'Medic', emoji: '⛑️', atk: 2, hp: 2,
    trigger: 'faint', text: 'Faint: give a random friend +2/+1.',
    async run(api, self) {
      const t = api.randomOf(api.friendsOf(self));
      if (t) await api.buff(t, 2, 1, self);
    },
  },
  necromancer: {
    name: 'Necromancer', emoji: '🧙', atk: 1, hp: 2,
    trigger: 'faint', text: 'Faint: summon a 1/1 Skeleton.',
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index, 'skeleton');
    },
  },
  shepherd: {
    name: 'Shepherd', emoji: '🧑‍🌾', atk: 2, hp: 2,
    trigger: 'faint', text: 'Faint: summon two 2/1 Wolves.',
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index, 'wolf');
      await api.summon(self.side, ctx.index, 'wolf');
    },
  },
  alchemist: {
    name: 'Alchemist', emoji: '💣', atk: 3, hp: 2,
    trigger: 'faint', text: 'Faint: deal 2 damage to ALL characters.',
    async run(api, self) {
      await api.damageMany(api.allUnits(), 2, self);
    },
  },
  bannerman: {
    name: 'Bannerman', emoji: '🚩', atk: 2, hp: 2,
    trigger: 'faint', text: 'Faint: give the two friends behind +1/+1.',
    async run(api, self, ctx) {
      const team = api.team(self.side);
      for (const t of team.slice(ctx.index, ctx.index + 2)) await api.buff(t, 1, 1, self);
    },
  },
  cleric: {
    name: 'Cleric', emoji: '🙏', atk: 1, hp: 3,
    trigger: 'faint', text: 'Faint: give the friend behind a Shield (blocks the next hit).',
    async run(api, self, ctx) {
      const t = api.team(self.side)[ctx.index];
      if (t) await api.shield(t, self);
    },
  },
  thornguard: {
    name: 'Thornguard', emoji: '🌵', atk: 3, hp: 3,
    trigger: 'hurt', text: 'Hurt: deal 2 damage to a random enemy.',
    async run(api, self) {
      const t = api.randomOf(api.enemiesOf(self));
      if (t) await api.damage(t, 2, self);
    },
  },
  paladin: {
    name: 'Paladin', emoji: '🛡️', atk: 2, hp: 5,
    trigger: 'hurt', text: 'Hurt: give the friend behind +1/+2.',
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.buff(t, 1, 2, self);
    },
  },
  rager: {
    name: 'Rager', emoji: '😡', atk: 1, hp: 4,
    trigger: 'hurt', text: 'Hurt: gain +2 attack.',
    async run(api, self) {
      await api.buff(self, 2, 0, self);
    },
  },
  golem: {
    name: 'Golem', emoji: '🗿', atk: 2, hp: 6,
    trigger: 'hurt', text: 'Hurt: gain a Shield (once per battle).',
    async run(api, self) {
      if (self.usedOnce) return;
      self.usedOnce = true;
      await api.shield(self, self);
    },
  },
  brute: {
    name: 'Brute', emoji: '🪓', atk: 4, hp: 3,
    trigger: 'knockOut', text: 'Knock out: gain +2/+2.',
    async run(api, self) {
      await api.buff(self, 2, 2, self);
    },
  },
  berserker: {
    name: 'Berserker', emoji: '🐘', atk: 3, hp: 5,
    trigger: 'beforeAttack', text: 'Before attack: deal 1 damage to the friend behind.',
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.damage(t, 1, self);
    },
  },
  squire: {
    name: 'Squire', emoji: '🐴', atk: 1, hp: 2,
    trigger: 'friendAheadAttacks', text: 'Friend ahead attacks: gain +2/+2.',
    async run(api, self) {
      await api.buff(self, 2, 2, self);
    },
  },

  // Summoned tokens (never part of the roster)
  skeleton: { name: 'Skeleton', emoji: '💀', atk: 1, hp: 1, token: true, text: '' },
  wolf: { name: 'Wolf', emoji: '🐺', atk: 2, hp: 1, token: true, text: '' },
};

export const RECRUITABLE = Object.keys(CHARACTERS).filter(id => !CHARACTERS[id].token);

let nextUid = 1;

// A roster entry (persistent between battles)
export function makeCharacter(id) {
  return { uid: nextUid++, id };
}

export function randomCharacterId() {
  return RECRUITABLE[Math.floor(Math.random() * RECRUITABLE.length)];
}
