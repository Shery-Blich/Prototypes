// OG Extraction but with Relics.
// The original Caravan Heroes loop (Unity project): squad selection -> map -> battle prep -> auto battle.
// Heroes keep their original abilities (PetData assets). Differences from the Unity project:
//  - The stat potions (Power/Vitality/Lucky Cookie) are replaced by one-time RELICS:
//      ⏩ Double Turn  — the holder attacks twice in a row on its turn at the front.
//      ↩️ Go Back      — after the holder takes its turn at the front, it moves to the back of the line.
//      🛡️ Shield       — blocks the first attack / ability damage that reaches the holder.
//    A relic is used up only when its effect happens; unused relics stay with the hero for later battles.
//  - After squad selection comes a relic setup step with a starter relic of each type.
//  - Win a battle: +2 random relics. Lose: every relic you have (equipped or not) is gone.
//  - Turn-based: your front hero always strikes first, then the enemy front hero, alternating.
//    There are no ties: the first side to run out of heroes loses.
//  - Heroes and relics are shown as tokens; tap one to see its full card, drag to move/equip.
//  - Battle playback uses the Water Map look: attack lunges, curved arrows with a trigger-emoji
//    badge for abilities, floating numbers, and hoverable trigger/relic icons.

// ─── Data (copied from the Unity assets) ─────────────────────────────────

// Abilities from the PetData assets. trigger: start | faint.  effect: buff (friend) | damage (enemy).
const HEROES = {
  falcon:    { name: 'Barbary Falcon', emoji: '🦅', atk: 1, hp: 2, ability: { name: 'Rally',       trigger: 'start', effect: 'buff',   friend: 'behind', atk: 1, hp: 1 } },
  caracal:   { name: 'Karakal',        emoji: '🐈', atk: 1, hp: 2, ability: { name: 'Blessing',    trigger: 'faint', effect: 'buff',   friend: 'random', atk: 0, hp: 1 } },
  fox:       { name: 'Desert Fox',     emoji: '🦊', atk: 2, hp: 1, ability: { name: 'Last Stand',  trigger: 'faint', effect: 'buff',   friend: 'behind', atk: 2, hp: 1 } },
  gecko:     { name: 'Gecko',          emoji: '🦎', atk: 2, hp: 2, ability: { name: 'First Strike', trigger: 'start', effect: 'damage', enemy: 'front',   dmg: 1 } },
  viper:     { name: 'Horned Viper',   emoji: '🐍', atk: 2, hp: 2, ability: { name: 'Venom Dart',  trigger: 'start', effect: 'damage', enemy: 'random',  dmg: 1 } },
  porcupine: { name: 'Porcupine',      emoji: '🦔', atk: 5, hp: 5, ability: { name: 'Spite',       trigger: 'faint', effect: 'damage', enemy: 'random',  dmg: 1 } },
};

const TRIGGERS = {
  start: { emoji: '🏁', name: 'Start of battle', note: 'Once, before the first attack.' },
  faint: { emoji: '💀', name: 'Faint', note: 'Once, when it faints.' },
};

function abilityDesc(id) {
  const a = HEROES[id].ability;
  const trig = `${TRIGGERS[a.trigger].emoji} ${TRIGGERS[a.trigger].name}`;
  if (a.effect === 'damage') {
    return `${trig}: deal ${a.dmg} dmg to ${a.enemy === 'front' ? 'the front enemy' : 'a random enemy'}.`;
  }
  const who = { ahead: 'the friend ahead', behind: 'the friend behind', random: 'a random friend' }[a.friend];
  const stats = [a.atk ? `+${a.atk} ⚔` : '', a.hp ? `+${a.hp} ♥` : ''].filter(Boolean).join(' ');
  return `${trig}: give ${who} ${stats}.`;
}

const RELICS = {
  double: { name: 'Double Turn', icon: '⏩', desc: 'On its turn at the front, this hero attacks twice in a row. Used up when the second attack happens.' },
  goback: { name: 'Go Back',     icon: '↩️', desc: 'Right after this hero takes its turn at the front, it moves to the back of the line. Used up when it moves.' },
  shield: { name: 'Shield',      icon: '🛡️', desc: 'Blocks the first attack or ability damage that reaches this hero. Used up when it blocks.' },
};
const RELIC_KEYS = Object.keys(RELICS);

// ─── Trigger / relic icon tooltips ───────────────────────────────────────

// Wraps every trigger emoji and relic icon in `text` so hovering it shows its description.
function withTriggerTips(text) {
  for (const [k, t] of Object.entries(TRIGGERS)) text = text.split(t.emoji).join(`<span class="trig" data-trigger="${k}">${t.emoji}</span>`);
  for (const [k, r] of Object.entries(RELICS)) text = text.split(r.icon).join(`<span class="trig" data-tip="relic-${k}">${r.icon}</span>`);
  return text;
}

const TIPS = {};
for (const [k, r] of Object.entries(RELICS)) TIPS[`relic-${k}`] = `${r.icon} <b>${r.name}</b>: ${r.desc}`;

function triggerLegend() {
  return el('div', {
    class: 'trigger-legend',
    html: Object.entries(TRIGGERS).map(([k, t]) => `<span class="legend-item" data-trigger="${k}">${t.emoji} ${t.name}</span>`).join(''),
  });
}

