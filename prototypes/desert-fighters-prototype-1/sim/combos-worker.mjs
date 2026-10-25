// Web worker for combos.html: plays every triple it is handed `games` times against random enemies.
// Game #i uses seed(i) for everyone, so each triple meets the same enemies and dice (common random numbers).

import { buildPool, drawFrom, playGame, reseed } from './core.mjs';

self.onmessage = async ({ data }) => {
  const { cfg, triples, workerId } = data;
  const pool = buildPool(cfg.pool, cfg.strip || []);
  const rows = [];
  let done = 0, lastPost = Date.now();
  for (const ids of triples) {
    const row = { ids, games: 0, wins: 0, fieldedInWins: {}, fielded: {}, front: {} };
    for (const id of ids) { row.fieldedInWins[id] = 0; row.fielded[id] = 0; row.front[id] = 0; }
    for (let i = 0; i < cfg.games; i++) {
      reseed(cfg.seed * 1000003 + i * 7919 + 17);
      const enemy = drawFrom(pool, cfg.slots);
      const r = await playGame(ids, enemy, cfg);
      row.games++; row.wins += r.win;
      for (const id of r.lineup) { row.fielded[id]++; if (r.win) row.fieldedInWins[id]++; }
      row.front[r.lineup[0]]++;
    }
    rows.push(row); done++;
    if (Date.now() - lastPost > 500) { self.postMessage({ type: 'progress', workerId, done }); lastPost = Date.now(); }
  }
  self.postMessage({ type: 'result', workerId, rows });
};
