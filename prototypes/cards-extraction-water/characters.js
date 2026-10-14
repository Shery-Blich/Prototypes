// Character definitions. Every ability uses one of four triggers (see TRIGGERS):
//   start (start of match), attack (it attacks), hurt (it is damaged), death (it dies)
// Each ability's `run(api, self, ctx)` is async so the battle can animate it.
// `preview(p)` describes one trigger's effect for the prep-screen preview:
//   p = { self, ahead, behind, behind2, friends, enemies, all } (all excluding self)
//   returns [{ targets, atk?, hp? (negative = damage), shield?, random? } | { summon: id, count }]

export const TRIGGERS = {
  start: { emoji: '🏁', name: 'Start of match', note: 'Once, after the teams are set and before the first attack.' },
  attack: { emoji: '🗡️', name: 'Attack', note: 'Every time it attacks.' },
  hurt: { emoji: '💢', name: 'Hurt', note: 'Every time it takes damage.' },
  death: { emoji: '💀', name: 'Death', note: 'Once, when it dies.' },
};

// Classes. 2+ of a class in a team gives that team its synergy at the start of the battle.
export const CLASSES = {
  helper: { emoji: '💚', name: 'Helper', synergy: '2+ Helpers: every friend gets +1 HP.' },
  attacker: { emoji: '🔥', name: 'Attacker', synergy: '2+ Attackers: the front friend gets +1 attack.' },
  summoner: { emoji: '🔮', name: 'Summoner', synergy: '2+ Summoners: every summoned friend gets +1/+1.' },
};