// One shared tooltip for any element with data-trigger / data-tip (HTML or SVG).
function initTriggerTips() {
  const tip = document.getElementById('trigger-tip');
  document.addEventListener('mouseover', e => {
    const t = e.target.closest?.('[data-trigger], [data-tip]');
    if (!t) { tip.classList.add('hidden'); return; }
    const trig = TRIGGERS[t.dataset.trigger];
    tip.innerHTML = trig ? `${trig.emoji} <b>${trig.name}</b>: ${trig.note}` : TIPS[t.dataset.tip];
    tip.classList.remove('hidden');
  });
  document.addEventListener('mousemove', e => {
    if (tip.classList.contains('hidden')) return;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY + 18}px`;
  });
}

const ROSTER_START = ['falcon', 'falcon', 'caracal', 'fox', 'gecko', 'gecko', 'viper', 'porcupine'];
const SQUAD_SIZE = 5;
const STARTER_RELICS = ['double', 'goback', 'shield'];
const RELICS_PER_WIN = 2;

// MapConfig.asset (grid index -> x = i % 10, y = i / 10).
const MAP = [
  { x: 2, y: 3, type: 'extract' },
  { x: 3, y: 3, type: 'area', tier: 1, enemies: ['falcon', 'caracal', 'fox', 'fox', 'gecko'] },
  { x: 4, y: 3, type: 'area', tier: 2, enemies: ['gecko', 'viper', 'porcupine', 'viper', 'falcon'] },
  { x: 5, y: 3, type: 'extract' },
  { x: 3, y: 4, type: 'area', tier: 3, enemies: ['porcupine', 'porcupine', 'porcupine', 'porcupine', 'porcupine'] },
  { x: 4, y: 4, type: 'area', tier: 2, enemies: ['gecko', 'viper', 'porcupine', 'gecko', 'fox'] },
  { x: 5, y: 4, type: 'area', tier: 1, enemies: ['falcon', 'caracal', 'fox', 'fox', 'falcon'] },
  { x: 5, y: 5, type: 'area', tier: 1, enemies: ['gecko', 'viper', 'porcupine', 'caracal', 'falcon'] },
  { x: 6, y: 5, type: 'spawn' },
];

const MAX_TURNS = 400;   // safety net only; every hero has attack > 0 so battles always end

// ─── State ───────────────────────────────────────────────────────────────

let state;

function newRun() {
  const spawn = MAP.find(c => c.type === 'spawn');
  state = {
    screen: 'squad',
    squad: ['falcon', 'caracal', 'fox', 'gecko', 'porcupine'], // slot 0 = front
    roster: ['falcon', 'gecko', 'viper'],
    equipped: {},              // squad slot -> relic key
    inventory: [],             // relic keys
    current: key(spawn),
    selectedCell: null,
    completed: new Set([key(spawn)]),
    battle: null,
    lastResult: null,
    wins: 0,
  };
  render();
}

const key = c => `${c.x},${c.y}`;
const cellAt = (x, y) => MAP.find(c => c.x === x && c.y === y);
const $screen = document.getElementById('screen');
const $pop = document.getElementById('card-pop');
const rnd = n => Math.floor(Math.random() * n);

// ─── DOM helpers ─────────────────────────────────────────────────────────

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'disabled') e.disabled = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}

// ─── Tap / drag (pointer events, works with mouse and touch) ─────────────
// draggable(el, payload, onTap): a short press is a tap, moving past a few px starts a drag.
// dropTarget(el, accept(payload), onDrop(payload)).

let press = null; // { el, payload, onTap, x, y, ghost }

function draggable(el, payload, onTap) {
  el.classList.add('draggable');
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    press = { el, payload, onTap, x: e.clientX, y: e.clientY, ghost: null };
  });
}

function tappable(el, onTap) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    press = { el, payload: null, onTap, x: e.clientX, y: e.clientY, ghost: null };
  });
}

function dropTarget(el, accept, onDrop) {
  el.classList.add('droppable');
  el._drop = { accept, onDrop };
}

function dropAt(x, y) {
  let t = document.elementFromPoint(x, y);
  while (t && !t._drop) t = t.parentElement;
  return t && t._drop.accept(press.payload) ? t : null;
}

document.addEventListener('pointermove', e => {
  if (!press || !press.payload) return;
  if (!press.ghost) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
    hidePop();
    const g = press.el.cloneNode(true);
    g.classList.add('ghost');
    document.body.append(g);
    press.ghost = g;
    press.el.classList.add('dragging');
    document.querySelectorAll('.droppable').forEach(d => { if (d._drop.accept(press.payload)) d.classList.add('can-drop'); });
  }
  press.ghost.style.left = `${e.clientX}px`;
  press.ghost.style.top = `${e.clientY}px`;
  document.querySelectorAll('.drop-hover').forEach(d => d.classList.remove('drop-hover'));
  dropAt(e.clientX, e.clientY)?.classList.add('drop-hover');
});

function endPress(e, cancelled) {
  if (!press) return;
  const p = press;
  if (!p.ghost) {
    press = null;
    if (!cancelled && p.onTap) p.onTap(p.el);
    return;
  }
  const target = cancelled ? null : dropAt(e.clientX, e.clientY);
  p.ghost.remove();
  p.el.classList.remove('dragging');
  document.querySelectorAll('.can-drop, .drop-hover').forEach(d => d.classList.remove('can-drop', 'drop-hover'));
  press = null;
  if (target) target._drop.onDrop(p.payload);
}
document.addEventListener('pointerup', e => endPress(e, false));
document.addEventListener('pointercancel', e => endPress(e, true));

// ─── Popover card (tap a token) ──────────────────────────────────────────

let popAnchor = null;

function showPop(anchor, content, actions = []) {
  if (popAnchor === anchor) return hidePop();
  $pop.innerHTML = '';
  $pop.append(content);
  for (const a of actions) {
    $pop.append(el('button', {
      class: a.danger ? 'danger' : 'primary',
      disabled: !!a.disabled,
      onclick: (e) => { e.stopPropagation(); hidePop(); a.run(); },
    }, a.label));
  }
  $pop.classList.remove('hidden');
  popAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  const w = $pop.offsetWidth, h = $pop.offsetHeight;
  const x = r.left + r.width / 2;
  $pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
  $pop.style.top = `${r.bottom + 10 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 10) : r.bottom + 10}px`;
}

function hidePop() {
  $pop.classList.add('hidden');
  popAnchor = null;
}

document.addEventListener('pointerdown', e => {
  if (popAnchor && !e.target.closest('#card-pop')) hidePop();
});
window.addEventListener('scroll', hidePop, { passive: true });

// Full hero card shown in the popover. u: { id, atk?, hp?, relic? }
function heroCard(u, enemy) {
  const h = HEROES[u.id];
  const atk = u.atk ?? h.atk, hp = Math.max(u.hp ?? h.hp, 0);
  const r = u.relic && RELICS[u.relic];
  return el('div', { class: `card ${enemy ? 'enemy' : ''}` }, [
    el('div', { class: 'card-emoji' }, h.emoji),
    el('div', { class: 'card-name' }, h.name),
    el('div', { class: 'card-ability', html: withTriggerTips(`<b>${h.ability.name}</b> — ${abilityDesc(u.id)}`) }),
    el('div', { class: 'card-relic' + (r ? '' : ' none'), html: r ? `<b>${r.icon} ${r.name}</b> — ${r.desc}` : (enemy ? 'No relic' : 'No relic equipped') }),
    el('div', { class: 'card-stats', html: `<span class="stat atk">⚔ ${atk}</span><span class="stat hp">♥ ${hp}</span>` }),
  ]);
}

function relicCard(k, count) {
  const r = RELICS[k];
  return el('div', { class: `card relic-card r-${k}` }, [
    el('div', { class: 'card-emoji' }, r.icon),
    el('div', { class: 'card-name' }, `${r.name} Relic${count > 1 ? ` ×${count}` : ''}`),
    el('div', { class: 'card-ability' }, r.desc),
    el('div', { class: 'card-relic none' }, 'One-time use. Drag it onto a hero to equip it.'),
  ]);
}

// ─── Tokens ──────────────────────────────────────────────────────────────

// Hero token: emoji in a ring, atk/hp corner badges, relic badge. u: { id, atk?, hp?, relic? }
function heroToken(u, { enemy, front, extraClass = '', relicDrag } = {}) {
  if (!u) return el('div', { class: `tok empty ${extraClass}` }, '+');
  const h = HEROES[u.id];
  const t = el('div', { class: `tok hero ${enemy ? 'enemy' : ''} ${front ? 'front' : ''} ${u.relic === 'shield' ? 'shielded' : ''} ${extraClass}` }, [
    el('span', { class: 'tok-emoji' }, h.emoji),
    el('span', { class: 'tok-atk' }, String(u.atk ?? h.atk)),
    el('span', { class: 'tok-hp' }, String(Math.max(u.hp ?? h.hp, 0))),
  ]);
  if (u.relic) {
    const badge = el('span', { class: `tok-relic r-${u.relic}`, 'data-relic': u.relic }, RELICS[u.relic].icon);
    if (relicDrag) draggable(badge, relicDrag, () => showPop(badge, relicCard(u.relic)));
    t.append(badge);
  }
  return t;
}

function relicToken(k, count) {
  return el('div', { class: `tok relic r-${k}` }, [
    el('span', { class: 'tok-emoji' }, RELICS[k].icon),
    count > 1 ? el('span', { class: 'tok-count' }, `×${count}`) : null,
  ]);
}

// ─── Render ──────────────────────────────────────────────────────────────

function render() {
  hidePop();
  $screen.innerHTML = '';
  ({
    squad: renderSquad,
    relics: renderRelicSetup,
    map: renderMap,
    prep: renderPrep,
    battle: renderBattle,
    extracted: renderExtracted,
  })[state.screen]();
}

function go(screen) { state.screen = screen; render(); }

function hud() {
  const total = state.inventory.length + Object.keys(state.equipped).length;
  return el('div', { class: 'hud', html: `<span>🏆 Wins <b>${state.wins}</b></span><span>💠 Relics <b>${total}</b></span>` });
}

// ─── Squad editing ───────────────────────────────────────────────────────

// Swap two squad slots; equipped relics move with the hero.
function swapSlots(a, b) {
  [state.squad[a], state.squad[b]] = [state.squad[b], state.squad[a]];
  const ea = state.equipped[a], eb = state.equipped[b];
  delete state.equipped[a]; delete state.equipped[b];
  if (eb) state.equipped[a] = eb;
  if (ea) state.equipped[b] = ea;
}

// A hero leaving the squad gives its relic back to the inventory.
function vacate(slot) {
  if (state.equipped[slot]) state.inventory.push(state.equipped[slot]);
  delete state.equipped[slot];
}

function equipRelic(payload, slot) {
  if (!state.squad[slot]) return;
  if (payload.from === 'inv') {
    state.inventory.splice(state.inventory.indexOf(payload.key), 1);
    if (state.equipped[slot]) state.inventory.push(state.equipped[slot]);
    state.equipped[slot] = payload.key;
  } else if (payload.slot !== slot) {
    const mine = state.equipped[slot];
    state.equipped[slot] = state.equipped[payload.slot];
    if (mine) state.equipped[payload.slot] = mine; else delete state.equipped[payload.slot];
  }
  render();
}

function unequip(slot) {
  vacate(slot);
  render();
}

// Player squad row: front (slot 0) on the right, facing the enemy.
// opts.heroes: allow dropping roster heroes in.  opts.relics: allow equipping relics.
function squadRow({ heroes = false, relics = false } = {}) {
  const row = el('div', { class: 'team player' });
  const front = state.squad.findIndex(Boolean);
  const slots = heroes ? state.squad.map((_, i) => i) : state.squad.map((id, i) => id ? i : -1).filter(i => i >= 0);
  for (const i of slots) {
    const id = state.squad[i];
    const u = id && { id, relic: state.equipped[i] };
    const t = heroToken(u, { front: i === front, relicDrag: relics ? { kind: 'relic', from: 'equip', slot: i } : null });
    const wrap = el('div', { class: 'slot' }, [t, el('div', { class: 'slot-label' }, i === front ? 'FRONT' : `#${i + 1}`)]);
    if (id) {
      const actions = [];
      if (relics && state.equipped[i]) actions.push({ label: `Unequip ${RELICS[state.equipped[i]].icon}`, danger: true, run: () => unequip(i) });
      if (heroes) actions.push({ label: 'Send to roster', danger: true, run: () => { vacate(i); state.roster.push(id); state.squad[i] = null; render(); } });
      draggable(t, { kind: 'hero', from: 'squad', slot: i }, () => showPop(t, heroCard(u), actions));
    }
    dropTarget(wrap,
      p => (p.kind === 'hero' && (p.from === 'squad' ? p.slot !== i : heroes)) || (relics && p.kind === 'relic' && !!id),
      p => {
        if (p.kind === 'relic') return equipRelic(p, i);
        if (p.from === 'squad') swapSlots(i, p.slot);
        else {
          const incoming = state.roster.splice(p.index, 1)[0];
          if (id) { vacate(i); state.roster.splice(p.index, 0, id); }
          state.squad[i] = incoming;
        }
        render();
      });
    row.append(wrap);
  }
  return row;
}

