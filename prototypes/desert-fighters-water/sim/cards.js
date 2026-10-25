// Candidate card pool for the balance simulator.
// These are OVERRIDES in the same shape the Visual Character Editor saves,
// so they're applied with applyCharacterOverrides() and get real `run` logic.
// Edit freely: add / remove / tweak and re-run `node sim/sim.mjs`.
//
// Stats are listed as hp / atk in the comments.
// NOTE: all cards in the game got +2 base HP; the candidates here include it too.

export const CANDIDATE_OVERRIDES = {
  // ── Your intuition examples ───────────────────────────────────────────────
  decoy:      { class: 'tank',    name: 'Decoy',      emoji: '🪨', hp: 3,  atk: 0,  trigger: null, text: '' },
  sniper:     { class: 'dps',     name: 'Sniper',     emoji: '🏹', hp: 3,  atk: 2,  trigger: 'start', autoText: true,
                preset: { type: 'deal_damage', target: 'random_enemy', amount: 2 } },
  martyr:     { class: 'support', name: 'Martyr',     emoji: '🕯️', hp: 3,  atk: 0,  trigger: 'death', autoText: true,
                preset: { type: 'buff', target: 'random_friend', atk: 2, hp: 1 } },

  // ── Plain cards (no ability): a spread of stat profiles ──────────────────
  // "fair" vanillas
  v_5_5_5:    { class: 'dps',  name: 'Bull',       emoji: '🐂', hp: 7, atk: 5, trigger: null, text: '' },
  // glass cannons
  v_1_3_1:    { class: 'dps',  name: 'Viper',      emoji: '🐍', hp: 3, atk: 3, trigger: null, text: '' },
  v_2_6_3:    { class: 'dps',  name: 'Cheetah',    emoji: '🐆', hp: 4, atk: 6, trigger: null, text: '' },
  // walls
  v_3_1_1:    { class: 'tank', name: 'Tortoise',   emoji: '🐢', hp: 5, atk: 1, trigger: null, text: '' },
  // under-statted cards
  v_1_1_0:    { class: 'tank', name: 'Mouse',      emoji: '🐭', hp: 3, atk: 1, trigger: null, text: '' },
  v_2_1_0:    { class: 'tank', name: 'Gecko',      emoji: '🦎', hp: 4, atk: 1, trigger: null, text: '' },
  // weak in combat (prototype 1 paid them back with negative noise)
  v_1_1_m2:   { class: 'tank', name: 'Whisper',    emoji: '🤫', hp: 3, atk: 1, trigger: null, text: '' },
  v_2_0_m3:   { class: 'tank', name: 'Hush',       emoji: '🌫️', hp: 4, atk: 0, trigger: null, text: '' },
  // over-statted cards
  v_4_4_6:    { class: 'dps',  name: 'Boar',       emoji: '🐖', hp: 6, atk: 4, trigger: null, text: '' },
  v_3_6_6:    { class: 'dps',  name: 'Rooster',    emoji: '🐓', hp: 5, atk: 6, trigger: null, text: '' },
};

// Cards that only exist as summon tokens / cage — never in the draw pool
export const EXCLUDE_IDS = new Set(['cage', 'bug', 'beetle']);
