import { CHARACTERS, makeCharacter, randomCharacterId } from './characters.js';
import { Battle } from './battle.js';
import { SimpleAudio } from '/src/shared/utils.js';

const MIN_TEAM = 1;
const MAX_TEAM = 5;
const STARTING_ROSTER = 6;

const $ = id => document.getElementById(id);
const audio = new SimpleAudio();

const state = {
  roster: [],        // [{uid, id}]
  team: [],          // roster uids, index 0 = front
  battleNum: 1,
  wins: 0,
  losses: 0,
  enemy: [],         // [{id, atkBonus, hpBonus}]
  speed: 1,
  inBattle: false,
  previewKey: null,  // selected prep card: 'p<rosterUid>' or 'e<index>'
};

// ---------- Run setup ----------

function newRun() {
  state.roster = Array.from({ length: STARTING_ROSTER }, () => makeCharacter(randomCharacterId()));
  state.team = state.roster.slice(0, 3).map(c => c.uid);
  state.battleNum = 1;
  state.wins = 0;
  state.losses = 0;
  state.enemy = generateEnemy(1);
  showPrep();
}

// Enemy teams grow from 3 to 5 characters, then gain extra stats each battle.
function generateEnemy(n) {
  const size = Math.min(MAX_TEAM, 3 + Math.floor((n - 1) / 2));
  const team = Array.from({ length: size }, () => ({ id: randomCharacterId(), atkBonus: 0, hpBonus: 0 }));
  let bonus = Math.max(0, n - 3) * 2;
  while (bonus-- > 0) {
    const e = team[Math.floor(Math.random() * team.length)];
    if (Math.random() < 0.5) e.atkBonus++; else e.hpBonus++;
  }
  return team;
}

// ---------- Cards ----------

function cardEl(id, atk, hp, opts = {}) {
  const def = CHARACTERS[id];
  const el = document.createElement('div');
  el.className = 'card' + (def.token ? ' token' : '') + (opts.cls ? ' ' + opts.cls : '');
  el.innerHTML = `
    <div class="card-emoji">${def.emoji}</div>
    <div class="card-name">${def.name}</div>
    <div class="card-text">${def.text || '<i>Summoned token</i>'}</div>
    <div class="card-stats">
      <span class="stat atk">⚔ <b class="atk-val">${atk}</b></span>
      <span class="shield-icon">🛡</span>
      <span class="stat hp">❤ <b class="hp-val">${hp}</b></span>
    </div>`;
  el.title = def.text;
  return el;
}

function updateHud() {
  $('hud-battle').textContent = state.battleNum;
  $('hud-wins').textContent = state.wins;
  $('hud-losses').textContent = state.losses;
  $('hud-roster').textContent = state.roster.length;
}

// ---------- Prep screen ----------

