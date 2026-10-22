// Character definitions for Class Card Extraction.
// Six classes: rotator (birds), dps (tigers), warlock (snakes/scorpions),
//              summoner (bugs), support (deers), tank (hippo/elephant/camel)
// Each card has a `class` property used for the visual outline colour.
// Triggers: start, attack, hurt, death, tile (stepped onto a new tile).
// Extra API used by these abilities: pushToLast, bringToFront, moveTo, setAtk, halveAtk, tileOf, setTile, swapTiles

import { TILES, tileLabel } from './tiles.js';

export const TRIGGERS = {
  start:  { emoji: '🏁', label: 'On start',      name: 'Start of match', note: 'Once, after the teams are set and before the first attack.' },
  attack: { emoji: '🗡️', label: 'Before attack', name: 'Before attack',  note: 'Every time it attacks, just before the hit.' },
  hurt:   { emoji: '💢', label: 'On hurt',       name: 'Hurt',            note: 'Every time it takes damage.' },
  death:  { emoji: '💀', label: 'On death',      name: 'Death',           note: 'Once, when it dies.' },
  tile:   { emoji: '🧭', label: 'On new tile',   name: 'New tile',        note: 'Every time it moves into another slot during the fight, and so onto that slot\'s tile.' },
};

// Card text opens with the trigger: "On start 🏁: ...", "Before attack 🗡️: ..."
export function triggerPrefix(trigger) {
  const t = TRIGGERS[trigger] || TRIGGERS.start;
  return `${t.label} ${t.emoji}:`;
}

// Rewrites the old "When 🏁 ..." wording (base texts, saved editor overrides) to the trigger prefix
export function rewordTriggerText(text) {
  if (!text) return text;
  return text.replace(/^When\s*(🏁|🗡️|🗡|💢|💀|🧭)\s*/u, (_, emoji) => {
    const key = Object.keys(TRIGGERS).find(k => TRIGGERS[k].emoji.startsWith(emoji) || emoji.startsWith(TRIGGERS[k].emoji));
    return key ? `${triggerPrefix(key)} ` : _;
  });
}

// ─── CLASS META (for the visual badge / background) ──────────────────────────
export const CLASSES = {
  rotator:  { label: 'Rotator',  emoji: '🦅', color: '#0ea5e9' },   // sky-blue
  dps:      { label: 'Warrior',  emoji: '⚔️', color: '#ef4444' },   // red
  warlock:  { label: 'Warlock',  emoji: '🥀', color: '#a855f7' },   // purple
  support:  { label: 'Support',  emoji: '💪', color: '#f59e0b' },   // amber
  tank:     { label: 'Healer',   emoji: '💚', color: '#10b981' },   // emerald / green
  cage:     { label: 'Cage',     emoji: '⛓️', color: '#eab308' },   // gold / locked cage
  summoner: { label: 'Summoner', emoji: '🐛', color: '#22c55e' },
};

// ─── ABILITY PRESETS & LOGIC BUILDER ─────────────────────────────────────────
// Any preset can carry `onlyOn: <tile id>`: the ability only does something while this card stands
// on that tile (a card on Rock never fires at all, so Rock is not offered as a condition).
export function buildCardLogic(def) {
  const logic = buildPresetLogic(def);
  const only = def.preset?.onlyOn;
  if (!only || !TILES[only]) return logic;
  return {
    preview: ctx => (ctx.selfTile && ctx.selfTile !== only ? [] : logic.preview(ctx)),
    async run(api, self, ctx) {
      if (api.tileOf(self) !== only) return;
      await logic.run(api, self, ctx);
    },
  };
}

// Column index a tile preset points at: 'here' = this card's slot, 'front' / 'middle' / 'back' fixed
function tileColumn(where, index) {
  if (where === 'front') return 0;
  if (where === 'middle') return 1;
  if (where === 'back') return 2;
  return index;
}

