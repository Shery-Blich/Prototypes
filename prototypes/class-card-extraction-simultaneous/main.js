import { CHARACTERS, CLASSES, TRIGGERS, ensureNextUid, makeCharacter, randomCharacterId } from './characters.js';
import { Battle } from './battle.js';
import { SimpleAudio } from '/src/shared/utils.js';
import { initEditor } from './editor.js';

const MIN_TEAM = 1;
const STARTING_ROSTER = 6;

// Team slots per side and camp size are gameplay modifiers (see MODIFIER_DEFAULTS).
const teamSlots = () => state.modifiers.playerSlots;
const enemySlots = () => state.modifiers.enemySlots;
const slotsFor = side => (side === 'player' ? teamSlots() : enemySlots());
const campMax = () => state.modifiers.campMax; // characters not in the team, at all times
const maxExpeditionLoadout = () => teamSlots() + campMax();

const campCount = () => state.roster.length - state.team.length;

const $ = id => document.getElementById(id);
const audio = new SimpleAudio();

const state = {
  stash: [],         // [{uid, id}] home stash cards
  roster: [],        // [{uid, id}] expedition loadout (team + camp)
  team: [],          // roster uids, index 0 = front
  selectedStashUids: new Set(), // selected cards on home screen
  battleNum: 1,
  wins: 0,
  losses: 0,
  enemy: [],         // [{id, atkBonus, hpBonus}]
  speed: 1,
  inBattle: false,
  screen: 'home',    // 'home' | 'prep' | 'battle'
  extractCountdown: null, // null = inactive, 2 = 2 battles left, 1 = 1 battle left
  previewKey: null,  // selected prep card: 'p<rosterUid>' or 'e<index>'
  modifiers: null,   // gameplay modifiers, see MODIFIER_DEFAULTS
  battlePreviewKey: null, // selected battle card: 'b<battle unit uid>'
  paused: false,     // battle is paused while a battle preview is open
};

// ---------- Gameplay modifiers ----------

const MODIFIER_DEFAULTS = {
  playerStartsPct: 50, // chance (0-100) that the player makes the first attack
  recruitsPerWin: 1,   // 0 = one random character of the defeated team, 1-10 = pick up to that many
  lossesPerDefeat: 1,  // 0 = one random character that fought, 1-10 = choose that many to lose (>= team size = all)
  playerSlots: 5,      // your team slots (1-10)
  enemySlots: 5,       // enemy team slots (1-10)
  campMax: 10,         // characters in camp (0-20)
};

// Stepper modifiers: range and description
const STEPPERS = {
  playerSlots: { min: 1, max: 10, desc: n => `Up to ${n} character${n === 1 ? '' : 's'} in your team. Lowering it sends the back of your team to camp.` },
  enemySlots: { min: 1, max: 10, desc: n => `Enemy teams start at ${Math.min(3, n)} and grow to ${n} character${n === 1 ? '' : 's'}.` },
  campMax: { min: 0, max: 20, desc: n => (n === 0 ? 'No camp: everyone you own is in your team.' : `Up to ${n} character${n === 1 ? '' : 's'} wait in camp. Lowering it below what's there asks you to discard.`) },
};

function loadModifiers() {
  try {
    const saved = JSON.parse(localStorage.getItem('cces-modifiers') || '{}');
    return { ...MODIFIER_DEFAULTS, ...saved };
  } catch {
    return { ...MODIFIER_DEFAULTS };
  }
}

function saveModifiers() {
  try { localStorage.setItem('cces-modifiers', JSON.stringify(state.modifiers)); } catch { /* not persisted */ }
}

function renderModifiers() {
  const pct = state.modifiers.playerStartsPct;
  $('mod-start-pct').value = pct;
  $('mod-start-val').textContent = `${pct}%`;
  $('mod-start-desc').textContent =
    pct === 100 ? 'Your abilities always trigger first.'
      : pct === 0 ? 'Enemy abilities always trigger first.'
        : `Your abilities trigger first ${pct}% of battles, enemy's ${100 - pct}%.`;
  $('mod-start-reset').disabled = pct === MODIFIER_DEFAULTS.playerStartsPct;

  const n = state.modifiers.recruitsPerWin;
  $('mod-recruits').value = n;
  $('mod-recruits-val').textContent = n === 0 ? 'Random' : n;
  $('mod-recruits-desc').textContent =
    n === 0 ? 'After a win, one random character of the defeated team offers to join.'
      : n >= enemySlots() ? 'After a win, you can take the entire defeated team (summons excluded).'
        : `After a win, pick up to ${n} character${n === 1 ? '' : 's'} of the defeated team.`;
  $('mod-recruits-reset').disabled = n === MODIFIER_DEFAULTS.recruitsPerWin;

  const l = state.modifiers.lossesPerDefeat;
  $('mod-losses').value = l;
  $('mod-losses-val').textContent = l === 0 ? 'Random' : l;
  $('mod-losses-desc').textContent =
    l === 0 ? 'After a defeat, one random character that fought is lost.'
      : l >= teamSlots() ? 'After a defeat, you lose all characters that fought.'
        : `After a defeat, choose ${l} character${l === 1 ? '' : 's'} that fought to lose.`;
  $('mod-losses-reset').disabled = l === MODIFIER_DEFAULTS.lossesPerDefeat;

  for (const [key, cfg] of Object.entries(STEPPERS)) {
    const v = state.modifiers[key];
    $(`mod-${key}-val`).textContent = v;
    $(`mod-${key}-desc`).textContent = cfg.desc(v);
    document.querySelector(`[data-step="${key}"][data-dir="-1"]`).disabled = v <= cfg.min;
    document.querySelector(`[data-step="${key}"][data-dir="1"]`).disabled = v >= cfg.max;
    document.querySelector(`[data-reset="${key}"]`).disabled = v === MODIFIER_DEFAULTS[key];
  }
}

// Changes a team-slot / camp-size modifier. A smaller team sends its back characters to camp;
// if the camp then holds too many, you pick which camp characters to discard (or cancel).
function setLimit(key, value) {
  const { min, max } = STEPPERS[key];
  value = Math.max(min, Math.min(max, value));
  if (value === state.modifiers[key]) return;
  const prev = { modifiers: { ...state.modifiers }, team: [...state.team] };
  state.modifiers[key] = value;
  if (state.team.length > teamSlots()) state.team = state.team.slice(0, teamSlots());

  const commit = () => {
    saveModifiers();
    fitEnemyToSlots();
    teamChanged();
    renderModifiers();
    if (state.screen === 'home') renderHome();
    else renderPrep();
  };

  if (state.screen === 'home') {
    const maxLoadout = maxExpeditionLoadout();
    if (state.selectedStashUids && state.selectedStashUids.size > maxLoadout) {
      const arr = [...state.selectedStashUids];
      state.selectedStashUids = new Set(arr.slice(0, maxLoadout));
    }
    commit();
    return;
  }

  const over = campCount() - campMax();
  if (over <= 0) { commit(); return; }
  pickDiscards(over, uids => {
    state.roster = state.roster.filter(r => !uids.includes(r.uid));
    commit();
  }, () => {
    state.modifiers = prev.modifiers;
    state.team = prev.team;
    renderModifiers();
    renderPrep();
  });
}

document.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
  const key = b.dataset.step;
  setLimit(key, state.modifiers[key] + Number(b.dataset.dir));
}));
document.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => {
  if (STEPPERS[b.dataset.reset]) setLimit(b.dataset.reset, MODIFIER_DEFAULTS[b.dataset.reset]);
}));