// ─── 1. Squad selection ──────────────────────────────────────────────────

function renderSquad() {
  $screen.append(
    el('h2', {}, 'Choose Your Squad'),
    el('p', { class: 'hint' }, 'Drag heroes between the roster and your squad, or drag squad heroes to reorder them. The rightmost hero is the front. Tap any token to see its card. Every hero keeps its original ability.'),
    el('h3', {}, `Squad ${state.squad.filter(Boolean).length}/${SQUAD_SIZE} — back ← → front`),
    squadRow({ heroes: true }),
    el('h3', {}, 'Roster'),
  );
  const rosterRow = el('div', { class: 'team roster' });
  state.roster.forEach((id, i) => {
    const t = heroToken({ id });
    const free = state.squad.indexOf(null);
    draggable(t, { kind: 'hero', from: 'roster', index: i }, () => showPop(t, heroCard({ id }), [{
      label: free >= 0 ? 'Add to squad' : 'Squad is full (drag onto a hero to swap)',
      disabled: free < 0,
      run: () => { state.roster.splice(i, 1); state.squad[free] = id; render(); },
    }]));
    rosterRow.append(t);
  });
  if (!state.roster.length) rosterRow.append(el('span', { class: 'hint' }, 'Everyone is in the squad.'));
  dropTarget(rosterRow, p => p.kind === 'hero' && p.from === 'squad', p => {
    vacate(p.slot);
    state.roster.push(state.squad[p.slot]);
    state.squad[p.slot] = null;
    render();
  });
  $screen.append(rosterRow, el('div', { class: 'actions' }, [
    el('button', {
      class: 'primary',
      disabled: !state.squad.some(Boolean),
      onclick: () => { state.inventory.push(...STARTER_RELICS); go('relics'); },
    }, 'Continue to Relics →'),
  ]));
}

