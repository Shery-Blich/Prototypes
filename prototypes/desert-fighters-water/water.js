// Water: the third card stat. It limits which cards you can field each combat. One rule is active
// at a time (the water mode):
//   off  : no limit (the control)
//   mana : the run has one water supply (RUN_WATER); fielding a card spends its water from it
//   uses : every card carries its own water; it loses 1 each fight it is fielded in, and at 0 it
//          can't be fielded. Recruits arrive full.
// Strong cards are balanced the opposite way in each mode: in mana they COST a lot, in uses they
// have FEW uses. Enemy cards have no water.
//
// First pass: water comes from each card's measured power (POWER: solo ΔWin in the 3-card combo search,
// sim/results-baseline-combos.txt), not from hand tuning. WATER_OVERRIDES pins a card by hand.

export const WATER_MODES = ['off', 'mana', 'uses'];
export const RUN_WATER = 30;   // mana: the run's water supply

// Solo ΔWin (win-rate points the card adds to a random hand), baseline combo search, seed 1
export const POWER = {
  warlock_attack: -20.6, rotator_death: -18.8, rotator_start: -16.0, plain_sloth: -14.8, plain_jackal: -13.9,
  plain_camel: -11.4, tank_hurt: -11.4, support_attack: -11.4, rotator_hurt: -9.2, tank_start: -9.2,
  support_hurt: -9.0, tank_hurt_noise: -8.0, rotator_attack_quiet: -7.8, rotator_attack: -7.3, tank_death: -5.2,
  warlock_start_noise: -3.4, plain_owl: -2.1, dps_start: 0.0, dps_hurt: 0.0, support_death: 0.8,
  warlock_start: 1.4, tank_attack: 1.8, warlock_hurt: 2.8, plain_falcon: 3.3, support_start: 8.0,
  dps_start_last: 8.0, warlock_death: 10.2, dps_death: 11.7, plain_hyena: 13.5, plain_warthog: 15.1,
  dps_attack: 15.6, plain_hippo: 16.6, plain_lion: 18.0, plain_elephant: 18.3, plain_behemoth: 34.3,
};

// { id: { mana, uses } } hand overrides of the formula below
export const WATER_OVERRIDES = {};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const powerOf = id => POWER[id] ?? 0;

// mana cost 1..7: an average card (0) costs 3, +1 per 9 points of power (Behemoth 7)
// uses 1..5:      an average card has 3 uses, −1 per 12 points of power (Behemoth 1)
export function baseWater(id) {
  const p = powerOf(id);
  return {
    mana: clamp(Math.round(3 + p / 9), 1, 7),
    uses: clamp(Math.round(3 - p / 12), 1, 5),
    ...WATER_OVERRIDES[id],
  };
}

// The card's water in this mode. `flat` (a number) gives every card the same water: the control that
// separates "per-card water creates choices" from "any limit does".
export function waterOf(id, mode, flat = null) {
  if (mode !== 'mana' && mode !== 'uses') return 0;
  return flat != null ? flat : baseWater(id)[mode];
}