// Camp overflow: choose exactly `count` camp characters to discard.
function pickDiscards(count, onConfirm, onCancel) {
  const chosen = [];
  const camp = state.roster.filter(r => !state.team.includes(r.uid));
  const confirm = $('discard-confirm');
  const draw = () => {
    $('discard-text').textContent =
      `Your camp now holds ${campMax()} but has ${camp.length}. Choose ${count} to discard (${chosen.length}/${count} picked), or cancel the change.`;
    const row = $('discard-cards');
    row.innerHTML = '';
    for (const c of camp) {
      const d = CHARACTERS[c.id];
      const el = cardEl(c.id, d.atk, d.hp, { cls: 'discard-option' + (chosen.includes(c.uid) ? ' discarding' : '') });
      el.addEventListener('click', () => {
        const i = chosen.indexOf(c.uid);
        if (i >= 0) chosen.splice(i, 1);
        else { if (chosen.length >= count) chosen.shift(); chosen.push(c.uid); }
        draw();
      });
      row.appendChild(el);
    }
    confirm.disabled = chosen.length !== count;
    confirm.textContent = `Discard ${count}`;
  };
  const close = () => $('discard-overlay').classList.add('hidden');
  confirm.onclick = () => { close(); onConfirm([...chosen]); };
  $('discard-cancel').onclick = () => { close(); onCancel(); };
  $('discard-overlay').classList.remove('hidden');
  draw();
}

$('mod-recruits').addEventListener('input', e => {
  state.modifiers.recruitsPerWin = Number(e.target.value);
  saveModifiers();
  renderModifiers();
});
$('mod-recruits-reset').addEventListener('click', () => {
  state.modifiers.recruitsPerWin = MODIFIER_DEFAULTS.recruitsPerWin;
  saveModifiers();
  renderModifiers();
});

$('mod-losses').addEventListener('input', e => {
  state.modifiers.lossesPerDefeat = Number(e.target.value);
  saveModifiers();
  renderModifiers();
});
$('mod-losses-reset').addEventListener('click', () => {
  state.modifiers.lossesPerDefeat = MODIFIER_DEFAULTS.lossesPerDefeat;
  saveModifiers();
  renderModifiers();
});

$('mod-start-pct').addEventListener('input', e => {
  state.modifiers.playerStartsPct = Number(e.target.value);
  saveModifiers();
  renderModifiers();
});
$('mod-start-reset').addEventListener('click', () => {
  state.modifiers.playerStartsPct = MODIFIER_DEFAULTS.playerStartsPct;
  saveModifiers();
  renderModifiers();
});

state.modifiers = loadModifiers();

function rollFirstSide() {
  return Math.random() * 100 < state.modifiers.playerStartsPct ? 'player' : 'enemy';
}

// ---------- Stash & Base Management ----------

function generateRandomStash(count = 20) {
  return Array.from({ length: count }, () => makeCharacter(randomCharacterId()));
}

function loadStash() {
  try {
    const raw = localStorage.getItem('cces-stash');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let maxUid = 0;
        for (const c of parsed) {
          if (c && typeof c.uid === 'number' && c.uid > maxUid) maxUid = c.uid;
        }
        ensureNextUid(maxUid + 1);
        return parsed.filter(c => c && CHARACTERS[c.id]);
      }
    }
  } catch (err) {
    console.warn('Failed to load stash:', err);
  }
  return generateRandomStash(20);
}

function saveStash() {
  try {
    localStorage.setItem('cces-stash', JSON.stringify(state.stash));
  } catch (err) {
    console.warn('Failed to save stash:', err);
  }
}

function returnAllToStash() {
  if (state.roster && state.roster.length) {
    state.stash.push(...state.roster);
    state.roster = [];
    state.team = [];
  }
  state.extractCountdown = null;
  saveStash();
}

function moveModifiersPanel(targetSlotId) {
  const panel = $('modifiers-panel');
  const target = $(targetSlotId);
  if (panel && target && panel.parentElement !== target) {
    target.appendChild(panel);
  }
}

// ---------- Home Screen ----------

