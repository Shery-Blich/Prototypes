// Caravan Heroes — "abilities as one-time items" variant.
// Mirrors the Unity project's run loop: squad selection -> map -> team prep -> auto battle.
// Differences from the Unity project:
//  - Heroes have no inherent abilities. Each original ability is an "ability potion" item that can be
//    equipped on ANY hero. It fires once (when its trigger happens) and is then used up.
//  - You gain potions every time you win a battle.
//  - Battles are still automatic, but turn-based: your front hero attacks first, then the enemy front
//    hero attacks back, alternating (instead of both hitting at the same time).

// ─── Data (copied from the Unity assets) ─────────────────────────────────

const HEROES = {
  falcon:    { name: 'Barbary Falcon', emoji: '🦅', atk: 1, hp: 2 },
  caracal:   { name: 'Karakal',        emoji: '🐈', atk: 1, hp: 2 },
  fox:       { name: 'Desert Fox',     emoji: '🦊', atk: 2, hp: 1 },
  gecko:     { name: 'Gecko',          emoji: '🦎', atk: 2, hp: 2 },
  viper:     { name: 'Horned Viper',   emoji: '🐍', atk: 2, hp: 2 },
  porcupine: { name: 'Porcupine',      emoji: '🦔', atk: 5, hp: 5 },
};

// The heroes' original abilities (PetData assets), one potion per hero ability. Any hero can carry any potion.
// trigger: start | faint | hurt.  effect: buff (friend target) | damage (enemy target).
const ABILITIES = {
  rally:     { name: "Falcon's Rally Potion",       icon: '📯', trigger: 'start', effect: 'buff',   friend: 'behind', atk: 1, hp: 1 },
  blessing:  { name: "Karakal's Blessing Potion",   icon: '🙏', trigger: 'faint', effect: 'buff',   friend: 'random', atk: 0, hp: 1 },
  laststand: { name: "Fox's Last Stand Potion",     icon: '🛡️', trigger: 'faint', effect: 'buff',   friend: 'behind', atk: 2, hp: 1 },
  strike:    { name: "Gecko's First Strike Potion", icon: '🎯', trigger: 'start', effect: 'damage', enemy: 'front',   dmg: 1 },
  dart:      { name: "Viper's Venom Dart Potion",   icon: '🏹', trigger: 'start', effect: 'damage', enemy: 'random',  dmg: 1 },
  spite:     { name: "Porcupine's Spite Potion",    icon: '💥', trigger: 'faint', effect: 'damage', enemy: 'random',  dmg: 1 },
};

function abilityDesc(key) {
  const a = ABILITIES[key];
  const trig = { start: 'Start of Battle', faint: 'Faint', hurt: 'Hurt' }[a.trigger];
  if (a.effect === 'damage') {
    return `${trig} → deal ${a.dmg} dmg to ${a.enemy === 'front' ? 'the front enemy' : '1 random enemy'}`;
  }
  const who = { self: 'self', ahead: 'the friend ahead', behind: 'the friend behind', random: 'a random friend' }[a.friend];
  const stats = [a.atk ? `+${a.atk} dmg` : '', a.hp ? `+${a.hp} hp` : ''].filter(Boolean).join(' ');
  return `${trig} → buff ${who} ${stats}`;
}

const ROSTER_START = ['falcon', 'falcon', 'caracal', 'fox', 'gecko', 'gecko', 'viper', 'porcupine'];
const SQUAD_START = ['falcon', 'caracal', 'fox', 'gecko', 'porcupine']; // slot 0 = front
// Start the run with one of every potion so all abilities are available from the first battle.
const STARTER_ITEMS = Object.keys(ABILITIES);

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

const MAX_ATTACKS = 200;   // same cap as BattleSimulator.MaxClashes -> tie
const STEP_MS = 650;

// ─── State ───────────────────────────────────────────────────────────────

let state;

function newRun() {
  const spawn = MAP.find(c => c.type === 'spawn');
  state = {
    screen: 'squad',
    squad: [...SQUAD_START],
    roster: [...ROSTER_START],
    equipped: {},              // squad slot -> ability key
    inventory: [...STARTER_ITEMS],
    selected: null,            // { kind: 'roster'|'squad'|'prep'|'item', index }
    current: key(spawn),
    selectedCell: null,
    completed: new Set([key(spawn)]),
    battle: null,
    lastResult: null,
  };
  render();
}

