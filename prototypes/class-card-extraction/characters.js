// Character definitions for Class Card Extraction.
// Six classes: rotator (birds), dps (tigers), warlock (snakes/scorpions),
//              summoner (bugs), support (deers), tank (hippo/elephant/camel)
// Each card has a `class` property used for the visual outline colour.
// Triggers: start, attack, hurt, death (same as parent prototype).
// Extra API used by these abilities: pushToLast, bringToFront, setAtk, halveAtk

export const TRIGGERS = {
  start:  { emoji: '🏁', name: 'Start of match', note: 'Once, after the teams are set and before the first attack.' },
  attack: { emoji: '🗡️', name: 'Attack',         note: 'Every time it attacks.' },
  hurt:   { emoji: '💢', name: 'Hurt',            note: 'Every time it takes damage.' },
  death:  { emoji: '💀', name: 'Death',           note: 'Once, when it dies.' },
};

// ─── CLASS META (for the visual badge / background) ──────────────────────────
export const CLASSES = {
  rotator: { label: 'Rotator', color: '#0ea5e9' },   // sky-blue
  dps:     { label: 'DPS',     color: '#ef4444' },   // red
  warlock: { label: 'Warlock', color: '#a855f7' },   // purple
  summoner:{ label: 'Summoner',color: '#22c55e' },   // green
  support: { label: 'Support', color: '#f59e0b' },   // amber
  tank:    { label: 'Tank',    color: '#6b7280' },   // slate-grey
};

