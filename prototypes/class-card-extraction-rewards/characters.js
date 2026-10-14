// Character definitions for Class Card Extraction.
// Six classes: rotator (birds), dps (tigers), warlock (snakes/scorpions),
//              summoner (bugs), support (deers), tank (hippo/elephant/camel)
// Each card has a `class` property used for the visual outline colour.
// Triggers: start, attack, hurt, death.
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
  cage:    { label: 'Cage',    color: '#eab308' },   // gold / locked cage
};

// ─── ABILITY PRESETS & LOGIC BUILDER ─────────────────────────────────────────
export function buildCardLogic(def) {
  const p = def.preset;
  if (!p) return { preview: def.preview, run: def.run };

  switch (p.type) {
    case 'deal_damage': {
      const amount = Number(p.amount) || 1;
      if (p.target === 'first_enemy') {
        return {
          preview: ctx => [{ targets: [ctx.enemies[0]], hp: -amount }],
          async run(api, self) {
            const enemies = api.enemiesOf(self);
            if (enemies.length) await api.damage(enemies[0], amount, self);
          },
        };
      }
      if (p.target === 'random_enemy') {
        return {
          preview: ctx => [{ targets: ctx.enemies, hp: -amount, random: true }],
          async run(api, self) {
            const t = api.randomOf(api.enemiesOf(self));
            if (t) await api.damage(t, amount, self);
          },
        };
      }
      if (p.target === 'all_enemies') {
        return {
          preview: ctx => [{ targets: ctx.enemies, hp: -amount }],
          async run(api, self) {
            const targets = api.enemiesOf(self);
            if (targets.length) await api.damageMany(targets, amount, self);
          },
        };
      }
      if (p.target === 'attacker') {
        return {
          preview: ctx => [{ targets: [ctx.enemies[0]], hp: -amount }],
          async run(api, self, ctx) {
            const attacker = ctx.attacker || api.enemiesOf(self)[0];
            if (attacker) await api.damage(attacker, amount, self);
          },
        };
      }
      if (p.target === 'self_hp_enemy') {
        return {
          preview: ctx => [{ targets: ctx.enemies, hp: -(ctx.self?.hp ?? 1), random: true }],
          async run(api, self) {
            const t = api.randomOf(api.enemiesOf(self));
            if (t && self.hp > 0) await api.damage(t, self.hp, self);
          },
        };
      }
      break;
    }

    case 'buff': {
      const atkDelta = Number(p.atk) || 0;
      const hpDelta = Number(p.hp) || 0;
      if (p.dynamic === 'equal_this_atk') {
        return {
          preview: ctx => [{ targets: [ctx.behind], hp: ctx.self?.atk ?? 1 }],
          async run(api, self) {
            const t = api.friendBehind(self);
            if (t) await api.buff(t, 0, self.atk, self);
          },
        };
      }
      if (p.dynamic === 'equal_remaining_hp') {
        return {
          preview: ctx => [{ targets: [ctx.behind], atk: Math.max(0, ctx.self?.hp ?? 1) }],
          async run(api, self) {
            const t = api.friendBehind(self);
            const remaining = Math.max(0, self.hp);
            if (t && remaining > 0) await api.buff(t, remaining, 0, self);
          },
        };
      }
      if (p.target === 'self') {
        return {
          preview: ctx => [{ targets: [ctx.self], atk: atkDelta, hp: hpDelta }],
          async run(api, self) {
            await api.buff(self, atkDelta, hpDelta, self);
          },
        };
      }
      if (p.target === 'friend_behind') {
        return {
          preview: ctx => [{ targets: [ctx.behind], atk: atkDelta, hp: hpDelta }],
          async run(api, self, ctx) {
            const team = api.team(self.side);
            const t = (ctx && ctx.index !== undefined) ? team[ctx.index] : api.friendBehind(self);
            if (t) await api.buff(t, atkDelta, hpDelta, self);
          },
        };
      }
      if (p.target === 'friend_ahead') {
        return {
          preview: ctx => [{ targets: [ctx.ahead], atk: atkDelta, hp: hpDelta }],
          async run(api, self) {
            const t = api.friendAhead(self);
            if (t) await api.buff(t, atkDelta, hpDelta, self);
          },
        };
      }
      if (p.target === 'two_ahead') {
        return {
          preview: ctx => [{ targets: [ctx.ahead, ctx.friends[0]].filter((u, i, a) => u && a.indexOf(u) === i), atk: atkDelta, hp: hpDelta }],
          async run(api, self) {
            const team = api.team(self.side);
            const i = team.indexOf(self);
            const targets = [team[i - 1], team[i - 2]].filter(Boolean);
            for (const t of targets) await api.buff(t, atkDelta, hpDelta, self);
          },
        };
      }
      if (p.target === 'random_friend') {
        return {
          preview: ctx => [{ targets: ctx.friends, atk: atkDelta, hp: hpDelta, random: true }],
          async run(api, self) {
            const t = api.randomOf(api.friendsOf(self));
            if (t) await api.buff(t, atkDelta, hpDelta, self);
          },
        };
      }
      if (p.target === 'all_friends') {
        return {
          preview: ctx => [{ targets: ctx.friends, atk: atkDelta, hp: hpDelta }],
          async run(api, self) {
            for (const t of api.friendsOf(self)) await api.buff(t, atkDelta, hpDelta, self);
          },
        };
      }
      break;
    }

    case 'retaliate': {
      return {
        preview: ctx => [{ targets: [ctx.enemies[0]], hp: -1, random: false }],
        async run(api, self, ctx) {
          if (ctx.damageAmount === undefined) return;
          const retaliate = Math.floor(ctx.damageAmount / 2);
          const attacker = ctx.attacker || api.enemiesOf(self)[0];
          if (attacker) await api.damage(attacker, retaliate, self);
        },
      };
    }

    case 'summon': {
      const token = p.token || 'bug';
      const count = Number(p.count) || 1;
      const pos = p.pos || 'behind';
      return {
        preview: () => [{ summon: token, count }],
        async run(api, self, ctx) {
          const insertIdx = pos === 'front' ? 0 : (ctx.index + 1);
          for (let k = 0; k < count; k++) {
            await api.summon(self.side, insertIdx, token, self);
          }
        },
      };
    }

    case 'reposition': {
      if (p.action === 'push_last') {
        return {
          preview: ctx => [{ targets: [ctx.enemies[0]], reorder: 'push-last' }],
          async run(api, self) {
            const enemies = api.enemiesOf(self);
            if (enemies.length) await api.pushToLast(enemies[0], self);
          },
        };
      }
      if (p.target === 'lowest_hp_enemy') {
        return {
          preview: ctx => {
            const sorted = [...ctx.enemies].filter(Boolean).sort((a, b) => a.hp - b.hp);
            return [{ targets: [sorted[0]], reorder: 'bring-front' }];
          },
          async run(api, self) {
            const enemies = api.enemiesOf(self);
            if (!enemies.length) return;
            const target = enemies.reduce((a, b) => a.hp <= b.hp ? a : b);
            await api.bringToFront(target, self);
          },
        };
      }
      if (p.target === 'highest_hp_friend') {
        return {
          preview: ctx => {
            const sorted = [...ctx.friends].filter(Boolean).sort((a, b) => b.hp - a.hp);
            return [{ targets: [sorted[0]], reorder: 'bring-front' }];
          },
          async run(api, self) {
            const friends = api.friendsOf(self);
            if (!friends.length) return;
            const target = friends.reduce((a, b) => a.hp >= b.hp ? a : b);
            await api.bringToFront(target, self);
          },
        };
      }
      if (p.target === 'highest_atk_friend') {
        return {
          preview: ctx => {
            const sorted = [...ctx.friends].filter(Boolean).sort((a, b) => b.atk - a.atk);
            return [{ targets: [sorted[0]], reorder: 'bring-front' }];
          },
          async run(api, self) {
            const friends = api.friendsOf(self);
            if (!friends.length) return;
            const target = friends.reduce((a, b) => a.atk >= b.atk ? a : b);
            await api.bringToFront(target, self);
          },
        };
      }
      break;
    }

    case 'debuff': {
      if (p.debuffType === 'halve_highest_atk') {
        return {
          preview: ctx => {
            const top = [...ctx.enemies].filter(Boolean).sort((a, b) => b.atk - a.atk)[0];
            return [{ targets: [top], atk: top ? -Math.floor(top.atk / 2) : 0 }];
          },
          async run(api, self) {
            const enemies = api.enemiesOf(self);
            if (!enemies.length) return;
            const top = enemies.reduce((a, b) => a.atk >= b.atk ? a : b);
            await api.halveAtk(top, self);
          },
        };
      }
      if (p.debuffType === 'set_atk_to_hp') {
        return {
          preview: ctx => {
            const e = ctx.enemies[0];
            return [{ targets: [e], atk: e ? e.hp - e.atk : 0 }];
          },
          async run(api, self) {
            const t = api.enemiesOf(self)[0];
            if (t) await api.setAtk(t, t.hp, self);
          },
        };
      }
      if (p.debuffType === 'reduce_atk_by_hp') {
        return {
          preview: ctx => {
            const e = ctx.enemies[0];
            return [{ targets: [e], atk: e ? -e.hp : 0 }];
          },
          async run(api, self) {
            const t = api.enemiesOf(self)[0];
            if (t) {
              const reduction = Math.min(t.atk, t.hp);
              await api.setAtk(t, Math.max(0, t.atk - reduction), self);
            }
          },
        };
      }
      break;
    }

    case 'shield': {
      return {
        preview: ctx => [{ targets: [ctx.self], shield: true }],
        async run(api, self) {
          await api.shield(self, self);
        },
      };
    }

    case 'custom': {
      try {
        const previewFn = p.previewCode ? new Function('p', p.previewCode) : () => [];
        const runFn = p.runCode
          ? new Function('api', 'self', 'ctx', `return (async () => { ${p.runCode} })();`)
          : async () => {};
        return { preview: previewFn, run: runFn };
      } catch (err) {
        console.warn('Failed to compile custom ability code:', err);
      }
      break;
    }
  }

  return { preview: def.preview || (() => []), run: def.run || (async () => {}) };
}