export const CHARACTERS = {
  archer: {
    name: 'Archer', emoji: '🏹', atk: 2, hp: 2, cls: 'attacker',
    trigger: 'start', text: 'When 🏁 deal 1 damage to a random enemy.',
    preview: p => [{ targets: p.enemies, hp: -1, random: true }],
    async run(api, self) {
      const t = api.randomOf(api.enemiesOf(self));
      if (t) await api.damage(t, 1, self);
    },
  },
  bard: {
    name: 'Bard', emoji: '🎻', atk: 1, hp: 3, cls: 'helper',
    trigger: 'start', text: 'When 🏁 give the friend ahead +2 attack.',
    preview: p => [{ targets: [p.ahead], atk: 2 }],
    async run(api, self) {
      const t = api.friendAhead(self);
      if (t) await api.buff(t, 2, 0, self);
    },
  },
  medic: {
    name: 'Medic', emoji: '⛑️', atk: 2, hp: 2, cls: 'helper',
    trigger: 'death', text: 'When 💀 give a random friend +2/+1.',
    preview: p => [{ targets: p.friends, atk: 2, hp: 1, random: true }],
    async run(api, self) {
      const t = api.randomOf(api.friendsOf(self));
      if (t) await api.buff(t, 2, 1, self);
    },
  },
  necromancer: {
    name: 'Necromancer', emoji: '🧙', atk: 1, hp: 2, cls: 'summoner',
    trigger: 'death', text: 'When 💀 summon a 1/1 Skeleton.',
    preview: () => [{ summon: 'skeleton', count: 1 }],
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index, 'skeleton', self);
    },
  },
  shepherd: {
    name: 'Shepherd', emoji: '🧑‍🌾', atk: 2, hp: 2, cls: 'summoner',
    trigger: 'death', text: 'When 💀 summon two 2/1 Wolves.',
    preview: () => [{ summon: 'wolf', count: 2 }],
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index, 'wolf', self);
      await api.summon(self.side, ctx.index, 'wolf', self);
    },
  },
  alchemist: {
    name: 'Alchemist', emoji: '💣', atk: 3, hp: 2, cls: 'attacker',
    trigger: 'death', text: 'When 💀 deal 2 damage to ALL characters.',
    preview: p => [{ targets: p.all, hp: -2 }],
    async run(api, self) {
      await api.damageMany(api.allUnits(), 2, self);
    },
  },
  bannerman: {
    name: 'Bannerman', emoji: '🚩', atk: 2, hp: 2, cls: 'helper',
    trigger: 'death', text: 'When 💀 give the two friends behind +1/+1.',
    preview: p => [{ targets: [p.behind, p.behind2], atk: 1, hp: 1 }],
    async run(api, self, ctx) {
      const team = api.team(self.side);
      for (const t of team.slice(ctx.index, ctx.index + 2)) await api.buff(t, 1, 1, self);
    },
  },
  cleric: {
    name: 'Cleric', emoji: '🙏', atk: 1, hp: 3, cls: 'helper',
    trigger: 'death', text: 'When 💀 give the friend behind a Shield (blocks the next hit).',
    preview: p => [{ targets: [p.behind], shield: true }],
    async run(api, self, ctx) {
      const t = api.team(self.side)[ctx.index];
      if (t) await api.shield(t, self);
    },
  },
  thornguard: {
    name: 'Thornguard', emoji: '🌵', atk: 3, hp: 3, cls: 'attacker',
    trigger: 'hurt', text: 'When 💢 deal 2 damage to a random enemy.',
    preview: p => [{ targets: p.enemies, hp: -2, random: true }],
    async run(api, self) {
      const t = api.randomOf(api.enemiesOf(self));
      if (t) await api.damage(t, 2, self);
    },
  },
  paladin: {
    name: 'Paladin', emoji: '🛡️', atk: 2, hp: 5, cls: 'helper',
    trigger: 'hurt', text: 'When 💢 give the friend behind +1/+2.',
    preview: p => [{ targets: [p.behind], atk: 1, hp: 2 }],
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.buff(t, 1, 2, self);
    },
  },
  rager: {
    name: 'Rager', emoji: '😡', atk: 1, hp: 4, cls: 'attacker',
    trigger: 'hurt', text: 'When 💢 gain +2 attack.',
    preview: p => [{ targets: [p.self], atk: 2 }],
    async run(api, self) {
      await api.buff(self, 2, 0, self);
    },
  },
  golem: {
    name: 'Golem', emoji: '🗿', atk: 2, hp: 6, cls: 'attacker',
    trigger: 'hurt', text: 'When 💢 gain a Shield (once per battle).',
    preview: p => [{ targets: [p.self], shield: true }],
    async run(api, self) {
      if (self.usedOnce) return;
      self.usedOnce = true;
      await api.shield(self, self);
    },
  },
  brute: {
    name: 'Brute', emoji: '🪓', atk: 4, hp: 3, cls: 'attacker',
    trigger: 'attack', text: 'When 🗡️ gain +2/+2 and deal 1 damage to the friend behind.',
    preview: p => [{ targets: [p.self], atk: 2, hp: 2 }, { targets: [p.behind], hp: -1 }],
    async run(api, self) {
      await api.buff(self, 2, 2, self);
      const t = api.friendBehind(self);
      if (t) await api.damage(t, 1, self);
    },
  },
  berserker: {
    name: 'Berserker', emoji: '🐘', atk: 3, hp: 5, cls: 'attacker',
    trigger: 'attack', text: 'When 🗡️ deal 1 damage to the friend behind.',
    preview: p => [{ targets: [p.behind], hp: -1 }],
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.damage(t, 1, self);
    },
  },
  squire: {
    name: 'Squire', emoji: '🐴', atk: 1, hp: 1, cls: 'attacker',
    trigger: 'attack', text: 'When 🗡️ gain +2/+2.',
    preview: p => [{ targets: [p.self], atk: 2, hp: 2 }],
    async run(api, self) {
      await api.buff(self, 2, 2, self);
    },
  },

  beekeeper: {
    name: 'Beekeeper', emoji: '🍯', atk: 1, hp: 4, cls: 'summoner',
    trigger: 'hurt', text: 'When 💢 summon a 1/1 Bee behind it.',
    preview: () => [{ summon: 'bee', count: 1 }],
    async run(api, self) {
      const i = api.team(self.side).indexOf(self);
      if (i >= 0) await api.summon(self.side, i + 1, 'bee', self);
    },
  },
  broodmother: {
    name: 'Broodmother', emoji: '🕷️', atk: 2, hp: 3, cls: 'summoner',
    trigger: 'start', text: 'When 🏁 summon a 1/2 Spiderling behind it.',
    preview: () => [{ summon: 'spiderling', count: 1 }],
    async run(api, self) {
      const i = api.team(self.side).indexOf(self);
      if (i >= 0) await api.summon(self.side, i + 1, 'spiderling', self);
    },
  },

  // Summoned tokens (never part of the roster)
  skeleton: { name: 'Skeleton', emoji: '🦴', atk: 1, hp: 1, token: true, text: '' },
  wolf: { name: 'Wolf', emoji: '🐺', atk: 2, hp: 1, token: true, text: '' },
  bee: { name: 'Bee', emoji: '🐝', atk: 1, hp: 1, token: true, text: '' },
  spiderling: { name: 'Spiderling', emoji: '🕸️', atk: 1, hp: 2, token: true, text: '' },
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
