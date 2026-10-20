// Enemy encounters for Desert Fighters.
// Lineups are DESIGNED, not rolled: each template is an ordered list, front card first.
// Difficulty comes from which cards are placed and how, never from stat bonuses.
// Used by main.js (generateEnemy) and by sim/sim.mjs (--enemy-set), so what you tune here is what ships.
//
// Design targets (3 slots, player picks the best order, see sim/):
//   easy   : a beginner with the starter pack wins ~75-85%; the fight lasts 3+ clashes so the Worm shows up.
//   medium : ~55-65% for an average hand from the whole pool.
//   hard   : ~35-45%: synergies placed in the right slots (support in the back, walls in front).

export const ENCOUNTERS = {
  easy: [
    ['plain_camel',  'plain_jackal'],
    ['plain_jackal', 'plain_sloth'],
    ['plain_hyena',  'plain_jackal'],
    ['plain_sloth',  'plain_owl'],
    ['plain_camel',  'plain_owl'],
    ['plain_jackal', 'plain_jackal'],
    ['tank_start',   'plain_jackal'],          // Iron Hide shows a 🏁 ability early
    ['plain_hyena',  'plain_sloth'],
  ],
  medium: [
    ['tank_start',   'plain_lion',    'support_start'],   // wall, then a buffed 10-atk Jaguar
    ['plain_camel',  'dps_start',     'plain_owl'],
    ['tank_start',   'plain_hyena',   'plain_falcon'],
    ['warlock_start','plain_warthog', 'plain_jackal'],    // Venom Sight halves your best attacker
    ['plain_hippo',  'support_death', 'plain_owl'],
    ['dps_hurt',     'plain_camel',   'dps_start'],
    ['plain_warthog','tank_death',    'plain_owl'],
    ['tank_hurt',    'plain_falcon',  'plain_jackal'],
  ],
  hard: [
    ['plain_hyena',  'plain_jackal',  'support_start'],   // Grace Aura in the back buffs the two ahead
    ['tank_attack',  'plain_falcon',  'warlock_start'],   // Trample Share feeds HP to the Falcon behind it
    ['plain_hippo',  'dps_death',     'support_start'],   // Death Roar sweeps after the Buffalo
    ['tank_attack',  'warlock_hurt',  'plain_jackal'],
    ['plain_camel',  'warlock_hurt',  'plain_jackal'],
    ['plain_warthog','dps_start',     'support_start'],
    ['tank_attack',  'plain_lion',    'support_start'],   // wall feeds the Jaguar, aura buffs both
    ['warlock_start','plain_warthog', 'support_start'],
  ],
};

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// Returns [{ id, atkBonus: 0, hpBonus: 0 }, ...] front first.
// `maxSlots` trims from the back when the enemy-slots modifier is smaller than the lineup.
export function generateEncounter(difficulty = 'easy', { rng = Math.random, maxSlots = 3 } = {}) {
  const pool = ENCOUNTERS[difficulty] || ENCOUNTERS.easy;
  const lineup = pick(pool, rng).slice(0, Math.max(1, maxSlots));
  return lineup.map(id => ({ id, atkBonus: 0, hpBonus: 0 }));
}