// Generates canonical trigger ability description text
export function generateAbilityText(def) {
  const trigEmoji = TRIGGERS[def.trigger]?.emoji || '🏁';
  const p = def.preset;
  if (!p) return def.text || '';

  if (p.type === 'deal_damage') {
    if (p.target === 'first_enemy') return `When ${trigEmoji} deal ${p.amount} damage to the first enemy.`;
    if (p.target === 'random_enemy') return `When ${trigEmoji} deal ${p.amount} damage to a random enemy.`;
    if (p.target === 'all_enemies') return `When ${trigEmoji} deal ${p.amount} damage to ALL enemies.`;
    if (p.target === 'attacker') return `When ${trigEmoji} deal ${p.amount} damage back to the attacker.`;
    if (p.target === 'self_hp_enemy') return `When ${trigEmoji} deal damage equal to this card's HP to a random enemy.`;
  }
  if (p.type === 'buff') {
    if (p.dynamic === 'equal_this_atk') return `When ${trigEmoji} give HP to the friend behind equal to this ATK.`;
    if (p.dynamic === 'equal_remaining_hp') return `When ${trigEmoji} give ATK to the friend behind equal to this remaining HP.`;
    const atkStr = p.atk ? (p.atk > 0 ? `+${p.atk}` : `${p.atk}`) : '';
    const hpStr = p.hp ? (p.hp > 0 ? `+${p.hp}` : `${p.hp}`) : '';
    const statStr = (atkStr && hpStr) ? `${atkStr}/${hpStr}` : (atkStr ? `${atkStr} ATK` : `${hpStr} HP`);
    if (p.target === 'self') return `When ${trigEmoji} gain ${statStr}.`;
    if (p.target === 'friend_behind') return `When ${trigEmoji} give ${statStr} to the friend behind.`;
    if (p.target === 'friend_ahead') return `When ${trigEmoji} give ${statStr} to the friend ahead.`;
    if (p.target === 'two_ahead') return `When ${trigEmoji} give ${statStr} to the two friends ahead.`;
    if (p.target === 'random_friend') return `When ${trigEmoji} give a random friend ${statStr}.`;
    if (p.target === 'all_friends') return `When ${trigEmoji} give all friends ${statStr}.`;
  }
  if (p.type === 'retaliate') return `When ${trigEmoji} deal half the damage taken back to the attacker.`;
  if (p.type === 'summon') {
    const tokenName = p.token === 'beetle' ? '2/2 Beetle' : '1/1 Bug';
    const posStr = p.pos === 'front' ? 'at the front' : 'behind';
    const countStr = p.count === 2 ? `2 ${tokenName}s` : `a ${tokenName}`;
    return `When ${trigEmoji} summon ${countStr} ${posStr}.`;
  }
  if (p.type === 'reposition') {
    if (p.action === 'push_last') return `When ${trigEmoji} push the first enemy to last.`;
    if (p.target === 'lowest_hp_enemy') return `When ${trigEmoji} bring the lowest-HP enemy to the front.`;
    if (p.target === 'highest_hp_friend') return `When ${trigEmoji} push the highest-HP friend to the front.`;
    if (p.target === 'highest_atk_friend') return `When ${trigEmoji} bring the highest-ATK friend forward.`;
  }
  if (p.type === 'debuff') {
    if (p.debuffType === 'halve_highest_atk') return `When ${trigEmoji} halve the ATK of the highest-ATK enemy (rounded down).`;
    if (p.debuffType === 'set_atk_to_hp') return `When ${trigEmoji} set the first enemy's ATK equal to its current HP.`;
    if (p.debuffType === 'reduce_atk_by_hp') return `When ${trigEmoji} reduce the first enemy's ATK by its current HP.`;
  }
  if (p.type === 'shield') return `When ${trigEmoji} gain 1-time block (Shield).`;
  return def.text || '';
}