const key = c => `${c.x},${c.y}`;
const cellAt = (x, y) => MAP.find(c => c.x === x && c.y === y);
const $screen = document.getElementById('screen');
const $inv = document.getElementById('inventory');

// ─── Rendering helpers ───────────────────────────────────────────────────

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

// u: { id, atk, hp, maxHp, item }
function unitCard(u, { front, extraClass = '', onclick, onItemClick, enemy } = {}) {
  if (!u) return el('div', { class: `card empty ${extraClass}`, onclick }, 'Empty slot');
  const h = HEROES[u.id];
  const itemTag = u.item
    ? el('div', {
        class: `tag ${onItemClick ? 'clickable' : ''}`,
        title: onItemClick ? 'Click to unequip' : '',
        onclick: onItemClick ? (e) => { e.stopPropagation(); onItemClick(); } : undefined,
      }, `${ABILITIES[u.item].icon} ${ABILITIES[u.item].name}: ${abilityDesc(u.item)}`)
    : el('div', { class: 'tag none' }, 'No ability');
  return el('div', { class: `card ${enemy ? 'enemy' : ''} ${u.flash || ''} ${extraClass}`, onclick }, [
    el('div', { class: 'front' }, front ? 'FRONT' : ' '),
    el('div', { class: 'emoji' }, h.emoji),
    el('div', { class: 'name' }, h.name),
    el('div', { class: 'stats', html: `<span class="atk">⚔ ${u.atk ?? h.atk}</span>  <span class="hp">♥ ${Math.max(u.hp ?? h.hp, 0)}</span>` }),
    itemTag,
  ]);
}

// Squad slot -> display unit (base stats + whatever potion is equipped).
const squadUnit = slot => state.squad[slot] && { id: state.squad[slot], item: state.equipped[slot] };

function render() {
  $screen.innerHTML = '';
  ({
    squad: renderSquad,
    map: renderMap,
    prep: renderPrep,
    battle: renderBattle,
    extracted: renderExtracted,
  })[state.screen]();
  renderInventory();
}

// ─── 1. Squad selection (ExpeditionPreparationController) ────────────────

function renderSquad() {
  $screen.append(
    el('h2', {}, 'Expedition Preparation — Choose Your Squad'),
    el('p', { class: 'hint' }, 'Click a roster hero, then a squad slot to swap them. Click two squad slots to swap their order. Slot 1 is the front. Heroes have no abilities of their own — equip ability potions from your inventory (bottom) on any hero.'),
    el('h3', {}, `Squad ${state.squad.filter(Boolean).length}/5 (front → back)`),
  );
  const squadRow = el('div', { class: 'row' });
  state.squad.forEach((id, i) => {
    const sel = state.selected?.kind === 'squad' && state.selected.index === i;
    squadRow.append(el('div', { class: 'slot' }, [
      unitCard(squadUnit(i), { front: i === 0, extraClass: state.selected?.kind === 'item' ? 'targetable' : sel ? 'selected' : '', onclick: () => clickSquadSlot(i), onItemClick: () => unequip(i) }),
      id ? potionPicker(i) : null,
    ]));
  });
  $screen.append(squadRow, el('h3', {}, 'Roster'));
  const rosterRow = el('div', { class: 'row' });
  state.roster.forEach((id, i) => {
    const sel = state.selected?.kind === 'roster' && state.selected.index === i;
    rosterRow.append(unitCard(id && { id }, { extraClass: sel ? 'selected' : '', onclick: () => clickRoster(i) }));
  });
  $screen.append(rosterRow, el('div', { class: 'actions' }, [
    el('button', { class: 'primary', onclick: () => go('map') }, 'Start Expedition →'),
  ]));
}

function go(screen) { state.selected = null; state.screen = screen; render(); }

function clickRoster(i) {
  state.selected = (state.selected?.kind === 'roster' && state.selected.index === i) ? null : { kind: 'roster', index: i };
  render();
}

function clickSquadSlot(i) {
  const s = state.selected;
  if (s?.kind === 'item') return equipOn(i);
  if (s?.kind === 'roster') {
    // Swap roster hero into the slot; the old hero goes back to that roster spot (its potion stays on the slot).
    [state.squad[i], state.roster[s.index]] = [state.roster[s.index], state.squad[i]];
    if (!state.squad[i] && state.equipped[i]) unequip(i, false);
    state.selected = null;
  } else if (s?.kind === 'squad' && s.index !== i) {
    swapSlots(i, s.index);
    state.selected = null;
  } else {
    state.selected = s?.kind === 'squad' && s.index === i ? null : { kind: 'squad', index: i };
  }
  render();
}

