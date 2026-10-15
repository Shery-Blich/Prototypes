import { CHARACTERS, TRIGGERS, CLASSES, makeCharacter, randomCharacterId, RECRUITABLE, POWER } from './characters.js';
import { Battle } from './battle.js';
import { SimpleAudio } from '/src/shared/utils.js';

const MIN_TEAM = 1;
const STARTING_ROSTER = 3;

// ---------- Water economy ----------
// Every rate below is a share of the expedition's stake, so a bigger gamble swings harder.
const START_BANK = 100;
const MIN_STAKE = 10;
const FLOOR_PCT = 0.25;        // the expedition ends (auto return) when water falls to this share of the stake
const CAP_MULT = 5;            // reaching this many times the stake starts the end: water can keep
const CAP_HOLD_MS = 2500;      // climbing for this long (at 1x pace), then the wells dry up: from there
                               // it's a steady decline with only bad events until the expedition ends
const GAIN_BASE = 0.03;        // water found per step...
const GAIN_GROWTH = 0.0014;    // ...growing by this much every step deeper (a run takes ~1-2 min)
const DRINK_PCT = 0.005;       // each team member drinks this per step (camp doesn't drink)
const WIN_COST_PCT = 0.03;     // after a win, per fighter that fell
const LOSS_MIN_PCT = 0.05;     // a lost battle takes this share of your water at the start of a run...
const LOSS_MAX_PCT = 0.5;      // ...up to this near its end (when the wells dry up)
const SCARE_STEPS = 3;         // a scare (lost water bucket) lasts this many steps, then it's found...
const SCARE_REAL_CHANCE = 0.1; // ...except this often, when it's gone for good (a real water loss)
const DOOM_CHANCE = 0.05;      // chance an expedition is doomed: morale breaks at a random step before the peak
const LOSS_DRY_CHANCE = 0.25;  // chance a lost battle or fleeing robbers breaks morale (same ending as reaching 5x)
const PITY_START_PCT = 0.4;    // cashing out right away costs this share of the stake (a disappointed caravan)...
const PITY_SECONDS = 45;       // ...fading to nothing after this much walking (at 1x pace)
const RECRUIT_PCT = 0.10;      // recruiting a defeated enemy on the path
const SHOP_PRICE = 12;         // recruits for hire at the oasis (flat, from the bank)
const SHOP_MIN = 2;            // passing travelers each time you're back at camp
const SHOP_MAX = 3;
const CAMP_DRINK_PER_DAY = 1;  // flavour text only: there are no days
const BATTLE_FASTEST_MS = 10000; // battles come faster the more water you carry: every 30s at
const BATTLE_SLOWEST_MS = 30000; // 25💧 or less, down to every 10s at 100💧 or more (at 1x pace)
const EXPECT_MIN = 1.5;        // what the caravan expects to bring home, rolled per expedition between
const EXPECT_MAX = 2.5;        // ...these multiples; coming home in profit but under it is a timid run
const TIMID_RUNS = 2;          // the first timid run is a warning; from this many in a row, characters walk out
const FLEE_KEEP = 0.25;        // fleeing robbers keeps this share of your water (ignores the floor)

// Team slots per side and camp size are gameplay modifiers (see MODIFIER_DEFAULTS).
const teamSlots = () => state.modifiers.playerSlots;
const enemySlots = () => state.modifiers.enemySlots;
const slotsFor = side => (side === 'player' ? teamSlots() : enemySlots());
const campMax = () => state.modifiers.campMax; // characters not in the team, at all times

const campCount = () => state.roster.length - state.team.length;

const $ = id => document.getElementById(id);
const audio = new SimpleAudio();

const state = {
  bank: START_BANK,  // water at the oasis
  mode: 'oasis',     // 'oasis' | 'trek' | 'encounter' | 'battle'
  exp: null,         // the current expedition, see setOut
  expNum: 1,
  best: 0,           // best cash-out multiplier
  offers: [],        // shop: character ids (null = bought)
  stake: 50,
  roster: [],        // [{uid, id}]
  team: [],          // roster uids, index 0 = front
  battleNum: 1,
  wins: 0,
  timidRuns: 0,      // timid cash-outs in a row (see EXPECT_MIN)
  losses: 0,
  enemy: [],         // [{id, atkBonus, hpBonus}]
  speed: 1,
  inBattle: false,
  previewKey: null,  // selected prep card: 'p<rosterUid>' or 'e<index>'
  modifiers: null,   // gameplay modifiers, see MODIFIER_DEFAULTS
  battlePreviewKey: null, // selected battle card: 'b<battle unit uid>'
  paused: false,     // battle is paused while a battle preview is open
};

// ---------- Gameplay modifiers ----------

const MODIFIER_DEFAULTS = {
  playerStartsPct: 50, // chance (0-100) that the player makes the first attack
  recruitsPerWin: 1,   // 0 = one random character of the defeated team, 1-10 = pick up to that many
  playerSlots: 5,      // your team slots (1-10)
  enemySlots: 5,       // enemy team slots (1-10)
  campMax: 10,         // characters in camp (0-20)
  lossLeaveBehind: 1,  // fighters you leave behind after a lost battle (0-5)
  eventTreasure: 30,   // walk event weights (0-100 each); their share of the total is the chance
  eventSpike: 45,
  eventLoss: 25,
};

// Stepper modifiers: range and description
const STEPPERS = {
  playerSlots: { min: 1, max: 10, desc: n => `Up to ${n} character${n === 1 ? '' : 's'} in your team. Lowering it sends the back of your team to camp.` },
  enemySlots: { min: 1, max: 10, desc: n => `Enemy teams start at 1 and grow by one per battle, up to ${n} character${n === 1 ? '' : 's'}.` },
  lossLeaveBehind: { min: 0, max: 5, desc: n => (n === 0 ? 'A lost battle only costs water.' : `A lost battle costs water and ${n} of the fighters (you choose who).`) },
  campMax: { min: 0, max: 20, desc: n => (n === 0 ? 'No camp: everyone you own is in your team.' : `Up to ${n} character${n === 1 ? '' : 's'} wait in camp. Lowering it below what's there asks you to discard.`) },
};

function loadModifiers() {
  try {
    const saved = JSON.parse(localStorage.getItem('cewater-modifiers') || '{}');
    return { ...MODIFIER_DEFAULTS, ...saved };
  } catch {
    return { ...MODIFIER_DEFAULTS };
  }
}

function saveModifiers() {
  try { localStorage.setItem('cewater-modifiers', JSON.stringify(state.modifiers)); } catch { /* not persisted */ }
}

function renderModifiers() {
  const pct = state.modifiers.playerStartsPct;
  $('mod-start-pct').value = pct;
  $('mod-start-val').textContent = `${pct}%`;
  $('mod-start-desc').textContent =
    pct === 100 ? 'You always attack first.'
      : pct === 0 ? 'The enemy always attacks first.'
        : `You attack first ${pct}% of battles, the enemy ${100 - pct}%.`;
  $('mod-start-reset').disabled = pct === MODIFIER_DEFAULTS.playerStartsPct;

  const n = state.modifiers.recruitsPerWin;
  $('mod-recruits').value = n;
  $('mod-recruits-val').textContent = n === 0 ? 'Random' : n;
  $('mod-recruits-desc').textContent =
    n === 0 ? 'After a win, one random character of the defeated team offers to join.'
      : n >= enemySlots() ? 'After a win, you can take the entire defeated team (summons excluded).'
        : `After a win, pick up to ${n} character${n === 1 ? '' : 's'} of the defeated team.`;
  $('mod-recruits-reset').disabled = n === MODIFIER_DEFAULTS.recruitsPerWin;

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
    renderPrep();
  };
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

// ---------- Run setup ----------

// A fresh game starts with two copies of the same Helper (their synergy is on from the first
// battle) and one other character.
function starterIds() {
  const helpers = RECRUITABLE.filter(id => CHARACTERS[id].cls === 'helper');
  const others = RECRUITABLE.filter(id => CHARACTERS[id].cls !== 'helper');
  const helper = helpers[Math.floor(Math.random() * helpers.length)];
  return [helper, helper, others[Math.floor(Math.random() * others.length)]];
}

function newRun() {
  // Start with up to 6 characters that fit the team slots + camp; 3 in the team (more if the camp can't hold the rest).
  const start = Math.min(STARTING_ROSTER, teamSlots() + campMax());
  state.roster = starterIds().slice(0, start).map(makeCharacter);
  const teamSize = Math.max(Math.min(3, teamSlots()), start - campMax());
  state.team = state.roster.slice(0, teamSize).map(c => c.uid);
  state.battleNum = 1;
  state.wins = 0;
  state.timidRuns = 0;
  state.seen = new Set(state.roster.map(c => c.id)); // character types met so far (see encounterEnemy)
  state.losses = 0;
  state.bank = START_BANK;
  state.expNum = 1;
  state.best = 0;
  state.stake = 50;
  rollOffers();
  showOasis();
}