// ─── 2. Relic setup ──────────────────────────────────────────────────────

function renderRelicSetup() {
  $screen.append(
    el('h2', {}, 'Relic Setup'),
    el('p', { class: 'hint' }, 'You start with one relic of each type (bottom). Drag a relic onto a hero to equip it — one relic per hero. Drag an equipped relic onto another hero to swap, or back to the inventory to unequip. Relics are used once and only when their effect happens; unused ones stay for later battles. You can also change relics in every battle prep.'),
    el('h3', {}, 'Your squad — back ← → front'),
    squadRow({ relics: true }),
    inventoryPanel(),
    el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: () => go('map') }, 'Start Expedition →')]),
  );
}

// ─── 3. Map (MapController) ──────────────────────────────────────────────

function isAvailable(cell) {
  if (state.completed.has(key(cell))) return false;
  const [cx, cy] = state.current.split(',').map(Number);
  if (Math.abs(cell.x - cx) + Math.abs(cell.y - cy) !== 1) return false;
  return canReachExtraction(cell);
}

// BFS through uncompleted cells to any extraction (prevents dead-ends), same as the original.
function canReachExtraction(start) {
  if (start.type === 'extract') return true;
  const queue = [start];
  const visited = new Set([key(start)]);
  while (queue.length) {
    const c = queue.shift();
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const n = cellAt(c.x + dx, c.y + dy);
      if (!n || visited.has(key(n)) || state.completed.has(key(n))) continue;
      if (n.type === 'extract') return true;
      visited.add(key(n));
      queue.push(n);
    }
  }
  return false;
}

