// Candidate card pool for the balance simulator.
// These are OVERRIDES in the same shape the Visual Character Editor saves,
// so they're applied with applyCharacterOverrides() and get real `run` logic.
// Edit freely: add / remove / tweak and re-run `node sim/sim.mjs`.
//
// Stats are listed as hp / atk / noise in the comments to match your notation.
// NOTE: all cards in the game got +2 base HP; the candidates here include it too.

export const CANDIDATE_OVERRIDES = {
  // ── Your intuition examples ───────────────────────────────────────────────
  decoy:      { class: 'tank',    name: 'Decoy',      emoji: '🪨', hp: 3,  atk: 0,  noise: 0,  trigger: null, text: '' },          // 1/0/0
  sniper:     { class: 'dps',     name: 'Sniper',     emoji: '🏹', hp: 3,  atk: 2,  noise: 4,  trigger: 'start', autoText: true,  // 1/2/4
                preset: { type: 'deal_damage', target: 'random_enemy', amount: 2 } },
  martyr:     { class: 'support', name: 'Martyr',     emoji: '🕯️', hp: 3,  atk: 0,  noise: 4,  trigger: 'death', autoText: true,  // 1/0/4
                preset: { type: 'buff', target: 'random_friend', atk: 2, hp: 1 } },

  // ── Plain cards (no ability): a spread of stat profiles ──────────────────
  // "fair" vanillas: noise ≈ (hp+atk)/3
  v_5_5_5:    { class: 'dps',  name: 'Bull',       emoji: '🐂', hp: 7, atk: 5, noise: 5, trigger: null, text: '' },
  // glass cannons
  v_1_3_1:    { class: 'dps',  name: 'Viper',      emoji: '🐍', hp: 3, atk: 3, noise: 1, trigger: null, text: '' },
  v_2_6_3:    { class: 'dps',  name: 'Cheetah',    emoji: '🐆', hp: 4, atk: 6, noise: 3, trigger: null, text: '' },
  // walls
  v_3_1_1:    { class: 'tank', name: 'Tortoise',   emoji: '🐢', hp: 5, atk: 1, noise: 1, trigger: null, text: '' },
  // "quiet" cards: under-statted but almost silent
  v_1_1_0:    { class: 'tank', name: 'Mouse',      emoji: '🐭', hp: 3, atk: 1, noise: 0, trigger: null, text: '' },
  v_2_1_0:    { class: 'tank', name: 'Gecko',      emoji: '🦎', hp: 4, atk: 1, noise: 0, trigger: null, text: '' },
  // negative noise: weak in combat, but makes room in the noise budget for a loud friend
  v_1_1_m2:   { class: 'tank', name: 'Whisper',    emoji: '🤫', hp: 3, atk: 1, noise: -2, trigger: null, text: '' },
  v_2_0_m3:   { class: 'tank', name: 'Hush',       emoji: '🌫️', hp: 4, atk: 0, noise: -3, trigger: null, text: '' },
  // "loud" cards: over-statted, very noisy
  v_4_4_6:    { class: 'dps',  name: 'Boar',       emoji: '🐖', hp: 6, atk: 4, noise: 6, trigger: null, text: '' },
  v_3_6_6:    { class: 'dps',  name: 'Rooster',    emoji: '🐓', hp: 5, atk: 6, noise: 6, trigger: null, text: '' },
};

// Cards that only exist as summon tokens / cage — never in the draw pool
export const EXCLUDE_IDS = new Set(['cage', 'bug', 'beetle']);