// Enemy teams grow from 3 characters (one more every 2 battles) up to the enemy team slots,
// then gain extra stats each battle.
const enemySize = n => Math.min(enemySlots(), 3 + Math.floor((n - 1) / 2));

function generateEnemy(n) {
  const team = Array.from({ length: enemySize(n) }, () => ({ id: randomCharacterId(), atkBonus: 0, hpBonus: 0 }));
  let bonus = Math.max(0, n - 3) * 2;
  while (bonus-- > 0) {
    const e = team[Math.floor(Math.random() * team.length)];
    if (Math.random() < 0.5) e.atkBonus++; else e.hpBonus++;
  }
  return team;
}

// The enemy slots modifier changed: trim the next opponent, or top it up with new characters.
function fitEnemyToSlots() {
  if (state.mode !== 'encounter') return;
  const size = Math.min(enemySlots(), state.exp.enemySize);
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
for (const [key, c] of Object.entries(CLASSES)) TIPS[`cls-${key}`] = `${c.emoji} <b>${c.name}</b>: ${c.synergy}`;

function renderTriggerLegend() {
  $('trigger-legend').innerHTML = Object.entries(TRIGGERS)
    .map(([key, t]) => `<span class="legend-item" data-trigger="${key}"><span class="trig">${t.emoji}</span> ${t.name}</span>`)
    .join('');
  $('class-legend').innerHTML = Object.entries(CLASSES)
    .map(([key, c]) => `<span class="legend-item legend-${key}" data-tip="cls-${key}">${c.emoji} ${c.name}</span>`)
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
  const el = document.createElement('div');
  el.className = 'card' + (def.token ? ' token' : '') + (def.cls ? ` cls-${def.cls}` : '') + (opts.cls ? ' ' + opts.cls : '');
  const cls = CLASSES[def.cls];
  el.innerHTML = `${cls ? `<div class="class-tag" data-tip="cls-${def.cls}">${cls.emoji}</div>` : ''}
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
  $('hud-bank').textContent = fmt(state.bank);
}

// ---------- Prep screen ----------

function showPrep() {
  state.inBattle = false;
  $('prep-screen').classList.remove('hidden');
  $('battle-screen').classList.add('hidden');
  $('trek-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  renderPrep();
  resetIdle();
}

function renderPrep() {
  updateHud();
  const oasis = state.mode === 'oasis';
  if (oasis) { stopIdleCycle(); state.previewKey = null; }
  // Trigger and class legends only matter when looking at a fight.
  document.querySelector('.hud').classList.toggle('hud-oasis', oasis);
  $('oasis-panel').classList.toggle('hidden', !oasis);
  $('encounter-bar').classList.toggle('hidden', oasis);
  // At the oasis there's no team to arrange: that happens when a battle starts.
  document.querySelector('.prep-top').classList.toggle('hidden', oasis);
  $('camp-panel').classList.toggle('hidden', oasis);
  if (oasis) renderOasis(); else renderEncounter();
  renderSynergies();

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
  $('fight-hint').textContent = !ok
    ? `Pick at least ${MIN_TEAM} character${MIN_TEAM > 1 ? 's' : ''}`
    : oasis ? `${n} in the team` : `${n} character${n > 1 ? 's' : ''} fight`;
  if (oasis) updateSetOut();

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

// Big arrow above the arena showing who makes the first attack (it's rolled, so make it obvious).
function showFirstBanner(side) {
  const b = $('first-banner');
  b.className = `first-banner ${side}`;
  b.innerHTML = side === 'player'
    ? '<span class="fb-text">YOU ATTACK FIRST</span><span class="fb-arrow">➜</span>'
    : '<span class="fb-arrow">⬅</span><span class="fb-text">ENEMY ATTACKS FIRST</span>';
  void b.offsetWidth; // restart the pop-in animation
  b.classList.add('pop');
}

async function startBattle() {
  if (state.inBattle) return;
  state.inBattle = true;
  state.mode = 'battle';
  state.previewKey = null;
  stopIdleCycle();
  audio.init();

  const participants = state.team.map(uid => state.roster.find(r => r.uid === uid));
  $('prep-screen').classList.add('hidden');
  $('trek-screen').classList.add('hidden');
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
  view.log(`🎲 ${firstSide === 'player' ? 'You attack' : 'The enemy attacks'} first (${state.modifiers.playerStartsPct}% chance you start)`);
  const battle = new Battle(participants, state.enemy, view, {
    firstSide, maxTeam: { player: teamSlots(), enemy: enemySlots() },
  });
  currentBattle = battle;
  const result = await battle.run();
  await view.wait(500);
  closeBattlePreview();
  currentBattle = null;
  const standing = new Set([...battle.teams.player, ...battle.reserve.player].map(u => u.rosterUid));
  const fallen = participants.filter(p => !standing.has(p.uid));
  showResult(result, participants, fallen);
}

// ---------- Results ----------

function showResult(result, participants, fallen) {
  const title = $('result-title');
  const btn = $('btn-continue');
  const defeated = state.enemy;
  const e = state.exp;
  $('result-cards').innerHTML = '';
  title.className = result;
  btn.disabled = false;
  $('btn-skip-recruit').classList.add('hidden');
  $('result-discard-wrap').classList.add('hidden');
  state.battleNum++;
  e.fights++;

  if (result === 'win') {
    state.wins++;
    changeWater(-fallen.length * WIN_COST_PCT * e.stake, 'fight', `⚔ Won the battle${fallen.length ? `, ${fallen.length} wounded drank` : ''}`);
    title.textContent = 'Victory!';
    audio.score();
    updateHud();
    $('result-overlay').classList.remove('hidden');
    showRecruit(defeated, '');
    return;
  }

  // Lost: robbers take water (5% early in the run, up to 50% near the end; never below the
  // floor) and you leave one of the fighters behind. Then the walk goes on.
  state.losses++;
  title.textContent = 'Defeat';
  audio.explosion();
  // How close the run is to its end: water on the way to 5x the stake, or the decline after it.
  const progress = e.crashed ? 1 : Math.max(0, Math.min(1, e.water / (e.stake * CAP_MULT)));
  const lost = -changeWater(-e.water * (LOSS_MIN_PCT + (LOSS_MAX_PCT - LOSS_MIN_PCT) * progress), 'fight', '💀 Lost a battle');
  updateHud();
  showLeaveBehind(participants, lost);
  $('result-overlay').classList.remove('hidden');
}

// After a loss: pick the one fighter who stays behind.
function showLeaveBehind(participants, lost) {
  const btn = $('btn-continue');
  const need = Math.min(state.modifiers.lossLeaveBehind, participants.length);
  const chosen = []; // uids, oldest pick first
  const nameOf = uid => CHARACTERS[participants.find(p => p.uid === uid).id].name;
  const draw = () => {
    $('result-text').textContent = `The robbers took ${fmt(lost)}💧.`
      + (need ? ` Choose ${need === 1 ? 'one fighter' : `${need} fighters`} to leave behind.` : '');
    const row = $('result-cards');
    row.innerHTML = '';
    if (need) {
      for (const p of participants) {
        const d = CHARACTERS[p.id];
        const picked = chosen.includes(p.uid);
        const el = cardEl(p.id, d.atk, d.hp, { cls: 'discard-option' + (picked ? ' discarding' : '') });
        if (picked) {
          const tag = frontTag();
          tag.textContent = 'STAYS BEHIND';
          el.appendChild(tag);
        }
        // Click toggles; at the limit, a new pick replaces the oldest one.
        el.addEventListener('click', () => {
          const i = chosen.indexOf(p.uid);
          if (i >= 0) chosen.splice(i, 1);
          else { if (chosen.length >= need) chosen.shift(); chosen.push(p.uid); }
          draw();
        });
        row.appendChild(el);
      }
    }
    const ready = chosen.length === need;
    btn.textContent = !need ? 'Continue ▶'
      : !ready ? `Choose who stays behind (${chosen.length}/${need})`
        : `Leave ${need === 1 ? nameOf(chosen[0]) : `${need} fighters`} behind, continue ▶`;
    btn.disabled = !ready;
  };
  btn.onclick = () => {
    const gone = new Set(chosen);
    if (gone.size) {
      trekLog(`🏜️ ${participants.filter(p => gone.has(p.uid)).map(p => CHARACTERS[p.id].emoji).join('')} stayed behind`, 'down');
    }
    state.roster = state.roster.filter(r => !gone.has(r.uid));
    state.team = state.team.filter(uid => !gone.has(uid));
    $('result-overlay').classList.add('hidden');
    if (!state.team.length) return endExpedition('alone');
    if (atFloor()) return endExpedition('dry');
    resumeTrek();
    if (!state.exp.crashed && Math.random() < LOSS_DRY_CHANCE) startDecline('defeat');
  };
  draw();
}

// Victory reward: recruit up to `recruitsPerWin` characters of the defeated team (base stats,
// never summons) for RECRUIT_PCT of the stake each, or skip. 0 = one random character.
// Recruits fill the camp first, then free team slots. If there isn't room for all of them,
// exactly that many of your own characters must be discarded; recruits take their places.
function showRecruit(defeated, intro) {
  const limit = state.modifiers.recruitsPerWin;
  const random = limit === 0;
  const price = RECRUIT_PCT * state.exp.stake;
  const affordable = Math.floor((spendable() + 1e-9) / price);
  const maxPicks = Math.min(affordable, random ? 1 : Math.min(limit, defeated.length));
  const offered = random ? [Math.floor(Math.random() * defeated.length)] : defeated.map((_, i) => i);
  const picks = []; // indexes into defeated
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
    $('result-text').textContent = (maxPicks <= 0
      ? 'Not enough water to recruit anyone.'
      : `Recruit for ${fmt(price)}💧 each, or skip.`)
      + (needDiscard ? ` Pick ${needDiscard} of yours to let go.` : '');

    const cards = $('result-cards');
    cards.innerHTML = '';
    for (const i of offered) {
      const d = CHARACTERS[defeated[i].id];
      const el = cardEl(defeated[i].id, d.atk, d.hp, { cls: 'recruit-option' + (picks.includes(i) ? ' picked' : '') + (maxPicks <= 0 ? ' lost' : '') });
      if (maxPicks > 0) {
        const tag = frontTag();
        tag.textContent = `${fmt(price)}💧`;
        el.appendChild(tag);
      }
      el.addEventListener('click', () => { toggle(picks, i, maxPicks); draw(); });
      cards.appendChild(el);
    }

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
      : `Recruit ${recruitText} for ${fmt(picks.length * price)}💧` + (needDiscard && discards.length === needDiscard ? `, discard ${discardText}` : '');
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
    changeWater(-picks.length * price, 'cost', `🤝 Recruited ${picks.map(i => CHARACTERS[defeated[i].id].emoji).join('')}`);
    $('result-overlay').classList.add('hidden');
    resumeTrek();
  };
  skip.textContent = 'Skip ⏭';
  skip.onclick = () => { $('result-overlay').classList.add('hidden'); resumeTrek(); };
  skip.classList.remove('hidden');
  draw();
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
  // Acting order, as in battle: start-of-match abilities first (player's, then enemy's,
  // highest attack first within a side), then everyone else front by front (player, then
  // enemy), then each side's 2nd, 3rd, ...
  const player = state.team.map(uid => {
    const c = state.roster.find(r => r.uid === uid);
    return { key: `p${uid}`, id: c.id, atk: CHARACTERS[c.id].atk };
  });
  const enemy = state.enemy.map((e, i) => ({ key: `e${i}`, id: e.id, atk: CHARACTERS[e.id].atk + e.atkBonus }));
  const isStart = u => CHARACTERS[u.id].trigger === 'start';
  const byAtk = list => [...list].sort((a, b) => b.atk - a.atk);
  const keys = [...byAtk(player.filter(isStart)), ...byAtk(enemy.filter(isStart))].map(u => u.key);
  for (let i = 0; i < Math.max(player.length, enemy.length); i++) {
    for (const u of [player[i], enemy[i]]) if (u && !isStart(u)) keys.push(u.key);
  }
  if (!keys.length || state.inBattle || drag || state.mode !== 'encounter') return;
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

// ---------- Water helpers ----------

// Whole numbers once there's plenty, one decimal for small amounts.
function fmt(n) {
  const a = Math.abs(n);
  return a >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1);
}
const signed = n => (n >= 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);

// Water above the floor: what fights, rations and recruits can spend.
const spendable = () => Math.max(0, state.exp.water - state.exp.floor);
const atFloor = () => state.exp.water <= state.exp.floor + 1e-6;

// Changes the expedition's water (never below the floor) and plots it. Returns the applied change.
function changeWater(delta, kind, msg) {
  const e = state.exp;
  const before = e.water;
  e.water = Math.max(e.floor, e.water + delta);
  const applied = e.water - before;
  e.peak = Math.max(e.peak, e.water);
  const last = e.history[e.history.length - 1];
  const x = kind === 'step' ? e.step : Math.max(last.x + 0.2, e.step + 0.4);
  e.history.push({ x, water: e.water, kind });
  if (msg) trekLog(`${msg} <b>${signed(applied)}💧</b>`, applied > 0 ? 'up' : applied < 0 ? 'down' : '');
  return applied;
}

function trekLog(msg, cls = '') {
  const log = $('trek-log');
  const line = document.createElement('div');
  line.className = cls;
  line.innerHTML = `<span class="log-step">${state.exp ? state.exp.step : ''}</span> ${msg}`;
  log.prepend(line);
  while (log.children.length > 80) log.lastChild.remove();
}

// ---------- Oasis ----------

function rollOffers() {
  const n = SHOP_MIN + Math.floor(Math.random() * (SHOP_MAX - SHOP_MIN + 1));
  state.offers = Array.from({ length: n }, () => randomCharacterId());
}

const canSetOut = () => state.bank >= MIN_STAKE;
const gameOver = () => !canSetOut() || (!state.roster.length && state.bank < SHOP_PRICE + MIN_STAKE);

function showOasis() {
  stopTicking();
  state.mode = 'oasis';
  state.exp = null;
  state.enemy = [];
  state.previewKey = null;
  showPrep();
}

function renderOasis() {
  renderLeaderboard();
  updateStakeUI();
  renderCamp();
  renderTravelers();
}

// Flavour only (there are no days): at least 20💧 a day each, bigger characters drink more.
const drinkPerDay = id => 15 + 5 * Math.max(1, Math.round((CHARACTERS[id].atk + CHARACTERS[id].hp) / 3));

// ---------- Collapsible rows (Oasis camp, passing travelers) ----------
// The whole section is the button. Collapsed: just the header. Expanded: tokens (emoji in a
// class-colored ring); tapping one shows its card. Each section remembers its state.

const expanded = { camp: false, travelers: false };
try { Object.assign(expanded, JSON.parse(localStorage.getItem('cewater-expanded') || '{}')); } catch { /* defaults */ }

function toggleSection(key) {
  expanded[key] = !expanded[key];
  try { localStorage.setItem('cewater-expanded', JSON.stringify(expanded)); } catch { /* not saved */ }
  hideCardPop();
  if (key === 'camp') renderCamp(); else renderTravelers();
}

for (const [key, id] of [['camp', 'camp-section'], ['travelers', 'travelers-section']]) {
  $(id).addEventListener('click', () => toggleSection(key));
  $(id).addEventListener('keydown', e => {
    if (e.target === $(id) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSection(key); }
  });
}

// A token; tapping it opens (or closes) its card. `action` adds a button under the card.
function tokenEl(id, { badge = '', action = null } = {}) {
  const d = CHARACTERS[id];
  const t = document.createElement('div');
  t.className = `token-chip cls-${d.cls}`;
  t.innerHTML = `${d.emoji}${badge ? `<span class="token-badge">${badge}</span>` : ''}`;
  t.addEventListener('click', e => {
    e.stopPropagation(); // a token, not the row toggle
    if (popAnchor === t) hideCardPop(); else showCardPop(t, id, action, e);
  });
  return t;
}

function renderCamp() {
  const open = expanded.camp;
  $('camp-section').classList.toggle('open', open);
  $('camp-toggle').textContent = open ? '▴' : '▾';
  const n = state.roster.length;
  const perDay = state.roster.reduce((t, c) => t + drinkPerDay(c.id), 0);
  const days = perDay ? Math.floor(state.bank / perDay) : 0;
  $('oasis-camp-count').textContent = `(${n})`;
  $('camp-drink').textContent = `${perDay}💧 a day`;
  $('camp-days').textContent = perDay ? `~${days} day${days === 1 ? '' : 's'} of water left` : '';
  $('camp-days').className = days < 2 ? 'down' : '';

  // Collapsed: just each class's header; expanded: its tokens too.
  const camp = $('oasis-roster');
  camp.innerHTML = '';
  camp.classList.toggle('collapsed', !open);
  if (!n) {
    camp.innerHTML = '<span class="hint">Nobody here. Hire a passing traveler.</span>';
    return;
  }
  for (const [key, cls] of Object.entries(CLASSES)) {
    const members = state.roster.filter(c => CHARACTERS[c.id].cls === key);
    if (!members.length) continue;
    const drink = members.reduce((t, c) => t + drinkPerDay(c.id), 0);
    const group = document.createElement('div');
    group.className = `camp-group group-${key}`;
    group.innerHTML = `<div class="group-title"><span>${cls.emoji} ${cls.name}s (${members.length})</span>
      ${open ? `<span class="group-drink">🥤 ${drink}💧/day</span>` : ''}</div>`
      + (open ? `<div class="group-synergy">✨ ${cls.synergy.replace(':', ' in a fight:')}</div>` : '');
    camp.appendChild(group);
    if (!open) continue;
    const row = document.createElement('div');
    row.className = 'group-row';
    for (const c of members) {
      row.appendChild(tokenEl(c.id, {
        badge: `${drinkPerDay(c.id)}`,
        action: { label: 'Kick out', danger: true, run: () => kickOut(c.uid) },
      }));
    }
    group.appendChild(row);
  }
}

function renderTravelers() {
  const open = expanded.travelers;
  $('travelers-section').classList.toggle('open', open);
  $('travelers-toggle').textContent = open ? '▴' : '▾';
  const waiting = state.offers.filter(Boolean).length;
  $('travelers-count').textContent = waiting ? `(${waiting}) · ${SHOP_PRICE}💧 each` : '· all hired';

  // Grouped by class like the camp: headers always, tokens when expanded.
  const shop = $('shop');
  shop.innerHTML = '';
  shop.classList.toggle('collapsed', !open);
  const room = state.roster.length < teamSlots() + campMax();
  const afford = state.bank >= SHOP_PRICE;
  for (const [key, cls] of Object.entries(CLASSES)) {
    const members = state.offers.map((id, i) => ({ id, i })).filter(o => o.id && CHARACTERS[o.id].cls === key);
    if (!members.length) continue;
    const group = document.createElement('div');
    group.className = `camp-group group-${key}`;
    group.innerHTML = `<div class="group-title"><span>${cls.emoji} ${cls.name}s (${members.length})</span></div>`;
    shop.appendChild(group);
    if (!open) continue;
    const row = document.createElement('div');
    row.className = 'group-row';
    for (const { id, i } of members) {
      row.appendChild(tokenEl(id, {
        badge: `${SHOP_PRICE}`,
        action: {
          label: !room ? 'Camp is full' : !afford ? 'Not enough water' : `Hire · ${SHOP_PRICE}💧`,
          disabled: !room || !afford,
          run: () => {
            state.bank -= SHOP_PRICE;
            const c = makeCharacter(id);
            state.roster.push(c);
            if (campCount() > campMax()) state.team.push(c.uid);
            state.offers[i] = null;
            audio.score();
            teamChanged();
            renderPrep();
          },
        },
      }));
    }
    group.appendChild(row);
  }
  if (!waiting) shop.innerHTML = '<span class="hint">New travelers pass by when you come back from an expedition.</span>';
}

// Dismiss a character from the camp for good.
function kickOut(uid) {
  state.roster = state.roster.filter(r => r.uid !== uid);
  state.team = state.team.filter(u => u !== uid);
  audio.beep(220);
  teamChanged();
  renderPrep();
}

// ---------- Card popover (tap a token) ----------

let popAnchor = null;

function showCardPop(anchor, id, action = null, ev = null) {
  const pop = $('card-pop');
  const d = CHARACTERS[id];
  pop.innerHTML = '';
  pop.appendChild(cardEl(id, d.atk, d.hp));
  if (action) {
    const btn = document.createElement('button');
    btn.className = `btn btn-small pop-action ${action.danger ? 'btn-flee' : 'btn-primary'}`;
    btn.textContent = action.label;
    btn.disabled = action.disabled;
    btn.addEventListener('click', e => { e.stopPropagation(); hideCardPop(); action.run(); });
    pop.appendChild(btn);
  }
  pop.classList.remove('hidden');
  popAnchor = anchor;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const x = ev ? ev.clientX : r.left + r.width / 2;
  const y = ev ? ev.clientY : r.bottom;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2))}px`;
  pop.style.top = `${y + 14 + h > window.innerHeight - 8 ? Math.max(8, y - h - 14) : y + 14}px`;
}

function hideCardPop() {
  $('card-pop').classList.add('hidden');
  popAnchor = null;
}

// Tapping anywhere else closes the card.
document.addEventListener('click', e => {
  if (popAnchor && !e.target.closest('#card-pop') && !e.target.closest('.token-chip')) hideCardPop();
});
$('card-pop').addEventListener('click', e => e.stopPropagation());
window.addEventListener('scroll', hideCardPop, { passive: true });

// ---------- Water to bring: a vertical tank, or type it in ----------

function setStake(v) {
  const max = Math.max(MIN_STAKE, state.bank);
  state.stake = Math.round(Math.max(MIN_STAKE, Math.min(max, v)));
  updateStakeUI();
  updateSetOut();
}

function updateStakeUI() {
  const max = Math.max(MIN_STAKE, state.bank);
  state.stake = Math.max(MIN_STAKE, Math.min(state.stake, max));
  const s = state.stake;
  const frac = state.bank > 0 ? Math.min(1, s / state.bank) : 0;
  $('tank-fill').style.height = `${frac * 100}%`;
  $('tank-label').textContent = `${fmt(s)}💧`;
  const num = $('stake-num'), pct = $('stake-pct');
  num.min = MIN_STAKE; num.max = max;
  if (document.activeElement !== num) num.value = s;
  if (document.activeElement !== pct) pct.value = state.bank > 0 ? Math.round(frac * 100) : 0;
  $('tank').classList.toggle('disabled', !canSetOut());
}

(() => {
  const tank = $('tank');
  const fromPointer = e => {
    const r = tank.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
    setStake(frac * state.bank);
  };
  tank.addEventListener('pointerdown', e => {
    if (!canSetOut()) return;
    tank.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  tank.addEventListener('pointermove', e => { if (tank.hasPointerCapture(e.pointerId)) fromPointer(e); });
  tank.addEventListener('wheel', e => { e.preventDefault(); setStake(state.stake - Math.sign(e.deltaY) * 5); }, { passive: false });
  $('stake-num').addEventListener('input', e => { if (e.target.value !== '') setStake(Number(e.target.value)); });
  $('stake-pct').addEventListener('input', e => {
    if (e.target.value !== '') setStake((Math.max(0, Math.min(100, Number(e.target.value))) / 100) * state.bank);
  });
  for (const id of ['stake-num', 'stake-pct']) $(id).addEventListener('blur', updateStakeUI);
})();

function updateSetOut() {
  const s = state.stake;
  renderRates();
  $('setout-floor').textContent = `If your water ever drops to ${fmt(s * FLOOR_PCT)}💧, the expedition comes back automatically.`;
  const n = state.roster.length;
  const btn = $('btn-setout');
  const hint = $('setout-hint');
  if (gameOver()) {
    btn.textContent = 'Restart ⟳';
    btn.disabled = false;
    hint.textContent = '☠️ Game over: not enough water to keep going.';
    return;
  }
  btn.textContent = `Set Out with ${fmt(s)}💧`;
  btn.disabled = !n;
  hint.textContent = !n ? 'Your camp is empty: hire a passing traveler first.' : '';
}

// Shown in the gameplay modifiers: how often water finds and battles come right now.
function renderRates() {
  const e = state.exp;
  const stake = e ? e.stake : state.stake;
  const water = e ? e.water : state.stake;
  $('mod-find-rate').textContent = `${e ? 'Set out with' : 'Bringing'} ${fmt(stake)}💧: water finds about every ${(boostEveryMs(stake) / 1000).toFixed(1)}s (7s at 10💧, down to 2s at 160💧 or more).`;
  $('mod-battle-rate').textContent = `${e ? 'Carrying' : 'Starting with'} ${fmt(water)}💧: a battle about every ${Math.round(battleEveryMs(water) / 1000)}s (30s at 25💧 or less, down to 10s at 100💧 or more).`;
}

function setOut() {
  if (gameOver()) { newRun(); return; }
  if (!state.roster.length) return;
  // Nobody picked to fight yet: the first few walk in front.
  if (!state.team.length) state.team = state.roster.slice(0, Math.min(3, teamSlots())).map(c => c.uid);
  audio.init();
  const stake = state.stake;
  state.bank -= stake;
  state.exp = {
    stake, water: stake, floor: stake * FLOOR_PCT, peak: stake,
    step: 0, crashStep: null, crashed: false, // the wells only dry up after reaching 5x (see tick)
    capClock: 0,
    scaresAt: scheduleScares(), scare: null,
    doomAt: Math.random() < DOOM_CHANCE ? 8 + Math.floor(Math.random() * 50) : null, // hidden
    battleClock: 0, battleJitter: battleJitter(), boostClock: 0, boostEvery: boostEveryMs(stake),
    fights: 0, difficulty: 1,
    expect: EXPECT_MIN + Math.random() * (EXPECT_MAX - EXPECT_MIN), // hidden from the player
    history: [{ x: 0, water: stake, kind: 'step' }],
    tiles: ['🏝️'],
  };
  $('trek-log').innerHTML = '';
  trekLog(`🐪 Set out from the oasis with <b>${fmt(stake)}💧</b> (floor ${fmt(stake * FLOOR_PCT)}💧)`);
  resumeTrek();
}

// ---------- Synergies ----------

function renderSynergies() {
  const ids = state.team.map(uid => state.roster.find(r => r.uid === uid)?.id).filter(Boolean);
  $('synergy-line').innerHTML = Object.entries(CLASSES).map(([key, c]) => {
    const n = ids.filter(id => CHARACTERS[id].cls === key).length;
    return `<span class="syn syn-${key}${n >= 2 ? ' on' : ''}" data-tip="cls-${key}">${c.emoji} ${c.name} ${n}/2</span>`;
  }).join('');
}

// ---------- Encounters ----------

function encounter() {
  const e = state.exp;
  stopTicking();
  e.enemySize = encounterSize();
  e.tiles[e.tiles.length - 1] = '⚔️';
  state.enemy = encounterEnemy(e.enemySize);
  renderTrek();
  $('trek-screen').classList.add('ambush');
  audio.hit();
  state.mode = 'robbers'; // no cashing out while they're on you
  const robbed = e.water * (1 - FLEE_KEEP);
  $('btn-rob-flee').textContent = `🏃 Flee (they take ${fmt(robbed)}💧)`;
  $('robbers-overlay').classList.remove('hidden');
  $('btn-rob-fight').onclick = () => {
    $('robbers-overlay').classList.add('hidden');
    $('trek-screen').classList.remove('ambush');
    state.mode = 'encounter';
    state.previewKey = null;
    showPrep();
  };
  $('btn-rob-flee').onclick = () => {
    $('robbers-overlay').classList.add('hidden');
    $('trek-screen').classList.remove('ambush');
    // Unlike other losses this ignores the floor; below it, the expedition is over.
    e.leftWith = e.water;
    e.water -= robbed;
    e.history.push({ x: e.step + 0.4, water: e.water, kind: 'fight' });
    toast(`🏃 Robbers took ${fmt(robbed)}💧`, 'down');
    if (atFloor()) return endExpedition('fled');
    delete e.leftWith;
    resumeTrek();
    if (!e.crashed && Math.random() < LOSS_DRY_CHANCE) startDecline('fled');
  };
}

// Small side notes on the trek (water found, robbed...). They stack and fade on their own.
function toast(text, cls = 'up') {
  const t = document.createElement('div');
  t.className = `toast ${cls}`;
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Battles come faster the more water you're carrying right now (robbers smell it): every 30s at
// 25💧 or less, down to every 10s at 100💧+, with a little jitter per battle. Water boosts
// (treasure or spike) have their own clock that runs faster the more water you set out with:
// every 7s at 10💧, down to 2s at 160💧+.
const battleEveryMs = water => Math.max(BATTLE_FASTEST_MS, Math.min(BATTLE_SLOWEST_MS,
  BATTLE_SLOWEST_MS - 10000 * Math.log2(Math.max(1, water) / 25)));
const battleJitter = () => 0.9 + 0.2 * Math.random();
const battleDue = e => Math.max(BATTLE_FASTEST_MS, Math.min(BATTLE_SLOWEST_MS, battleEveryMs(e.water) * e.battleJitter));
const boostEveryMs = stake => Math.max(2000, Math.min(7000, 7000 - 1500 * Math.log2(stake / 10)));
const EVENTS = [
  { key: 'eventTreasure', run: treasure },
  { key: 'eventSpike', run: spike },
  { key: 'eventLoss', run: waterLoss },
];

// Enemy waves. Each expedition opens with a single enemy and adds one per battle
// up to the enemy slots; past that, every battle raises their power instead (see POWER): the
// enemies are picked near a target strength that starts at your team's average and climbs, so
// the gang turns into Golems, Paladins and finally Brutes. Past the strongest character, the extra power becomes +1 stats. After the crash the
// target climbs further, every step. Types you haven't met yet are picked first when they fit.
const ENC_POWER_PER_BATTLE = 1.5; // target power per enemy, added per battle once the enemy team is full
const ENC_CRASH_POWER = 3;        // added once morale breaks, plus ENC_CRASH_POWER_STEP per step after
const ENC_CRASH_POWER_STEP = 0.5;
const ENC_TOP_POWER = Math.max(...RECRUITABLE.map(id => POWER[id]));

function encounterSize() {
  return Math.min(enemySlots(), 1 + state.exp.fights);
}

function encounterEnemy(size) {
  const e = state.exp;
  const members = state.team.map(uid => state.roster.find(r => r.uid === uid));
  const avg = members.length ? members.reduce((t, c) => t + POWER[c.id], 0) / members.length : 7;
  const past = Math.max(0, 1 + e.fights - enemySlots());
  const target = avg + past * ENC_POWER_PER_BATTLE
    + (e.crashed ? ENC_CRASH_POWER + ENC_CRASH_POWER_STEP * (e.step - e.crashStep) : 0);
  // Characters within 2 below the target (or the closest ones), the strongest once it's past them all.
  const near = RECRUITABLE.filter(id => POWER[id] <= target + 1 && POWER[id] >= Math.min(target, ENC_TOP_POWER) - 2);
  const pool = near.length ? near : RECRUITABLE;
  // Power the characters themselves can't reach goes into their stats.
  const extra = Math.max(0, Math.round(target - ENC_TOP_POWER));
  const team = [];
  for (let i = 0; i < size; i++) {
    const unseen = pool.filter(id => !state.seen.has(id) && !team.some(u => u.id === id));
    const from = unseen.length ? unseen : pool;
    const atkBonus = Math.floor(extra / 2);
    team.push({ id: from[Math.floor(Math.random() * from.length)], atkBonus, hpBonus: extra - atkBonus });
  }
  for (const u of team) state.seen.add(u.id);
  return team;
}

function randomEvent() {
  // Once the wells are drying up, the road only takes.
  if (state.exp.crashed) return waterLoss();
  const total = EVENTS.reduce((t, ev) => t + state.modifiers[ev.key], 0);
  if (!total) return;
  let r = Math.random() * total;
  for (const ev of EVENTS) if ((r -= state.modifiers[ev.key]) < 0) return ev.run();
}

// Random event chance sliders: each is a weight, shown as its share of the total.
const EVENT_MODS = ['eventTreasure', 'eventSpike', 'eventLoss'];

function renderEventMods() {
  const total = EVENT_MODS.reduce((t, k) => t + state.modifiers[k], 0);
  for (const key of EVENT_MODS) {
    const v = state.modifiers[key];
    $(`mod-${key}`).value = v;
    $(`mod-${key}-val`).textContent = total ? `${Math.round((v / total) * 100)}%` : '0%';
  }
  $('mod-events-desc').textContent = total
    ? `Walk events are ${EVENT_MODS.map(k => `${$(`mod-${k}-val`).textContent} ${{ eventTreasure: '🎁 treasure', eventSpike: '💥 spike', eventLoss: '💔 water loss' }[k]}`).join(', ')}.`
    : 'Both at 0: no water finds, just the walk and the battles.';
  $('mod-events-reset').disabled = EVENT_MODS.every(k => state.modifiers[k] === MODIFIER_DEFAULTS[k]);
}

for (const key of EVENT_MODS) {
  $(`mod-${key}`).addEventListener('input', e => {
    state.modifiers[key] = Number(e.target.value);
    saveModifiers();
    renderEventMods();
  });
}
$('mod-events-reset').addEventListener('click', () => {
  for (const k of EVENT_MODS) state.modifiers[k] = MODIFIER_DEFAULTS[k];
  saveModifiers();
  renderEventMods();
});

// Instant jump on the graph. After the wells dry up it's only a small tease.
// Bad luck on the road: a chunk of the water you're carrying is gone. Keeps the climb to the
// cap unpredictable.
const LOSSES = [
  '🦂 A scorpion bit through a waterskin',
  '🐫 A camel kicked over the barrels',
  '🌪️ A sandstorm tore the canteens open',
  '🕳️ A waterskin leaked all night',
  '🥵 A heatwave: everyone drank double',
];

function waterLoss() {
  const e = state.exp;
  const msg = LOSSES[Math.floor(Math.random() * LOSSES.length)];
  e.tiles[e.tiles.length - 1] = msg.split(' ')[0];
  const applied = changeWater(-e.water * (0.08 + 0.14 * Math.random()), 'loss', msg);
  audio.playTone(150, 'sawtooth', 0.18, 0.12);
  renderTrek();
  toast(`${msg}! ${signed(applied)}💧`, 'down');
}

function spike() {
  const e = state.exp;
  const S = e.stake;
  const amount = e.crashed ? S * (0.04 + 0.08 * Math.random()) : S * (0.12 + 0.18 * Math.random());
  e.tiles[e.tiles.length - 1] = '💥';
  const applied = changeWater(amount, 'spike', '💥 <b>Water spike!</b> An underground stream bursts up');
  audio.playTone(880, 'triangle', 0.08, 0.15);
  setTimeout(() => audio.playTone(1320, 'triangle', 0.15, 0.15), 70);
  renderTrek();
  toast(`💧 Water found! ${signed(applied)}💧`);
}

// A chest on the path: a pile of water or a free character (water if there's no room for one).
function treasure() {
  const e = state.exp;
  e.tiles[e.tiles.length - 1] = '🎁';
  const room = state.roster.length < teamSlots() + campMax();
  const id = room && Math.random() < 0.4 ? randomCharacterId() : null;
  const amount = e.stake * (0.2 + 0.25 * Math.random());
  audio.score();
  if (!id) {
    const applied = changeWater(amount, 'treasure', '🎁 Waterskins from a chest');
    renderTrek();
    toast(`🎁 Treasure! ${signed(applied)}💧`);
    return;
  }
  stopTicking();
  state.mode = 'treasure';
  renderTrek();

  $('treasure-text').textContent = id
    ? `Inside, a ${CHARACTERS[id].name} has been waiting for rescue. It joins your caravan for free.`
    : `It's full of sealed waterskins: ${signed(amount)}💧.`;
  const cards = $('treasure-cards');
  cards.innerHTML = '';
  if (id) {
    const d = CHARACTERS[id];
    cards.appendChild(cardEl(id, d.atk, d.hp, { cls: 'reward' }));
  } else {
    cards.innerHTML = `<div class="treasure-water">💧 ${signed(amount)}</div>`;
  }
  $('btn-treasure').onclick = () => {
    $('treasure-overlay').classList.add('hidden');
    if (id) {
      const c = makeCharacter(id);
      state.roster.push(c);
      if (campCount() > campMax()) state.team.push(c.uid);
      trekLog(`🎁 ${CHARACTERS[id].emoji} ${CHARACTERS[id].name} joins the caravan`, 'up');
    }
    resumeTrek();
  };
  $('treasure-overlay').classList.remove('hidden');
}

function renderEncounter() {}

// ---------- Trek ----------

let trekTimer = null;
let trekPaused = false;
let pace = 1;
const STEP_MS = 900;

function stopTicking() {
  clearTimeout(trekTimer);
  trekTimer = null;
}

// Any popup on screen freezes the walk: water, the graph and the event clocks.
const POPUPS = ['robbers-overlay', 'treasure-overlay', 'result-overlay', 'end-overlay', 'discard-overlay', 'desert-overlay'];
const popupOpen = () => POPUPS.some(id => !$(id).classList.contains('hidden'));

function startTicking() {
  stopTicking();
  if (trekPaused || state.mode !== 'trek' || popupOpen()) return;
  trekTimer = setTimeout(() => { tick(); startTicking(); }, STEP_MS / pace);
}

function resumeTrek() {
  state.mode = 'trek';
  state.inBattle = false;
  $('prep-screen').classList.add('hidden');
  $('battle-screen').classList.add('hidden');
  $('trek-screen').classList.remove('hidden');
  stopIdleCycle();
  renderTrek();
  startTicking();
}

const TERRAIN = ['🏜️', '🏜️', '🌵', '🪨', '🐪', '🦂', '🏜️', '🌴'];
const DRY = ['☀️', '🦴', '💀', '🏜️', '🔥'];

// Morale breaks: from here water only declines and every walk event is bad, until the
// expedition ends at the floor. Triggered by reaching 5x (after a short window) or a lost battle.
function startDecline(why = 'tired') {
  const e = state.exp;
  e.crashed = true;
  e.crashStep = e.step;
  const last = e.history[e.history.length - 1];
  e.history.push({ x: last.x + 0.2, water: e.water, kind: 'crash' });
  toast({
    defeat: '😞 After the defeat, morale is breaking…',
    fled: '😞 Running from robbers broke their spirit…',
    tired: '😩 The caravan is exhausted, morale is dropping…',
    doom: '🤒 A fever spreads through the caravan, morale is collapsing…',
  }[why], 'down');
  audio.playTone(110, 'sawtooth', 0.4, 0.15);
  renderTrek();
}

// Scares: 1-2 times a run water suddenly drops below where you started, then comes right back a
// few steps later (with whatever you'd have found meanwhile). Panic-cashing out during one keeps
// only the low amount. Steps are spread between 8 and 60 and at least 10 apart.
const SCARES = [
  ['🪣 Someone lost the water bucket!', '😅 Found it behind a dune!', '💔 The bucket is gone for good'],
  ['🐫 A camel ran off with the waterskins!', '😅 Caught it, the water is safe!', '💔 The camel got away with the water'],
  ['🕳️ The barrels fell into a crevice!', '😅 Pulled them back up!', '💔 The barrels are lost in the crevice'],
];

function scheduleScares() {
  const count = 1 + Math.floor(Math.random() * 2);
  const at = [];
  while (at.length < count) {
    const step = 8 + Math.floor(Math.random() * 52);
    if (at.every(s => Math.abs(s - step) >= 10)) at.push(step);
  }
  return at.sort((a, b) => a - b);
}

function startScare(e) {
  const [lost, found, gone] = SCARES[Math.floor(Math.random() * SCARES.length)];
  e.scaresAt.shift();
  e.scare = { saved: e.water, left: SCARE_STEPS, found, gone };
  e.tiles[e.tiles.length - 1] = '😱';
  changeWater(e.stake * (0.6 + 0.25 * Math.random()) - e.water, 'scare', lost);
  audio.playTone(180, 'square', 0.25, 0.15);
  setTimeout(() => audio.playTone(120, 'square', 0.3, 0.15), 120);
  renderTrek();
  toast(lost, 'down');
}

function tick() {
  const e = state.exp;
  if (!e || state.mode !== 'trek' || popupOpen()) return;
  e.step++;
  e.battleClock += STEP_MS;
  e.boostClock += STEP_MS;
  const S = e.stake;
  const r = Math.random();
  let found;
  let tile;
  let note = '';
  if (!e.crashed) {
    found = S * (GAIN_BASE + GAIN_GROWTH * e.step) * (0.2 + 1.6 * Math.random());
    tile = TERRAIN[Math.floor(Math.random() * TERRAIN.length)];
    if (r < 0.07) {
      found -= S * (0.06 + 0.08 * Math.random());
      tile = '🌪️'; note = '🌪️ Sandstorm! Canteens spill.';
    }
    // Mirages show up more as the wells near their end, but also at random.
    if ((e.water >= e.stake * (CAP_MULT - 1) && Math.random() < 0.5) || Math.random() < 0.06) {
      tile = '🌫️'; note = note || '🌫️ A mirage shimmers on the horizon...';
    }
  } else {
    const k = e.step - e.crashStep;
    found = -S * (0.05 + 0.015 * k) * (0.6 + 0.8 * Math.random());
    tile = DRY[Math.floor(Math.random() * DRY.length)];
    if (Math.random() < 0.2) note = '🌫️ A mirage shimmers on the horizon...';
  }
  const drink = S * DRINK_PCT * state.team.length;
  e.tiles.push(tile);
  if (e.scare) {
    e.scare.saved += found - drink;
    if (--e.scare.left > 0) {
      changeWater(e.stake * 0.02 * (Math.random() - 0.5), 'step');
      audio.playTone(140, 'sine', 0.12, 0.1);
    } else if (Math.random() < SCARE_REAL_CHANCE) {
      // Not this time: the water is gone for good.
      e.tiles[e.tiles.length - 1] = '💔';
      changeWater(0, 'loss', e.scare.gone);
      toast(e.scare.gone, 'down');
      audio.playTone(150, 'sawtooth', 0.18, 0.12);
      e.scare = null;
    } else {
      changeWater(e.scare.saved - e.water, 'step', e.scare.found);
      toast(e.scare.found);
      audio.score();
      e.scare = null;
    }
    renderTrek();
    return; // nothing else happens mid-scare; event clocks keep counting
  }
  const applied = changeWater(found - drink, 'step', `${note ? note + ' ' : ''}Step ${e.step}: ${found >= 0 ? 'found' : 'lost'} ${fmt(Math.abs(found))}, drank ${fmt(drink)}`);
  const mult = e.water / S;
  if (applied >= 0) audio.beep(Math.min(1400, 280 + 260 * mult));
  else audio.playTone(Math.max(90, 220 - 40 * (1 - mult)), 'sine', 0.12, 0.12);

  renderTrek();
  if (atFloor()) { stopTicking(); setTimeout(() => endExpedition('dry'), 500); return; }
  // A doomed expedition breaks at its step, peak or not; nothing hints at it beforehand.
  if (!e.crashed && e.doomAt !== null && e.step >= e.doomAt) {
    startDecline('doom');
    return;
  }
  // Only scare from above where you started, and never once morale is breaking.
  if (!e.crashed && e.scaresAt.length && e.step >= e.scaresAt[0] && e.water > e.stake) {
    startScare(e);
    return;
  }
  // Reaching 5x starts the end: a short window to cash out, then the wells dry up.
  if (!e.crashed && (e.capClock > 0 || e.water >= e.stake * CAP_MULT)) {
    e.capClock += STEP_MS;
    if (e.capClock >= CAP_HOLD_MS) {
      startDecline();
      return;
    }
  }
  if (e.battleClock >= battleDue(e)) {
    e.battleClock = 0;
    e.battleJitter = battleJitter();
    encounter();
  } else if (e.boostClock >= e.boostEvery) {
    e.boostClock = 0;
    randomEvent();
  }
}


function renderTrek() {
  const e = state.exp;
  if (!e) return;
  updateHud();
  $('t-water').textContent = fmt(e.water);
  const home = Math.max(e.floor, e.water - pityCost(e));
  $('cash-home').textContent = `come back with ${fmt(home)}💧`;
  // Green past the profit target, yellow for a small (timid) profit, red if you'd come back short.
  $('btn-cashout').classList.toggle('profit', home >= e.stake * e.expect);
  $('btn-cashout').classList.toggle('loss', home < e.stake);
  renderRates();
  $('t-water').className = e.water >= e.stake ? 'up' : 'down';

  drawGraph($('graph'), $('graph-labels'), e, false);

  // Desert strip: the last tiles walked, the caravan, then unknown sand ahead.
  const track = $('desert-track');
  const past = e.tiles.slice(-14);
  track.innerHTML = past.map((t, i) => `<span class="tile${i === past.length - 1 ? ' here' : ''}">${t}</span>`).join('')
    + `<span class="caravan">🐪${state.team.map(uid => CHARACTERS[state.roster.find(r => r.uid === uid).id].emoji).join('')}</span>`
    + '<span class="tile fog">❔</span>'.repeat(5);
}

// Water over steps. Labels are HTML on top (the SVG stretches to fit).
function drawGraph(svg, labels, e, final) {
  const W = 900, H = 300, PAD = 8;
  const pts = e.history;
  const lastX = pts[pts.length - 1].x;
  const best = final ? e.bestPossible : null;
  const xMax = final ? Math.max(lastX, best.x) + 1 : Math.max(20, lastX + 4);
  const yMax = Math.max(e.peak, e.stake * 1.6, best ? best.water : 0) * 1.1;
  const X = x => PAD + (x / xMax) * (W - PAD * 2);
  const Y = w => H - PAD - (w / yMax) * (H - PAD * 2);
  const pct = (v, max) => `${(v / max) * 100}%`;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.water).toFixed(1)}`).join(' ');
  const area = `${line} L${X(lastX).toFixed(1)},${H} L${X(0)},${H} Z`;
  const up = e.water >= e.stake;
  let segs = '';
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const cls = b.water >= e.stake ? (b.water >= e.stake * 2 ? 'seg-gold' : 'seg-up') : 'seg-down';
    segs += `<line class="seg ${cls}" x1="${X(a.x)}" y1="${Y(a.water)}" x2="${X(b.x)}" y2="${Y(b.water)}" />`;
  }
  let grid = '';
  for (let m = 0.5; m * e.stake < yMax; m += 0.5) {
    if (m === 1) grid += `<line class="grid grid-stake" x1="0" x2="${W}" y1="${Y(m * e.stake)}" y2="${Y(m * e.stake)}" />`;
  }
  // Where a plain walk would have gone if you'd stayed: a faint dashed line up to the star.
  const ghost = final && e.ghost?.length > 1
    ? `<path class="ghost" d="${e.ghost.filter(p => p.x <= best.x).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.water).toFixed(1)}`).join(' ')}" />`
    : '';
  const last = pts[pts.length - 1];
  svg.innerHTML = `
    <defs><linearGradient id="${svg.id}-fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${up ? '#22c55e' : '#ef4444'}" stop-opacity="0.35" />
      <stop offset="1" stop-color="${up ? '#22c55e' : '#ef4444'}" stop-opacity="0" />
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#${svg.id}-fill)" />
    ${ghost}
    ${segs}`;

  let html = `<span class="gl-dot ${up ? 'up' : 'down'}" style="left:${pct(X(last.x), W)};top:${pct(Y(last.water), H)}"></span>`;
  for (const p of pts) {
    const icon = { fight: '⚔️', spike: '💥', treasure: '🎁', crash: '📉', loss: '💔', pity: '😒', fled: '🏃' }[p.kind];
    if (icon) html += `<span class="gl-fight" style="left:${pct(X(p.x), W)};top:${pct(Y(p.water), H)}">${icon}</span>`;
  }
  if (final) {
    const at = (x, w) => `left:${pct(X(x), W)};top:${pct(Y(w), H)}`;
    html += `<span class="gl-dot start" style="${at(0, e.stake)}"></span>`
      + `<span class="gl-start" style="${at(0, e.stake)}">Set out ${fmt(e.stake)}💧</span>`
      + `<span class="gl-now ${up ? 'up' : 'down'}" style="${at(last.x, last.water)}">Home ${fmt(e.water)}💧</span>`
      + (X(best.x) > W / 2
        ? `<span class="gl-star left" style="${at(best.x, best.water)}">${fmt(best.water)}💧 ⭐</span>`
        : `<span class="gl-star" style="${at(best.x, best.water)}">⭐ ${fmt(best.water)}💧</span>`);
  }
  labels.innerHTML = html;
}

// ---------- Expedition end ----------

// The best you could have cashed out with: the peak you reached, or, if you left before the
// wells dried up, the top of a plain walk (no events, same team drinking) from where you left
// up to the last step before they did.
function bestPossible(e) {
  let best = e.history.reduce((b, p) => (p.water > b.water ? p : b), e.history[0]);
  e.ghost = [];
  if (!e.crashed) {
    let w = e.leftWith ?? e.water;
    const drink = e.stake * DRINK_PCT * state.team.length;
    e.ghost.push({ x: e.step, water: w });
    let capLeft = e.capClock > 0 ? CAP_HOLD_MS - e.capClock : null;
    for (let step = e.step + 1; step < e.step + 2000; step++) {
      if (capLeft === null && w >= e.stake * CAP_MULT) capLeft = CAP_HOLD_MS;
      if (capLeft !== null && (capLeft -= STEP_MS) < 0) break;
      w += e.stake * (GAIN_BASE + GAIN_GROWTH * step) - drink;
      e.ghost.push({ x: step, water: w });
      if (w > best.water) best = { x: step, water: w };
    }
  }
  return { x: best.x, water: best.water };
}

function endExpedition(reason) {
  const e = state.exp;
  if (!e || state.mode === 'ended') return;
  stopTicking();
  state.mode = 'ended';
  e.bestPossible = bestPossible(e);
  // You always bring something home (never less than the floor), unless your whole team is gone.
  e.water = reason === 'alone' ? 0 : Math.max(e.water, e.floor);
  // The graph ends where you came home (after the early-return cost or a flight).
  const lastPt = e.history[e.history.length - 1];
  if (Math.abs(lastPt.water - e.water) > 0.01) {
    e.history.push({ x: lastPt.x + 0.3, water: e.water, kind: e.pity ? 'pity' : reason === 'fled' ? 'fled' : 'step' });
  }
  state.bank += e.water;
  const mult = e.water / e.stake;
  state.best = Math.max(state.best, mult);
  state.expNum++;
  const title = $('end-title');
  const good = mult >= 1;
  title.className = good ? 'win' : 'lose';
  title.textContent = {
    cashout: e.pity ? '😒 Came back too early' : good ? '🏁 Cashed out!' : '🏁 Came back short',
    fled: '🏃 Fled home',
    alone: '🏜️ Abandoned',
    dry: '🏜️ Expedition ended!',
  }[reason];
  $('end-text').textContent = {
    cashout: e.pity ? `You left too early. The disappointed caravan drank ${fmt(e.pity)}💧 to drown their sorrows.`
      : good ? 'The caravan made it back to the oasis.' : 'You cut your losses and turned back.',
    fled: 'You dropped most of your water running away.',
    alone: 'Your whole team was left behind, and all the water with them.',
    dry: 'Morale ran out and your caravan turned back.',
  }[reason];
  // Small profits in a row make the caravan restless; a real haul settles them down.
  const timid = reason === 'cashout' && mult >= 1 && mult < e.expect;
  if (timid) state.timidRuns++;
  else if (mult >= e.expect) state.timidRuns = 0;
  e.timid = timid;
  recordTake(e, reason);
  if (good) audio.score(); else audio.explosion();
  $('end-overlay').classList.remove('hidden');
  drawGraph($('end-graph'), $('end-graph-labels'), e, true);
  updateHud();
}

// ---------- Leaderboard ----------
// Best takes (water brought home) across all runs, kept in this browser.

const TAKES_KEY = 'cewater-takes';
const TAKES_SHOWN = 5;
let lastTakeId = null;

function loadTakes() {
  try { return JSON.parse(localStorage.getItem(TAKES_KEY) || '[]'); } catch { return []; }
}

function recordTake(e, reason) {
  const takes = loadTakes();
  lastTakeId = Date.now();
  takes.push({ id: lastTakeId, home: e.water, stake: e.stake, gain: e.water - e.stake, best: e.bestPossible.water, reason });
  takes.sort((a, b) => b.gain - a.gain);
  try { localStorage.setItem(TAKES_KEY, JSON.stringify(takes.slice(0, 50))); } catch { /* not saved */ }
}


// Demo data so the board has something to climb: rivals, plus three of "your" past runs.
const DEMO_BOARD = [
  { name: 'Zahra', gain: 85 }, { name: 'You', gain: 50, mine: true }, { name: 'Kasim', gain: 41 },
  { name: 'You', gain: 30, mine: true }, { name: 'You', gain: 20, mine: true },
  { name: 'Nadia', gain: 15 }, { name: 'Rook', gain: 8 },
];

function renderLeaderboard() {
  const rows = [
    ...DEMO_BOARD,
    ...loadTakes().map(t => ({ ...t, name: 'You', mine: true, gain: t.gain ?? t.home - t.stake })),
  ].sort((a, b) => b.gain - a.gain);
  const shown = rows.slice(0, TAKES_SHOWN);
  const latest = rows.findIndex(r => r.id && r.id === lastTakeId);
  const row = (r, i) => `<div class="take${r.mine ? ' mine' : ''}${i === latest ? ' latest' : ''}">
      <span class="take-rank">${i + 1}</span>
      <span class="take-name">${r.name}</span>
      <span class="take-home ${r.gain >= 0 ? 'up' : 'down'}">${r.gain >= 0 ? '+' : '−'}${fmt(Math.abs(r.gain))}💧</span>
    </div>`;
  $('leaderboard').innerHTML = shown.map(row).join('')
    + (latest >= TAKES_SHOWN ? `<div class="take-gap">⋯</div>${row(rows[latest], latest)}` : '');
}

function cashOut() {
  if (!state.exp) return;
  // Leaving at a battle is a flight: you keep your characters but drop most of the water.
  if (state.mode === 'encounter') {
    $('prep-screen').classList.add('hidden');
    state.exp.leftWith = state.exp.water;
    state.exp.water *= FLEE_KEEP;
    endExpedition('fled');
    return;
  }
  // Panic-selling mid-scare keeps the low amount; the max still counts what was coming back.
  const e = state.exp;
  if (e.scare) e.leftWith = e.scare.saved;
  // Coming back early disappoints the caravan, and some water goes to drowning their sorrows.
  const pity = pityCost(e);
  if (pity > 0) {
    e.leftWith ??= e.water;
    const before = e.water;
    e.water = Math.max(e.floor, e.water - pity);
    e.pity = before - e.water;
  }
  endExpedition('cashout');
}

// Water the caravan drinks to its disappointment if you cash out now.
function pityCost(e) {
  const seconds = e.step * STEP_MS / 1000;
  return e.stake * PITY_START_PCT * Math.max(0, 1 - seconds / PITY_SECONDS);
}

function setPace(p) {
  pace = p;
  document.querySelectorAll('.pace').forEach(b => b.classList.toggle('active', Number(b.dataset.pace) === p));
  if (trekTimer) startTicking();
}

// ---------- Wiring (oasis and trek) ----------

$('btn-setout').addEventListener('click', setOut);
$('btn-cashout').addEventListener('click', cashOut);
$('btn-enc-cashout').addEventListener('click', cashOut);
$('btn-trek-pause').addEventListener('click', () => {
  trekPaused = !trekPaused;
  $('btn-trek-pause').textContent = trekPaused ? '▶ Resume' : '⏸ Pause';
  $('btn-trek-pause').classList.toggle('active', trekPaused);
  if (trekPaused) stopTicking(); else startTicking();
});
document.querySelectorAll('.pace').forEach(b => b.addEventListener('click', () => setPace(Number(b.dataset.pace))));
$('btn-end-continue').addEventListener('click', () => {
  $('end-overlay').classList.add('hidden');
  // After a timid run the caravan reacts once you're back at camp (over the prep screen).
  const timid = state.exp?.timid;
  rollOffers();
  showOasis();
  if (timid) caravanReacts();
});

// Timid runs (cashing out in profit but under what the caravan expected): the first one gets a warning, then
// characters walk out: 1 on the next timid run in a row, 2 on the one after, and so on, until a
// real haul (or nobody's left).
const DESERT_LINES = [
  "I didn't cross the desert to turn back at the first dune. Find me when you're ready to go all the way.",
  "We keep coming home with a few drops. I need a leader who goes for the real haul.",
  "I signed on for glory and full barrels, not safe little strolls. I'm done waiting.",
  "Every time it gets good, you turn us around. I'll find a caravan with more nerve.",
];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function caravanReacts() {
  const leaveCount = state.timidRuns - TIMID_RUNS + 1;
  $('desert-cards').innerHTML = '';
  if (leaveCount <= 0) {
    $('desert-title').textContent = '😤 The caravan grumbles';
    $('desert-text').textContent = '"All that walking for a few drops? We came out here for a real haul."';
    $('desert-hint').textContent = 'That was a timid run: you came home in profit, but with less than your caravan expected to get. '
      + 'Too many timid runs and characters will leave you.';
  } else {
    if (!state.roster.length) return;
    const gone = [];
    for (let i = 0; i < leaveCount && state.roster.length; i++) {
      const c = pick(state.roster);
      state.roster = state.roster.filter(r => r !== c);
      state.team = state.team.filter(uid => uid !== c.uid);
      gone.push(c);
    }
    if (!state.team.length) state.team = state.roster.slice(0, Math.min(3, teamSlots())).map(r => r.uid);
    const names = gone.map(c => `${CHARACTERS[c.id].emoji} ${CHARACTERS[c.id].name}`);
    $('desert-title').textContent = gone.length === 1 ? `${names[0]} left the caravan` : `${gone.length} left the caravan`;
    $('desert-text').textContent = `"${pick(DESERT_LINES)}"`;
    $('desert-hint').textContent = !state.roster.length
      ? 'Nobody is left. Hire a passing traveler to set out again.'
      : 'Too many timid runs: your caravan expected more from you.';
    for (const c of gone) {
      const def = CHARACTERS[c.id];
      $('desert-cards').appendChild(cardEl(c.id, def.atk + (c.atkBonus ?? 0), def.hp + (c.hpBonus ?? 0)));
    }
    renderPrep();
    audio.explosion();
  }
  $('desert-overlay').classList.remove('hidden');
}

$('btn-desert-continue').addEventListener('click', () => {
  $('desert-overlay').classList.add('hidden');
  renderPrep();
});
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && state.mode === 'trek') { e.preventDefault(); cashOut(); }
});

renderTriggerLegend();
initTriggerTips();
renderModifiers();
renderEventMods();
setPace(1);
newRun();