// ─── BASE CHARACTERS ─────────────────────────────────────────────────────────
export const BASE_CHARACTERS = {
  // ── ROTATOR (birds)
  rotator_start: {
    class: 'rotator', name: 'Swiftbeak', emoji: '🦅', atk: 2, hp: 1,
    trigger: 'start',
    text: 'When 🏁 push the first enemy to last.',
    preset: { type: 'reposition', action: 'push_last', target: 'first_enemy' },
  },
  rotator_attack: {
    class: 'rotator', name: 'Tailwind', emoji: '🦜', atk: 3, hp: 1,
    trigger: 'attack',
    text: 'When 🗡️ bring the lowest-HP enemy to the front.',
    preset: { type: 'reposition', action: 'bring_front', target: 'lowest_hp_enemy' },
  },
  rotator_hurt: {
    class: 'rotator', name: 'Stormwing', emoji: '🦢', atk: 2, hp: 3,
    trigger: 'hurt',
    text: 'When 💢 push the highest-HP friend to the front.',
    preset: { type: 'reposition', action: 'bring_front', target: 'highest_hp_friend' },
  },
  rotator_death: {
    class: 'rotator', name: 'Deathfeather', emoji: '🦩', atk: 2, hp: 1,
    trigger: 'death',
    text: 'When 💀 bring the highest-ATK friend forward.',
    preset: { type: 'reposition', action: 'bring_front', target: 'highest_atk_friend' },
  },

  // ── DPS (tigers)
  dps_start: {
    class: 'dps', name: 'Claw Strike', emoji: '🐯', atk: 3, hp: 1,
    trigger: 'start',
    text: 'When 🏁 deal 3 damage to a random enemy.',
    preset: { type: 'deal_damage', target: 'random_enemy', amount: 3 },
  },
  dps_attack: {
    class: 'dps', name: 'Frenzy', emoji: '🐆', atk: 3, hp: 3,
    trigger: 'attack',
    text: 'When 🗡️ gain +1 ATK.',
    preset: { type: 'buff', target: 'self', atk: 1, hp: 0 },
  },
  dps_hurt: {
    class: 'dps', name: 'Retaliate', emoji: '🐅', atk: 3, hp: 2,
    trigger: 'hurt',
    text: 'When 💢 deal half the damage taken back to the attacker.',
    preset: { type: 'retaliate', fraction: 0.5 },
  },
  dps_death: {
    class: 'dps', name: 'Death Roar', emoji: '🦁', atk: 5, hp: 1,
    trigger: 'death',
    text: 'When 💀 deal 1 damage to ALL enemies.',
    preset: { type: 'deal_damage', target: 'all_enemies', amount: 1 },
  },

  // ── WARLOCK (snake / scorpion)
  warlock_start: {
    class: 'warlock', name: 'Venom Sight', emoji: '🐍', atk: 2, hp: 2,
    trigger: 'start',
    text: 'When 🏁 halve the ATK of the highest-ATK enemy (rounded down).',
    preset: { type: 'debuff', debuffType: 'halve_highest_atk' },
  },
  warlock_attack: {
    class: 'warlock', name: 'Curse Bite', emoji: '🦂', atk: 2, hp: 1,
    trigger: 'attack',
    text: 'When 🗡️ set the first enemy\'s ATK equal to its current HP.',
    preset: { type: 'debuff', debuffType: 'set_atk_to_hp' },
  },
  warlock_hurt: {
    class: 'warlock', name: 'Hex Scales', emoji: '🐊', atk: 1, hp: 3,
    trigger: 'hurt',
    text: 'When 💢 deal damage equal to this card\'s HP to a random enemy.',
    preset: { type: 'deal_damage', target: 'self_hp_enemy', amount: 0 },
  },
  warlock_death: {
    class: 'warlock', name: 'Death Curse', emoji: '🦎', atk: 2, hp: 2,
    trigger: 'death',
    text: 'When 💀 reduce the first enemy\'s ATK by its current HP.',
    preset: { type: 'debuff', debuffType: 'reduce_atk_by_hp' },
  },

  // ── SUMMONER (bugs)
  summoner_start: {
    class: 'summoner', name: 'Egg Burst', emoji: '🪲', atk: 2, hp: 2,
    trigger: 'start',
    text: 'When 🏁 summon a 2/2 Beetle behind.',
    preset: { type: 'summon', token: 'beetle', count: 1, pos: 'behind' },
  },
  summoner_attack: {
    class: 'summoner', name: 'Hive Call', emoji: '🐜', atk: 2, hp: 2,
    trigger: 'attack',
    text: 'When 🗡️ summon a 1/1 Bug behind.',
    preset: { type: 'summon', token: 'bug', count: 1, pos: 'behind' },
  },
  summoner_hurt: {
    class: 'summoner', name: 'Pain Spawn', emoji: '🦗', atk: 2, hp: 2,
    trigger: 'hurt',
    text: 'When 💢 summon a 1/1 Bug behind.',
    preset: { type: 'summon', token: 'bug', count: 1, pos: 'behind' },
  },
  summoner_death: {
    class: 'summoner', name: 'Swarm Queen', emoji: '🐝', atk: 2, hp: 2,
    trigger: 'death',
    text: 'When 💀 summon 2 1/1 Bugs at the front.',
    preset: { type: 'summon', token: 'bug', count: 2, pos: 'front' },
  },

  // ── SUPPORT (deers)
  support_start: {
    class: 'support', name: 'Grace Aura', emoji: '🦌', atk: 2, hp: 1,
    trigger: 'start',
    text: 'When 🏁 give +2/+1 to the two friends ahead.',
    preset: { type: 'buff', target: 'two_ahead', atk: 2, hp: 1 },
  },
  support_attack: {
    class: 'support', name: 'Healer Doe', emoji: '🦙', atk: 1, hp: 2,
    trigger: 'attack',
    text: 'When 🗡️ give HP to the friend behind equal to this ATK.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_this_atk', atk: 0, hp: 0 },
  },
  support_hurt: {
    class: 'support', name: 'Pain Share', emoji: '🦘', atk: 2, hp: 1,
    trigger: 'hurt',
    text: 'When 💢 give ATK to the friend behind equal to this remaining HP.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_remaining_hp', atk: 0, hp: 0 },
  },
  support_death: {
    class: 'support', name: 'Final Gift', emoji: '🐐', atk: 1, hp: 2,
    trigger: 'death',
    text: 'When 💀 give a random friend +2/+2.',
    preset: { type: 'buff', target: 'random_friend', atk: 2, hp: 2 },
  },

  // ── TANK (hippo / elephant / camel)
  tank_start: {
    class: 'tank', name: 'Iron Hide', emoji: '🦛', atk: 1, hp: 4,
    trigger: 'start',
    text: 'When 🏁 give the friend behind +2 HP.',
    preset: { type: 'buff', target: 'friend_behind', atk: 0, hp: 2 },
  },
  tank_attack: {
    class: 'tank', name: 'Trample Share', emoji: '🐘', atk: 1, hp: 5,
    trigger: 'attack',
    text: 'When 🗡️ give HP to the friend behind equal to this ATK.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_this_atk', atk: 0, hp: 0 },
  },
  tank_hurt: {
    class: 'tank', name: 'Thick Skin', emoji: '🐪', atk: 1, hp: 3,
    trigger: 'hurt',
    text: 'When 💢 give a random friend +1 HP.',
    preset: { type: 'buff', target: 'random_friend', atk: 0, hp: 1 },
  },
  tank_death: {
    class: 'tank', name: 'Last Stand', emoji: '🦬', atk: 1, hp: 5,
    trigger: 'death',
    text: 'When 💀 give +2 HP to the friend behind.',
    preset: { type: 'buff', target: 'friend_behind', atk: 0, hp: 2 },
  },

  // ── Tokens
  bug: { name: 'Bug', emoji: '🐛', atk: 1, hp: 1, token: true, class: 'summoner', text: '' },
  beetle: { name: 'Beetle', emoji: '🪲', atk: 2, hp: 2, token: true, class: 'summoner', text: '' },

  // ── Special Cage Card (0 ATK, 2 HP)
  cage: {
    name: 'Cage',
    emoji: '⛓️',
    atk: 0,
    hp: 2,
    token: true,
    isCage: true,
    class: 'cage',
    text: '0 ATK, 2 HP. Destroy this cage to rescue a captive card if you win combat!',
  },
};