function renderMap() {
  $screen.append(
    el('div', { class: 'map-head' }, [el('h2', {}, 'Expedition Map'), inventoryToggle()]),
    hud(),
    el('p', { class: 'hint' }, 'Move to an adjacent green-outlined node. Battle nodes open battle prep; an extraction node ends the run. Completed nodes can\'t be revisited, and you can only move where a path to extraction still exists.'),
  );
  if (state.lastResult) $screen.append(el('div', { class: `banner ${state.lastResult.cls}` }, state.lastResult.text));
  const xs = MAP.map(c => c.x), ys = MAP.map(c => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const grid = el('div', { class: 'map' });
  grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, var(--cell))`;
  for (let y = maxY; y >= minY; y--) {          // y grows upward, like MapView
    for (let x = minX; x <= maxX; x++) {
      const c = cellAt(x, y);
      if (!c) { grid.append(el('div', { class: 'cell none' })); continue; }
      const avail = isAvailable(c);
      const here = key(c) === state.current;
      const classes = ['cell', c.type,
        state.completed.has(key(c)) && !here ? 'completed' : '',
        avail ? 'available' : '',
        here ? 'current' : ''].join(' ');
      const label = c.type === 'spawn' ? '<b>⛺ Spawn</b>' : c.type === 'extract' ? '<b>🏁 Extract</b>'
        : `<b>⚔ Tier ${c.tier}</b><span class="mini">${c.enemies.map(e => HEROES[e].emoji).join('')}</span>`;
      grid.append(el('div', {
        class: classes,
        html: label + (here ? '<span class="you">🐪</span>' : ''),
        onclick: avail ? () => clickCell(c) : undefined,
      }));
    }
  }
  $screen.append(grid, el('h3', {}, 'Your squad — back ← → front'), squadRow());
}

function clickCell(c) {
  state.selectedCell = key(c);
  state.lastResult = null;
  if (c.type === 'extract') {
    state.current = key(c);
    state.completed.add(key(c));
    go('extracted');
  } else {
    go('prep');
  }
}

// ─── 4. Battle prep (BattlePreparationController) ────────────────────────

// Padded to 5 by cycling the area's list, same as the original. Enemies have no relics.
function enemyTeamFor(cell) {
  return Array.from({ length: SQUAD_SIZE }, (_, i) => ({ id: cell.enemies[i % cell.enemies.length] }));
}

const selectedCell = () => cellAt(...state.selectedCell.split(',').map(Number));

function enemyRow(units) {
  const row = el('div', { class: 'team enemy' });
  units.forEach((u, i) => {
    const t = heroToken(u, { enemy: true, front: i === 0 });
    tappable(t, () => showPop(t, heroCard(u, true)));
    row.append(t);
  });
  return row;
}

function renderPrep() {
  const cell = selectedCell();
  $screen.append(
    el('h2', {}, `Battle Prep — Tier ${cell.tier}`),
    hud(),
    el('p', { class: 'hint' }, 'Drag relics from your relics (below) onto your heroes, drag heroes to reorder. Your front hero strikes first. Win: +2 relics. Lose: ALL your relics are gone. Enemies have no relics.'),
    triggerLegend(),
    el('div', { class: 'battlefield' }, [squadRow({ relics: true }), el('div', { class: 'vs' }, 'VS'), enemyRow(enemyTeamFor(cell))]),
    inventoryPanel(),
    el('div', { class: 'actions' }, [
      el('button', { onclick: () => go('map') }, '← Back to Map'),
      el('button', { class: 'primary', onclick: startBattle }, '⚔ Fight!'),
    ]),
  );
}

// ─── 5. Battle simulation (turn-based port of BattleSimulator) ───────────

let uid = 0;
const makeUnit = (id, team, slot, relic = null) => {
  const h = HEROES[id];
  return { uid: ++uid, id, team, slot, atk: h.atk, hp: h.hp, relic, usedRelic: null };
};
const label = u => `${u.team === 0 ? 'Your' : 'Enemy'} ${HEROES[u.id].emoji} ${HEROES[u.id].name}`;

function simulate(A, B) {
  const events = [];
  let winner = null;   // set the moment one side runs out of heroes; nothing happens after that
  const teams = u => (u.team === 0 ? [A, B] : [B, A]);
  // Fainted heroes whose faint ability is still playing: out of the team (untargetable), but
  // still drawn at the slot they fainted in until it's done. [{ u, index }]
  const lingering = [];

  const shown = (team, side) => {
    const list = team.map(u => ({ ...u }));
    let added = 0;
    for (const { u, index } of lingering) {
      if (u.team !== side) continue;
      list.splice(Math.min(index + added, list.length), 0, { ...u, doomed: true });
      added++;
    }
    return list;
  };

  // anim: what the playback animates on the way to this snapshot (see playEvent).
  // text null = a silent step (nothing logged).
  const snap = (cls, text, anim = {}) => events.push({ cls, text, anim, player: shown(A, 0), enemy: shown(B, 1) });

  const useRelic = u => { u.usedRelic = u.relic; u.relic = null; };

  // Any damage (attack or ability) goes through here so the shield can block it.
  function damage(src, target, amount, text, anim) {
    if (target.relic === 'shield') {
      useRelic(target);
      snap('r', `${text} — 🛡️ ${label(target)}'s Shield blocks it!`, { ...anim, blocked: true });
      return;
    }
    target.hp -= amount;
    snap(src.team === 0 ? 'p' : 'e', `${text} for ${amount} (♥ ${Math.max(target.hp, 0)})`, anim);
    faintIfNeeded(target);
  }

  function faintIfNeeded(u) {
    const [own, enemy] = teams(u);
    if (u.hp > 0 || !own.includes(u)) return;
    const idx = own.indexOf(u);
    own.splice(idx, 1);
    if (!own.length) winner ??= u.team === 0 ? 1 : 0;
    const lingers = winner === null && HEROES[u.id].ability.trigger === 'faint';
    if (lingers) lingering.push({ u, index: idx });
    snap('s', `${label(u)} fainted!`, { type: 'faint', uid: u.uid, lingers });
    if (!lingers) return;
    useAbility(u, own, enemy, idx);
    lingering.splice(lingering.findIndex(l => l.u === u), 1);
    snap(null, null, { type: 'despawn', uid: u.uid });
  }

  function useAbility(src, own, enemy, indexBeforeRemoval) {
    if (winner !== null) return;
    const a = HEROES[src.id].ability;
    const text = `${TRIGGERS[a.trigger].emoji} ${label(src)}'s ${a.name}`;
    const anim = { type: 'ability', src: src.uid, trigger: a.trigger };
    if (a.effect === 'damage') {
      if (!enemy.length) return;
      const target = a.enemy === 'front' ? enemy[0] : enemy[rnd(enemy.length)];
      damage(src, target, a.dmg, `${text} hits ${label(target)}`, { ...anim, items: [{ uid: target.uid, fx: { hp: -a.dmg } }] });
    } else {
      const target = friendTarget(src, own, indexBeforeRemoval, a.friend);
      if (!target) return;
      target.atk += a.atk; target.hp += a.hp;
      snap(src.team === 0 ? 'p' : 'e', `${text}: ${label(target)} +${a.atk}⚔ +${a.hp}♥ → ${target.atk}/${target.hp}`,
        { ...anim, items: [{ uid: target.uid, fx: { atk: a.atk, hp: a.hp } }] });
    }
  }

  function friendTarget(src, own, indexBeforeRemoval, mode) {
    if (!own.length) return null;
    const idx = own.indexOf(src);
    switch (mode) {
      case 'ahead':
        if (idx >= 0) return own[idx - 1] || null;
        return indexBeforeRemoval > 0 ? own[indexBeforeRemoval - 1] || null : null;
      case 'behind':
        if (idx >= 0) return own[idx + 1] || null;
        return indexBeforeRemoval >= 0 ? own[indexBeforeRemoval] || null : null;
      default: {
        const c = own.filter(u => u !== src);
        const pool = c.length ? c : own;
        return pool[rnd(pool.length)];
      }
    }
  }

  function attack(att, own, enemy, tag) {
    const def = enemy[0];
    damage(att, def, att.atk, `${tag} ${label(att)} attacks ${label(def)}`,
      { type: 'attack', src: att.uid, team: att.team, target: def.uid, amount: att.atk });
  }

  snap('s', '⚔ Battle start!', { type: 'start' });
  // Start of battle: your side first.
  for (const [own, enemy] of [[A, B], [B, A]]) {
    for (const u of [...own]) {
      if (winner === null && own.includes(u) && HEROES[u.id].ability.trigger === 'start') useAbility(u, own, enemy, -1);
    }
  }

  let turns = 0;
  while (winner === null && turns < MAX_TURNS) {
    const playerTurn = turns % 2 === 0;           // player always attacks first
    const [own, enemy] = playerTurn ? [A, B] : [B, A];
    const tag = playerTurn ? '▶' : '◀';
    const att = own[0];
    attack(att, own, enemy, tag);
    if (winner === null && att.relic === 'double' && own[0] === att) {
      useRelic(att);
      snap('r', `⏩ ${label(att)}'s Double Turn — it strikes again!`, { type: 'relic', uid: att.uid, relic: 'double' });
      attack(att, own, enemy, tag);
    }
    if (winner === null && att.relic === 'goback' && own.includes(att) && own.length > 1) {
      useRelic(att);
      own.splice(own.indexOf(att), 1);
      own.push(att);
      snap('r', `↩️ ${label(att)}'s Go Back — it retreats to the back of the line.`, { type: 'relic', uid: att.uid, relic: 'goback' });
    }
    turns++;
  }
  // Safety net (unreachable with the current heroes): more total health wins, no ties.
  if (winner === null) {
    const hp = t => t.reduce((s, u) => s + u.hp, 0);
    winner = hp(A) >= hp(B) ? 0 : 1;
  }
  return { events, winner };
}