function buildPresetLogic(def) {
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
      if (p.target === 'last_enemy') {
        return {
          preview: ctx => [{ targets: [ctx.enemies.filter(Boolean).at(-1)], hp: -amount }],
          async run(api, self) {
            const enemies = api.enemiesOf(self);
            if (enemies.length) await api.damage(enemies[enemies.length - 1], amount, self);
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
      if (p.action === 'self_to_tile') {
        // This card walks onto the first column with that tile (no-op if there is none)
        const want = p.tile || 'oasis';
        return {
          preview: ctx => {
            const col = (ctx.tiles || []).indexOf(want);
            return col < 0 ? [] : [{ targets: [ctx.self], reorder: 'to-tile', tile: want, col }];
          },
          async run(api, self) {
            const col = api.tiles().indexOf(want);
            if (col >= 0) await api.moveTo(self, col, self);
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

    // Reshapes the terrain: the tile in one column becomes another tile (both sides share it)
    case 'terraform': {
      const tile = TILES[p.tile] ? p.tile : 'rock';
      return {
        preview: ctx => [{ terraform: { col: tileColumn(p.where, ctx.index ?? 0), tile } }],
        async run(api, self, ctx) {
          await api.setTile(tileColumn(p.where, ctx.index), tile, self);
        },
      };
    }

    // Swaps the front and back tiles
    case 'swap_tiles': {
      return {
        preview: () => [{ terraform: { col: 0, swap: 2 } }],
        async run(api, self) {
          await api.swapTiles(0, 2, self);
        },
      };
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
  const p = def.preset;
  if (!p) return def.text || '';
  const pre = triggerPrefix(def.trigger) + (p.onlyOn && TILES[p.onlyOn] ? ` if on ${tileLabel(p.onlyOn)},` : '');

  if (p.type === 'deal_damage') {
    if (p.target === 'first_enemy') return `${pre} deal ${p.amount} damage to the first enemy.`;
    if (p.target === 'last_enemy') return `${pre} deal ${p.amount} damage to the last enemy.`;
    if (p.target === 'random_enemy') return `${pre} deal ${p.amount} damage to a random enemy.`;
    if (p.target === 'all_enemies') return `${pre} deal ${p.amount} damage to ALL enemies.`;
    if (p.target === 'attacker') return `${pre} deal ${p.amount} damage back to the attacker.`;
    if (p.target === 'self_hp_enemy') return `${pre} deal damage equal to this card's HP to a random enemy.`;
  }
  if (p.type === 'buff') {
    if (p.dynamic === 'equal_this_atk') return `${pre} give HP to the friend behind equal to this ATK.`;
    if (p.dynamic === 'equal_remaining_hp') return `${pre} give ATK to the friend behind equal to this remaining HP.`;
    const atkStr = p.atk ? (p.atk > 0 ? `+${p.atk}` : `${p.atk}`) : '';
    const hpStr = p.hp ? (p.hp > 0 ? `+${p.hp}` : `${p.hp}`) : '';
    const statStr = (atkStr && hpStr) ? `${atkStr}/${hpStr}` : (atkStr ? `${atkStr} ATK` : `${hpStr} HP`);
    if (p.target === 'self') return `${pre} gain ${statStr}.`;
    if (p.target === 'friend_behind') return `${pre} give ${statStr} to the friend behind.`;
    if (p.target === 'friend_ahead') return `${pre} give ${statStr} to the friend ahead.`;
    if (p.target === 'two_ahead') return `${pre} give ${statStr} to the two friends ahead.`;
    if (p.target === 'random_friend') return `${pre} give a random friend ${statStr}.`;
    if (p.target === 'all_friends') return `${pre} give all friends ${statStr}.`;
  }
  if (p.type === 'retaliate') return `${pre} deal half the damage taken back to the attacker.`;
  if (p.type === 'summon') {
    const tokenName = p.token === 'beetle' ? '2/2 Beetle' : '1/1 Bug';
    const posStr = p.pos === 'front' ? 'at the front' : 'behind';
    const countStr = p.count === 2 ? `2 ${tokenName}s` : `a ${tokenName}`;
    return `${pre} summon ${countStr} ${posStr}.`;
  }
  if (p.type === 'reposition') {
    if (p.action === 'push_last') return `${pre} push the first enemy to last.`;
    if (p.target === 'lowest_hp_enemy') return `${pre} bring the lowest-HP enemy to the front.`;
    if (p.action === 'self_to_tile') return `${pre} move onto the ${tileLabel(p.tile || 'oasis')} (if there is one).`;
    if (p.target === 'highest_hp_friend') return `${pre} push the highest-HP friend to the front.`;
    if (p.target === 'highest_atk_friend') return `${pre} bring the highest-ATK friend forward.`;
  }
  if (p.type === 'debuff') {
    if (p.debuffType === 'halve_highest_atk') return `${pre} halve the ATK of the highest-ATK enemy (rounded down).`;
    if (p.debuffType === 'set_atk_to_hp') return `${pre} set the first enemy's ATK equal to its current HP.`;
    if (p.debuffType === 'reduce_atk_by_hp') return `${pre} reduce the first enemy's ATK by its current HP.`;
  }
  if (p.type === 'terraform') {
    const where = { front: 'the front tile', middle: 'the middle tile', back: 'the back tile' }[p.where] || 'the tile here';
    return `${pre} turn ${where} into ${tileLabel(p.tile || 'rock')}.`;
  }
  if (p.type === 'swap_tiles') return `${pre} swap the front and back tiles.`;
  if (p.type === 'shield') return `${pre} gain 1-time block (Shield).`;
  return def.text || '';
}

// ─── BASE CHARACTERS ─────────────────────────────────────────────────────────
export const BASE_CHARACTERS = {
  // ── ROTATOR (birds)
  rotator_start: {
    class: 'rotator', name: 'Swiftbeak', emoji: '🦅', atk: 2, hp: 3,
    trigger: 'start',
    text: 'On start 🏁: push the first enemy to last.',
    preset: { type: 'reposition', action: 'push_last', target: 'first_enemy' },
  },
  rotator_attack: {
    class: 'rotator', name: 'Tailwind', emoji: '🦜', atk: 3, hp: 3,
    trigger: 'attack',
    text: 'Before attack 🗡️: bring the lowest-HP enemy to the front.',
    preset: { type: 'reposition', action: 'bring_front', target: 'lowest_hp_enemy' },
  },
  rotator_hurt: {
    class: 'rotator', name: 'Stormwing', emoji: '🦢', atk: 2, hp: 5,
    trigger: 'hurt',
    text: 'On hurt 💢: push the highest-HP friend to the front.',
    preset: { type: 'reposition', action: 'bring_front', target: 'highest_hp_friend' },
  },
  rotator_death: {
    class: 'rotator', name: 'Deathfeather', emoji: '🦩', atk: 2, hp: 3,
    trigger: 'death',
    text: 'On death 💀: bring the highest-ATK friend forward.',
    preset: { type: 'reposition', action: 'bring_front', target: 'highest_atk_friend' },
  },

  // ── DPS (tigers)
  dps_start: {
    class: 'dps', name: 'Claw Strike', emoji: '🐯', atk: 3, hp: 3,
    trigger: 'start',   // terrain pass 1: was "deal 3 damage to a random enemy"
    text: 'On start 🏁: turn the front tile into Quicksand 🌀.',
    preset: { type: 'terraform', where: 'front', tile: 'quicksand' },
  },
  dps_attack: {
    class: 'dps', name: 'Frenzy', emoji: '🐆', atk: 3, hp: 5,
    trigger: 'attack',
    text: 'Before attack 🗡️: gain +1 ATK.',
    preset: { type: 'buff', target: 'self', atk: 1, hp: 0 },
  },
  dps_hurt: {
    class: 'dps', name: 'Retaliate', emoji: '🐅', atk: 3, hp: 4,
    trigger: 'hurt',   // terrain pass 1: now only on Oasis (where it fires twice = full damage back)
    text: 'On hurt 💢: if on Oasis 🌴, deal half the damage taken back to the attacker.',
    preset: { type: 'retaliate', fraction: 0.5, onlyOn: 'oasis' },
  },
  dps_death: {
    class: 'dps', name: 'Death Roar', emoji: '🦁', atk: 5, hp: 3,
    trigger: 'death',   // terrain pass 1: was "deal 1 damage to ALL enemies"
    text: 'On death 💀: turn the tile here into Oasis 🌴.',
    preset: { type: 'terraform', where: 'here', tile: 'oasis' },
  },

  // ── WARLOCK (snake / scorpion)
  warlock_start: {
    class: 'warlock', name: 'Venom Sight', emoji: '🐍', atk: 2, hp: 4,
    trigger: 'start',
    text: 'On start 🏁: halve the ATK of the highest-ATK enemy (rounded down).',
    preset: { type: 'debuff', debuffType: 'halve_highest_atk' },
  },
  warlock_attack: {
    class: 'warlock', name: 'Curse Bite', emoji: '🦂', atk: 2, hp: 3,
    trigger: 'attack',
    text: 'Before attack 🗡️: set the first enemy\'s ATK equal to its current HP.',
    preset: { type: 'debuff', debuffType: 'set_atk_to_hp' },
  },
  warlock_hurt: {
    class: 'warlock', name: 'Hex Scales', emoji: '🐊', atk: 1, hp: 5,
    trigger: 'tile',   // terrain pass 1: was the same effect "On hurt"
    text: 'On new tile 🧭: deal damage equal to this card\'s HP to a random enemy.',
    preset: { type: 'deal_damage', target: 'self_hp_enemy', amount: 0 },
  },
  warlock_death: {
    class: 'warlock', name: 'Death Curse', emoji: '🦎', atk: 2, hp: 4,
    trigger: 'death',
    text: 'On death 💀: reduce the first enemy\'s ATK by its current HP.',
    preset: { type: 'debuff', debuffType: 'reduce_atk_by_hp' },
  },

  // ── SUPPORT (deers)
  support_start: {
    class: 'support', name: 'Grace Aura', emoji: '🦌', atk: 2, hp: 3,
    trigger: 'start',
    text: 'On start 🏁: give +1/+1 to the two friends ahead.',
    preset: { type: 'buff', target: 'two_ahead', atk: 1, hp: 1 },
  },
  support_attack: {
    class: 'support', name: 'Healer Doe', emoji: '🦙', atk: 1, hp: 4,
    trigger: 'attack',
    text: 'Before attack 🗡️: give HP to the friend behind equal to this ATK.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_this_atk', atk: 0, hp: 0 },
  },
  support_hurt: {
    class: 'support', name: 'Pain Share', emoji: '🦘', atk: 2, hp: 3,
    trigger: 'hurt',
    text: 'On hurt 💢: give ATK to the friend behind equal to this remaining HP.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_remaining_hp', atk: 0, hp: 0 },
  },
  support_death: {
    class: 'support', name: 'Final Gift', emoji: '🐐', atk: 1, hp: 4,
    trigger: 'death',
    text: 'On death 💀: give a random friend +2/+2.',
    preset: { type: 'buff', target: 'random_friend', atk: 2, hp: 2 },
  },

  // ── TANK (hippo / elephant / camel)
  tank_start: {
    class: 'tank', name: 'Iron Hide', emoji: '🦛', atk: 1, hp: 6,
    trigger: 'start',
    text: 'On start 🏁: give the friend behind +2 HP.',
    preset: { type: 'buff', target: 'friend_behind', atk: 0, hp: 2 },
  },
  tank_attack: {
    class: 'tank', name: 'Trample Share', emoji: '🐘', atk: 1, hp: 7,
    trigger: 'attack',
    text: 'Before attack 🗡️: give HP to the friend behind equal to this ATK.',
    preset: { type: 'buff', target: 'friend_behind', dynamic: 'equal_this_atk', atk: 0, hp: 0 },
  },
  tank_hurt: {
    class: 'tank', name: 'Thick Skin', emoji: '🐪', atk: 1, hp: 5,
    trigger: 'hurt',
    text: 'On hurt 💢: give a random friend +1 HP.',
    preset: { type: 'buff', target: 'random_friend', atk: 0, hp: 1 },
  },
  tank_death: {
    class: 'tank', name: 'Last Stand', emoji: '🦬', atk: 1, hp: 7,
    trigger: 'death',
    text: 'On death 💀: give +2 HP to the friend behind.',
    preset: { type: 'buff', target: 'friend_behind', atk: 0, hp: 2 },
  },

  // ── AMBUSH cards (ids kept from prototype 1; their noise abilities became plain ones)
  warlock_start_noise: {
    class: 'warlock', name: 'Howler', emoji: '🐒', atk: 2, hp: 4,
    trigger: 'death',
    text: 'On death 💀: deal 2 damage to the first enemy.',
    preset: { type: 'deal_damage', target: 'first_enemy', amount: 2 },
  },
  tank_hurt_noise: {
    class: 'tank', name: 'Rattleback', emoji: '🦔', atk: 1, hp: 5,
    trigger: 'hurt',
    text: 'On hurt 💢: deal 1 damage back to the attacker.',
    preset: { type: 'deal_damage', target: 'attacker', amount: 1 },
  },
  dps_start_last: {
    class: 'dps', name: 'Ambush Fox', emoji: '🦊', atk: 2, hp: 3,
    trigger: 'start',
    text: 'On start 🏁: deal 5 damage to the last enemy.',
    preset: { type: 'deal_damage', target: 'last_enemy', amount: 5 },
  },
  rotator_attack_quiet: {
    class: 'warlock', name: 'Sandgrouse', emoji: '🐦', atk: 3, hp: 3,
    trigger: 'start',
    text: 'On start 🏁: bring the lowest-HP enemy to the front.',
    preset: { type: 'reposition', action: 'bring_front', target: 'lowest_hp_enemy' },
  },


  // ── PLAIN CARDS (no ability, no class): the power ladder is visible in the numbers.
  plain_jackal:   { name: 'Jackal',   emoji: '🐕', atk: 2,  hp: 4, text: '' },
  plain_hyena: {   // scavenger: picks at the back line every time the line moves (terrain pass 1: was "Before attack")
    class: 'dps', name: 'Hyena', emoji: '🐺', atk: 3, hp: 5,
    trigger: 'tile',
    text: 'On new tile 🧭: deal 2 damage to the last enemy.',
    preset: { type: 'deal_damage', target: 'last_enemy', amount: 2 },
  },
  plain_warthog:  { name: 'Warthog',  emoji: '🐗', atk: 4,  hp: 6, text: '' },
  plain_falcon: {   // terrain pass 1: was a plain 5/3
    name: 'Falcon', emoji: '🦅', atk: 5, hp: 3,
    trigger: 'start',
    text: 'On start 🏁: swap the front and back tiles.',
    preset: { type: 'swap_tiles' },
  },
  plain_lion:     { name: 'Jaguar',   emoji: '🐈‍⬛', atk: 8,  hp: 4, text: '' },
  plain_owl:      { name: 'Owl',      emoji: '🦉', atk: 4,  hp: 3, text: '' },
  plain_sloth:    { name: 'Sloth',    emoji: '🦥', atk: 1,  hp: 6, text: '' },
  plain_camel:    { name: 'Camel',    emoji: '🐪', atk: 1,  hp: 7, text: '' },
  plain_hippo: {   // big wall that sharpens the card behind it
    class: 'support', name: 'Buffalo', emoji: '🐃', atk: 2, hp: 8,
    trigger: 'start',
    text: 'On start 🏁: give +1 ATK to the friend behind.',
    preset: { type: 'buff', target: 'friend_behind', atk: 1, hp: 0 },
  },
  plain_elephant: {   // huge wall that shrugs off the first hit
    class: 'tank', name: 'Elephant', emoji: '🐘', atk: 2, hp: 9,
    trigger: 'start',
    text: 'On start 🏁: gain 1-time block (Shield).',
    preset: { type: 'shield' },
  },
  plain_behemoth: { name: 'Behemoth', emoji: '🦏', atk: 10, hp: 12, text: '' },

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

// ─── STARTER PACK & XP UNLOCK CONFIGURATION ──────────────────────────────────
export const STARTER_PACK_IDS = [
  // Beginner-friendly: readable numbers, two simple 🏁 abilities that teach positioning.
  'plain_jackal',    // 🐕 4hp 2atk
  'plain_hyena',     // 🐺 5/3
  'plain_camel',     // 🐪 7/1  wall
  'plain_sloth',     // 🦥 6/1  wall
  'plain_owl',       // 🦉 3/4  striker
  'plain_warthog',   // 🐗 6/4
  'plain_hippo',     // 🐃 Buffalo 8/2
  'tank_start',      // 🦛 Iron Hide: 🏁 give the friend behind +2 HP   (teaches "who is behind me")
  'dps_start',       // 🐯 Claw Strike: 🏁 deal 3 damage to a random enemy
];

// First card guaranteed to unlock at Level 1 before transitioning to random unlocks
export const FIRST_UNLOCK_CARD_ID = 'support_start'; // Grace Aura (🦌): first ability that rewards back-slot placement

export const XP_CONFIG = {
  cardPlayed: 22,
  levelCleared: 25,
  runCompletionBonus: 50,
  firstRunBonus: 50,
};

// Cumulative XP thresholds required to reach each level
export const UNLOCK_THRESHOLDS = {
  1: 191,
  2: 389,
  3: 609,
  4: 864,
  5: 1169,
  6: 1537,
  7: 2015,
  8: 2556,
  9: 3183,
  10: 3923,
  11: 4828,
  12: 5920,
  13: 7175,
  14: 8572,
  15: 10086,
  16: 11905,
  17: 14086,
  18: 16412,
  19: 18665,
};

export function getXpThresholdForLevel(lvl) {
  if (lvl <= 0) return 0;
  if (UNLOCK_THRESHOLDS[lvl] !== undefined) return UNLOCK_THRESHOLDS[lvl];
  // Smooth progression past level 19
  return 18665 + (lvl - 19) * 2500;
}

export function getLevelFromTotalXp(xp) {
  let lvl = 0;
  while (xp >= getXpThresholdForLevel(lvl + 1)) {
    lvl++;
  }
  return lvl;
}

// ─── ACTIVE CHARACTERS REGISTRY ──────────────────────────────────────────────
export const CHARACTERS = {};
export const RECRUITABLE = Object.keys(BASE_CHARACTERS).filter(
  id => !BASE_CHARACTERS[id].token && !BASE_CHARACTERS[id].isCage && id !== 'cage' && BASE_CHARACTERS[id].class !== 'cage'
);

let activeUnlockedIds = [...STARTER_PACK_IDS];

export function setUnlockedIds(ids) {
  if (Array.isArray(ids) && ids.length > 0) {
    activeUnlockedIds = ids.filter(id => CHARACTERS[id] && !CHARACTERS[id].token && !isCageCard(id));
  }
  if (!activeUnlockedIds.length) {
    activeUnlockedIds = [...STARTER_PACK_IDS];
  }
}

export function getUnlockedIds() {
  return [...activeUnlockedIds];
}

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

export function randomCharacterId(allowLocked = false) {
  const pool = (!allowLocked && activeUnlockedIds.length) ? activeUnlockedIds : RECRUITABLE;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return picked || 'dps_start';
}

// ─── OVERRIDE STORAGE & REHYDRATION ──────────────────────────────────────────
const STORAGE_KEY = 'dfp2-character-overrides';

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
    merged.text = rewordTriggerText(merged.text);
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