// ─── ACTIVE CHARACTERS REGISTRY ──────────────────────────────────────────────
export const CHARACTERS = {};
export const RECRUITABLE = Object.keys(BASE_CHARACTERS).filter(
  id => !BASE_CHARACTERS[id].token && !BASE_CHARACTERS[id].isCage && id !== 'cage' && BASE_CHARACTERS[id].class !== 'cage'
);

let nextUid = 1;

export function makeCharacter(id, atkBonus = 0, hpBonus = 0) {
  const c = { uid: nextUid++, id };
  if (atkBonus) c.atkBonus = atkBonus;
  if (hpBonus) c.hpBonus = hpBonus;
  return c;
}

export function ensureNextUid(n) {
  if (n >= nextUid) nextUid = n + 1;
}

export function isCageCard(id) {
  if (!id || id === 'cage') return true;
  const def = CHARACTERS[id] || BASE_CHARACTERS[id];
  return Boolean(def && (def.isCage || def.class === 'cage'));
}

export function randomCharacterId() {
  if (!RECRUITABLE.length) {
    for (const [id, def] of Object.entries(BASE_CHARACTERS)) {
      if (!def.token && !def.isCage && id !== 'cage' && def.class !== 'cage') {
        RECRUITABLE.push(id);
      }
    }
  }
  const picked = RECRUITABLE[Math.floor(Math.random() * RECRUITABLE.length)];
  return picked || 'dps_start';
}