// ─── 6. Battle playback ──────────────────────────────────────────────────

function startBattle() {
  const player = [];
  state.squad.forEach((id, i) => { if (id) player.push(makeUnit(id, 0, i, state.equipped[i] || null)); });
  if (!player.length) return;
  const cell = selectedCell();
  const enemy = enemyTeamFor(cell).map(u => makeUnit(u.id, 1));
  const { events, winner } = simulate([...player], enemy);
  state.battle = { cell, player, events, winner, step: 0, speed: 1, done: false, skip: false, wakers: new Set() };
  go('battle');
  playBattle(state.battle);
}

async function playBattle(b) {
  await wait(b, 700);
  for (let i = 1; i < b.events.length && !b.skip; i++) {
    b.step = i;
    await playEvent(b, b.events[i]);
  }
  finishBattle();
}

// Waits ms (scaled by speed); resolves at once when the battle is skipped.
function wait(b, ms) {
  if (b.skip) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); b.wakers.delete(done); resolve(); };
    const timer = setTimeout(done, ms / b.speed);
    b.wakers.add(done);
  });
}

function skipBattle() {
  const b = state.battle;
  b.skip = true;
  [...b.wakers].forEach(w => w());
}

// Animates the way from the previous snapshot to `ev` (ev.anim from simulate), then shows it.
async function playEvent(b, ev) {
  const a = ev.anim;
  if (ev.text) { setNow(ev); logLine(ev); }
  const harmed = (uid, amount, blocked) => {
    if (blocked) { flash(uid, 'blocked'); float(uid, '🛡️ Blocked!', 'blocked'); }
    else { flash(uid, 'hit'); float(uid, `-${amount}`, 'dmg'); }
  };
  switch (a.type) {
    case 'attack':
      flash(a.src, a.team === 0 ? 'lunge-right' : 'lunge-left');
      await wait(b, 250);
      syncRows(b, ev);
      harmed(a.target, a.amount, a.blocked);
      await wait(b, 550);
      break;
    case 'ability':
      flash(a.src, 'ability');
      float(a.src, TRIGGERS[a.trigger].emoji, 'ability');
      await wait(b, 350);
      await effectArrows(b, a);
      syncRows(b, ev);
      for (const it of a.items) {
        if ((it.fx.hp || 0) < 0) harmed(it.uid, -it.fx.hp, a.blocked);
        else { flash(it.uid, 'buffed'); float(it.uid, effectLabel(it.fx), 'buff'); }
      }
      await wait(b, 450);
      break;
    case 'relic':
      flash(a.uid, 'ability');
      float(a.uid, `${RELICS[a.relic].icon} ${RELICS[a.relic].name}`, 'relic');
      await wait(b, 500);
      syncRows(b, ev);
      await wait(b, 350);
      break;
    case 'faint':
      // Heroes with a faint ability stay (greyed, 💀) until it has played; see 'despawn'.
      if (!a.lingers) { flash(a.uid, 'dying'); await wait(b, 400); }
      syncRows(b, ev);
      await wait(b, 300);
      break;
    case 'despawn':
      flash(a.uid, 'dying');
      await wait(b, 400);
      syncRows(b, ev);
      await wait(b, 150);
      break;
    default:
      syncRows(b, ev);
      await wait(b, 500);
  }
}

function finishBattle() {
  const b = state.battle;
  if (b.done) return;
  b.done = true;
  b.step = b.events.length - 1;
  b.consumed = [];
  for (const u of b.player) {
    if (u.usedRelic) { delete state.equipped[u.slot]; b.consumed.push(u.usedRelic); }
  }
  b.rewards = [];
  b.lost = [];
  if (b.winner === 0) {
    for (let i = 0; i < RELICS_PER_WIN; i++) b.rewards.push(RELIC_KEYS[rnd(RELIC_KEYS.length)]);
    state.inventory.push(...b.rewards);
    state.wins++;
  } else {
    b.lost = [...state.inventory, ...Object.values(state.equipped)];
    state.inventory = [];
    state.equipped = {};
  }
  render();
}

// ─── 7. Battle view (same look as Water Map) ─────────────────────────────
// The battle screen is built once; playback then updates its tokens in place (keyed by uid) so
// CSS animations, floats and arrows can play on them.

const NS = 'http://www.w3.org/2000/svg';
const tokens = new Map(); // battle unit uid -> token element
let bv = null;            // { svg, host, rows: { player, enemy }, now, log }

function renderBattle() {
  const b = state.battle;
  tokens.clear();
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'fx-arrows');
  const rows = { player: el('div', { class: 'team player' }), enemy: el('div', { class: 'team enemy' }) };
  const host = el('div', { class: 'arena' }, [svg, el('div', { class: 'battlefield' }, [rows.player, el('div', { class: 'vs' }, 'VS'), rows.enemy])]);
  bv = { svg, host, rows, now: el('div', { class: 'now' }), log: el('div', { class: 'log' }) };

  $screen.append(el('div', { class: 'battle-head' }, [el('h2', {}, `Battle — Tier ${b.cell.tier}`), triggerLegend()]));
  // Your side always strikes first.
  if (!b.done) $screen.append(el('div', { class: `first-banner player ${b.step === 0 ? 'pop' : ''}`, html: '<span class="fb-text">YOU ATTACK FIRST</span><span class="fb-arrow">➜</span>' }));
  $screen.append(bv.now, host);
  syncRows(b, b.events[b.step], false);
  const shownSoFar = b.events.slice(0, b.step + 1).filter(e => e.text);
  setNow(shownSoFar[shownSoFar.length - 1]);

  if (b.done) {
    $screen.append(resultBanner(b), el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: returnToMap }, 'Return to Map')]));
  } else {
    $screen.append(el('div', { class: 'actions' }, [
      el('button', { onclick: e => { b.speed = b.speed === 1 ? 3 : 1; e.currentTarget.textContent = speedLabel(b); } }, speedLabel(b)),
      el('button', { onclick: skipBattle }, '⏭ Skip to end'),
      el('span', { class: 'hint' }, 'Tap a hero to see its card.'),
    ]));
  }
  $screen.append(bv.log);
  shownSoFar.forEach(logLine);
}