// Swap two squad slots; equipped potions move with the hero.
function swapSlots(a, b) {
  [state.squad[a], state.squad[b]] = [state.squad[b], state.squad[a]];
  const ea = state.equipped[a], eb = state.equipped[b];
  delete state.equipped[a]; delete state.equipped[b];
  if (eb) state.equipped[a] = eb;
  if (ea) state.equipped[b] = ea;
}

// ─── Equipping potions ───────────────────────────────────────────────────

// Equipping is allowed everywhere except while a battle is still playing (the result screen is fine).
function canEquipNow() { return state.screen !== 'battle' || state.battle?.done; }

function equipOn(slot) {
  const s = state.selected;
  if (!state.squad[slot] || s?.kind !== 'item') return;
  const [itemKey] = state.inventory.splice(s.index, 1);
  if (state.equipped[slot]) state.inventory.push(state.equipped[slot]); // swap out the old potion
  state.equipped[slot] = itemKey;
  state.selected = null;
  render();
}

// Dropdown under a hero: pick a potion from the inventory to give that hero its ability.
function potionPicker(slot) {
  const select = el('select', {
    class: 'picker',
    disabled: !state.inventory.length,
    onchange: (e) => {
      const i = +e.target.value;
      if (i < 0) return;
      state.selected = { kind: 'item', index: i };
      equipOn(slot);
    },
  }, [el('option', { value: '-1' }, state.inventory.length
    ? (state.equipped[slot] ? '↻ Swap potion…' : '+ Add potion…')
    : 'No potions in inventory')]);
  const seen = new Set();
  state.inventory.forEach((k, i) => {
    if (seen.has(k)) return;
    seen.add(k);
    const count = state.inventory.filter(x => x === k).length;
    select.append(el('option', { value: String(i) }, `${ABILITIES[k].icon} ${ABILITIES[k].name}${count > 1 ? ' x' + count : ''}`));
  });
  return select;
}

function unequip(slot, rerender = true) {
  state.inventory.push(state.equipped[slot]);
  delete state.equipped[slot];
  if (rerender) render();
}

