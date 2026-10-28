import { CARDS } from './cards.mjs';

// Named config sets for balance.html (?grid=name). Each entry: [label, config] (see resolveConfig in balance.mjs).
// Earlier grids (stats, abil1, abil2, rot) ran on the tier-based card set; their result files keep those numbers.

const card = (id, over) => ({ cards: { [id]: over } });

export const GRIDS = {
  // The defaults in cards.mjs
  final: [['final (cards.mjs defaults)', {}]],
  // Control: each ability card with its ability removed. ability value = power − power without it.
  strip: Object.keys(CARDS).filter(id => CARDS[id].trigger).map(id => [`strip ${id}`, card(id, { trigger: null })]),
};