// ─── OVERRIDE STORAGE & REHYDRATION ──────────────────────────────────────────
const STORAGE_KEY = 'ccer-character-overrides';

export function getSavedOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveCharacterOverrides(overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (err) {
    console.warn('Could not save character overrides to localStorage:', err);
  }
  applyCharacterOverrides(overrides);
}

export function resetCharacterOverrides() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear character overrides from localStorage:', err);
  }
  applyCharacterOverrides({});
}

export function applyCharacterOverrides(overrides = {}) {
  // Clear active dictionary
  for (const k of Object.keys(CHARACTERS)) delete CHARACTERS[k];

  // Initialize from base
  for (const [id, base] of Object.entries(BASE_CHARACTERS)) {
    const cloned = { ...base };
    if (base.preset) cloned.preset = { ...base.preset };
    const { preview, run } = buildCardLogic(cloned);
    cloned.preview = preview;
    cloned.run = run;
    CHARACTERS[id] = cloned;
  }

  // Apply overrides
  for (const [id, ov] of Object.entries(overrides)) {
    if (!ov) continue;
    if (ov._deleted) {
      delete CHARACTERS[id];
      continue;
    }
    const current = CHARACTERS[id] || { class: 'dps', trigger: 'attack', token: false };
    const merged = { ...current, ...ov };
    if (ov.preset) merged.preset = { ...ov.preset };
    const { preview, run } = buildCardLogic(merged);
    merged.preview = preview;
    merged.run = run;
    if (!merged.text || ov.autoText) {
      merged.text = generateAbilityText(merged);
    }
    CHARACTERS[id] = merged;
  }

  // Refresh recruitable list
  RECRUITABLE.length = 0;
  for (const [id, def] of Object.entries(CHARACTERS)) {
    if (!def.token && !def.isCage && id !== 'cage' && def.class !== 'cage') {
      RECRUITABLE.push(id);
    }
  }
}