function showPrep() {
  state.inBattle = false;
  $('prep-screen').classList.remove('hidden');
  $('battle-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  renderPrep();
  resetIdle();
}

function renderPrep() {
  updateHud();

  const lineup = { player: [], enemy: [] };

  const enemyRow = $('enemy-preview');
  enemyRow.innerHTML = '';
  state.enemy.forEach((e, i) => {
    const d = CHARACTERS[e.id];
    const el = cardEl(e.id, d.atk + e.atkBonus, d.hp + e.hpBonus);
    if (i === 0) el.appendChild(frontTag());
    lineup.enemy.push(previewable(el, `e${i}`, 'enemy', e.id, d.atk + e.atkBonus, d.hp + e.hpBonus));
    enemyRow.appendChild(el);
  });

  const teamRow = $('team-slots');
  teamRow.innerHTML = '';
  for (let i = 0; i < MAX_TEAM; i++) {
    const uid = state.team[i];
    if (uid === undefined) {
      const empty = document.createElement('div');
      empty.className = 'card empty';
      empty.textContent = i === 0 ? 'Front' : `Slot ${i + 1}`;
      teamRow.appendChild(empty);
      continue;
    }
    const c = state.roster.find(r => r.uid === uid);
    const d = CHARACTERS[c.id];
    const el = cardEl(c.id, d.atk, d.hp);
    if (i === 0) el.appendChild(frontTag());
    const ctrls = document.createElement('div');
    ctrls.className = 'card-ctrls';
    ctrls.append(
      ctrlBtn('◀', 'Move back', i < state.team.length - 1, () => swap(i, i + 1)),
      ctrlBtn('✕', 'Remove from team', true, () => { state.team.splice(i, 1); renderPrep(); }),
      ctrlBtn('▶', 'Move forward', i > 0, () => swap(i, i - 1)),
    );
    el.appendChild(ctrls);
    lineup.player.push(previewable(el, `p${uid}`, 'player', c.id, d.atk, d.hp));
    teamRow.appendChild(el);
  }

  const rosterRow = $('roster');
  rosterRow.innerHTML = '';
  for (const c of state.roster) {
    const d = CHARACTERS[c.id];
    const inTeam = state.team.includes(c.uid);
    const el = cardEl(c.id, d.atk, d.hp, { cls: inTeam ? 'in-team' : 'clickable' });
    if (!inTeam) el.addEventListener('click', () => {
      if (state.team.length >= MAX_TEAM) return;
      state.team.push(c.uid);
      audio.beep(520);
      renderPrep();
    });
    rosterRow.appendChild(el);
  }

  const n = state.team.length;
  const ok = n >= MIN_TEAM && n <= MAX_TEAM;
  $('btn-fight').disabled = !ok;
  $('fight-hint').textContent = ok
    ? `${n} character${n > 1 ? 's' : ''} at risk`
    : `Pick at least ${MIN_TEAM} character${MIN_TEAM > 1 ? 's' : ''}`;

  showAbilityPreview(lineup);
}

// ---------- Ability preview (prep screen) ----------

const TRIGGER_NOTES = {
  startOfBattle: 'Once, at the start of battle.',
  hurt: 'Every time it takes damage.',
  faint: 'Once, when it faints (shown as if it faints in its current slot).',
  knockOut: 'Every time its attack knocks out an enemy.',
  beforeAttack: 'Every time, right before it attacks.',
  friendAheadAttacks: 'Every time the friend directly ahead of it attacks.',
};

// Clicking a lineup card selects it; clicking it again (or another card) ends/switches the preview.
function previewable(el, key, side, id, atk, hp) {
  el.classList.add('selectable');
  el.addEventListener('click', () => {
    state.previewKey = state.previewKey === key ? null : key;
    renderPrep();
  });
  return { el, key, side, id, atk, hp };
}

function showAbilityPreview(lineup) {
  const info = $('preview-info');
  const all = [...lineup.player, ...lineup.enemy];
  const self = all.find(u => u.key === state.previewKey);
  if (!self) {
    state.previewKey = null;
    info.classList.add('hidden');
    drawArrows(null, []);
    return;
  }

  const def = CHARACTERS[self.id];
  const team = lineup[self.side];
  const foes = lineup[self.side === 'player' ? 'enemy' : 'player'];
  const i = team.indexOf(self);
  const effects = def.preview({
    self,
    ahead: team[i - 1],
    behind: team[i + 1],
    behind2: team[i + 2],
    friends: team.filter(u => u !== self),
    enemies: foes,
    all: all.filter(u => u !== self),
  });

  self.el.classList.add('preview-source');
  let anyTarget = false;
  let extra = '';
  const arrows = [];
  for (const fx of effects) {
    if (fx.summon) {
      // It faints first, so the team has one more free slot than now.
      const room = MAX_TEAM - (team.length - 1);
      const shown = Math.min(fx.count, room);
      const d = CHARACTERS[fx.summon];
      for (let k = 0; k < shown; k++) {
        arrows.push({ el: addSummonGhost(self, fx.summon), label: `+${d.emoji} ${d.atk}/${d.hp}`, cls: 'help' });
      }
      if (shown < fx.count) extra += ` Only ${shown} of ${fx.count} fit (team is full).`;
      anyTarget = anyTarget || shown > 0;
      continue;
    }
    for (const u of fx.targets.filter(Boolean)) {
      anyTarget = true;
      applyPreview(u, fx);
      arrows.push({ el: u.el, label: effectLabel(fx), cls: (fx.atk || 0) < 0 || (fx.hp || 0) < 0 ? 'harm' : 'help' });
    }
  }

  const slot = self.side === 'player' ? `your slot ${i + 1}` : `enemy slot ${i + 1}`;
  if (effects.some(fx => fx.summon)) extra = ' Summons take its place in the line.' + extra;
  else if (!anyTarget) extra += ' No valid target in this position.';
  if (effects.some(fx => fx.random && fx.targets.some(Boolean))) extra += ' <span class="pv-rand">?</span> = one of these, picked at random.';
  info.innerHTML = `<b>${def.emoji} ${def.name}</b> (${slot}): ${def.text} <span class="hint">${TRIGGER_NOTES[def.trigger]}${extra}</span>`;
  info.classList.remove('hidden');
  drawArrows(self.el, arrows);
}

function effectLabel(fx) {
  const atk = fx.atk || 0, hp = fx.hp || 0;
  const sign = n => (n > 0 ? `+${n}` : `${n}`);
  let text;
  if (fx.shield) text = '+🛡';
  else if (atk && hp) text = `${sign(atk)}/${sign(hp)}`;
  else if (atk) text = `${sign(atk)} ⚔`;
  else text = `${sign(hp)} ❤`;
  return fx.random ? `${text} ?` : text;
}

// Curved arrows from the selected card to everything it affects, with the amount under each tip.
function drawArrows(sourceEl, arrows) {
  const svg = $('preview-arrows');
  svg.innerHTML = '';
  if (!sourceEl || !arrows.length) return;

  const host = $('prep-screen').getBoundingClientRect();
  svg.setAttribute('width', host.width);
  svg.setAttribute('height', host.height);
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    svg.appendChild(e);
    return e;
  };
  const defs = mk('defs', {});
  for (const cls of ['help', 'harm']) {
    const m = document.createElementNS(NS, 'marker');
    for (const [k, v] of Object.entries({ id: `arrowhead-${cls}`, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' })) m.setAttribute(k, v);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    path.setAttribute('class', `arrowhead ${cls}`);
    m.appendChild(path);
    defs.appendChild(m);
  }

  const src = sourceEl.getBoundingClientRect();
  const sx = src.left + src.width / 2 - host.left;
  const sy = src.top - host.top;
  const GAP = 24; // space between arrow tip and the target card's top (label sits there)

  for (const a of arrows) {
    const r = a.el.getBoundingClientRect();
    const tx = r.left + r.width / 2 - host.left;
    const ty = r.top - host.top - GAP;
    let d;
    if (a.el === sourceEl) {
      // Self: loop leaving the card's top-left, landing on its top-right
      const x1 = r.left - host.left + 22, x2 = r.right - host.left - 22;
      d = `M${x1},${sy} C${x1 - 10},${sy - 60} ${x2 + 10},${sy - 60} ${x2},${ty}`;
    } else {
      const lift = 40 + Math.abs(tx - sx) * 0.18;
      const cy = Math.min(sy, ty) - lift;
      d = `M${sx},${sy} Q${(sx + tx) / 2},${cy} ${tx},${ty}`;
    }
    mk('path', { d, class: `arrow ${a.cls}`, 'marker-end': `url(#arrowhead-${a.cls})` });
    const label = mk('text', { x: tx, y: ty + 15, class: `arrow-label ${a.cls}`, 'text-anchor': 'middle' });
    label.textContent = a.label;
  }
}

// Ghost card of a summoned token, inserted right behind the summoner (where it will appear).
function addSummonGhost(self, id) {
  const d = CHARACTERS[id];
  const ghost = cardEl(id, d.atk, d.hp, { cls: 'preview-summon' });
  const tag = document.createElement('div');
  tag.className = 'summon-tag';
  tag.textContent = '+ SUMMON';
  ghost.appendChild(tag);
  self.el.classList.add('preview-faints');
  self.el.after(ghost);
  // Keep the player row at 5 cards by dropping a trailing empty slot.
  const empty = self.el.parentElement.querySelector('.card.empty:last-child');
  if (empty) empty.remove();
  return ghost;
}

function applyPreview(u, fx) {
  const atk = fx.atk || 0, hp = fx.hp || 0;
  const atkEl = u.el.querySelector('.atk-val');
  const hpEl = u.el.querySelector('.hp-val');
  if (atk) {
    atkEl.textContent = u.atk + atk;
    atkEl.parentElement.classList.add(atk > 0 ? 'stat-up' : 'stat-down');
  }
  if (hp) {
    hpEl.textContent = Math.max(0, u.hp + hp);
    hpEl.parentElement.classList.add(hp > 0 ? 'stat-up' : 'stat-down');
  }
  if (fx.shield) u.el.classList.add('shielded');
  u.el.classList.add(atk < 0 || hp < 0 ? 'preview-harm' : 'preview-help');
  if (fx.random) {
    const q = document.createElement('div');
    q.className = 'pv-rand pv-badge';
    q.textContent = '?';
    u.el.appendChild(q);
  }
}

function frontTag() {
  const t = document.createElement('div');
  t.className = 'front-tag';
  t.textContent = 'FRONT';
  return t;
}

function ctrlBtn(label, title, enabled, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.disabled = !enabled;
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

function swap(i, j) {
  [state.team[i], state.team[j]] = [state.team[j], state.team[i]];
  renderPrep();
}

// ---------- Battle view ----------

const cardMap = new Map(); // battle unit uid -> element

const view = {
  render(battle) {
    for (const side of ['player', 'enemy']) {
      const row = $(side === 'player' ? 'battle-player' : 'battle-enemy');
      const units = battle.teams[side];
      const keep = new Set(units.map(u => u.uid));
      for (const [uid, el] of cardMap) {
        if (el.parentElement === row && !keep.has(uid)) { el.remove(); cardMap.delete(uid); }
      }
      units.forEach((u, i) => {
        let el = cardMap.get(u.uid);
        if (!el) { el = cardEl(u.id, u.atk, u.hp); cardMap.set(u.uid, el); }
        el.querySelector('.atk-val').textContent = u.atk;
        el.querySelector('.hp-val').textContent = Math.max(0, u.hp);
        el.classList.toggle('shielded', u.shield);
        el.classList.toggle('front', i === 0);
        if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
      });
    }
  },
  float(u, text, cls) {
    const el = cardMap.get(u.uid);
    if (!el) return;
    const f = document.createElement('div');
    f.className = `float ${cls}`;
    f.textContent = text;
    el.appendChild(f);
    setTimeout(() => f.remove(), 1100);
    if (cls === 'dmg') audio.hit();
    else if (cls === 'buff') audio.beep(760);
  },
  flash(u, cls) {
    const el = cardMap.get(u.uid);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart animation
    el.classList.add(cls);
    if (cls !== 'dying') setTimeout(() => el.classList.remove(cls), 600);
  },
  log(msg) {
    const logEl = $('battle-log');
    const line = document.createElement('div');
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  },
  turn(text) {
    $('turn-label').textContent = text;
    this.log(`— ${text} —`);
  },
  wait(ms) {
    return new Promise(r => setTimeout(r, ms / state.speed));
  },
};

function setSpeed(s) {
  state.speed = s;
  document.querySelectorAll('.speed').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === s));
}

async function startBattle() {
  if (state.inBattle) return;
  state.inBattle = true;
  state.previewKey = null;
  stopIdleCycle();
  audio.init();

  const participants = state.team.map(uid => state.roster.find(r => r.uid === uid));
  $('prep-screen').classList.add('hidden');
  $('battle-screen').classList.remove('hidden');
  $('battle-player').innerHTML = '';
  $('battle-enemy').innerHTML = '';
  $('battle-log').innerHTML = '';
  cardMap.clear();
  setSpeed(state.speed > 4 ? 1 : state.speed);

  const battle = new Battle(participants, state.enemy, view);
  const result = await battle.run();
  await view.wait(500);
  showResult(result, participants);
}

// ---------- Results ----------

function showResult(result, participants) {
  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btn = $('btn-continue');
  cards.innerHTML = '';
  title.className = result;

  if (result === 'win') {
    state.wins++;
    const reward = makeCharacter(randomCharacterId());
    state.roster.push(reward);
    title.textContent = 'Victory!';
    text.textContent = 'Your team survives. A new character joins your roster:';
    const d = CHARACTERS[reward.id];
    cards.appendChild(cardEl(reward.id, d.atk, d.hp, { cls: 'reward' }));
    audio.score();
  } else {
    state.losses++;
    const lost = new Set(participants.map(p => p.uid));
    state.roster = state.roster.filter(r => !lost.has(r.uid));
    state.team = [];
    title.textContent = 'Defeat';
    text.textContent = `You lost all ${participants.length} characters that fought:`;
    for (const p of participants) {
      const d = CHARACTERS[p.id];
      cards.appendChild(cardEl(p.id, d.atk, d.hp, { cls: 'lost' }));
    }
    audio.explosion();
  }

  state.battleNum++;
  state.enemy = generateEnemy(state.battleNum);
  state.team = state.team.filter(uid => state.roster.some(r => r.uid === uid));

  if (state.roster.length === 0) {
    title.textContent = 'Game Over';
    title.className = 'lose';
    text.textContent = `You lost all ${participants.length} character${participants.length === 1 ? '' : 's'} that fought, and your roster is now empty. You survived ${state.battleNum - 1} battle${state.battleNum === 2 ? '' : 's'} with ${state.wins} win${state.wins === 1 ? '' : 's'}.`;
    btn.textContent = 'Restart ⟳';
    btn.onclick = newRun;
  } else {
    btn.textContent = 'Continue ▶';
    btn.onclick = showPrep;
  }
  updateHud();
  $('result-overlay').classList.remove('hidden');
}

// ---------- Idle preview cycle ----------
// After 5s without input on the prep screen, step through every card's preview in acting order.

const IDLE_MS = 5000;
const CYCLE_MS = 2500;
let idleTimer = null;
let cycleTimer = null;

function resetIdle() {
  clearTimeout(idleTimer);
  clearTimeout(cycleTimer);  // any input stops the cycle, leaving the current preview shown
  if (state.inBattle) return;
  idleTimer = setTimeout(startIdleCycle, IDLE_MS);
}

function stopIdleCycle() {
  clearTimeout(idleTimer);
  clearTimeout(cycleTimer);
}

function startIdleCycle() {
  // Acting order: fronts first (player, then enemy), then each side's 2nd, 3rd, ...
  const keys = [];
  for (let i = 0; i < MAX_TEAM; i++) {
    if (state.team[i] !== undefined) keys.push(`p${state.team[i]}`);
    if (state.enemy[i]) keys.push(`e${i}`);
  }
  if (!keys.length || state.inBattle) return;
  let idx = Math.max(0, keys.indexOf(state.previewKey) + 1) % keys.length;
  const step = () => {
    state.previewKey = keys[idx];
    renderPrep();
    idx = (idx + 1) % keys.length;
    cycleTimer = setTimeout(step, CYCLE_MS);
  };
  step();
}

for (const ev of ['mousemove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, resetIdle, { passive: true, capture: true });
}

// ---------- Wiring ----------

window.addEventListener('resize', () => {
  if (state.previewKey && !state.inBattle) renderPrep();
});

$('btn-fight').addEventListener('click', startBattle);
$('btn-skip').addEventListener('click', () => setSpeed(1000));
document.querySelectorAll('.speed').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

newRun();
