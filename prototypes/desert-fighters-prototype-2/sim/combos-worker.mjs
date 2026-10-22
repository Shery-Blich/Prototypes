// Web worker for combos.html: plays every triple it is handed `games` times against random enemies.
// Game #i uses seed(i) for everyone, so each triple meets the same enemies, tiles and dice (common random numbers).

import { CHARACTERS } from '../characters.js';
import { buildPool, drawFrom, drawTiles, playGame, reseed } from './core.mjs';

self.onmessage = async ({ data }) => {
  const { cfg, triples, workerId } = data;
  const pool = buildPool(cfg.pool);
  const rows = [];
  // Solved-tile check: tile -> class -> times a card of that class started a WON fight on that tile
  const tileClass = {};
  let done = 0, lastPost = Date.now();
  for (const ids of triples) {
    const row = { ids, games: 0, wins: 0, fieldedInWins: {}, fielded: {}, front: {} };
    for (const id of ids) { row.fieldedInWins[id] = 0; row.fielded[id] = 0; row.front[id] = 0; }
    for (let i = 0; i < cfg.games; i++) {
      reseed(cfg.seed * 1000003 + i * 7919 + 17);
      const enemy = drawFrom(pool, cfg.slots);
      const tiles = drawTiles(cfg);
      const r = await playGame(ids, enemy, cfg, tiles);
      row.games++; row.wins += r.win;
      for (const id of r.lineup) { row.fielded[id]++; if (r.win) row.fieldedInWins[id]++; }
      row.front[r.lineup[0]]++;
      if (r.win) r.lineup.forEach((id, slot) => {
        const t = (tileClass[tiles[slot] || 'dune'] ??= {});
        const cls = CHARACTERS[id].class || 'plain';
        t[cls] = (t[cls] || 0) + 1;
      });
    }
    rows.push(row); done++;
    if (Date.now() - lastPost > 500) { self.postMessage({ type: 'progress', workerId, done }); lastPost = Date.now(); }
  }
  self.postMessage({ type: 'result', workerId, rows, tileClass });
};