// ─── 2. Map (MapController) ──────────────────────────────────────────────

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
    el('h2', {}, 'Expedition Map'),
    el('p', { class: 'hint' }, 'Move to an adjacent green-outlined node. Battle nodes open team prep; an Extraction node ends the run. Completed nodes can\'t be revisited, and you can only move where a path to extraction still exists.'),
  );
  if (state.lastResult) $screen.append(el('div', { class: `banner ${state.lastResult.cls}` }, state.lastResult.text));
  const xs = MAP.map(c => c.x), ys = MAP.map(c => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const grid = el('div', { class: 'map' });
  grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, 90px)`;
  for (let y = maxY; y >= minY; y--) {          // y grows upward, like MapView
    for (let x = minX; x <= maxX; x++) {
      const c = cellAt(x, y);
      if (!c) { grid.append(el('div', { class: 'cell none' })); continue; }
      const avail = isAvailable(c);
      const classes = ['cell', c.type,
        state.completed.has(key(c)) && key(c) !== state.current ? 'completed' : '',
        avail ? 'available' : '',
        key(c) === state.current ? 'current' : ''].join(' ');
      const label = c.type === 'spawn' ? '<b>⛺ Spawn</b>' : c.type === 'extract' ? '<b>🏁 Extraction</b>'
        : `<b>⚔ Battle</b>Tier ${c.tier}<br>${c.enemies.map(e => HEROES[e].emoji).join('')}`;
      grid.append(el('div', {
        class: classes,
        html: label + (key(c) === state.current ? '<br>🐪 you' : ''),
        onclick: avail ? () => clickCell(c) : undefined,
      }));
    }
  }
  $screen.append(grid, el('h3', {}, 'Your squad'), squadRowEditable());
}

// Squad row where potions can be equipped (click inventory item, then hero) or unequipped (click the potion tag).
function squadRowEditable(onHeroClick) {
  const row = el('div', { class: 'team player' });
  const front = state.squad.findIndex(Boolean);
  state.squad.forEach((id, i) => {
    if (!id) return;
    const sel = state.selected?.kind === 'prep' && state.selected.index === i;
    row.append(el('div', { class: 'slot' }, [
      unitCard(squadUnit(i), {
        front: i === front,
        extraClass: state.selected?.kind === 'item' ? 'targetable' : sel ? 'selected' : '',
        onclick: () => (state.selected?.kind === 'item' ? equipOn(i) : onHeroClick?.(i)),
        onItemClick: () => unequip(i),
      }),
      potionPicker(i),
    ]));
  });
  return row;
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

// ─── 3. Team prep (BattlePreparationController) ──────────────────────────

// Padded to 5 by cycling the area's list, same as the original. Enemies have no abilities/items.
function enemyTeamFor(cell) {
  return Array.from({ length: 5 }, (_, i) => ({ id: cell.enemies[i % cell.enemies.length] }));
}

const selectedCell = () => cellAt(...state.selectedCell.split(',').map(Number));

function renderPrep() {
  const cell = selectedCell();
  $screen.append(
    el('h2', {}, `Team Preparation — Tier ${cell.tier} Battle`),
    el('p', { class: 'hint' }, 'Equip potions: click an item in your inventory, then a hero (1 potion per hero; click a hero\'s potion to unequip). Click two heroes to swap order. Enemies have no abilities. Your front hero (closest to the middle) attacks first.'),
  );
  const enemyTeam = el('div', { class: 'team' });
  enemyTeamFor(cell).forEach((u, i) => enemyTeam.append(unitCard(u, { front: i === 0, enemy: true })));
  $screen.append(
    el('div', { class: 'battlefield' }, [squadRowEditable(clickPrepHero), el('div', { class: 'vs' }, 'VS'), enemyTeam]),
    el('div', { class: 'actions' }, [
      el('button', { onclick: () => go('map') }, '← Back to Map'),
      el('button', { class: 'primary', onclick: startBattle }, '⚔ Fight!'),
    ]),
  );
}

function clickPrepHero(i) {
  const s = state.selected;
  if (s?.kind === 'prep' && s.index !== i) {
    swapSlots(i, s.index);
    state.selected = null;
  } else {
    state.selected = s?.kind === 'prep' && s.index === i ? null : { kind: 'prep', index: i };
  }
  render();
}

// ─── 4. Battle simulation (port of BattleSimulator, turn-based) ──────────

let uid = 0;
const makeUnit = (u, team, slot) => {
  const h = HEROES[u.id];
  return { uid: ++uid, id: u.id, team, slot, atk: h.atk, hp: h.hp, maxHp: h.hp, item: u.item || null, used: false };
};
const label = u => `${u.team === 0 ? 'Your' : 'Enemy'} ${HEROES[u.id].emoji} ${HEROES[u.id].name}`;

function simulate(teamA, teamB) {
  const A = [...teamA], B = [...teamB];
  const events = [];
  const rnd = n => Math.floor(Math.random() * n);

  const snap = (cls, text, flashes = {}) => events.push({
    cls, text,
    player: A.map(u => ({ ...u, flash: flashes[u.uid] })),
    enemy: B.map(u => ({ ...u, flash: flashes[u.uid] })),
  });

  const has = (u, trigger) => u.item && ABILITIES[u.item].trigger === trigger;

  function startOfBattle(own, enemy) {
    for (const u of [...own]) {
      if (u.hp > 0 && own.includes(u) && has(u, 'start')) exec(u, own, enemy, -1);
    }
  }

  function exec(src, own, enemy, indexBeforeRemoval) {
    const key = src.item;
    const a = ABILITIES[key];
    const prefix = `${label(src)} uses ${a.icon} ${a.name}`;
    // Potions are one-time per battle: used up only when the effect actually happens.
    // If it fizzles (no valid target) it stays on the hero for the next battle.
    const consume = () => { src.item = null; src.used = key; };
    if (a.effect === 'damage') {
      if (!enemy.length) return;
      consume();
      const target = a.enemy === 'front' ? enemy[0] : enemy[rnd(enemy.length)];
      target.hp -= a.dmg;
      snap(src.team === 0 ? 'p' : 'e', `${prefix}: ${a.dmg} dmg to ${label(target)} (♥ ${Math.max(target.hp, 0)})`, { [src.uid]: 'acting', [target.uid]: 'hit' });
      if (a.dmg > 0 && target.hp > 0 && has(target, 'hurt')) exec(target, enemy, own, -1);
      faintIfNeeded(target, enemy, own);
    } else {
      const target = friendTarget(src, own, indexBeforeRemoval, a.friend);
      if (!target) {
        snap('s', `${label(src)}'s ${a.icon} ${a.name} fizzled — no valid friend to buff. Potion kept.`, { [src.uid]: 'acting' });
        return;
      }
      consume();
      target.atk += a.atk; target.hp += a.hp; target.maxHp += a.hp;
      snap(src.team === 0 ? 'p' : 'e', `${prefix}: ${label(target)} +${a.atk} dmg +${a.hp} hp → ${target.atk}/${target.hp}`, { [src.uid]: 'acting', [target.uid]: 'buffed' });
    }
  }

  function friendTarget(src, own, indexBeforeRemoval, mode) {
    if (!own.length) return null;
    const idx = own.indexOf(src);
    switch (mode) {
      case 'self': return idx >= 0 ? src : null;
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

  function faintIfNeeded(u, own, enemy) {
    if (u.hp > 0 || !own.includes(u)) return;
    const idx = own.indexOf(u);
    own.splice(idx, 1);
    snap('s', `${label(u)} fainted! 💀`);
    if (has(u, 'faint')) exec(u, own, enemy, idx);
  }

  snap('s', '⚔ Battle start!');
  startOfBattle(A, B);
  startOfBattle(B, A);

  let attacks = 0;
  while (A.length && B.length && attacks < MAX_ATTACKS) {
    const playerTurn = attacks % 2 === 0;           // player always attacks first
    const [own, enemy] = playerTurn ? [A, B] : [B, A];
    const att = own[0], def = enemy[0];
    def.hp -= att.atk;
    snap(playerTurn ? 'p' : 'e', `${playerTurn ? '▶ YOUR TURN' : '◀ ENEMY TURN'}: ${label(att)} attacks ${label(def)} for ${att.atk} (♥ ${Math.max(def.hp, 0)})`,
      { [att.uid]: 'acting', [def.uid]: 'hit' });
    if (att.atk > 0 && def.hp > 0 && has(def, 'hurt')) exec(def, enemy, own, -1);
    faintIfNeeded(def, enemy, own);
    attacks++;
  }

  const winner = A.length && !B.length ? 0 : B.length && !A.length ? 1 : -1;
  return { events, winner };
}

// ─── 5. Battle playback (BattlePresenter) ────────────────────────────────

function startBattle() {
  const player = [];
  state.squad.forEach((id, i) => { if (id) player.push(makeUnit(squadUnit(i), 0, i)); });
  if (!player.length) return;
  const cell = selectedCell();
  const enemy = enemyTeamFor(cell).map(u => makeUnit(u, 1));
  const { events, winner } = simulate(player, enemy);
  state.battle = { cell, player, events, winner, step: 0, speed: 1, done: false };
  go('battle');
  scheduleStep();
}

let stepTimer = null;
function scheduleStep() {
  clearTimeout(stepTimer);
  const b = state.battle;
  if (!b || b.done) return;
  stepTimer = setTimeout(() => {
    if (b.step < b.events.length - 1) { b.step++; render(); scheduleStep(); }
    else finishBattle();
  }, STEP_MS / b.speed);
}

function skipBattle() {
  const b = state.battle;
  b.step = b.events.length - 1;
  finishBattle();
}

function finishBattle() {
  const b = state.battle;
  if (b.done) return;
  clearTimeout(stepTimer);
  b.done = true;
  b.consumed = [];
  b.kept = [];
  // Potions that fired are gone; every other potion stays on its hero, whatever the outcome.
  for (const u of b.player) {
    if (u.used) { delete state.equipped[u.slot]; b.consumed.push(u.used); }
  }
  b.kept = Object.values(state.equipped);
  b.rewards = [];
  if (b.winner === 0) {
    const ids = Object.keys(ABILITIES);
    for (let i = 0; i < b.cell.tier + 1; i++) b.rewards.push(ids[Math.floor(Math.random() * ids.length)]);
    state.inventory.push(...b.rewards);
  }
  render();
}

function renderBattle() {
  const b = state.battle;
  const ev = b.events[b.step];
  $screen.append(el('h2', {}, `Auto Battle — Tier ${b.cell.tier}`));
  const playerTeam = el('div', { class: 'team player' });
  ev.player.forEach((u, i) => playerTeam.append(unitCard(u, { front: i === 0 })));
  const enemyTeam = el('div', { class: 'team' });
  ev.enemy.forEach((u, i) => enemyTeam.append(unitCard(u, { front: i === 0, enemy: true })));
  $screen.append(
    el('div', { class: `now ${ev.cls}` }, ev.text),
    el('div', { class: 'battlefield' }, [playerTeam, el('div', { class: 'vs' }, 'VS'), enemyTeam]),
  );
  if (b.done) {
    $screen.append(
      resultBanner(b),
      el('h3', {}, 'Your squad — equip potions now (use the dropdowns, or click a potion below then a hero)'),
      squadRowEditable(),
      el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: returnToMap }, 'Return to Map')]),
    );
  } else {
    $screen.append(el('div', { class: 'actions' }, [
      el('button', { onclick: () => { b.speed = b.speed === 1 ? 3 : 1; render(); scheduleStep(); } }, b.speed === 1 ? '⏩ Speed x3' : '▶ Speed x1'),
      el('button', { onclick: skipBattle }, '⏭ Skip to end'),
    ]));
  }
  const logBox = el('div', { class: 'log' });
  b.events.slice(0, b.step + 1).forEach(e => logBox.append(el('div', { class: e.cls }, e.text)));
  $screen.append(logBox);
  logBox.scrollTop = logBox.scrollHeight;
}