// ─── EXPORT CHARACTERS.JS SOURCE GENERATOR ───────────────────────────────────
export function exportCharactersJs(chars = CHARACTERS) {
  let lines = [];
  lines.push(`// Character definitions for Class Card Extraction.`);
  lines.push(`// Generated by the Visual Character Editor.`);
  lines.push(``);
  lines.push(`export const TRIGGERS = ${JSON.stringify(TRIGGERS, null, 2)};`);
  lines.push(``);
  lines.push(`export const CLASSES = ${JSON.stringify(CLASSES, null, 2)};`);
  lines.push(``);
  lines.push(`export const CHARACTERS = {`);

  for (const [id, def] of Object.entries(chars)) {
    lines.push(`  ${id}: {`);
    lines.push(`    class: ${JSON.stringify(def.class || 'dps')},`);
    lines.push(`    name: ${JSON.stringify(def.name || id)},`);
    lines.push(`    emoji: ${JSON.stringify(def.emoji || '🐾')},`);
    lines.push(`    atk: ${Number(def.atk) || 0},`);
    lines.push(`    hp: ${Number(def.hp) || 1},`);
    if (def.token) lines.push(`    token: true,`);
    if (def.isCage) lines.push(`    isCage: true,`);
    if (def.trigger) lines.push(`    trigger: ${JSON.stringify(def.trigger)},`);
    lines.push(`    text: ${JSON.stringify(def.text || '')},`);
    if (def.preset) {
      lines.push(`    preset: ${JSON.stringify(def.preset)},`);
    }
    lines.push(`  },`);
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`export const RECRUITABLE = Object.keys(CHARACTERS).filter(id => !CHARACTERS[id].token && !CHARACTERS[id].isCage && id !== 'cage' && CHARACTERS[id].class !== 'cage');`);
  lines.push(``);
  lines.push(`let nextUid = 1;`);
  lines.push(`export function makeCharacter(id, atkBonus = 0, hpBonus = 0) { const c = { uid: nextUid++, id }; if (atkBonus) c.atkBonus = atkBonus; if (hpBonus) c.hpBonus = hpBonus; return c; }`);
  lines.push(`export function ensureNextUid(n) { if (n >= nextUid) nextUid = n + 1; }`);
  lines.push(`export function randomCharacterId() { return RECRUITABLE[Math.floor(Math.random() * RECRUITABLE.length)]; }`);
  lines.push(``);

  return lines.join('\n');
}

// Initial hydration from localStorage
applyCharacterOverrides(getSavedOverrides());