// ─── CHARACTERS ──────────────────────────────────────────────────────────────
export const CHARACTERS = {

  // ── ROTATOR (birds) ──────────────────────────────────────────────────────
  // Theme: move enemies/friends around the line.
  rotator_start: {
    class: 'rotator', name: 'Swiftbeak', emoji: '🦅', atk: 2, hp: 1,
    trigger: 'start',
    text: 'When 🏁 push the first enemy to last.',
    preview: p => [{ targets: [p.enemies[0]], reorder: 'push-last' }],
    async run(api, self) {
      const enemies = api.enemiesOf(self);
      if (enemies.length) await api.pushToLast(enemies[0], self);
    },
  },
  rotator_attack: {
    class: 'rotator', name: 'Tailwind', emoji: '🦜', atk: 3, hp: 1,
    trigger: 'attack',
    text: 'When 🗡️ bring the lowest-HP enemy to the front.',
    preview: p => {
      const sorted = [...p.enemies].filter(Boolean).sort((a, b) => a.hp - b.hp);
      return [{ targets: [sorted[0]], reorder: 'bring-front' }];
    },
    async run(api, self) {
      const enemies = api.enemiesOf(self);
      if (!enemies.length) return;
      const target = enemies.reduce((a, b) => a.hp <= b.hp ? a : b);
      await api.bringToFront(target, self);
    },
  },
  rotator_hurt: {
    class: 'rotator', name: 'Stormwing', emoji: '🦢', atk: 2, hp: 3,
    trigger: 'hurt',
    text: 'When 💢 push the highest-HP friend to the front.',
    preview: p => {
      const sorted = [...p.friends].filter(Boolean).sort((a, b) => b.hp - a.hp);
      return [{ targets: [sorted[0]], reorder: 'bring-front' }];
    },
    async run(api, self) {
      const friends = api.friendsOf(self);
      if (!friends.length) return;
      const target = friends.reduce((a, b) => a.hp >= b.hp ? a : b);
      await api.bringToFront(target, self);
    },
  },
  rotator_death: {
    class: 'rotator', name: 'Deathfeather', emoji: '🦩', atk: 2, hp: 1,
    trigger: 'death',
    text: 'When 💀 bring the highest-ATK friend forward.',
    preview: p => {
      const sorted = [...p.friends].filter(Boolean).sort((a, b) => b.atk - a.atk);
      return [{ targets: [sorted[0]], reorder: 'bring-front' }];
    },
    async run(api, self) {
      const friends = api.friendsOf(self);
      if (!friends.length) return;
      const target = friends.reduce((a, b) => a.atk >= b.atk ? a : b);
      await api.bringToFront(target, self);
    },
  },

  // ── DPS (tigers) ─────────────────────────────────────────────────────────
  // Theme: pure damage / self-buff / burst.
  dps_start: {
    class: 'dps', name: 'Claw Strike', emoji: '🐯', atk: 5, hp: 1,
    trigger: 'start',
    text: 'When 🏁 deal 3 damage to the first enemy.',
    preview: p => [{ targets: [p.enemies[0]], hp: -3 }],
    async run(api, self) {
      const t = api.enemiesOf(self)[0];
      if (t) await api.damage(t, 3, self);
    },
  },
  dps_attack: {
    class: 'dps', name: 'Frenzy', emoji: '🐆', atk: 3, hp: 3,
    trigger: 'attack',
    text: 'When 🗡️ gain +2 ATK.',
    preview: p => [{ targets: [p.self], atk: 2 }],
    async run(api, self) {
      await api.buff(self, 2, 0, self);
    },
  },
  dps_hurt: {
    class: 'dps', name: 'Retaliate', emoji: '🐅', atk: 4, hp: 2,
    trigger: 'hurt',
    text: 'When 💢 deal half the damage taken back to the attacker.',
    preview: p => [{ targets: [p.enemies[0]], hp: -2, random: false }],
    async run(api, self, ctx) {
      if (!ctx.damageAmount) return;
      const retaliate = Math.max(1, Math.ceil(ctx.damageAmount / 2));
      const attacker = api.enemiesOf(self)[0];
      if (attacker) await api.damage(attacker, retaliate, self);
    },
  },
  dps_death: {
    class: 'dps', name: 'Death Roar', emoji: '🦁', atk: 5, hp: 1,
    trigger: 'death',
    text: 'When 💀 deal its ATK to ALL enemies.',
    preview: p => [{ targets: p.enemies, hp: -(p.self?.atk ?? 5) }],
    async run(api, self) {
      const targets = api.enemiesOf(self);
      if (targets.length) await api.damageMany(targets, self.atk, self);
    },
  },

  // ── WARLOCK (snake / scorpion) ────────────────────────────────────────────
  // Theme: debuff enemy ATK, not raw damage.
  warlock_start: {
    class: 'warlock', name: 'Venom Sight', emoji: '🐍', atk: 2, hp: 2,
    trigger: 'start',
    text: 'When 🏁 halve the ATK of the highest-ATK enemy (rounded down).',
    preview: p => {
      const top = [...p.enemies].filter(Boolean).sort((a, b) => b.atk - a.atk)[0];
      return [{ targets: [top], atk: top ? -Math.floor(top.atk / 2) : 0 }];
    },
    async run(api, self) {
      const enemies = api.enemiesOf(self);
      if (!enemies.length) return;
      const top = enemies.reduce((a, b) => a.atk >= b.atk ? a : b);
      await api.halveAtk(top, self);
    },
  },
  warlock_attack: {
    class: 'warlock', name: 'Curse Bite', emoji: '🦂', atk: 3, hp: 1,
    trigger: 'attack',
    text: 'When 🗡️ set the first enemy\'s ATK equal to its current HP.',
    preview: p => {
      const e = p.enemies[0];
      return [{ targets: [e], atk: e ? e.hp - e.atk : 0 }];
    },
    async run(api, self) {
      const t = api.enemiesOf(self)[0];
      if (t) await api.setAtk(t, t.hp, self);
    },
  },
  warlock_hurt: {
    class: 'warlock', name: 'Hex Scales', emoji: '🐊', atk: 1, hp: 3,
    trigger: 'hurt',
    text: 'When 💢 set the first enemy\'s ATK to 0 (once per battle).',
    preview: p => [{ targets: [p.enemies[0]], atk: p.enemies[0] ? -p.enemies[0].atk : 0 }],
    async run(api, self) {
      if (self.usedOnce) return;
      self.usedOnce = true;
      const t = api.enemiesOf(self)[0];
      if (t) await api.setAtk(t, 0, self);
    },
  },
  warlock_death: {
    class: 'warlock', name: 'Death Curse', emoji: '🦎', atk: 2, hp: 2,
    trigger: 'death',
    text: 'When 💀 reduce the first enemy\'s ATK by its current HP.',
    preview: p => {
      const e = p.enemies[0];
      return [{ targets: [e], atk: e ? -e.hp : 0 }];
    },
    async run(api, self) {
      const t = api.enemiesOf(self)[0];
      if (t) {
        const reduction = Math.min(t.atk, t.hp);
        await api.setAtk(t, Math.max(0, t.atk - reduction), self);
      }
    },
  },

  // ── SUMMONER (bugs) ───────────────────────────────────────────────────────
  // Theme: always summon tokens — predictable but relentless.
  summoner_start: {
    class: 'summoner', name: 'Egg Burst', emoji: '🪲', atk: 2, hp: 2,
    trigger: 'start',
    text: 'When 🏁 summon a 1/1 Bug behind.',
    preview: () => [{ summon: 'bug', count: 1 }],
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index + 1, 'bug', self);
    },
  },
  summoner_attack: {
    class: 'summoner', name: 'Hive Call', emoji: '🐜', atk: 2, hp: 2,
    trigger: 'attack',
    text: 'When 🗡️ summon a 1/1 Bug behind.',
    preview: () => [{ summon: 'bug', count: 1 }],
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index + 1, 'bug', self);
    },
  },
  summoner_hurt: {
    class: 'summoner', name: 'Pain Spawn', emoji: '🦗', atk: 2, hp: 2,
    trigger: 'hurt',
    text: 'When 💢 summon a 1/1 Bug behind.',
    preview: () => [{ summon: 'bug', count: 1 }],
    async run(api, self, ctx) {
      await api.summon(self.side, ctx.index + 1, 'bug', self);
    },
  },
  summoner_death: {
    class: 'summoner', name: 'Swarm Queen', emoji: '🐝', atk: 2, hp: 2,
    trigger: 'death',
    text: 'When 💀 summon 2 1/1 Bugs at the front.',
    preview: () => [{ summon: 'bug', count: 2 }],
    async run(api, self, ctx) {
      await api.summon(self.side, 0, 'bug', self);
      await api.summon(self.side, 0, 'bug', self);
    },
  },

  // ── SUPPORT (deers) ───────────────────────────────────────────────────────
  // Theme: buff friends, redistribute stats.
  support_start: {
    class: 'support', name: 'Grace Aura', emoji: '🦌', atk: 2, hp: 1,
    trigger: 'start',
    text: 'When 🏁 give +2/+1 to the two friends ahead.',
    preview: p => {
      // p.ahead is the unit 1 slot ahead; to get the 2nd slot ahead we use friends sorted by position
      const team = p.friends.concat([p.self]).sort(() => 0); // preview system gives no direct team array
      // Best approximation: show p.ahead and the first friend in friends list (which is sorted by index)
      return [{ targets: [p.ahead, p.friends[0]].filter((u, i, a) => u && a.indexOf(u) === i), atk: 2, hp: 1 }];
    },
    async run(api, self) {
      const team = api.team(self.side);
      const i = team.indexOf(self);
      // "ahead" in game = lower index (closer to front)
      const targets = [team[i - 1], team[i - 2]].filter(Boolean);
      for (const t of targets) await api.buff(t, 2, 1, self);
    },
  },
  support_attack: {
    class: 'support', name: 'Healer Doe', emoji: '🦙', atk: 1, hp: 2,
    trigger: 'attack',
    text: 'When 🗡️ give HP to the friend behind equal to this ATK.',
    preview: p => [{ targets: [p.behind], hp: p.self?.atk ?? 1 }],
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.buff(t, 0, self.atk, self);
    },
  },
  support_hurt: {
    class: 'support', name: 'Pain Share', emoji: '🦘', atk: 2, hp: 1,
    trigger: 'hurt',
    text: 'When 💢 give ATK to the friend behind equal to this remaining HP.',
    preview: p => [{ targets: [p.behind], atk: Math.max(0, p.self?.hp ?? 1) }],
    async run(api, self) {
      const t = api.friendBehind(self);
      const remaining = Math.max(0, self.hp);
      if (t && remaining > 0) await api.buff(t, remaining, 0, self);
    },
  },
  support_death: {
    class: 'support', name: 'Final Gift', emoji: '🐐', atk: 1, hp: 2,
    trigger: 'death',
    text: 'When 💀 swap ATK and HP of the friend behind (gives whichever stat is lower).',
    preview: p => {
      const t = p.behind;
      if (!t) return [{ targets: [] }];
      return [{ targets: [t], atk: t.hp - t.atk, hp: t.atk - t.hp }];
    },
    async run(api, self, ctx) {
      const team = api.team(self.side);
      const t = team[ctx.index]; // friend now at slot (self already removed)
      if (!t) return;
      const [newAtk, newHp] = [t.hp, t.atk]; // swap
      const dAtk = newAtk - t.atk;
      const dHp  = newHp  - t.hp;
      await api.buff(t, dAtk, dHp, self);
    },
  },

  // ── TANK (hippo / elephant / camel) ──────────────────────────────────────
  // Theme: absorb damage, protect friends.
  tank_start: {
    class: 'tank', name: 'Iron Hide', emoji: '🦛', atk: 1, hp: 5,
    trigger: 'start',
    text: 'When 🏁 gain a Shield (blocks next hit).',
    preview: p => [{ targets: [p.self], shield: true }],
    async run(api, self) {
      await api.shield(self, self);
    },
  },
  tank_attack: {
    class: 'tank', name: 'Trample Share', emoji: '🐘', atk: 1, hp: 5,
    trigger: 'attack',
    text: 'When 🗡️ give HP to the friend behind equal to this ATK.',
    preview: p => [{ targets: [p.behind], hp: p.self?.atk ?? 1 }],
    async run(api, self) {
      const t = api.friendBehind(self);
      if (t) await api.buff(t, 0, self.atk, self);
    },
  },
  tank_hurt: {
    class: 'tank', name: 'Thick Skin', emoji: '🐪', atk: 1, hp: 5,
    trigger: 'hurt',
    text: 'When 💢 gain +1 HP (unless already at 0 or below).',
    preview: p => [{ targets: [p.self], hp: 1 }],
    async run(api, self) {
      if (self.hp > 0) await api.buff(self, 0, 1, self);
    },
  },
  tank_death: {
    class: 'tank', name: 'Last Stand', emoji: '🦬', atk: 1, hp: 5,
    trigger: 'death',
    text: 'When 💀 give +2 HP to the friend behind.',
    preview: p => [{ targets: [p.behind], hp: 2 }],
    async run(api, self, ctx) {
      const team = api.team(self.side);
      const t = team[ctx.index];
      if (t) await api.buff(t, 0, 2, self);
    },
  },

  // ── Tokens ────────────────────────────────────────────────────────────────
  bug: { name: 'Bug', emoji: '🐛', atk: 1, hp: 1, token: true, class: 'summoner', text: '' },
};

export const RECRUITABLE = Object.keys(CHARACTERS).filter(id => !CHARACTERS[id].token);

let nextUid = 1;

export function makeCharacter(id) {
  return { uid: nextUid++, id };
}

export function randomCharacterId() {
  return RECRUITABLE[Math.floor(Math.random() * RECRUITABLE.length)];
}