function resultBanner(b) {
  const names = ks => ks.map(k => ABILITIES[k].name).join(', ');
  const potions = `
Used up (gone): ${b.consumed.length ? names(b.consumed) : 'none'}
Not used (still on your heroes): ${b.kept.length ? names(b.kept) : 'none'}`;
  if (b.winner === 0) {
    return el('div', { class: 'banner win' }, `Victory!
You gained ${b.rewards.length} potion(s): ${names(b.rewards)}${potions}`);
  }
  if (b.winner === 1) {
    return el('div', { class: 'banner lose' }, `Wiped out!
Map progress is kept; you stay where you were.${potions}`);
  }
  return el('div', { class: 'banner tie' }, `A Tie!
You stay where you were.${potions}`);
}

function returnToMap() {
  const b = state.battle;
  if (b.winner === 0) {
    state.current = state.selectedCell;
    state.completed.add(state.selectedCell);
    state.lastResult = { cls: 'win', text: `Won the Tier ${b.cell.tier} battle — gained ${b.rewards.length} potion(s).` };
  } else {
    state.lastResult = b.winner === 1
      ? { cls: 'lose', text: 'Lost the last battle — you stayed in place. Unused potions kept.' }
      : { cls: 'tie', text: 'Tied the last battle — you stayed in place. Unused potions kept.' };
  }
  state.battle = null;
  go('map');
}

