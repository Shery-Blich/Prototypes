// Web worker for runs.html: plays its share of runs with every policy asked for.
// Run #i starts from the same dice for every policy (common random numbers), so policies are compared
// on the same first enemy and the same luck until their choices split them apart.

import { buildPool } from './core.mjs';
import { playRun, memoSize } from './run-core.mjs';

self.onmessage = async ({ data }) => {
  const { cfg, runs, workerId } = data;
  buildPool('base', cfg.strip || []);
  const out = [];
  let done = 0, lastPost = Date.now();
  try {
    for (const i of runs) {
      for (const policy of cfg.policies) out.push(await playRun(cfg, policy, i));
      done++;
      if (Date.now() - lastPost > 500) { self.postMessage({ type: 'progress', workerId, done, memo: memoSize() }); lastPost = Date.now(); }
    }
  } catch (err) {
    self.postMessage({ type: 'error', workerId, error: String(err.stack || err) });
    return;
  }
  self.postMessage({ type: 'result', workerId, rows: out });
};