function showHome() {
  state.screen = 'home';
  state.inBattle = false;
  state.previewKey = null;
  state.extractCountdown = null;
  stopIdleCycle();

  $('home-screen').classList.remove('hidden');
  $('prep-screen').classList.add('hidden');
  $('battle-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  $('discard-overlay').classList.add('hidden');

  moveModifiersPanel('home-modifiers-slot');

  if (!state.selectedStashUids) {
    state.selectedStashUids = new Set();
  }
  // Remove uids no longer in stash
  const stashUids = new Set(state.stash.map(c => c.uid));
  for (const uid of state.selectedStashUids) {
    if (!stashUids.has(uid)) state.selectedStashUids.delete(uid);
  }

  // If no cards selected yet and stash has cards, auto-select up to loadout limit
  if (state.selectedStashUids.size === 0 && state.stash.length > 0) {
    const max = maxExpeditionLoadout();
    for (let i = 0; i < Math.min(state.stash.length, max); i++) {
      state.selectedStashUids.add(state.stash[i].uid);
    }
  }

  updateHud();
  renderModifiers();
  renderHome();
}

function renderHome() {
  updateHud();
  const max = maxExpeditionLoadout();
  const currentCount = state.selectedStashUids ? state.selectedStashUids.size : 0;

  $('loadout-count').textContent = currentCount;
  $('loadout-max').textContent = max;
  $('loadout-formula').textContent = `(Team slots: ${teamSlots()} + Camp size: ${campMax()})`;
  $('stash-count').textContent = state.stash.length;

  const btnGo = $('btn-go-expedition');
  btnGo.disabled = currentCount < MIN_TEAM;
  btnGo.textContent = currentCount < MIN_TEAM
    ? `Select at least ${MIN_TEAM} card`
    : `⚔️ Go Expedition (${currentCount} cards)`;

  const container = $('stash-cards');
  container.innerHTML = '';

  if (state.stash.length === 0) {
    container.innerHTML = '<div class="hint" style="padding:20px;font-size:15px;">Your stash is empty! Click "Restock +20" above to generate cards.</div>';
    return;
  }

  for (const c of state.stash) {
    const d = CHARACTERS[c.id];
    const isSelected = state.selectedStashUids.has(c.uid);
    const el = cardEl(c.id, d.atk, d.hp, {
      cls: 'stash-card clickable' + (isSelected ? ' selected' : ''),
    });

    if (isSelected) {
      const tag = document.createElement('div');
      tag.className = 'stash-loadout-tag';
      tag.textContent = '✓ LOADOUT';
      el.appendChild(tag);
    }

    el.addEventListener('click', () => {
      if (state.selectedStashUids.has(c.uid)) {
        state.selectedStashUids.delete(c.uid);
        audio.beep(400);
      } else {
        if (state.selectedStashUids.size >= maxExpeditionLoadout()) {
          audio.beep(250);
          return;
        }
        state.selectedStashUids.add(c.uid);
        audio.beep(550);
      }
      renderHome();
    });

    container.appendChild(el);
  }
}

function startExpedition() {
  const selectedUids = state.selectedStashUids;
  if (!selectedUids || selectedUids.size < MIN_TEAM) return;

  const selectedCards = state.stash.filter(c => selectedUids.has(c.uid));
  state.stash = state.stash.filter(c => !selectedUids.has(c.uid));
  saveStash();
  state.selectedStashUids.clear();

  state.roster = selectedCards;
  const initialTeamSize = Math.min(teamSlots(), state.roster.length);
  state.team = state.roster.slice(0, initialTeamSize).map(c => c.uid);

  state.battleNum = 1;
  state.wins = 0;
  state.losses = 0;
  state.extractCountdown = null;
  state.enemy = generateEnemy(1);

  showPrep();
}

// ---------- Run setup ----------

function newRun() {
  // Start with up to 6 characters that fit the team slots + camp; 3 in the team (more if the camp can't hold the rest).
  const start = Math.min(STARTING_ROSTER, teamSlots() + campMax());
  state.roster = Array.from({ length: start }, () => makeCharacter(randomCharacterId()));
  const teamSize = Math.max(Math.min(3, teamSlots()), start - campMax());
  state.team = state.roster.slice(0, teamSize).map(c => c.uid);
  state.battleNum = 1;
  state.wins = 0;
  state.losses = 0;
  state.enemy = generateEnemy(1);
  showPrep();
}

// Enemy teams grow from 3 characters (one more every 2 battles) up to the enemy team slots.
// Card stats always stay at base values as battles go on (no stat improvement over time).
const enemySize = n => Math.min(enemySlots(), 3 + Math.floor((n - 1) / 2));

function generateEnemy(n) {
  return Array.from({ length: enemySize(n) }, () => ({ id: randomCharacterId(), atkBonus: 0, hpBonus: 0 }));
}

// The enemy slots modifier changed: trim the next opponent, or top it up with new characters.
function fitEnemyToSlots() {
  const size = enemySize(state.battleNum);
  if (state.enemy.length > size) state.enemy = state.enemy.slice(0, size);
  while (state.enemy.length < size) state.enemy.push({ id: randomCharacterId(), atkBonus: 0, hpBonus: 0 });
}

// ---------- Trigger emojis ----------

// Wraps every trigger emoji (and shield icon) in `text` so hovering it shows its description.
function withTriggerTips(text) {
  for (const [key, t] of Object.entries(TRIGGERS)) {
    text = text.split(t.emoji).join(`<span class="trig" data-trigger="${key}">${t.emoji}</span>`);
  }
  // Bare 🛡 only: the Paladin's own emoji is 🛡️ (with a variation selector).
  return text.replace(/🛡(?!\uFE0F)/g, '<span class="trig" data-tip="shield">🛡</span>');
}

function triggerTipText(key) {
  const t = TRIGGERS[key];
  return `${t.emoji} <b>${t.name}</b>: ${t.note}`;
}

// Other hoverable icons (data-tip="<key>")
const TIPS = {
  shield: '🛡 <b>Shield</b>: blocks all damage from the next hit, then breaks.',
};

function renderTriggerLegend() {
  $('trigger-legend').innerHTML = Object.entries(TRIGGERS)
    .map(([key, t]) => `<span class="legend-item" data-trigger="${key}"><span class="trig">${t.emoji}</span> ${t.name}</span>`)
    .join('');
}

function renderClassLegend() {
  $('class-legend').innerHTML = Object.entries(CLASSES)
    .map(([key, c]) =>
      `<span class="class-legend-item" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${c.label}</span>`)
    .join('');
}

// One shared tooltip for any element with data-trigger (HTML or SVG), wherever it is.
function initTriggerTips() {
  const tip = $('trigger-tip');
  document.addEventListener('mouseover', e => {
    const el = e.target.closest?.('[data-trigger], [data-tip]');
    if (!el) { tip.classList.add('hidden'); return; }
    tip.innerHTML = el.dataset.trigger ? triggerTipText(el.dataset.trigger) : TIPS[el.dataset.tip];
    tip.classList.remove('hidden');
  });
  document.addEventListener('mousemove', e => {
    if (tip.classList.contains('hidden')) return;
    const w = tip.offsetWidth;
    const x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${e.clientY + 18}px`;
  });
}

// ---------- Cards ----------

function cardEl(id, atk, hp, opts = {}) {
  const def = CHARACTERS[id];
  const cls = def.class || null;
  const clsDef = cls ? CLASSES[cls] : null;
  const el = document.createElement('div');
  el.className = 'card'
    + (def.token ? ' token' : '')
    + (cls ? ` class-${cls}` : '')
    + (opts.cls ? ' ' + opts.cls : '');
  el.innerHTML = `
    ${clsDef ? `<div class="class-badge" style="background:${clsDef.color}22;color:${clsDef.color};border:1px solid ${clsDef.color}55">${clsDef.label}</div>` : ''}
    <div class="card-emoji">${def.emoji}</div>
    <div class="card-name">${def.name}</div>
    <div class="card-text">${def.text ? withTriggerTips(def.text) : '<i>Summoned token</i>'}</div>
    <div class="card-stats">
      <span class="stat atk">⚔ <b class="atk-val">${atk}</b></span>
      <span class="shield-icon trig" data-tip="shield">🛡</span>
      <span class="stat hp">❤ <b class="hp-val">${hp}</b></span>
    </div>`;
  // On the character emoji only, so it doesn't stack with the trigger emoji tooltip.
  el.querySelector('.card-emoji').title = def.text;
  return el;
}

function updateHud() {
  if (state.screen === 'home') {
    $('hud-battle').textContent = 'Base';
    $('hud-wins').textContent = '0';
    $('hud-losses').textContent = '0';
    $('hud-roster').textContent = '--';
    $('hud-extract-status').textContent = 'At Base';
    $('hud-extract-status').className = '';
    $('hud-stash-count').textContent = state.stash ? state.stash.length : 0;
    $('btn-evac-base').classList.add('hidden');
    return;
  }

  $('hud-battle').textContent = state.battleNum;
  $('hud-wins').textContent = state.wins;
  $('hud-losses').textContent = state.losses;
  $('hud-roster').textContent = `${campCount()}/${campMax()}`;
  $('hud-stash-count').textContent = state.stash ? state.stash.length : 0;
  $('btn-evac-base').classList.toggle('hidden', state.inBattle);

  const extractEl = $('hud-extract-status');
  if (state.extractCountdown === null) {
    extractEl.textContent = 'Not active';
    extractEl.className = '';
  } else if (state.extractCountdown === 2) {
    extractEl.textContent = 'In 2 battles';
    extractEl.className = 'hud-extract-active';
  } else if (state.extractCountdown === 1) {
    extractEl.textContent = 'In 1 battle!';
    extractEl.className = 'hud-extract-urgent';
  }
}

// ---------- Prep screen ----------

function showPrep() {
  state.screen = 'prep';
  state.inBattle = false;
  $('home-screen').classList.add('hidden');
  $('prep-screen').classList.remove('hidden');
  $('battle-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  $('discard-overlay').classList.add('hidden');
  moveModifiersPanel('prep-modifiers-slot');
  renderModifiers();
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
  // Panel widths follow card counts (at least 2 so headers and buttons keep some room).
  document.querySelector('.panel-team').style.setProperty('--slots', Math.max(2, teamSlots()));
  document.querySelector('.panel-enemy').style.setProperty('--slots', Math.max(2, state.enemy.length));
  for (let i = 0; i < teamSlots(); i++) {
    const uid = state.team[i];
    if (uid === undefined) {
      const empty = document.createElement('div');
      empty.className = 'card empty';
      empty.textContent = i === 0 ? 'Front' : `Slot ${i + 1}`;
      dropTarget(empty, () => true, d => {
        if (d.from === 'team') state.team.splice(state.team.indexOf(d.uid), 1);
        state.team.push(d.uid);
      });
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
      ctrlBtn('✕', campCount() >= campMax() ? 'Camp is full' : 'Back to camp', campCount() < campMax(),
        () => { state.team.splice(i, 1); teamChanged(); renderPrep(); }),
      ctrlBtn('▶', 'Move forward', i > 0, () => swap(i, i - 1)),
    );
    el.appendChild(ctrls);
    makeDraggable(el, 'team', uid);
    // Camp card dropped here: swap (this one goes to camp). Team card: swap the two slots.
    dropTarget(el, d => d.uid !== uid, d => {
      if (d.from === 'camp') state.team[i] = d.uid;
      else swap(state.team.indexOf(d.uid), i, false);
    });
    lineup.player.push(previewable(el, `p${uid}`, 'player', c.id, d.atk, d.hp));
    teamRow.appendChild(el);
  }

  // Camp: everyone not in the team
  const campRow = $('roster');
  campRow.innerHTML = '';
  for (const c of state.roster.filter(r => !state.team.includes(r.uid))) {
    const d = CHARACTERS[c.id];
    const el = cardEl(c.id, d.atk, d.hp, { cls: 'clickable' });
    el.addEventListener('click', () => {
      if (state.team.length >= teamSlots()) return;
      state.team.push(c.uid);
      teamChanged();
      audio.beep(520);
      renderPrep();
    });
    makeDraggable(el, 'camp', c.uid);
    campRow.appendChild(el);
  }
  if (!campRow.children.length) campRow.innerHTML = '<span class="hint">The camp is empty.</span>';
  $('camp-count').textContent = `${campCount()}/${campMax()}`;

  const n = state.team.length;
  const ok = n >= MIN_TEAM && n <= teamSlots();
  $('btn-fight').disabled = !ok;
  $('fight-hint').textContent = ok
    ? `${n} character${n > 1 ? 's' : ''} at risk`
    : `Pick at least ${MIN_TEAM} character${MIN_TEAM > 1 ? 's' : ''}`;

  fitRows();
  if (!showAbilityPreview(lineup, state.previewKey, prepUi())) state.previewKey = null;
}

// ---------- Ability preview (prep and battle screens) ----------

const prepUi = () => ({ info: $('preview-info'), svg: $('preview-arrows'), host: $('prep-screen') });
const battleUi = () => ({ info: $('battle-preview-info'), svg: $('battle-arrows'), host: $('battle-screen') });

// Clicking a lineup card selects it; clicking it again (or another card) ends/switches the preview.
function previewable(el, key, side, id, atk, hp) {
  el.classList.add('selectable');
  el.addEventListener('click', () => {
    state.previewKey = state.previewKey === key ? null : key;
    renderPrep();
  });
  return { el, key, side, id, atk, hp };
}

// Draws the preview of the card with `key` (lineup: { player: [...], enemy: [...] } of
// { el, key, side, id, atk, hp }). Returns false (and draws nothing) if that card isn't there.
function showAbilityPreview(lineup, key, ui) {
  const { info } = ui;
  const all = [...lineup.player, ...lineup.enemy];
  const self = all.find(u => u.key === key);
  if (!self) {
    info.classList.add('hidden');
    drawArrows(null, [], null, ui);
    return false;
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
      // It dies first, so the team has one more free slot than now.
      const room = slotsFor(self.side) - (team.length - 1);
      const shown = Math.min(fx.count, room);
      const d = CHARACTERS[fx.summon];
      for (let k = 0; k < shown; k++) {
        arrows.push({ el: addSummonGhost(self, fx.summon), label: `+${d.emoji} ${d.atk}/${d.hp}`, cls: 'help' });
      }
      if (shown < fx.count) extra += ` Team is full: ${fx.count - shown} at the back wait${fx.count - shown === 1 ? 's' : ''} off-screen until there's room.`;
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
  const trig = TRIGGERS[def.trigger];
  if (def.trigger === 'death') extra = ' Shown as if it dies in its current slot.' + extra;
  info.innerHTML = withTriggerTips(`<b>${def.emoji} ${def.name}</b> (${slot}): ${def.text} <span class="hint">${trig.emoji} ${trig.name}: ${trig.note}${extra}</span>`);
  info.classList.remove('hidden');
  drawArrows(self.el, arrows, def.trigger, ui);
  return true;
}

function effectLabel(fx) {
  if (fx.reorder) return fx.reorder === 'push-last' ? '⬇ Last' : '⬆ Front';
  const atk = fx.atk || 0, hp = fx.hp || 0;
  const sign = n => (n > 0 ? `+${n}` : `${n}`);
  let text;
  if (fx.shield) text = '+🛡';
  else if (atk && hp) text = `${sign(atk)}/${sign(hp)}`;
  else if (atk) text = `${sign(atk)} ⚔`;
  else text = `${sign(hp)} ❤`;
  return fx.random ? `${text} ?` : text;
}

// Curved arrows from the selected card to everything it affects, all leaving its upper-left
// corner where a single trigger emoji badge sits, with the amount under each tip. `source` is a
// card element, or a remembered DOMRect for a card that already left the arena.
// Returns { paths, badge: { circle, text } }.
function drawArrows(source, arrows, trigger, ui) {
  const { svg } = ui;
  svg.innerHTML = '';
  // Cards past the slot limit are hidden (see view.render): no arrows to or from them
  if (isOverSlot(source)) return { paths: [], badge: null };
  arrows = arrows.filter(a => !isOverSlot(a.el));
  if (!source || !arrows.length) return { paths: [], badge: null };
  fitRows(); // card sizes must be final before positions are measured

  const host = ui.host.getBoundingClientRect();
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
    for (const [k, v] of Object.entries({ id: `${svg.id}-head-${cls}`, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' })) m.setAttribute(k, v);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    path.setAttribute('class', `arrowhead ${cls}`);
    m.appendChild(path);
    defs.appendChild(m);
  }

  const src = source instanceof Element ? source.getBoundingClientRect() : source;
  const sx = src.left + 18 - host.left; // upper-left corner
  const sy = src.top - host.top;
  const GAP = 24; // space between arrow tip and the target card's top (label sits there)
  const paths = [];

  for (const a of arrows) {
    const r = a.el.getBoundingClientRect();
    const tx = r.left + r.width / 2 - host.left;
    const ty = r.top - host.top - GAP;
    let d;
    if (a.el === source) {
      // Self: loop from the upper-left corner over the card, landing on its upper-right
      const x2 = r.right - host.left - 18;
      d = `M${sx},${sy} C${sx - 10},${sy - 70} ${x2 + 10},${sy - 70} ${x2},${ty}`;
    } else {
      const lift = 40 + Math.abs(tx - sx) * 0.18;
      const cy = Math.min(sy, ty) - lift;
      d = `M${sx},${sy} Q${(sx + tx) / 2},${cy} ${tx},${ty}`;
    }
    paths.push(mk('path', { d, class: `arrow ${a.cls}`, 'marker-end': `url(#${svg.id}-head-${a.cls})` }));
    const label = mk('text', { x: tx, y: ty + 15, class: `arrow-label ${a.cls}`, 'text-anchor': 'middle' });
    label.textContent = a.label;
  }

  // Drawn last so the badge sits on top of the arrows.
  const circle = mk('circle', { cx: sx, cy: sy, r: 15, class: 'trigger-badge', 'data-trigger': trigger });
  const text = mk('text', { x: sx, y: sy + 1, class: 'trigger-emoji', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-trigger': trigger });
  text.textContent = TRIGGERS[trigger].emoji;
  return { paths, badge: { circle, text } };
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
  if (fx.reorder) {
    u.el.classList.add('preview-help');
    return;
  }
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

// Any change to the team composition or order ends the preview (cycle and shown card).
function teamChanged() {
  stopIdleCycle();
  state.previewKey = null;
}

function swap(i, j, render = true) {
  [state.team[i], state.team[j]] = [state.team[j], state.team[i]];
  teamChanged();
  if (render) renderPrep();
}

// ---------- Keeping card rows on one line ----------
// Every card row stays a single line and all rows share one card scale (CSS zoom, so stats and
// emoji scale with them), so a card is the same size in prep and in battle. The scale is the
// largest one at which every row on both screens fits, capped at MAX_ZOOM. Small cards hide their ability text.

const CARD_W = 104;
const ROW_GAP = 10;
const MAX_ZOOM = 1.6;

// Zoom at which n cards fill the row, or null if there's nothing to fit
function rowFit(row, n) {
  const avail = row.clientWidth;
  if (!avail || !n) return null;
  return (avail - ROW_GAP * (n - 1)) / (CARD_W * n);
}

// Row widths don't depend on their cards, so the hidden screen is briefly un-hidden to measure it
// (synchronously, so it's never painted).
function fitRows() {
  const screens = [$('prep-screen'), $('battle-screen')];
  const hidden = screens.filter(el => el.classList.contains('hidden'));
  hidden.forEach(el => el.classList.remove('hidden'));
  const fits = [
    rowFit($('team-slots'), $('team-slots').querySelectorAll(':scope > .card').length),
    rowFit($('enemy-preview'), $('enemy-preview').querySelectorAll(':scope > .card').length),
    // Battle rows reserve room for the side's full slot count, so cards don't resize as units die.
    rowFit($('battle-player'), teamSlots()),
    rowFit($('battle-enemy'), enemySlots()),
  ].filter(z => z !== null);
  hidden.forEach(el => el.classList.add('hidden'));
  if (!fits.length) return;
  const zoom = Math.max(0.3, Math.min(MAX_ZOOM, ...fits));
  $('app').style.setProperty('--card-zoom', zoom.toFixed(3));
  $('app').classList.toggle('compact-cards', zoom < 0.8);
}

window.addEventListener('resize', fitRows);

// ---------- Drag and drop (prep) ----------
// Camp cards onto a team card swap with it (works with a full camp, the count doesn't change),
// onto an empty slot join the team; team cards reorder, or go back to camp if it has room.

let drag = null; // { from: 'camp' | 'team', uid }

function makeDraggable(el, from, uid) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    drag = { from, uid };
    stopIdleCycle();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(uid));
    setCardDragImage(e, el);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    drag = null;
    el.classList.remove('dragging');
    document.querySelectorAll('.drop-ok').forEach(x => x.classList.remove('drop-ok'));
    resetIdle();
  });
}

// Drag image = a clean off-screen copy of just this card (the browser's own snapshot of a
// transformed card can grab the surrounding UI instead).
function setCardDragImage(e, el) {
  const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.querySelectorAll('.card-ctrls, .front-tag, .pv-badge').forEach(x => x.remove());
  ghost.classList.remove('preview-source', 'preview-help', 'preview-harm', 'selectable', 'clickable');
  Object.assign(ghost.style, {
    // No explicit size: the row's styles (incl. its card zoom) size it like the original.
    position: 'fixed', top: '-1000px', left: '-1000px', transform: 'none', margin: '0', pointerEvents: 'none',
  });
  el.parentElement.appendChild(ghost); // same row, so the same card styles apply
  e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top);
  setTimeout(() => ghost.remove(), 0);
}

// canDrop(drag) decides if `el` accepts the dragged card; onDrop(drag) updates state.team.
function dropTarget(el, canDrop, onDrop) {
  el.addEventListener('dragover', e => {
    if (!drag || !canDrop(drag)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drop-ok');
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-ok');
  });
  el.addEventListener('drop', e => {
    if (!drag || !canDrop(drag)) return;
    e.preventDefault();
    e.stopPropagation();
    const d = drag;
    drag = null;
    onDrop(d);
    teamChanged();
    audio.beep(520);
    renderPrep();
  });
}

dropTarget($('camp-panel'), d => d.from === 'team' && campCount() < campMax(),
  d => state.team.splice(state.team.indexOf(d.uid), 1));

// ---------- Battle view ----------

const cardMap = new Map(); // battle unit uid -> element
const lastRects = new Map(); // battle unit uid -> where its card was when it left the arena
let currentBattle = null;
let resumeWaiters = [];

// Undo everything a battle preview added to the arena (ghost cards, badges, highlights).
function clearBattlePreview() {
  const arena = document.querySelector('.arena');
  arena.querySelectorAll('.preview-summon, .pv-badge').forEach(e => e.remove());
  arena.querySelectorAll('.card').forEach(e => e.classList.remove('preview-source', 'preview-help', 'preview-harm', 'preview-faints'));
  arena.querySelectorAll('.stat-up, .stat-down').forEach(e => e.classList.remove('stat-up', 'stat-down'));
  $('battle-preview-info').classList.add('hidden');
  $('battle-arrows').innerHTML = '';
}

function showBattlePreview(battle) {
  const lineup = {};
  for (const side of ['player', 'enemy']) {
    lineup[side] = battle.teams[side].map(u => ({
      el: cardMap.get(u.uid), key: `b${u.uid}`, side, id: u.id, atk: u.atk, hp: Math.max(0, u.hp),
    }));
  }
  // The previewed character is gone (died): close the preview and resume.
  if (!showAbilityPreview(lineup, state.battlePreviewKey, battleUi())) closeBattlePreview();
}

function toggleBattlePreview(key) {
  state.battlePreviewKey = state.battlePreviewKey === key ? null : key;
  setPaused(!!state.battlePreviewKey);
  if (currentBattle) view.render(currentBattle);
}

function closeBattlePreview() {
  state.battlePreviewKey = null;
  setPaused(false);
  clearBattlePreview();
}

function setPaused(p) {
  state.paused = p;
  $('pause-label').classList.toggle('hidden', !p);
  // The preview takes over while paused; a running effect animation is hidden until resume.
  $('effect-arrows').classList.toggle('hidden', p);
  if (!p) { resumeWaiters.forEach(r => r()); resumeWaiters = []; }
}

const isOverSlot = el => el instanceof Element && el.classList.contains('over-slot');

const view = {
  render(battle) {
    clearBattlePreview();
    for (const side of ['player', 'enemy']) {
      const row = $(side === 'player' ? 'battle-player' : 'battle-enemy');
      const units = battle.display(side);
      const keep = new Set(units.map(u => u.uid));
      for (const [uid, el] of cardMap) {
        if (el.parentElement === row && !keep.has(uid)) {
          lastRects.set(uid, el.getBoundingClientRect());
          el.remove();
          cardMap.delete(uid);
        }
      }
      units.forEach((u, i) => {
        let el = cardMap.get(u.uid);
        if (!el) {
          el = cardEl(u.id, u.atk, u.hp, { cls: 'selectable' });
          el.addEventListener('click', () => toggleBattlePreview(`b${u.uid}`));
          cardMap.set(u.uid, el);
        }
        el.querySelector('.atk-val').textContent = u.atk;
        el.querySelector('.hp-val').textContent = Math.max(0, u.hp);
        el.classList.toggle('shielded', u.shield);
        el.classList.toggle('front', u === battle.teams[side][0]);
        el.classList.toggle('doomed', battle.isLingering(u));
        // More cards than slots (e.g. summons while a dying card still lingers): the extras at the
        // back stay hidden until there's room for them again.
        el.classList.toggle('over-slot', i >= battle.maxTeam[side]);
        if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
      });
    }
    fitRows();
    if (state.battlePreviewKey) showBattlePreview(battle);
  },
  float(u, text, cls) {
    const el = cardMap.get(u.uid);
    if (!el) return;
    const f = document.createElement('div');
    f.className = `float ${cls}`;
    f.innerHTML = withTriggerTips(text);
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
    line.innerHTML = withTriggerTips(msg);
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  },
  turn(text) {
    $('turn-label').textContent = text;
    this.log(`— ${text} —`);
  },
  // Shows an ability's actual effect with the preview's UI: arrows appear at once from `src`
  // to each target, then each arrow's tail (with the trigger badge) slides along it into its
  // target. Resolves when it arrives; the caller then applies the effect.
  // items: [{ unit, fx: { atk?, hp?, shield? } } | { unit, label }] (label = custom, e.g. summons)
  async effect(src, items) {
    if (state.speed >= 1000) return; // skipping
    const source = cardMap.get(src.uid) || lastRects.get(src.uid);
    items = items.filter(it => cardMap.get(it.unit.uid) && !isOverSlot(cardMap.get(it.unit.uid)));
    if (!source || !items.length) return;

    const arrows = items.map(it => {
      const el = cardMap.get(it.unit.uid);
      if (it.fx) {
        applyPreview({ el, atk: it.unit.atk, hp: Math.max(0, it.unit.hp) }, it.fx);
        const harm = (it.fx.atk || 0) < 0 || (it.fx.hp || 0) < 0;
        return { el, label: effectLabel(it.fx), cls: harm ? 'harm' : 'help' };
      }
      el.classList.add('preview-help');
      return { el, label: it.label, cls: 'help' };
    });
    if (source instanceof Element) source.classList.add('preview-source');

    const ui = { svg: $('effect-arrows'), host: $('battle-screen') };
    const drawn = drawArrows(source, arrows, src.def.trigger, ui);
    await snakeArrows(drawn, 250, 700);
    ui.svg.innerHTML = '';
    if (source instanceof Element) source.classList.remove('preview-source');
  },
  // Also holds the battle here while it's paused for a preview.
  async wait(ms) {
    await new Promise(r => setTimeout(r, ms / state.speed));
    while (state.paused) await new Promise(r => resumeWaiters.push(r));
  },
};

// Holds the arrows for `holdMs`, then over `travelMs` shortens each from its start so the tail
// slides along the curve into the tip, while the shared trigger badge at the base fades out.
// Time stops while paused.
function snakeArrows({ paths, badge }, holdMs, travelMs) {
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
      if (!state.paused) elapsed += (now - last) * Math.min(state.speed, 8);
      last = now;
      if (state.speed >= 1000) elapsed = holdMs + travelMs;
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
      if (badge) {
        badge.circle.style.opacity = 1 - eased;
        badge.text.style.opacity = 1 - eased;
      }
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function setSpeed(s) {
  state.speed = s;
  document.querySelectorAll('.speed').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === s));
}

// Big arrow above the arena showing who triggers abilities first (it's rolled, so make it obvious).
function showFirstBanner(side) {
  const b = $('first-banner');
  b.className = `first-banner ${side}`;
  b.innerHTML = side === 'player'
    ? '<span class="fb-text">YOU TRIGGER FIRST</span><span class="fb-arrow">➜</span>'
    : '<span class="fb-arrow">⬅</span><span class="fb-text">ENEMY TRIGGERS FIRST</span>';
  void b.offsetWidth; // restart the pop-in animation
  b.classList.add('pop');
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
  lastRects.clear();
  $('effect-arrows').innerHTML = '';
  closeBattlePreview();
  setSpeed(state.speed > 4 ? 1 : state.speed);

  const firstSide = rollFirstSide();
  showFirstBanner(firstSide);
  view.log(`🎲 ${firstSide === 'player' ? 'Your abilities' : 'Enemy abilities'} trigger first (${state.modifiers.playerStartsPct}% chance you start)`);
  const battle = new Battle(participants, state.enemy, view, {
    firstSide, maxTeam: { player: teamSlots(), enemy: enemySlots() },
  });
  currentBattle = battle;
  const result = await battle.run();
  await view.wait(500);
  closeBattlePreview();
  currentBattle = null;
  showResult(result, participants);
}

// ---------- Results ----------

function showResult(result, participants) {
  const title = $('result-title');
  const cards = $('result-cards');
  const btn = $('btn-continue');
  const defeated = state.enemy;
  cards.innerHTML = '';
  title.className = result;
  btn.disabled = false;
  $('btn-skip-recruit').classList.add('hidden');
  $('btn-extract').classList.add('hidden');
  $('btn-return-home').classList.add('hidden');
  $('result-discard-wrap').classList.add('hidden');
  $('result-squad-preview').classList.add('hidden');

  state.battleNum++;
  state.enemy = generateEnemy(state.battleNum);

  if (result === 'win') {
    state.wins++;
    title.textContent = 'Victory!';
    audio.score();
    showRecruit(defeated);
  } else {
    state.losses++;
    title.textContent = 'Defeat';
    audio.explosion();
    showDefeat(participants);
  }
  updateHud();
  $('result-overlay').classList.remove('hidden');
}

function showDefeat(participants) {
  $('result-squad-preview').classList.add('hidden');
  const limit = state.modifiers.lossesPerDefeat;
  const allLost = limit >= participants.length;
  const random = limit === 0;
  const count = allLost ? participants.length : (random ? 1 : Math.min(limit, participants.length));

  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btn = $('btn-continue');
  cards.innerHTML = '';

  const finishDefeat = lostUids => {
    const lostSet = new Set(lostUids);
    state.roster = state.roster.filter(r => !lostSet.has(r.uid));
    state.team = state.team.filter(uid => !lostSet.has(uid));
    updateHud();
  };

  if (allLost) {
    const lostUids = participants.map(p => p.uid);
    text.textContent = `You lost all ${participants.length} character${participants.length === 1 ? '' : 's'} that fought:`;
    for (const p of participants) {
      const d = CHARACTERS[p.id];
      cards.appendChild(cardEl(p.id, d.atk, d.hp, { cls: 'lost' }));
    }
    btn.disabled = false;
    btn.textContent = 'Confirm Loss ▶';
    btn.onclick = () => {
      finishDefeat(lostUids);
      onPostCardChoice('lose');
    };
    return;
  }

  if (random) {
    const pickIndex = Math.floor(Math.random() * participants.length);
    const lostUnit = participants[pickIndex];
    text.textContent = `You lost 1 random character that fought (${participants.length - 1} survived):`;
    for (const p of participants) {
      const d = CHARACTERS[p.id];
      const isLost = p.uid === lostUnit.uid;
      const el = cardEl(p.id, d.atk, d.hp, { cls: isLost ? 'lost discarding' : '' });
      const tag = frontTag();
      tag.textContent = isLost ? 'LOST' : 'SURVIVED';
      tag.style.background = isLost ? '#ef4444' : '#22c55e';
      tag.style.color = isLost ? '#ffffff' : '#052e16';
      el.appendChild(tag);
      cards.appendChild(el);
    }
    btn.disabled = false;
    btn.textContent = 'Confirm Loss ▶';
    btn.onclick = () => {
      finishDefeat([lostUnit.uid]);
      onPostCardChoice('lose');
    };
    return;
  }

  // Interactive pick: choose `count` characters that fought to lose
  const chosen = [];
  const draw = () => {
    text.textContent = `Defeat! Choose ${count} character${count === 1 ? '' : 's'} that fought to lose (${chosen.length}/${count} picked):`;
    cards.innerHTML = '';
    participants.forEach(p => {
      const d = CHARACTERS[p.id];
      const isChosen = chosen.includes(p.uid);
      const el = cardEl(p.id, d.atk, d.hp, { cls: 'discard-option' + (isChosen ? ' discarding' : '') });
      const tag = frontTag();
      tag.textContent = isChosen ? 'LOSE' : 'KEEP';
      tag.style.background = isChosen ? '#ef4444' : '#22c55e';
      tag.style.color = isChosen ? '#ffffff' : '#052e16';
      el.appendChild(tag);
      el.addEventListener('click', () => {
        const i = chosen.indexOf(p.uid);
        if (i >= 0) chosen.splice(i, 1);
        else {
          if (chosen.length >= count) chosen.shift();
          chosen.push(p.uid);
        }
        draw();
      });
      cards.appendChild(el);
    });

    const ready = chosen.length === count;
    btn.disabled = !ready;
    btn.textContent = ready ? 'Confirm Loss ▶' : `Choose ${count} to lose`;
  };

  btn.onclick = () => {
    finishDefeat(chosen);
    onPostCardChoice('lose');
  };

  draw();
}

// Preview player's current squad (team slots and camp) during card recruit selection
function renderSquadPreview() {
  const previewWrap = $('result-squad-preview');
  if (!previewWrap) return;

  $('preview-team-count').textContent = state.team.length;
  $('preview-team-max').textContent = teamSlots();
  $('preview-camp-count').textContent = campCount();
  $('preview-camp-max').textContent = campMax();

  // Team slots preview (slot 0 is front, displayed on right)
  const teamRow = $('preview-team-slots');
  teamRow.innerHTML = '';
  for (let i = 0; i < teamSlots(); i++) {
    const uid = state.team[i];
    if (uid === undefined) {
      const empty = document.createElement('div');
      empty.className = 'card empty preview-empty-slot';
      empty.innerHTML = `<span>${i === 0 ? 'Front' : `Slot ${i + 1}`}</span><span class="hint">Open</span>`;
      teamRow.appendChild(empty);
      continue;
    }
    const c = state.roster.find(r => r.uid === uid);
    if (!c) continue;
    const d = CHARACTERS[c.id];
    const el = cardEl(c.id, d.atk, d.hp);
    const tag = frontTag();
    tag.textContent = i === 0 ? 'FRONT (1)' : `SLOT ${i + 1}`;
    if (i !== 0) {
      tag.style.background = '#475569';
      tag.style.color = '#f1f5f9';
    }
    el.appendChild(tag);
    teamRow.appendChild(el);
  }

  // Camp preview
  const campRow = $('preview-camp-slots');
  campRow.innerHTML = '';
  const campCards = state.roster.filter(r => !state.team.includes(r.uid));
  if (campCards.length === 0) {
    campRow.innerHTML = '<span class="hint squad-empty-hint">Camp is empty. Recruited cards will wait here if team is full.</span>';
  } else {
    for (const c of campCards) {
      const d = CHARACTERS[c.id];
      const el = cardEl(c.id, d.atk, d.hp);
      const tag = document.createElement('div');
      tag.className = 'front-tag';
      tag.textContent = 'CAMP';
      tag.style.background = '#334155';
      tag.style.color = '#cbd5e1';
      el.appendChild(tag);
      campRow.appendChild(el);
    }
  }

  previewWrap.classList.remove('hidden');
}

// Victory reward: recruit up to `recruitsPerWin` characters of the defeated team (base stats,
// never summons), or skip. 0 = one random character of the defeated team, take it or skip.
// Recruits fill the camp first, then free team slots. If there isn't room for all of them,
// exactly that many of your own characters must be discarded; recruits take their places.
function showRecruit(defeated) {
  const limit = state.modifiers.recruitsPerWin;
  const random = limit === 0;
  const maxPicks = random ? 1 : Math.min(limit, defeated.length);
  const picks = random ? [Math.floor(Math.random() * defeated.length)] : []; // indexes into defeated
  const discards = []; // own uids
  const room = (campMax() - campCount()) + (teamSlots() - state.team.length);
  const btn = $('btn-continue');
  const skip = $('btn-skip-recruit');
  const nameOf = id => `${CHARACTERS[id].emoji} ${CHARACTERS[id].name}`;
  // Click toggles; at the limit, a new pick replaces the oldest one (so a limit of 1 just switches).
  const toggle = (list, v, max) => {
    const i = list.indexOf(v);
    if (i >= 0) { list.splice(i, 1); return; }
    if (max <= 0) return;
    if (list.length >= max) list.shift();
    list.push(v);
  };

  const draw = () => {
    const needDiscard = Math.max(0, picks.length - room);
    if (discards.length > needDiscard) discards.length = needDiscard;
    const roomText = `Room: ${room} (camp ${campCount()}/${campMax()}, team ${state.team.length}/${teamSlots()}).`;
    $('result-text').textContent = (random
      ? 'Your team survives. A random character from the defeated team wants to join. Take it or skip.'
      : `Your team survives. Pick up to ${maxPicks} character${maxPicks === 1 ? '' : 's'} from the defeated team (${picks.length}/${maxPicks} picked), or skip.`)
      + ` ${roomText}` + (needDiscard ? ` Discard ${needDiscard} of yours to make room.` : '');

    const cards = $('result-cards');
    cards.innerHTML = '';
    defeated.forEach((e, i) => {
      if (random && i !== picks[0]) return;
      const d = CHARACTERS[e.id];
      const el = cardEl(e.id, d.atk, d.hp, { cls: 'recruit-option' + (picks.includes(i) ? ' picked' : '') });
      if (!random) el.addEventListener('click', () => { toggle(picks, i, maxPicks); draw(); });
      cards.appendChild(el);
    });

    // Render team slots & camp preview below the available cards
    renderSquadPreview();

    $('result-discard-wrap').classList.toggle('hidden', !needDiscard);
    $('result-discard-label').textContent = `Discard ${needDiscard} of yours (${discards.length}/${needDiscard} picked):`;
    if (needDiscard) {
      const own = $('result-discard');
      own.innerHTML = '';
      for (const c of state.roster) {
        const d = CHARACTERS[c.id];
        const el = cardEl(c.id, d.atk, d.hp, { cls: 'discard-option' + (discards.includes(c.uid) ? ' discarding' : '') });
        if (state.team.includes(c.uid)) {
          const tag = frontTag();
          tag.textContent = 'TEAM';
          el.appendChild(tag);
        }
        el.addEventListener('click', () => { toggle(discards, c.uid, needDiscard); draw(); });
        own.appendChild(el);
      }
    }

    const recruitText = picks.length === 1 ? nameOf(defeated[picks[0]].id) : `${picks.length} characters`;
    const discardText = discards.length === 1
      ? nameOf(state.roster.find(r => r.uid === discards[0]).id)
      : `${discards.length} characters`;
    btn.textContent = !picks.length ? 'Recruit'
      : `Recruit ${recruitText}` + (needDiscard && discards.length === needDiscard ? `, discard ${discardText}` : '');
    btn.disabled = !picks.length || discards.length !== needDiscard;
  };

  btn.onclick = () => {
    // Discarded team members leave a hole (null) for a recruit to fill in the same slot.
    const freed = [];
    for (const uid of discards) {
      state.roster = state.roster.filter(r => r.uid !== uid);
      const slot = state.team.indexOf(uid);
      if (slot >= 0) { state.team[slot] = null; freed.push(slot); }
    }
    const teamSize = () => state.team.filter(u => u !== null).length;
    for (const i of picks) {
      const recruit = makeCharacter(defeated[i].id);
      const inCamp = state.roster.length - teamSize();
      if (inCamp < campMax()) { /* goes to camp */ }
      else if (freed.length) state.team[freed.shift()] = recruit.uid;
      else state.team.push(recruit.uid);
      state.roster.push(recruit);
    }
    state.team = state.team.filter(u => u !== null);
    onPostCardChoice('win');
  };
  skip.onclick = () => onPostCardChoice('win');
  skip.classList.remove('hidden');
  draw();
}

function onPostCardChoice(lastResult) {
  updateHud();

  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btnContinue = $('btn-continue');
  const btnExtract = $('btn-extract');
  const btnReturnHome = $('btn-return-home');
  const btnSkip = $('btn-skip-recruit');
  const discardWrap = $('result-discard-wrap');

  btnSkip.classList.add('hidden');
  discardWrap.classList.add('hidden');
  $('result-squad-preview').classList.add('hidden');
  cards.innerHTML = '';

  // 1. Forced Evacuation Check: <= 2 cards left in camp + slots
  if (state.roster.length <= 2) {
    const survivingCount = state.roster.length;
    if (survivingCount > 0) {
      state.stash.push(...state.roster);
      saveStash();
    }
    const savedRoster = [...state.roster];
    state.roster = [];
    state.team = [];
    state.extractCountdown = null;
    updateHud();

    title.textContent = survivingCount === 0 ? 'Squad Wiped Out 💀' : 'Emergency Evacuation 🚨';
    title.className = 'lose';
    text.textContent = survivingCount === 0
      ? `All characters were lost in battle. The expedition ended. You survived ${state.battleNum - 1} battle${state.battleNum === 2 ? '' : 's'}.`
      : `Critical squad loss! You have only ${survivingCount} card${survivingCount === 1 ? '' : 's'} remaining (≤ 2). You and your surviving cards have been returned to Base Stash immediately!`;

    for (const c of savedRoster) {
      const d = CHARACTERS[c.id];
      const el = cardEl(c.id, d.atk, d.hp);
      const tag = frontTag();
      tag.textContent = 'SAVED TO STASH';
      tag.style.background = '#22c55e';
      tag.style.color = '#052e16';
      el.appendChild(tag);
      cards.appendChild(el);
    }

    btnContinue.classList.add('hidden');
    btnExtract.classList.add('hidden');
    btnReturnHome.classList.remove('hidden');
    btnReturnHome.textContent = 'Return to Home Stash 🏠';
    btnReturnHome.onclick = () => {
      showHome();
    };
    return;
  }

  // 2. Extraction Completion: countdown reaches 0 (was 1 last battle)
  if (state.extractCountdown === 1) {
    const extractedCount = state.roster.length;
    state.stash.push(...state.roster);
    saveStash();
    const savedRoster = [...state.roster];
    state.roster = [];
    state.team = [];
    state.extractCountdown = null;
    updateHud();

    title.textContent = 'Extraction Successful! 🚁';
    title.className = 'win';
    text.textContent = `Extraction chopper arrived! All ${extractedCount} cards from your squad were safely deposited into your Base Stash.`;

    for (const c of savedRoster) {
      const d = CHARACTERS[c.id];
      const el = cardEl(c.id, d.atk, d.hp);
      const tag = frontTag();
      tag.textContent = 'EXTRACTED';
      tag.style.background = '#38bdf8';
      tag.style.color = '#082f49';
      el.appendChild(tag);
      cards.appendChild(el);
    }

    btnContinue.classList.add('hidden');
    btnExtract.classList.add('hidden');
    btnReturnHome.classList.remove('hidden');
    btnReturnHome.textContent = 'Return to Home Stash 🏠';
    btnReturnHome.onclick = () => {
      showHome();
    };
    return;
  }

  // 3. Extraction in progress: countdown was 2, now 1 battle left
  if (state.extractCountdown === 2) {
    state.extractCountdown = 1;
    updateHud();

    title.textContent = 'Extraction Inbound 🚁';
    title.className = 'win';
    text.textContent = 'Extraction beacon active! Survive 1 more battle to extract all squad cards to Base Stash.';

    for (const c of state.roster) {
      const d = CHARACTERS[c.id];
      const el = cardEl(c.id, d.atk, d.hp);
      if (state.team.includes(c.uid)) {
        const tag = frontTag();
        tag.textContent = 'TEAM';
        el.appendChild(tag);
      }
      cards.appendChild(el);
    }

    btnReturnHome.classList.add('hidden');

    btnContinue.classList.remove('hidden');
    btnContinue.disabled = false;
    btnContinue.textContent = 'Continue to Final Battle ▶';
    btnContinue.onclick = () => {
      showPrep();
    };

    btnExtract.classList.remove('hidden');
    btnExtract.disabled = true;
    btnExtract.textContent = '⏳ Extract in 1 battle';
    return;
  }

  // 4. Extraction not active: offer Continue or Extract in 2 battles
  title.textContent = lastResult === 'win' ? 'Victory Secured' : 'Regroup';
  title.className = lastResult;
  text.textContent = `Your squad has ${state.roster.length} cards (team: ${state.team.length}, camp: ${campCount()}). Push deeper or call extraction in 2 battles:`;

  for (const c of state.roster) {
    const d = CHARACTERS[c.id];
    const el = cardEl(c.id, d.atk, d.hp);
    if (state.team.includes(c.uid)) {
      const tag = frontTag();
      tag.textContent = 'TEAM';
      el.appendChild(tag);
    }
    cards.appendChild(el);
  }

  btnReturnHome.classList.add('hidden');

  btnContinue.classList.remove('hidden');
  btnContinue.disabled = false;
  btnContinue.textContent = 'Continue Expedition ▶';
  btnContinue.onclick = () => {
    showPrep();
  };

  btnExtract.classList.remove('hidden');
  btnExtract.disabled = false;
  btnExtract.textContent = '🚁 Extract in 2 battles';
  btnExtract.onclick = () => {
    state.extractCountdown = 2;
    updateHud();
    showPrep();
  };
}

// ---------- Idle preview cycle ----------
// After 5s without input on the prep screen, step through every card's preview in acting order.
// The "Preview battle" button starts the same cycle right away; that one keeps going while the
// mouse moves and stops on a click, key, scroll or a second press of the button.

const IDLE_MS = 5000;
const CYCLE_MS = 2500;
let idleTimer = null;
let cycleTimer = null;
let cycling = false;
let manualCycle = false; // started from the button

function resetIdle(e) {
  if (e?.target?.closest?.('#btn-preview-battle')) return; // the button handles its own clicks
  if (manualCycle && e?.type === 'mousemove') return;
  stopIdleCycle();  // any input stops the cycle, leaving the current preview shown
  if (state.inBattle) return;
  idleTimer = setTimeout(() => startIdleCycle(false), IDLE_MS);
}

function stopIdleCycle() {
  clearTimeout(idleTimer);
  clearTimeout(cycleTimer);
  cycling = false;
  manualCycle = false;
  updatePreviewBattleBtn();
}

function startIdleCycle(manual) {
  // Acting order, as in battle: start-of-match abilities first (priority side, then other side,
  // highest attack first within a side), then front cards in clash order.
  const firstSide = rollFirstSide();
  const sides = firstSide === 'player' ? ['player', 'enemy'] : ['enemy', 'player'];
  const player = state.team.map(uid => {
    const c = state.roster.find(r => r.uid === uid);
    return { key: `p${uid}`, id: c.id, atk: CHARACTERS[c.id].atk };
  });
  const enemy = state.enemy.map((e, i) => ({ key: `e${i}`, id: e.id, atk: CHARACTERS[e.id].atk + e.atkBonus }));
  const isStart = u => CHARACTERS[u.id].trigger === 'start';
  const byAtk = list => [...list].sort((a, b) => b.atk - a.atk);
  const bySide = { player, enemy };
  const keys = [...byAtk(bySide[sides[0]].filter(isStart)), ...byAtk(bySide[sides[1]].filter(isStart))].map(u => u.key);
  for (let i = 0; i < Math.max(player.length, enemy.length); i++) {
    for (const s of sides) {
      const u = bySide[s][i];
      if (u && !isStart(u)) keys.push(u.key);
    }
  }
  if (!keys.length || state.inBattle || drag) return;
  clearTimeout(idleTimer);
  cycling = true;
  manualCycle = manual;
  updatePreviewBattleBtn();
  // The button always restarts from the first character; the idle cycle continues from the shown one.
  let idx = manual ? 0 : Math.max(0, keys.indexOf(state.previewKey) + 1) % keys.length;
  const step = () => {
    state.previewKey = keys[idx];
    renderPrep();
    idx = (idx + 1) % keys.length;
    cycleTimer = setTimeout(step, CYCLE_MS);
  };
  step();
}

function updatePreviewBattleBtn() {
  const b = $('btn-preview-battle');
  b.textContent = cycling ? '■ Stop preview' : '▶ Preview battle';
  b.classList.toggle('active', cycling);
}

for (const ev of ['mousemove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, resetIdle, { passive: true, capture: true });
}

$('btn-preview-battle').addEventListener('click', () => {
  if (cycling) { stopIdleCycle(); resetIdle(); }
  else startIdleCycle(true);
});

// ---------- Wiring ----------

window.addEventListener('resize', () => {
  if (state.previewKey && !state.inBattle) renderPrep();
  if (state.battlePreviewKey && currentBattle) view.render(currentBattle);
});

$('btn-fight').addEventListener('click', startBattle);
$('btn-skip').addEventListener('click', () => { closeBattlePreview(); setSpeed(1000); });
document.querySelectorAll('.speed').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

$('btn-go-expedition').addEventListener('click', startExpedition);

$('btn-auto-loadout').addEventListener('click', () => {
  if (!state.selectedStashUids) state.selectedStashUids = new Set();
  state.selectedStashUids.clear();
  const max = maxExpeditionLoadout();
  for (let i = 0; i < Math.min(state.stash.length, max); i++) {
    state.selectedStashUids.add(state.stash[i].uid);
  }
  audio.beep(550);
  renderHome();
});

$('btn-clear-loadout').addEventListener('click', () => {
  if (state.selectedStashUids) state.selectedStashUids.clear();
  audio.beep(400);
  renderHome();
});

$('btn-restock-stash').addEventListener('click', () => {
  const fresh = generateRandomStash(20);
  state.stash.push(...fresh);
  saveStash();
  audio.beep(650);
  renderHome();
});

$('btn-evac-base').addEventListener('click', () => {
  if (state.screen !== 'prep') return;
  if (confirm(`Evacuate now? Return all ${state.roster.length} squad cards to base stash?`)) {
    returnAllToStash();
    showHome();
  }
});

// ---------- Visual Character Editor Modal ----------
function openEditorModal() {
  const modal = $('editor-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const container = $('editor-modal-content');
  if (container) {
    container.innerHTML = '';
    initEditor(container, {
      inModal: true,
      onClose: closeEditorModal,
      onSave: () => {
        updateHud();
        if (state.screen === 'home') renderHome();
        else if (state.screen === 'prep') renderPrep();
      },
    });
  }
}

function closeEditorModal() {
  const modal = $('editor-modal');
  if (modal) modal.classList.add('hidden');
  updateHud();
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'prep') renderPrep();
}

$('btn-open-editor')?.addEventListener('click', openEditorModal);
$('btn-close-editor')?.addEventListener('click', closeEditorModal);

renderTriggerLegend();
renderClassLegend();
initTriggerTips();
state.modifiers = loadModifiers();
state.stash = loadStash();
showHome();
