// The expedition map for Desert Fighters: 9 diamond nodes in an isometric grid.
// Used by main.js (the map screen) and by sim/run-sim.mjs, so the sim walks the map that ships.

export const MAP_NODES = {
  start: {
    id: 'start',
    type: 'start',
    name: 'Expedition Start',
    x: 696, y: 274,
    color: '#fdf8ea',
    icon: 'start',
    label: 'Start (Base Departure)',
    neighbors: ['b1_easy'],
  },
  b1_easy: {
    id: 'b1_easy',
    type: 'battle',
    difficulty: 'easy',
    swords: 1,
    name: 'Border Skirmish',
    x: 592, y: 170,
    color: '#fbc05c',
    icon: 'sword',
    label: 'Easy Battle (1 Sword)',
    neighbors: ['start', 'b2_easy'],
  },
  b2_easy: {
    id: 'b2_easy',
    type: 'battle',
    difficulty: 'easy',
    swords: 1,
    name: 'Desert Ambush',
    x: 488, y: 274,
    color: '#fbc05c',
    icon: 'sword',
    label: 'Easy Battle (1 Sword)',
    neighbors: ['b1_easy', 'b3_med', 'ext_bottom'],
  },
  b3_med: {
    id: 'b3_med',
    type: 'battle',
    difficulty: 'medium',
    swords: 2,
    name: 'Dune Patrol',
    x: 384, y: 170,
    color: '#f98342',
    icon: 'swords2',
    label: 'Medium Battle (2 Swords)',
    neighbors: ['b2_easy', 'b_skull', 'b4_med'],
  },
  b4_med: {
    id: 'b4_med',
    type: 'battle',
    difficulty: 'medium',
    swords: 2,
    name: 'Canyon Outpost',
    x: 280, y: 274,
    color: '#f98342',
    icon: 'swords2',
    label: 'Medium Battle (2 Swords)',
    neighbors: ['b3_med', 'b5_easy', 'ext_bottom'],
  },
  b_skull: {
    id: 'b_skull',
    type: 'battle',
    difficulty: 'hard',
    swords: 3,
    name: 'Warlord Stronghold',
    x: 280, y: 66,
    color: '#e0534b',
    icon: 'skull',
    label: 'Boss Battle (Skull 💀)',
    neighbors: ['b3_med', 'b5_easy'],
  },
  b5_easy: {
    id: 'b5_easy',
    type: 'battle',
    difficulty: 'easy',
    swords: 1,
    name: 'Ruins Crossing',
    x: 176, y: 170,
    color: '#fbc05c',
    icon: 'sword',
    label: 'Easy Battle (1 Sword)',
    neighbors: ['b_skull', 'b4_med', 'ext_top'],
  },
  ext_bottom: {
    id: 'ext_bottom',
    type: 'extract',
    name: 'Southern Extraction Point',
    x: 384, y: 378,
    color: '#6cb8eb',
    icon: 'door',
    label: 'Extraction Point (Exit 🚪➔)',
    neighbors: ['b2_easy', 'b4_med'],
  },
  ext_top: {
    id: 'ext_top',
    type: 'extract',
    name: 'Northern Extraction Point',
    x: 72, y: 66,
    color: '#6cb8eb',
    icon: 'door',
    label: 'Extraction Point (Exit 🚪➔)',
    neighbors: ['b5_easy'],
  },
};

// Can the squad still reach an extraction point from startId without re-entering a visited node?
export function canReachExtraction(startId, visitedSet) {
  const node = MAP_NODES[startId];
  if (!node) return false;
  if (node.type === 'extract') return true;

  const visited = new Set(visitedSet);
  visited.add(startId);
  const queue = [startId];
  const seen = new Set([startId]);

  while (queue.length > 0) {
    const currId = queue.shift();
    const currNode = MAP_NODES[currId];
    if (!currNode) continue;
    if (currNode.type === 'extract') return true;

    for (const nbrId of currNode.neighbors) {
      if (!visited.has(nbrId) && !seen.has(nbrId)) {
        seen.add(nbrId);
        queue.push(nbrId);
      }
    }
  }
  return false;
}