const speedLabel = b => (b.speed === 1 ? '⏩ Speed x3' : '▶ Speed x1');

function setNow(ev) {
  bv.now.className = `now ${ev.cls}`;
  bv.now.innerHTML = withTriggerTips(ev.text);
}

function logLine(ev) {
  bv.log.append(el('div', { class: ev.cls, html: withTriggerTips(ev.text) }));
  bv.log.scrollTop = bv.log.scrollHeight;
}

// Brings both rows in line with snapshot `ev`; with `animate`, tokens that changed place slide there.
function syncRows(b, ev, animate = true) {
  const before = new Map();
  if (animate) for (const [uid, t] of tokens) before.set(uid, t.getBoundingClientRect());
  for (const [units, row, enemy] of [[ev.player, bv.rows.player, false], [ev.enemy, bv.rows.enemy, true]]) {
    const keep = new Set(units.map(u => u.uid));
    for (const [uid, t] of tokens) {
      if (t.parentElement === row && !keep.has(uid)) { t.remove(); tokens.delete(uid); }
    }
    row.querySelector('.tok.empty')?.remove();
    const front = units.find(u => !u.doomed);
    units.forEach((u, i) => {
      let t = tokens.get(u.uid);
      if (!t) {
        t = heroToken(u, { enemy });
        tappable(t, () => showPop(t, heroCard(t._u, enemy)));
        tokens.set(u.uid, t);
      }
      t._u = u;
      updateToken(t, u, u === front);
      if (row.children[i] !== t) row.insertBefore(t, row.children[i] || null);
    });
    if (!units.length) row.append(el('div', { class: 'tok empty' }, '💀'));
  }
  for (const [uid, r] of before) {
    const t = tokens.get(uid);
    const dx = t ? r.left - t.getBoundingClientRect().left : 0;
    if (Math.abs(dx) > 1) t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 350 / b.speed, easing: 'ease' });
  }
}

function updateToken(t, u, front) {
  const atk = t.querySelector('.tok-atk'), hp = t.querySelector('.tok-hp');
  atk.textContent = u.atk;
  hp.textContent = Math.max(u.hp, 0);
  atk.classList.remove('stat-up', 'stat-down');
  hp.classList.remove('stat-up', 'stat-down');
  t.classList.remove('preview-source', 'preview-help', 'preview-harm');
  t.classList.toggle('front', front);
  t.classList.toggle('shielded', u.relic === 'shield');
  t.classList.toggle('doomed', !!u.doomed);
  const badge = t.querySelector('.tok-relic');
  if ((badge?.dataset.relic || null) !== (u.relic || null)) {
    badge?.remove();
    if (u.relic) t.append(el('span', { class: `tok-relic r-${u.relic}`, 'data-relic': u.relic }, RELICS[u.relic].icon));
  }
}

function flash(uid, cls) {
  const t = tokens.get(uid);
  if (!t) return;
  t.classList.remove(cls);
  void t.offsetWidth; // restart animation
  t.classList.add(cls);
  if (cls !== 'dying') setTimeout(() => t.classList.remove(cls), 600);
}

function float(uid, text, cls) {
  const t = tokens.get(uid);
  if (!t) return;
  const f = el('div', { class: `float ${cls}`, html: withTriggerTips(text) });
  t.append(f);
  setTimeout(() => f.remove(), 1100);
}

function effectLabel(fx) {
  const atk = fx.atk || 0, hp = fx.hp || 0;
  const sign = n => (n > 0 ? `+${n}` : `${n}`);
  if (atk && hp) return `${sign(atk)}/${sign(hp)}`;
  if (atk) return `${sign(atk)} ⚔`;
  return `${sign(hp)} ♥`;
}

// Shows an ability's coming effect on the target token (stat badges change colour and value).
function previewFx(t, u, fx) {
  const atk = fx.atk || 0, hp = fx.hp || 0;
  if (atk) {
    const s = t.querySelector('.tok-atk');
    s.textContent = u.atk + atk;
    s.classList.add(atk > 0 ? 'stat-up' : 'stat-down');
  }
  if (hp) {
    const s = t.querySelector('.tok-hp');
    s.textContent = Math.max(0, u.hp + hp);
    s.classList.add(hp > 0 ? 'stat-up' : 'stat-down');
  }
  t.classList.add(atk < 0 || hp < 0 ? 'preview-harm' : 'preview-help');
}

// Arrows from the ability's hero to each target, then each arrow's tail slides into its target.
async function effectArrows(b, a) {
  const source = tokens.get(a.src);
  const arrows = [];
  for (const it of a.items) {
    const t = tokens.get(it.uid);
    if (!t) continue;
    previewFx(t, t._u, it.fx);
    const harm = (it.fx.atk || 0) < 0 || (it.fx.hp || 0) < 0;
    arrows.push({ el: t, label: effectLabel(it.fx), cls: harm ? 'harm' : 'help' });
  }
  if (!source || !arrows.length || b.skip) return;
  source.classList.add('preview-source');
  await snakeArrows(b, drawArrows(source, arrows, a.trigger), 250, 700);
  bv.svg.innerHTML = '';
}

