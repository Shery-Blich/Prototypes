// Card data for the Class Cards Extraction GDD (see ../GDD.md). Every card has its own HP and ATK.
// Names are [class]_[index]; the index follows the order of the design table.
//
// effect.kind   hp      give HP (no max HP: it can go above the starting value)
//               atk     give ATK
//               damage  deal damage (it triggers the target's 💢 hurt ability)
//               weaken  remove ATK (never below RULES.minAtk)
//               setAtk  set ATK to amount
//               move    reposition a card: effect.to = 'front' | 'last'
// effect.amount a number, or 'halfAtk' (remove half the target's ATK, round down)
// effect.target see targetsOf() in engine.mjs
//
// Tuned with balance.html?grid=final (results-final.txt).

export const RULES = {
  minAtk: 1,   // ATK never drops below this: every clash deals damage, so every battle ends
};

export const CLASSES = ['plain', 'healer', 'support', 'warrior', 'warlock', 'rotator'];

export const CARDS = {
  // ── Plain: no ability
  plain_1: { cls: 'plain', hp: 9,  atk: 3 },
  plain_2: { cls: 'plain', hp: 9,  atk: 2 },
  plain_3: { cls: 'plain', hp: 5,  atk: 1 },
  plain_4: { cls: 'plain', hp: 8,  atk: 1 },
  plain_5: { cls: 'plain', hp: 5,  atk: 2 },

  // ── Healer: gives HP
  healer_1: { cls: 'healer', hp: 7, atk: 2, trigger: 'start',
    effect: { kind: 'hp', target: 'friendAhead', amount: 2 } },
  healer_2: { cls: 'healer', hp: 8, atk: 1, trigger: 'hurt',
    effect: { kind: 'hp', target: 'friendBehind', amount: 2 } },
  healer_3: { cls: 'healer', hp: 5, atk: 2, trigger: 'death',
    effect: { kind: 'hp', target: 'randomFriend', amount: 4 } },

  // ── Support: gives ATK
  support_1: { cls: 'support', hp: 7, atk: 1, trigger: 'attack',
    effect: { kind: 'atk', target: 'friendBehind', amount: 1 } },
  support_2: { cls: 'support', hp: 8, atk: 1, trigger: 'death',
    effect: { kind: 'atk', target: 'randomFriend', amount: 2 } },
  support_3: { cls: 'support', hp: 6, atk: 1, trigger: 'start',
    effect: { kind: 'atk', target: 'allFriends', amount: 1 } },

  // ── Warrior: deals damage outside the clash
  warrior_1: { cls: 'warrior', hp: 4, atk: 3, trigger: 'start',
    effect: { kind: 'damage', target: 'lastEnemy', amount: 3 } },
  warrior_2: { cls: 'warrior', hp: 5, atk: 2, trigger: 'attack',
    effect: { kind: 'damage', target: 'secondEnemy', amount: 2 } },
  warrior_3: { cls: 'warrior', hp: 6, atk: 2, trigger: 'death',
    effect: { kind: 'damage', target: 'allEnemies', amount: 2 } },

  // ── Warlock: removes enemy ATK
  warlock_1: { cls: 'warlock', hp: 6, atk: 1, trigger: 'start',
    effect: { kind: 'weaken', target: 'allEnemies', amount: 1 } },
  warlock_2: { cls: 'warlock', hp: 8, atk: 2, trigger: 'death',
    effect: { kind: 'weaken', target: 'killer', amount: 'halfAtk' } },
  warlock_3: { cls: 'warlock', hp: 7, atk: 1, trigger: 'attack',
    effect: { kind: 'setAtk', target: 'firstEnemy', amount: 1 } },

  // ── Rotator: moves cards
  rotator_1: { cls: 'rotator', hp: 9, atk: 2, trigger: 'start',
    effect: { kind: 'move', target: 'firstEnemy', to: 'last' } },
  rotator_2: { cls: 'rotator', hp: 8, atk: 2, trigger: 'attack',
    effect: { kind: 'move', target: 'lowestHpEnemy', to: 'front' } },
  rotator_3: { cls: 'rotator', hp: 10, atk: 2, trigger: 'death',
    effect: { kind: 'move', target: 'highestAtkFriend', to: 'front' } },
};

export const CARD_IDS = Object.keys(CARDS);