function renderExtracted() {
  $screen.append(
    el('h2', {}, '🏁 Extracted!'),
    el('div', { class: 'banner win' }, `You reached an extraction point.\nRun complete with ${state.inventory.length + Object.keys(state.equipped).length} potion(s) left.`),
    el('div', { class: 'actions' }, [el('button', { class: 'primary', onclick: newRun }, 'New Run')]),
  );
}

// ─── Inventory bar ───────────────────────────────────────────────────────

function renderInventory() {
  const editable = canEquipNow();
  const pending = state.selected?.kind === 'item';
  const status = !editable ? 'Inventory is locked during battle.'
    : pending ? 'Now click a hero to equip it (it replaces any potion already on that hero).'
    : 'Click a potion, then a hero, to give that hero the ability. Each potion fires once, then it\'s used up. Win battles to earn more.';
  $inv.innerHTML = '';
  $inv.append(el('div', { class: 'inv-head' }, [
    el('b', {}, `🎒 Inventory (${state.inventory.length})`),
    el('span', { class: 'inv-status' }, status),
  ]));
  const row = el('div', { class: 'row' });
  if (!state.inventory.length) row.append(el('span', { class: 'inv-status' }, 'Empty.'));
  state.inventory.forEach((k, i) => {
    const sel = pending && state.selected.index === i;
    row.append(el('button', {
      class: `item ${sel ? 'pending' : ''}`,
      disabled: !editable,
      onclick: () => { state.selected = sel ? null : { kind: 'item', index: i }; render(); },
    }, [
      el('div', { class: 'iname' }, `${ABILITIES[k].icon} ${ABILITIES[k].name}`),
      el('div', { class: 'idesc' }, abilityDesc(k)),
    ]));
  });
  $inv.append(row);
}

newRun();