// Curved arrows from the source token's upper-left corner (where the trigger emoji badge sits)
// to the top of every target, with the amount under each tip. Returns { paths, badge }.
function drawArrows(source, arrows, trigger) {
  const { svg } = bv;
  svg.innerHTML = '';
  const host = bv.host.getBoundingClientRect();
  svg.setAttribute('width', host.width);
  svg.setAttribute('height', host.height);
  const mk = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const defs = mk('defs', {});
  for (const cls of ['help', 'harm']) {
    const m = mk('marker', { id: `fx-head-${cls}`, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
    mk('path', { d: 'M0,0 L10,5 L0,10 z', class: `arrowhead ${cls}` }, m);
  }

  const src = source.getBoundingClientRect();
  const sx = src.left + 8 - host.left;
  const sy = src.top + 4 - host.top;
  const GAP = 26; // space between arrow tip and the target's top (label sits there)
  const paths = [];
  for (const a of arrows) {
    const r = a.el.getBoundingClientRect();
    const tx = r.left + r.width / 2 - host.left;
    const ty = r.top - host.top - GAP;
    let d;
    if (a.el === source) {
      const x2 = r.right - host.left - 8;
      d = `M${sx},${sy} C${sx - 10},${sy - 60} ${x2 + 10},${sy - 60} ${x2},${ty}`;
    } else {
      const cy = Math.min(sy, ty) - (36 + Math.abs(tx - sx) * 0.16);
      d = `M${sx},${sy} Q${(sx + tx) / 2},${cy} ${tx},${ty}`;
    }
    paths.push(mk('path', { d, class: `arrow ${a.cls}`, 'marker-end': `url(#fx-head-${a.cls})` }));
    mk('text', { x: tx, y: ty + 15, class: `arrow-label ${a.cls}`, 'text-anchor': 'middle' }).textContent = a.label;
  }
  // Drawn last so the badge sits on top of the arrows.
  const circle = mk('circle', { cx: sx, cy: sy, r: 14, class: 'trigger-badge', 'data-trigger': trigger });
  const text = mk('text', { x: sx, y: sy + 1, class: 'trigger-emoji', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-trigger': trigger });
  text.textContent = TRIGGERS[trigger].emoji;
  return { paths, badge: { circle, text } };
}

// Holds the arrows for `holdMs`, then over `travelMs` shortens each from its start so the tail
// slides along the curve into the tip, while the trigger badge at the base fades out.
function snakeArrows(b, { paths, badge }, holdMs, travelMs) {
  const SAMPLES = 32;
  const shapes = paths.map(path => {
    const ref = path.cloneNode(); // keeps the full curve to sample from
    ref.removeAttribute('marker-end');
    ref.setAttribute('class', 'arrow-ref');
    path.before(ref);
    return { path, ref, len: ref.getTotalLength() };
  });
  return new Promise(resolve => {
    let elapsed = 0;
    let last = performance.now();
    const frame = now => {
      elapsed += (now - last) * b.speed;
      last = now;
      if (b.skip) elapsed = holdMs + travelMs;
      const t = Math.min(1, Math.max(0, (elapsed - holdMs) / travelMs));
      const eased = t * t * (3 - 2 * t);
      for (const s of shapes) {
        const from = s.len * eased;
        const pts = [];
        for (let k = 0; k <= SAMPLES; k++) {
          const p = s.ref.getPointAtLength(from + (s.len - from) * (k / SAMPLES));
          pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        }
        s.path.setAttribute('d', `M${pts.join(' L')}`);
      }
      badge.circle.style.opacity = 1 - eased;
      badge.text.style.opacity = 1 - eased;
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

const relicList = ks => ks.length ? ks.map(k => `${RELICS[k].icon} ${RELICS[k].name}`).join(', ') : 'none';

function resultBanner(b) {
  if (b.winner === 0) {
    return el('div', { class: 'banner win' }, `Victory!
Gained ${b.rewards.length} relics: ${relicList(b.rewards)}
Used up this battle: ${relicList(b.consumed)}`);
  }
  return el('div', { class: 'banner lose' }, `Defeat!
All your relics are gone (${b.lost.length + b.consumed.length}): ${relicList([...b.consumed, ...b.lost])}
You stay where you were; map progress is kept.`);
}

function returnToMap() {
  const b = state.battle;
  if (b.winner === 0) {
    state.current = state.selectedCell;
    state.completed.add(state.selectedCell);
    state.lastResult = { cls: 'win', text: `Won the Tier ${b.cell.tier} battle — gained ${relicList(b.rewards)}.` };
  } else {
    state.lastResult = { cls: 'lose', text: 'Lost the last battle — every relic is gone. You stayed in place.' };
  }
  state.battle = null;
  go('map');
}

function renderExtracted() {
  const total = state.inventory.length + Object.keys(state.equipped).length;
  $screen.append(
    el('h2', {}, '🏁 Extracted!'),
    el('div', { class: 'banner win' }, `You reached an extraction point.\nBattles won: ${state.wins}\nRelics extracted: ${total}`),
    el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: newRun }, 'New Run')]),
  );
}

// ─── Relic inventory ─────────────────────────────────────────────────────

// Inline panel under the squad (relic setup + battle prep): drag relics onto heroes, drag equipped ones back.
function inventoryPanel() {
  const panel = el('div', { class: 'inventory' }, [
    el('div', { class: 'inv-head' }, [
      el('b', {}, `🎒 Relics (${state.inventory.length})`),
      el('span', { class: 'inv-status' }, 'Tap to read · drag onto a hero to equip · drag an equipped relic here to unequip'),
    ]),
  ]);
  const row = el('div', { class: 'inv-row' });
  for (const k of RELIC_KEYS) {
    const count = state.inventory.filter(x => x === k).length;
    if (!count) continue;
    const t = relicToken(k, count);
    draggable(t, { kind: 'relic', from: 'inv', key: k }, () => showPop(t, relicCard(k, count)));
    row.append(t);
  }
  if (!state.inventory.length) row.append(el('span', { class: 'inv-status' }, 'Empty. Win battles to earn relics.'));
  panel.append(row);
  dropTarget(panel, p => p.kind === 'relic' && p.from === 'equip', p => unequip(p.slot));
  return panel;
}

// Map: a small right-side button that opens a read-only list of every relic you own.
function inventoryToggle() {
  const owned = [...state.inventory, ...Object.values(state.equipped)];
  const wrap = el('div', { class: 'inv-toggle' }, [
    el('button', {
      class: state.showInventory ? 'active' : '',
      onclick: () => { state.showInventory = !state.showInventory; render(); },
    }, `🎒 ${state.showInventory ? 'Hide' : 'Show'} inventory (${owned.length})`),
  ]);
  if (!state.showInventory) return wrap;
  const list = el('div', { class: 'inv-dropdown' });
  for (const k of RELIC_KEYS) {
    const free = state.inventory.filter(x => x === k).length;
    const worn = Object.values(state.equipped).filter(x => x === k).length;
    if (!free && !worn) continue;
    const t = relicToken(k, free + worn);
    tappable(t, () => showPop(t, relicCard(k, free + worn)));
    list.append(el('div', { class: 'inv-line' }, [t, el('div', {}, [
      el('b', {}, RELICS[k].name),
      el('div', { class: 'inv-status' }, `${free} in bag · ${worn} equipped`),
    ])]));
  }
  if (!owned.length) list.append(el('span', { class: 'inv-status' }, 'No relics. Win battles to earn them.'));
  list.append(el('div', { class: 'inv-status' }, 'Equip relics in battle prep.'));
  wrap.append(list);
  return wrap;
}

initTriggerTips();
newRun();
