import {
  CHARACTERS,
  CLASSES,
  TRIGGERS,
  RECRUITABLE,
  STARTER_PACK_IDS,
  FIRST_UNLOCK_CARD_ID,
  XP_CONFIG,
  UNLOCK_THRESHOLDS,
  getXpThresholdForLevel,
  getLevelFromTotalXp,
  setUnlockedIds,
  getUnlockedIds,
  ensureNextUid,
  isCageCard,
  makeCharacter,
  randomCharacterId,
} from './characters.js';
import { Battle } from './battle.js';
import { SimpleAudio } from '/src/shared/utils.js';
import { initEditor } from './editor.js';

const MIN_TEAM = 1;
const STARTING_ROSTER = 4;

// Team slots per side and camp size are gameplay modifiers (see MODIFIER_DEFAULTS).
const teamSlots = () => state.modifiers.playerSlots;
const enemySlots = () => state.modifiers.enemySlots;
const slotsFor = side => (side === 'player' ? teamSlots() : enemySlots());
const campMax = () => state.modifiers.campMax; // characters not in the team, at all times
const maxExpeditionLoadout = () => teamSlots() + campMax();

const campCount = () => state.roster.length - state.team.length;

const $ = id => document.getElementById(id);
const audio = new SimpleAudio();

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    name: 'Easy',
    emoji: '🟢',
    badge: 'Easy',
    color: '#22c55e',
    pickCount: 1,
    desc: '1–2 enemy cards · Pick 1 reward card on win · Standard stats',
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    emoji: '🟡',
    badge: 'Medium',
    color: '#eab308',
    pickCount: 2,
    desc: '2–3 enemy cards · Pick up to 2 reward cards on win · Standard stats',
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    emoji: '🔴',
    badge: 'Hard',
    color: '#ef4444',
    pickCount: 3,
    desc: '3 buffed cards (+1 to +2 ⚔/❤) · Pick up to 3 reward cards on win',
  },
};

// ─── META-PROGRESSION (XP & CARD UNLOCKS) ───────────────────────────────────
const PROGRESSION_STORAGE_KEY = 'dfp1-progression-v2';

function defaultProgression() {
  return {
    version: 2,
    totalXp: 0,
    level: 0,
    runCount: 0,
    firstRunBonusAwarded: false,
    unlockedCards: [...STARTER_PACK_IDS],
  };
}

let progression = defaultProgression();

function loadProgression() {
  try {
    const saved = localStorage.getItem(PROGRESSION_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      progression = {
        version: 2,
        totalXp: Number(parsed.totalXp) || 0,
        level: Number(parsed.level) || 0,
        runCount: Number(parsed.runCount) || 0,
        firstRunBonusAwarded: Boolean(parsed.firstRunBonusAwarded),
        unlockedCards: Array.isArray(parsed.unlockedCards) && parsed.unlockedCards.length
          ? parsed.unlockedCards.filter(id => CHARACTERS[id] && !CHARACTERS[id].token && !isCageCard(id))
          : [...STARTER_PACK_IDS],
      };
      // Guarantee starter pack is always included
      for (const sp of STARTER_PACK_IDS) {
        if (!progression.unlockedCards.includes(sp)) {
          progression.unlockedCards.push(sp);
        }
      }
      setUnlockedIds(progression.unlockedCards);
      return;
    }
  } catch (err) {
    console.warn('Could not load progression:', err);
  }
  progression = defaultProgression();
  setUnlockedIds(progression.unlockedCards);
}

function saveProgression() {
  try {
    localStorage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(progression));
  } catch (err) {
    console.warn('Could not save progression:', err);
  }
  setUnlockedIds(progression.unlockedCards);
}

function resetProgression() {
  localStorage.removeItem(PROGRESSION_STORAGE_KEY);
  localStorage.removeItem(STASH_STORAGE_KEY);
  progression = defaultProgression();
  setUnlockedIds(progression.unlockedCards);
  saveProgression();
  state.stash = STARTER_PACK_IDS.map(id => makeCharacter(id));
  saveStash();
  state.roster = [];
  state.team = [];
  state.extractCountdown = null;
  state.battleNum = 1;
  state.wins = 0;
  state.ties = 0;
  state.losses = 0;
  if (state.selectedStashUids) state.selectedStashUids.clear();
  renderProgressionPanel();
  renderModifiers();
  if (state.screen === 'home') renderHome();
  else showHome();
}

const state = {
  stash: [],         // [{uid, id}] home stash cards
  roster: [],        // [{uid, id}] expedition loadout (team + camp)
  team: [],          // roster uids, index 0 = front
  selectedStashUids: new Set(), // selected cards on home screen
  battleNum: 1,
  wins: 0,
  losses: 0,
  difficulty: 'easy',     // current battle difficulty: 'easy' | 'medium' | 'hard'
  nextDifficulty: 'easy', // difficulty selected for next battle
  enemy: [],         // [{id, atkBonus, hpBonus}]
  speed: 1,
  inBattle: false,
  screen: 'home',    // 'home' | 'prep' | 'battle' | 'map'
  extractCountdown: null, // legacy extraction countdown
  previewKey: null,  // selected prep card: 'p<rosterUid>' or 'e<index>'
  modifiers: null,   // gameplay modifiers, see MODIFIER_DEFAULTS
  battlePreviewKey: null, // selected battle card: 'b<battle unit uid>'
  paused: false,     // battle is paused while a battle preview is open
  combatStep: 0,     // step count in battle for Balatro speed acceleration
  map: {
    currentNode: 'start',
    visitedNodes: ['start'],
    pendingNode: null,
  },
  runStats: {
    cardsPlayed: 0,
    levelsCleared: 0,
  },
  poolTab: 'unlocked', // 'unlocked' | 'locked'
};

// ---------- Gameplay modifiers ----------

const MODIFIER_DEFAULTS = {
  playerStartsPct: 50,    // chance (0-100) that the player makes the first attack
  rewardFromEnemy: false, // boolean: true = from defeated enemy team that had lost, false = random cards
  keepEnemyBuffs: false,  // boolean: true = recruited cards keep enemy stat buffs (+ATK/+HP)
  playerSlots: 5,         // your team slots (1-10)
  enemySlots: 5,          // enemy team slots (1-10)
  campMax: 10,            // characters in camp (0-20)
};

// Stepper modifiers: range and description
const STEPPERS = {
  playerSlots: { min: 1, max: 10, desc: n => `Up to ${n} character${n === 1 ? '' : 's'} in your team. Lowering it sends the back of your team to camp.` },
  enemySlots: { min: 1, max: 10, desc: n => `Enemy teams start at ${Math.min(4, n)} and grow to ${n} character${n === 1 ? '' : 's'}.` },
  campMax: { min: 0, max: 20, desc: n => (n === 0 ? 'No camp: everyone you own is in your team.' : `Up to ${n} character${n === 1 ? '' : 's'} wait in camp. Lowering it below what's there asks you to discard.`) },
};

function loadModifiers() {
  try {
    const saved = JSON.parse(localStorage.getItem('dfp1-modifiers') || '{}');
    return { ...MODIFIER_DEFAULTS, ...saved };
  } catch {
    return { ...MODIFIER_DEFAULTS };
  }
}

function saveModifiers() {
  try { localStorage.setItem('dfp1-modifiers', JSON.stringify(state.modifiers)); } catch { /* not persisted */ }
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

  const fromEnemy = Boolean(state.modifiers.rewardFromEnemy);
  const toggleBtn = $('mod-reward-toggle');
  const rewardDesc = $('mod-reward-desc');
  const rewardReset = $('mod-reward-reset');
  if (toggleBtn) {
    toggleBtn.textContent = fromEnemy ? 'Defeated Enemy Team 👹' : 'Random Cards 🎲';
    toggleBtn.className = `btn btn-small mod-toggle-btn ${fromEnemy ? 'from-enemy' : 'random'}`;
  }
  if (rewardDesc) {
    rewardDesc.textContent = fromEnemy
      ? 'Victory rewards are chosen from the defeated enemy team that had lost.'
      : 'Victory rewards are rolled randomly from the recruitable character pool.';
  }
  if (rewardReset) {
    rewardReset.disabled = (fromEnemy === MODIFIER_DEFAULTS.rewardFromEnemy);
  }

  const keepBuffs = Boolean(state.modifiers.keepEnemyBuffs);
  const keepBuffsBtn = $('mod-keep-buffs-toggle');
  const keepBuffsDesc = $('mod-keep-buffs-desc');
  const keepBuffsReset = $('mod-keep-buffs-reset');
  if (keepBuffsBtn) {
    keepBuffsBtn.textContent = keepBuffs ? 'Keep Buffs Permanently ⭐' : 'Reset to Base Stats 🔄';
    keepBuffsBtn.className = `btn btn-small mod-toggle-btn ${keepBuffs ? 'keep-buffs' : 'base-stats'}`;
  }
  if (keepBuffsDesc) {
    keepBuffsDesc.textContent = keepBuffs
      ? 'When winning against buffed enemies, recruited cards retain their ATK & HP stat buffs permanently.'
      : 'Recruited cards revert to standard base stats (buffs reset).';
  }
  if (keepBuffsReset) {
    keepBuffsReset.disabled = (keepBuffs === MODIFIER_DEFAULTS.keepEnemyBuffs);
  }

  for (const [key, cfg] of Object.entries(STEPPERS)) {
    const v = state.modifiers[key] ?? MODIFIER_DEFAULTS[key];
    const valEl = $(`mod-${key}-val`);
    const descEl = $(`mod-${key}-desc`);
    const btnDown = document.querySelector(`[data-step="${key}"][data-dir="-1"]`);
    const btnUp = document.querySelector(`[data-step="${key}"][data-dir="1"]`);
    const btnReset = document.querySelector(`[data-reset="${key}"]`);
    if (valEl) valEl.textContent = cfg.label ? cfg.label(v) : v;
    if (descEl) descEl.textContent = cfg.desc(v);
    if (btnDown) btnDown.disabled = v <= cfg.min;
    if (btnUp) btnUp.disabled = v >= cfg.max;
    if (btnReset) btnReset.disabled = v === MODIFIER_DEFAULTS[key];
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

$('mod-reward-toggle')?.addEventListener('click', () => {
  state.modifiers.rewardFromEnemy = !state.modifiers.rewardFromEnemy;
  saveModifiers();
  renderModifiers();
  audio.beep(state.modifiers.rewardFromEnemy ? 560 : 660);
});
$('mod-reward-reset')?.addEventListener('click', () => {
  state.modifiers.rewardFromEnemy = MODIFIER_DEFAULTS.rewardFromEnemy;
  saveModifiers();
  renderModifiers();
  audio.beep(400);
});

$('mod-keep-buffs-toggle')?.addEventListener('click', () => {
  state.modifiers.keepEnemyBuffs = !state.modifiers.keepEnemyBuffs;
  saveModifiers();
  renderModifiers();
  audio.beep(state.modifiers.keepEnemyBuffs ? 640 : 440);
});
$('mod-keep-buffs-reset')?.addEventListener('click', () => {
  state.modifiers.keepEnemyBuffs = MODIFIER_DEFAULTS.keepEnemyBuffs;
  saveModifiers();
  renderModifiers();
  audio.beep(400);
});

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
      const atkBonus = c.atkBonus || 0;
      const hpBonus = c.hpBonus || 0;
      const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, {
        cls: 'discard-option' + (chosen.includes(c.uid) ? ' discarding' : ''),
        atkBonus,
        hpBonus,
      });
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
  const cards = [];
  for (let i = 0; i < count; i++) {
    let id = randomCharacterId();
    if (isCageCard(id)) id = 'dps_start';
    cards.push(makeCharacter(id));
  }
  return cards;
}

const STASH_STORAGE_KEY = 'dfp1-stash-v2';

function loadStash() {
  try {
    const raw = localStorage.getItem(STASH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let maxUid = 0;
        for (const c of parsed) {
          if (c && typeof c.uid === 'number' && c.uid > maxUid) maxUid = c.uid;
        }
        ensureNextUid(maxUid + 1);
        const valid = parsed.filter(c => c && c.id && CHARACTERS[c.id] && !isCageCard(c.id));
        if (valid.length > 0) return valid;
      }
    }
  } catch (err) {
    console.warn('Failed to load stash:', err);
  }
  // Start with the 4-card Starter Pack (claw strike, healer doe, thick skin, death curse)
  const initial = STARTER_PACK_IDS.map(id => makeCharacter(id));
  try {
    localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(initial));
  } catch {}
  return initial;
}

function saveStash() {
  try {
    localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(state.stash));
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
  // Modifiers panel permanently resides inside the bottom-left modal window
}

// ---------- Home Screen ----------

function showHome() {
  state.screen = 'home';
  state.inBattle = false;
  state.previewKey = null;
  state.extractCountdown = null;
  stopIdleCycle();

  $('home-screen').classList.remove('hidden');
  $('map-screen')?.classList.add('hidden');
  $('prep-screen').classList.add('hidden');
  $('battle-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  $('discard-overlay').classList.add('hidden');

  if (!state.selectedStashUids) {
    state.selectedStashUids = new Set();
  }
  // Remove uids no longer in stash
  const stashUids = new Set(state.stash.map(c => c.uid));
  for (const uid of state.selectedStashUids) {
    if (!stashUids.has(uid)) state.selectedStashUids.delete(uid);
  }

  updateHud();
  renderModifiers();
  renderHome();
}

function renderHome() {
  updateHud();
  renderProgressionPanel();
  const max = maxExpeditionLoadout();
  const currentCount = state.selectedStashUids ? state.selectedStashUids.size : 0;

  if ($('loadout-count')) $('loadout-count').textContent = currentCount;
  if ($('loadout-max')) $('loadout-max').textContent = max;
  if ($('loadout-formula')) $('loadout-formula').textContent = `(Team slots: ${teamSlots()} + Camp size: ${campMax()})`;
  if ($('stash-count')) $('stash-count').textContent = state.stash.length;

  const btnGo = $('btn-go-expedition');
  btnGo.disabled = currentCount < MIN_TEAM;
  btnGo.textContent = currentCount < MIN_TEAM
    ? `Select at least ${MIN_TEAM} card`
    : `⚔️ Go Expedition (${currentCount} cards)`;

  const selectedContainer = $('selected-loadout-cards');
  const stashContainer = $('stash-cards');
  if (selectedContainer) selectedContainer.innerHTML = '';
  if (stashContainer) stashContainer.innerHTML = '';

  const selectedCards = [];
  const unselectedCards = [];

  for (const c of state.stash) {
    if (!c || !c.id) continue;
    if (state.selectedStashUids && state.selectedStashUids.has(c.uid)) {
      selectedCards.push(c);
    } else {
      unselectedCards.push(c);
    }
  }

  // 1. Render Selected Cards Window (Higher on screen, no header text)
  if (selectedContainer) {
    if (selectedCards.length === 0) {
      selectedContainer.innerHTML = '';
    } else {
      for (const c of selectedCards) {
        const d = CHARACTERS[c.id];
        if (!d) continue;
        const atkBonus = c.atkBonus || 0;
        const hpBonus = c.hpBonus || 0;
        const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, {
          cls: 'stash-card clickable selected',
          atkBonus,
          hpBonus,
        });

        el.addEventListener('click', () => {
          state.selectedStashUids.delete(c.uid);
          audio.beep(400);
          renderHome();
        });
        selectedContainer.appendChild(el);
      }
    }
  }

  // 2. Render Stash Cards (The Oasis)
  if (stashContainer) {
    if (state.stash.length === 0) {
      stashContainer.innerHTML = '<div class="hint" style="padding:20px;font-size:14px;color:#c9a97f;">The Oasis is empty. Embark using "Expedition with Starter Pack" above to explore and acquire new cards!</div>';
    } else if (unselectedCards.length === 0) {
      stashContainer.innerHTML = '<div class="hint" style="padding:20px;font-size:14px;color:#c9a97f;">All cards from The Oasis are in your selected loadout window above.</div>';
    } else {
      for (const c of unselectedCards) {
        const d = CHARACTERS[c.id];
        if (!d) continue;
        const atkBonus = c.atkBonus || 0;
        const hpBonus = c.hpBonus || 0;
        const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, {
          cls: 'stash-card clickable',
          atkBonus,
          hpBonus,
        });

        el.addEventListener('click', () => {
          if (state.selectedStashUids.size >= maxExpeditionLoadout()) {
            audio.beep(250);
            return;
          }
          state.selectedStashUids.add(c.uid);
          audio.beep(550);
          renderHome();
        });
        stashContainer.appendChild(el);
      }
    }
  }

  renderProgressionPanel();
}

function renderProgressionPanel() {
  const currentLvl = progression.level;
  const currentXp = progression.totalXp;
  const currThresh = getXpThresholdForLevel(currentLvl);
  const nextThresh = getXpThresholdForLevel(currentLvl + 1);

  const lvlBadge = $('home-lvl-badge');
  if (lvlBadge) lvlBadge.textContent = `Level ${currentLvl}`;

  const totalXpEl = $('home-total-xp');
  if (totalXpEl) totalXpEl.textContent = `${currentXp} XP`;

  const runCountEl = $('home-run-count');
  if (runCountEl) runCountEl.textContent = `${progression.runCount}`;

  const ratioEl = $('home-unlocked-ratio');
  if (ratioEl) ratioEl.textContent = `${progression.unlockedCards.length} / ${RECRUITABLE.length}`;

  const nextLbl = $('home-next-level-label');
  if (nextLbl) {
    nextLbl.textContent = currentLvl === 0
      ? 'Level 1 (Swiftbeak 🦅)'
      : `Level ${currentLvl + 1}`;
  }

  const progressText = $('home-xp-progress-text');
  const span = Math.max(1, nextThresh - currThresh);
  const progressInLvl = Math.max(0, currentXp - currThresh);
  const pct = Math.min(100, Math.max(0, Math.round((progressInLvl / span) * 100)));
  const fill = $('home-xp-fill');
  if (fill) fill.style.width = pct + '%';
  if (progressText) {
    const diff = Math.max(0, nextThresh - currentXp);
    progressText.textContent = `${currentXp} / ${nextThresh} XP (${diff} XP needed)`;
  }

  const silBadge = $('silhouette-badge');
  if (silBadge) silBadge.textContent = `Lvl ${currentLvl + 1}`;
  const silTarget = $('card-silhouette-target');
  if (silTarget) {
    silTarget.title = currentLvl === 0
      ? 'Next Card Reward: Swiftbeak 🦅 (Guaranteed at Level 1)'
      : `Next Card Reward: 1 Random Card (at Level ${currentLvl + 1})`;
  }

  const firstRunChip = $('rule-first-run-chip');
  if (firstRunChip) {
    if (progression.firstRunBonusAwarded) {
      firstRunChip.innerHTML = '<span style="opacity:0.5;text-decoration:line-through;">🌟 First Run: +50 XP</span> <b style="color:#86efac;font-size:10px;">✔ Claimed</b>';
    } else {
      firstRunChip.innerHTML = '🌟 First Run Bonus: <b>+50 XP</b> (Run 1)';
    }
  }

  // Update tabs
  const unlockedCount = $('unlocked-count');
  if (unlockedCount) unlockedCount.textContent = progression.unlockedCards.length;

  const lockedCards = RECRUITABLE.filter(id => !progression.unlockedCards.includes(id));
  const lockedCount = $('locked-count');
  if (lockedCount) lockedCount.textContent = lockedCards.length;

  const tabUnlocked = $('tab-unlocked-pool');
  const tabLocked = $('tab-locked-pool');
  const tabHint = $('pool-tab-hint');
  if (tabUnlocked && tabLocked) {
    tabUnlocked.classList.toggle('active', state.poolTab === 'unlocked');
    tabLocked.classList.toggle('active', state.poolTab === 'locked');
  }

  const poolContainer = $('pool-cards-container');
  if (!poolContainer) return;
  poolContainer.innerHTML = '';

  if (state.poolTab === 'unlocked') {
    if (tabHint) tabHint.textContent = 'These cards are in the active enemy spawn pool and can be met in combat and recruited on victory.';
    for (const id of progression.unlockedCards) {
      const def = CHARACTERS[id];
      if (!def) continue;
      const isStarter = STARTER_PACK_IDS.includes(id);
      const el = cardEl(id, def.atk, def.hp, {
        cls: isStarter ? 'starter-pack-card' : 'spawn-pool-card',
      });
      const tag = frontTag();
      tag.textContent = isStarter ? 'STARTER PACK 🌟' : 'SPAWN POOL 👹';
      el.appendChild(tag);
      poolContainer.appendChild(el);
    }
  } else {
    if (tabHint) tabHint.textContent = 'Locked cards will NEVER spawn as enemies. Level up via XP to unlock 1 card per level (Swiftbeak first, then random)!';
    if (lockedCards.length === 0) {
      poolContainer.innerHTML = '<div class="hint" style="padding:20px;font-size:15px;color:#86efac;">🎉 All cards in the game have been unlocked!</div>';
      return;
    }
    for (const id of lockedCards) {
      const def = CHARACTERS[id];
      if (!def) continue;
      const isNextFirstUnlock = (id === FIRST_UNLOCK_CARD_ID && lockedCards.includes(FIRST_UNLOCK_CARD_ID));
      const el = cardEl(id, def.atk, def.hp, {
        cls: 'locked-card' + (isNextFirstUnlock ? ' next-unlock-card' : ''),
      });
      const lockOverlay = document.createElement('div');
      lockOverlay.className = 'card-lock-overlay';
      lockOverlay.textContent = isNextFirstUnlock ? '🦅' : '🔒';
      el.appendChild(lockOverlay);
      const tag = frontTag();
      if (isNextFirstUnlock) {
        tag.textContent = 'NEXT UNLOCK 🦅';
        tag.style.background = '#0ea5e9';
        tag.style.color = '#ffffff';
      } else {
        tag.textContent = 'LOCKED 🔒';
        tag.style.background = '#4a321d';
        tag.style.color = '#c9a97f';
      }
      el.appendChild(tag);
      poolContainer.appendChild(el);
    }
  }
}

function initProgressionEvents() {
  $('tab-unlocked-pool')?.addEventListener('click', () => {
    state.poolTab = 'unlocked';
    renderProgressionPanel();
    audio.beep(520);
  });
  $('tab-locked-pool')?.addEventListener('click', () => {
    state.poolTab = 'locked';
    renderProgressionPanel();
    audio.beep(460);
  });
  $('btn-reset-progression')?.addEventListener('click', () => {
    if (confirm('Reset all cards to the first 4 (Claw Strike, Healer Doe, Thick Skin, Death Curse) and reset Level to 0?')) {
      resetProgression();
      audio.explosion();
    }
  });
  $('mod-reset-progression')?.addEventListener('click', () => {
    if (confirm('Reset all cards to the first 4 (Claw Strike, Healer Doe, Thick Skin, Death Curse) and reset Level to 0?')) {
      resetProgression();
      audio.explosion();
    }
  });
}

function startExpedition() {
  const selectedUids = state.selectedStashUids;
  if (!selectedUids || selectedUids.size < MIN_TEAM) return;

  const selectedCards = state.stash.filter(c => selectedUids.has(c.uid) && !isCageCard(c.id));
  state.stash = state.stash.filter(c => !selectedUids.has(c.uid));
  saveStash();
  state.selectedStashUids.clear();

  state.roster = selectedCards;
  const initialTeamSize = Math.min(teamSlots(), state.roster.length);
  state.team = state.roster.slice(0, initialTeamSize).map(c => c.uid);

  state.battleNum = 0;
  state.wins = 0;
  state.ties = 0;
  state.losses = 0;
  state.difficulty = 'easy';
  state.nextDifficulty = 'easy';
  state.extractCountdown = null;
  state.map = {
    currentNode: 'start',
    visitedNodes: ['start'],
    pendingNode: null,
  };

  // Reset runStats for the new expedition
  state.runStats = {
    cardsPlayed: 0,
    levelsCleared: 0,
  };

  showMap();
}

// ---------- Run setup ----------

function newRun() {
  // Start with up to 6 characters that fit the team slots + camp; 3 in the team (more if the camp can't hold the rest).
  const start = Math.min(STARTING_ROSTER, teamSlots() + campMax());
  state.roster = Array.from({ length: start }, () => makeCharacter(randomCharacterId()));
  const teamSize = Math.max(Math.min(3, teamSlots()), start - campMax());
  state.team = state.roster.slice(0, teamSize).map(c => c.uid);
  state.battleNum = 0;
  state.wins = 0;
  state.ties = 0;
  state.losses = 0;
  state.difficulty = 'easy';
  state.nextDifficulty = 'easy';
  state.map = {
    currentNode: 'start',
    visitedNodes: ['start'],
    pendingNode: null,
  };
  showMap();
}

function generateEnemy(n, difficulty = state.difficulty || 'easy') {
  // First battle is always easy
  if (n === 1) difficulty = 'easy';

  let fighterCount = 1;
  let getFighterStats = () => ({ atkBonus: 0, hpBonus: 0 });

  if (difficulty === 'easy') {
    // Easy: 1-2 enemy cards (70% 1, 30% 2 - most of the time only 1 slot is occupied)
    fighterCount = Math.random() < 0.70 ? 1 : 2;
    getFighterStats = () => ({ atkBonus: 0, hpBonus: 0 });
  } else if (difficulty === 'medium') {
    // Medium: 2-3 enemy cards
    fighterCount = Math.random() < 0.50 ? 2 : 3;
    getFighterStats = () => ({ atkBonus: 0, hpBonus: 0 });
  } else if (difficulty === 'hard') {
    // Hard: 3 cards, and +1 or +2 to attack and defense (randomly) to the enemy cards
    fighterCount = 3;
    getFighterStats = () => ({
      atkBonus: 1 + Math.floor(Math.random() * 2), // +1 or +2
      hpBonus: 1 + Math.floor(Math.random() * 2),  // +1 or +2
    });
  }

  return Array.from({ length: fighterCount }, () => {
    const stats = getFighterStats();
    return {
      id: randomCharacterId(),
      atkBonus: stats.atkBonus,
      hpBonus: stats.hpBonus,
    };
  });
}

// The enemy slots modifier changed: refresh opponent with matching size.
function fitEnemyToSlots() {
  state.enemy = generateEnemy(state.battleNum, state.difficulty);
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
  const el = $('trigger-legend');
  if (!el) return;
  el.innerHTML = Object.entries(TRIGGERS)
    .map(([key, t]) => `<span class="legend-item" data-trigger="${key}"><span class="trig">${t.emoji}</span> ${t.name}</span>`)
    .join('');
}

function renderClassLegend() {
  const el = $('class-legend');
  if (!el) return;
  el.innerHTML = Object.entries(CLASSES)
    .map(([key, c]) =>
      `<span class="class-legend-item" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${c.emoji ? c.emoji + ' ' : ''}${c.label}</span>`)
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
  const def = CHARACTERS[id] || { name: id || 'Unknown', emoji: '❓', atk: atk || 1, hp: hp || 1, text: '', class: 'dps', token: false };
  atk = atk ?? def.atk;
  hp = hp ?? def.hp;
  const cls = def.class || null;
  const clsDef = cls ? CLASSES[cls] : null;
  const el = document.createElement('div');
  el.className = 'card'
    + (def.token ? ' token' : '')
    + (cls ? ` class-${cls}` : '')
    + (opts.cls ? ' ' + opts.cls : '');

  const hasBuff = ((opts.atkBonus || 0) > 0 || (opts.hpBonus || 0) > 0);
  const buffBadge = hasBuff
    ? `<div class="hard-buff-badge">+${opts.atkBonus || 0}⚔/+${opts.hpBonus || 0}❤</div>`
    : '';

  const classEmoji = clsDef ? (clsDef.emoji || '⭐') : '';
  const classLabel = clsDef ? clsDef.label : '';

  const noise = opts.noise ?? def.noise ?? 1;

  el.innerHTML = `
    <div class="noise-badge" title="Noise: added to your team's noise every time this card attacks at the front">🔊<b class="noise-val">${noise}</b></div>
    ${clsDef ? `<div class="class-badge" data-class="${cls}" title="${classLabel}" style="background:${clsDef.color}22;color:${clsDef.color};border:1px solid ${clsDef.color}55"><span class="class-badge-emoji">${classEmoji}</span><span class="class-badge-label">${classLabel}</span></div>` : ''}
    ${buffBadge}
    <div class="card-emoji">${def.emoji}</div>
    <div class="card-name">${def.name}</div>
    <div class="card-text">${def.text ? withTriggerTips(def.text) : '<i>Summoned token</i>'}</div>
    <div class="card-stats">
      <span class="stat atk${(opts.atkBonus || 0) > 0 ? ' stat-up' : ''}">⚔ <b class="atk-val">${atk}</b></span>
      <span class="shield-icon trig" data-tip="shield">🛡</span>
      <span class="stat hp${(opts.hpBonus || 0) > 0 ? ' stat-up' : ''}">❤ <b class="hp-val">${hp}</b></span>
    </div>`;
  // On the character emoji only, so it doesn't stack with the trigger emoji tooltip.
  el.querySelector('.card-emoji').title = def.text;
  return el;
}

function updateHud() {
  const lvlEl = $('hud-level');
  if (lvlEl) lvlEl.textContent = progression.level;
  const xpCurrEl = $('hud-xp-curr');
  if (xpCurrEl) xpCurrEl.textContent = progression.totalXp;
  const xpTargetEl = $('hud-xp-target');
  if (xpTargetEl) xpTargetEl.textContent = getXpThresholdForLevel(progression.level + 1);

  if ($('hud-battle')) {
    const diffInfo = DIFFICULTIES[state.difficulty || 'easy'];
    $('hud-battle').textContent = state.screen === 'home' ? 'Base' : `${state.battleNum} (${diffInfo.badge})`;
  }
  if ($('hud-wins')) $('hud-wins').textContent = state.screen === 'home' ? '0' : (state.wins || 0);
  if ($('hud-ties')) $('hud-ties').textContent = state.screen === 'home' ? '0' : (state.ties || 0);
  if ($('hud-losses')) $('hud-losses').textContent = state.screen === 'home' ? '0' : (state.losses || 0);
  if ($('hud-roster')) $('hud-roster').textContent = state.screen === 'home' ? '--' : `${campCount()}/${campMax()}`;
  if ($('hud-stash-count')) $('hud-stash-count').textContent = state.stash ? state.stash.length : 0;
  if ($('btn-evac-base')) $('btn-evac-base').classList.toggle('hidden', state.screen === 'home' || state.inBattle);
  if ($('btn-view-map')) $('btn-view-map').classList.toggle('hidden', state.screen === 'home' || state.screen === 'map' || state.inBattle || !state.map);

  const extractEl = $('hud-extract-status');
  if (extractEl) {
    if (state.screen === 'home') {
      extractEl.textContent = 'At Base';
      extractEl.className = '';
    } else if (state.extractCountdown === null) {
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
}

// ─── EXPEDITION MAP DEFINITIONS ──────────────────────────────────────────────
// Topology matching the reference image: 9 diamond tiles in an isometric grid.
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

function canReachExtraction(startId, visitedSet) {
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

function getMapIconSvg(iconType) {
  if (iconType === 'start') {
    return `<svg viewBox="0 0 36 36" class="tile-svg" style="transform: rotate(45deg);"><path d="M23 28 L11 18 L23 8" fill="none" stroke="#2b1408" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (iconType === 'sword') {
    return `<svg viewBox="0 0 36 36" class="tile-svg"><line x1="10" y1="26" x2="25" y2="11" stroke="#2b1408" stroke-width="4.5" stroke-linecap="round"/><polygon points="23,9 27,9 27,13" fill="#2b1408"/><line x1="8" y1="21" x2="15" y2="28" stroke="#2b1408" stroke-width="3.5" stroke-linecap="round"/><circle cx="7" cy="29" r="2.5" fill="#2b1408"/></svg>`;
  }
  if (iconType === 'swords2') {
    return `<svg viewBox="0 0 36 36" class="tile-svg"><line x1="8" y1="28" x2="28" y2="8" stroke="#2b1408" stroke-width="4" stroke-linecap="round"/><line x1="8" y1="20" x2="16" y2="28" stroke="#2b1408" stroke-width="3" stroke-linecap="round"/><line x1="28" y1="28" x2="8" y2="8" stroke="#2b1408" stroke-width="4" stroke-linecap="round"/><line x1="28" y1="20" x2="20" y2="28" stroke="#2b1408" stroke-width="3" stroke-linecap="round"/></svg>`;
  }
  if (iconType === 'skull') {
    return `<svg viewBox="0 0 36 36" class="tile-svg"><path d="M8 18 C8 10 12 6 18 6 C24 6 28 10 28 18 C28 22 25 24 23 24 L23 28 C23 29 22 30 21 30 L15 30 C14 30 13 29 13 28 L13 24 C11 24 8 22 8 18 Z" fill="#2b1408"/><circle cx="14" cy="16" r="2.8" fill="#e0534b"/><circle cx="22" cy="16" r="2.8" fill="#e0534b"/><line x1="16" y1="26" x2="16" y2="29" stroke="#e0534b" stroke-width="2" stroke-linecap="round"/><line x1="20" y1="26" x2="20" y2="29" stroke="#e0534b" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  if (iconType === 'door') {
    return `<svg viewBox="0 0 36 36" class="tile-svg"><line x1="5" y1="29" x2="31" y2="29" stroke="#10324d" stroke-width="3.5" stroke-linecap="round"/><path d="M9 29 L9 11 C9 8 12 6 15 6 L23 6 C26 6 27 8 27 11 L27 16" fill="none" stroke="#10324d" stroke-width="3.5" stroke-linecap="round"/><path d="M9 11 L18 14 L18 29" fill="none" stroke="#10324d" stroke-width="3.5" stroke-linecap="round"/><line x1="14" y1="20" x2="30" y2="20" stroke="#10324d" stroke-width="3.5" stroke-linecap="round"/><polyline points="24,14 30,20 24,26" fill="none" stroke="#10324d" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return '';
}

function showMap() {
  state.screen = 'map';
  state.inBattle = false;
  $('home-screen').classList.add('hidden');
  $('prep-screen').classList.add('hidden');
  $('battle-screen').classList.add('hidden');
  $('map-screen').classList.remove('hidden');
  $('result-overlay').classList.add('hidden');
  $('discard-overlay').classList.add('hidden');
  updateHud();
  renderMap();
}

function renderMap() {
  const tilesLayer = $('map-tiles-layer');
  const svg = $('map-connections-svg');
  if (!tilesLayer || !svg) return;

  tilesLayer.innerHTML = '';
  svg.innerHTML = '';

  $('map-squad-count').textContent = state.roster ? state.roster.length : 0;
  $('map-battles-won').textContent = state.wins || 0;

  const btnToPrep = $('btn-map-to-prep');
  if (btnToPrep) {
    btnToPrep.classList.toggle('hidden', !state.map?.pendingNode);
    btnToPrep.onclick = () => showPrep();
  }

  const currNodeId = state.map ? state.map.currentNode : 'start';
  const visited = new Set(state.map?.visitedNodes || ['start']);
  const currNode = MAP_NODES[currNodeId];
  const reachable = new Set(currNode ? currNode.neighbors.filter(id => !visited.has(id) && canReachExtraction(id, visited)) : []);

  // Hint text
  const hintEl = $('map-hint');
  if (hintEl) {
    if (currNodeId === 'start') {
      hintEl.textContent = 'Expedition Ready! Click the adjacent Easy Battle (1 Sword) to begin your run.';
    } else {
      const hasExtract = [...reachable].some(id => MAP_NODES[id]?.type === 'extract');
      hintEl.textContent = hasExtract
        ? 'Extraction Zone in reach! Click an extraction door (🚪➔) to secure your cards, or push into battle.'
        : 'Select an adjacent battle tile to advance your squad deeper into the desert.';
    }
  }

  // 1. Draw connection lines
  const drawnEdges = new Set();
  for (const [id, node] of Object.entries(MAP_NODES)) {
    for (const nId of node.neighbors) {
      const edgeKey = [id, nId].sort().join('-');
      if (drawnEdges.has(edgeKey)) continue;
      drawnEdges.add(edgeKey);

      const target = MAP_NODES[nId];
      if (!target) continue;

      const isTraversed = visited.has(id) && visited.has(nId);
      const isActive = (id === currNodeId && reachable.has(nId)) || (nId === currNodeId && reachable.has(id));

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', node.x);
      line.setAttribute('y1', node.y);
      line.setAttribute('x2', target.x);
      line.setAttribute('y2', target.y);
      line.setAttribute('class', `map-path-line ${isActive ? 'active' : ''} ${isTraversed ? 'cleared' : ''}`);
      svg.appendChild(line);
    }
  }

  // 2. Draw 9 diamond tiles
  for (const [id, node] of Object.entries(MAP_NODES)) {
    const isCurrent = (id === currNodeId);
    const isVisited = visited.has(id);
    const isReachable = reachable.has(id);

    const el = document.createElement('div');
    el.className = `map-tile tile-${node.type} tile-${node.id}`
      + (node.difficulty ? ` tile-${node.difficulty}` : '')
      + (isReachable ? ' reachable' : '')
      + (isVisited && !isCurrent ? ' visited' : '')
      + (isCurrent ? ' player-here' : '');

    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    if (node.color) {
      el.style.backgroundColor = node.color;
    }

    el.innerHTML = `
      <div class="tile-inner">
        ${getMapIconSvg(node.icon)}
      </div>
      ${isVisited && !isCurrent && node.type !== 'start' ? '<div class="tile-cleared-badge">✔</div>' : ''}
      ${isCurrent ? '<div class="tile-player-marker">🤠 YOU</div>' : ''}
    `;

    if (isReachable) {
      el.addEventListener('click', () => onTileClick(id));
    }

    tilesLayer.appendChild(el);
  }
}

function onTileClick(nodeId) {
  const node = MAP_NODES[nodeId];
  if (!node) return;

  const curr = MAP_NODES[state.map?.currentNode || 'start'];
  if (!curr || !curr.neighbors.includes(nodeId)) return;
  if (state.map?.visitedNodes?.includes(nodeId)) return;
  if (!canReachExtraction(nodeId, state.map?.visitedNodes || ['start'])) return;

  if (node.type === 'extract') {
    extractFromMap(nodeId);
    return;
  }

  if (node.type === 'battle') {
    state.map.pendingNode = nodeId;
    state.difficulty = node.difficulty || 'easy';
    state.nextDifficulty = node.difficulty || 'easy';
    state.battleNum = (state.battleNum || 0) + 1;
    state.enemy = generateEnemy(state.battleNum, state.difficulty);
    audio.beep(520);
    showPrep();
  }
}

function extractFromMap(nodeId) {
  audio.score();
  if (!state.map) state.map = { currentNode: nodeId, visitedNodes: [nodeId] };
  state.map.currentNode = nodeId;
  if (!state.map.visitedNodes.includes(nodeId)) {
    state.map.visitedNodes.push(nodeId);
  }

  const extractedCount = state.roster.length;
  state.stash.push(...state.roster);
  saveStash();

  const savedRoster = [...state.roster];
  state.roster = [];
  state.team = [];
  state.inBattle = false;
  state.map.pendingNode = null;
  updateHud();

  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btnContinue = $('btn-continue');
  const btnReturnHome = $('btn-return-home');

  $('result-squad-preview')?.classList.add('hidden');
  $('result-discard-wrap')?.classList.add('hidden');

  title.textContent = 'Extraction Successful! 🚁';
  title.className = 'win';
  text.textContent = `You reached the extraction point and safely evacuated! All ${extractedCount} squad cards have been deposited into your Base Stash.`;

  cards.innerHTML = '';
  for (const c of savedRoster) {
    const d = CHARACTERS[c.id];
    const atkBonus = c.atkBonus || 0;
    const hpBonus = c.hpBonus || 0;
    const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
    const tag = frontTag();
    tag.textContent = 'EXTRACTED';
    tag.style.background = '#f2a541';
    tag.style.color = '#082f49';
    el.appendChild(tag);
    cards.appendChild(el);
  }

  btnContinue.classList.add('hidden');
  btnReturnHome.classList.remove('hidden');
  btnReturnHome.textContent = 'Return to Home Stash 🏠';
  btnReturnHome.onclick = () => {
    $('result-overlay').classList.add('hidden');
    showHome();
  };

  const debrief = finalizeRunXp(true);
  renderDebrief(debrief, 'success');
  $('result-overlay').classList.remove('hidden');
}

// ---------- Prep screen ----------

function showPrep() {
  state.screen = 'prep';
  state.inBattle = false;
  $('home-screen').classList.add('hidden');
  $('map-screen')?.classList.add('hidden');
  $('prep-screen').classList.remove('hidden');
  $('battle-screen').classList.add('hidden');
  $('result-overlay').classList.add('hidden');
  $('discard-overlay').classList.add('hidden');
  renderModifiers();
  renderPrep();
  resetIdle();
}

function renderPrep() {
  updateHud();

  const diffInfo = DIFFICULTIES[state.difficulty || 'easy'];
  const badgeEl = $('prep-difficulty-badge');
  if (badgeEl) {
    badgeEl.textContent = `${diffInfo.emoji} ${diffInfo.badge}`;
    badgeEl.className = `diff-badge badge-${diffInfo.id}`;
  }

  // Update prep difficulty picker buttons
  document.querySelectorAll('#prep-difficulty-picker .diff-pill').forEach(btn => {
    const diff = btn.dataset.diff;
    btn.classList.toggle('active', diff === state.difficulty);
    btn.disabled = state.battleNum === 1;
    if (state.battleNum === 1 && diff !== 'easy') {
      btn.title = 'Battle 1 is always Easy';
    } else {
      btn.title = `Switch to ${DIFFICULTIES[diff].name}`;
    }
  });

  const lineup = { player: [], enemy: [] };

  const enemyRow = $('enemy-preview');
  enemyRow.innerHTML = '';
  state.enemy.forEach((e, i) => {
    const d = CHARACTERS[e.id];
    const el = cardEl(e.id, d.atk + e.atkBonus, d.hp + e.hpBonus, {
      atkBonus: e.atkBonus,
      hpBonus: e.hpBonus,
    });
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
      dropTarget(empty, d => {
        const charId = d.id || state.roster.find(r => r.uid === d.uid)?.id;
        return !isCageCard(charId);
      }, d => {
        if (d.from === 'team') state.team.splice(state.team.indexOf(d.uid), 1);
        state.team.push(d.uid);
      });
      teamRow.appendChild(empty);
      continue;
    }
    const c = state.roster.find(r => r.uid === uid);
    const d = CHARACTERS[c.id];
    const atkBonus = c.atkBonus || 0;
    const hpBonus = c.hpBonus || 0;
    const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
    if (i === 0) el.appendChild(frontTag());
    makeDraggable(el, 'team', uid);
    // Camp card dropped here: swap (this one goes to camp). Team card: swap the two slots.
    dropTarget(el, d => {
      if (d.uid === uid) return false;
      const charId = d.id || state.roster.find(r => r.uid === d.uid)?.id;
      return !isCageCard(charId);
    }, d => {
      if (d.from === 'camp') state.team[i] = d.uid;
      else swap(state.team.indexOf(d.uid), i, false);
    });
    lineup.player.push(previewable(el, `p${uid}`, 'player', c.id, d.atk + atkBonus, d.hp + hpBonus));
    teamRow.appendChild(el);
  }

  // Camp: everyone not in the team
  const campRow = $('roster');
  campRow.innerHTML = '';
  for (const c of state.roster.filter(r => !state.team.includes(r.uid))) {
    const d = CHARACTERS[c.id];
    const atkBonus = c.atkBonus || 0;
    const hpBonus = c.hpBonus || 0;
    const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { cls: 'clickable', atkBonus, hpBonus });
    el.addEventListener('click', () => {
      if (isCageCard(c.id)) return;
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
  const fightHintEl = $('fight-hint');
  if (fightHintEl) {
    fightHintEl.textContent = ok
      ? ''
      : `Pick at least ${MIN_TEAM} character${MIN_TEAM > 1 ? 's' : ''}`;
    fightHintEl.classList.toggle('hidden', ok);
  }

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
  if (info) {
    info.innerHTML = '';
    info.classList.add('hidden');
  }
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
    // Dead cards wait at the back of the row, so it may hold more than the slot count.
    rowFit($('battle-player'), Math.max(teamSlots(), $('battle-player').querySelectorAll(':scope > .card:not(.over-slot)').length)),
    rowFit($('battle-enemy'), Math.max(enemySlots(), $('battle-enemy').querySelectorAll(':scope > .card:not(.over-slot)').length)),
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
          el = cardEl(u.id, u.atk, u.hp, { cls: 'selectable combat-card', atkBonus: u.atkBonus || 0, hpBonus: u.hpBonus || 0 });
          el.addEventListener('click', (e) => {
            if (el.classList.contains('dead')) return;
            const isPop = el.classList.contains('pop-open');
            document.querySelectorAll('.arena .card.pop-open').forEach(c => c.classList.remove('pop-open'));
            if (!isPop) el.classList.add('pop-open');
            toggleBattlePreview(`b${u.uid}`);
            e.stopPropagation();
          });
          cardMap.set(u.uid, el);
        }
        el.querySelector('.atk-val').textContent = u.atk;
        el.querySelector('.hp-val').textContent = Math.max(0, u.hp);
        el.classList.toggle('shielded', u.shield);
        el.classList.toggle('front', u === battle.teams[side][0]);
        el.classList.toggle('doomed', battle.isLingering(u));
        const dead = battle.isDead(u);
        el.classList.toggle('dead', dead);
        if (dead) el.classList.remove('dying', 'front');
        // More cards than slots (e.g. summons while a dying card still lingers): the extras at the
        // back stay hidden until there's room for them again. Dead cards always show at the back.
        el.classList.toggle('over-slot', !dead && i >= battle.maxTeam[side]);
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
  noise(u, amount, total) {
    this.float(u, `+${amount}🔊`, 'noise');
    setNoiseCounter(u.side, total, true);
    audio.beep(u.side === 'player' ? 300 : 260, 90);
  },
  flash(u, cls) {
    const el = cardMap.get(u.uid);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart animation
    el.classList.add(cls);
    if (cls === 'ability') {
      el.classList.add('pop-open');
      const accel = Math.max(0.28, Math.pow(0.965, state.combatStep || 0));
      const duration = Math.max(250, (1500 * accel) / (state.speed || 1));
      setTimeout(() => el.classList.remove('pop-open'), duration);
    }
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

    if (source instanceof Element) {
      source.classList.add('pop-open');
    }

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
    const accel = Math.max(0.28, Math.pow(0.965, state.combatStep || 0));
    await snakeArrows(drawn, Math.round(250 * accel), Math.round(700 * accel));
    ui.svg.innerHTML = '';
    if (source instanceof Element) {
      source.classList.remove('preview-source');
      source.classList.remove('pop-open');
    }
  },
  // Also holds the battle here while it's paused for a preview.
  async wait(ms) {
    state.combatStep = (state.combatStep || 0) + 1;
    const accel = Math.max(0.28, Math.pow(0.965, state.combatStep));
    const effectiveSpeed = (state.speed || 1) / accel;
    await new Promise(r => setTimeout(r, ms / effectiveSpeed));
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

// Triggers first arrow removed per user request
function showFirstBanner(side) {}

async function startBattle() {
  if (state.inBattle) return;
  state.inBattle = true;
  state.previewKey = null;
  stopIdleCycle();
  audio.init();

  const participants = state.team.map(uid => state.roster.find(r => r.uid === uid)).filter(Boolean);
  const defeatedEnemy = state.enemy.map(e => ({ ...e }));
  const battleDifficulty = state.difficulty || 'easy';

  if (!state.runStats) {
    state.runStats = { cardsPlayed: 0, levelsCleared: 0 };
  }
  state.runStats.cardsPlayed += participants.length;
  state.combatStep = 0;

  $('map-screen')?.classList.add('hidden');
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
  view.log(`🎲 ${firstSide === 'player' ? 'Your abilities' : 'Enemy abilities'} trigger first (${state.modifiers.playerStartsPct}% chance you start)`);
  const battle = new Battle(participants, state.enemy, view, {
    firstSide, maxTeam: { player: teamSlots(), enemy: Math.max(enemySlots(), state.enemy.length) },
  });
  currentBattle = battle;
  setNoiseCounter('player', 0);
  setNoiseCounter('enemy', 0);
  const result = await battle.run();
  await view.wait(500);
  closeBattlePreview();

  // The Giant Worm eats the louder team, whoever won the fight.
  const noise = result.noise || { player: 0, enemy: 0 };
  let outcome = result.outcome;
  let eaten = null;
  if (noise.player > noise.enemy) { eaten = 'player'; outcome = 'lose'; }
  else if (noise.enemy > noise.player) { eaten = 'enemy'; outcome = 'win'; }

  if (eaten) await playWormSequence(battle, eaten);
  if (outcome === 'win') await playReviveSequence(battle);

  currentBattle = null;
  showResult(outcome, participants, defeatedEnemy, battleDifficulty, { combat: result.outcome, eaten, noise });
}

// ---------- Giant Worm & Noise ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function setNoiseCounter(side, total, pop = false) {
  const el = $(`noise-${side}`);
  if (!el) return;
  el.querySelector('b').textContent = total;
  el.classList.remove('loud');
  if (pop) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

// Wait, scale up the louder counter, shake the screen, then a worm bursts out of the ground
// under the louder team, swallows its cards and sinks back down (~3s).
async function playWormSequence(battle, side) {
  const row = $(side === 'player' ? 'battle-player' : 'battle-enemy');
  const counter = $(`noise-${side}`);
  const screen = $('battle-screen');
  $('turn-label').textContent = '🪱 The ground trembles...';

  await sleep(700);
  counter.classList.remove('bump');
  counter.classList.add('loud');
  audio.beep(200);
  await sleep(900);

  screen.classList.add('shake');
  audio.explosion();
  await sleep(450);

  // The pit is the ground line under the row: the worm rises from its bottom edge.
  const cards = [...row.querySelectorAll(':scope > .card:not(.over-slot)')];
  const rect = row.getBoundingClientRect();
  const cardRect = cards.reduce((r, c) => {
    const b = c.getBoundingClientRect();
    return { left: Math.min(r.left, b.left), right: Math.max(r.right, b.right), top: Math.min(r.top, b.top), bottom: Math.max(r.bottom, b.bottom) };
  }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  const box = cards.length ? cardRect : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  const width = Math.max(160, box.right - box.left + 60);
  const height = box.bottom - box.top + 110;

  const pit = document.createElement('div');
  pit.className = 'worm-pit';
  pit.style.left = `${(box.left + box.right) / 2 - width / 2 + window.scrollX}px`;
  pit.style.top = `${box.bottom + 24 - height + window.scrollY}px`;
  pit.style.width = `${width}px`;
  pit.style.height = `${height}px`;
  pit.innerHTML = `
    <div class="worm">
      <div class="worm-mouth"><div class="worm-teeth"></div><div class="worm-throat"></div></div>
      <div class="worm-body"></div>
    </div>
    <div class="worm-sand"></div>`;
  document.body.appendChild(pit);
  void pit.offsetWidth;

  pit.classList.add('rise');
  $('turn-label').textContent = `🪱 The Giant Worm eats the ${side === 'player' ? 'loud squad' : 'loud enemies'}!`;
  await sleep(900);
  screen.classList.remove('shake');

  // Swallowed while the worm covers them
  cards.forEach(c => c.classList.add('eaten'));
  audio.hit();
  await sleep(700);

  pit.classList.remove('rise');
  pit.classList.add('sink');
  await sleep(900);
  pit.remove();
  counter.classList.remove('loud');
  // The eaten team is gone for good
  battle.teams[side].length = 0;
  battle.graves[side].length = 0;
  battle.lingering = battle.lingering.filter(l => l.u.side !== side);
  view.render(battle);
  await sleep(400);
}

// The player survived: dead cards come back with base stats, and every card drops its
// combat buffs, so it's clear both deaths and buffs only lasted for this combat.
async function playReviveSequence(battle) {
  const units = battle.display('player').filter(u => u.rosterUid != null);
  if (!units.length) return;
  $('turn-label').textContent = '✨ Your squad recovers...';
  await sleep(500);

  for (const u of units) {
    const el = cardMap.get(u.uid);
    if (!el) continue;
    const baseAtk = u.def.atk + (u.atkBonus || 0);
    const baseHp = u.def.hp + (u.hpBonus || 0);
    const wasDead = battle.isDead(u);
    const changed = u.atk !== baseAtk || Math.max(0, u.hp) !== baseHp;
    if (!wasDead && !changed) continue;

    el.querySelector('.atk-val').textContent = baseAtk;
    el.querySelector('.hp-val').textContent = baseHp;
    el.classList.remove('dead', 'doomed', 'shielded', 'over-slot');
    el.classList.remove('revived');
    void el.offsetWidth;
    el.classList.add('revived');
    view.float(u, wasDead ? '✨ Revived' : '↺ Base stats', 'revive');
    audio.beep(wasDead ? 880 : 660);
    await sleep(350);
  }
  $('turn-label').textContent = '✨ Deaths and buffs only last for the combat';
  await sleep(1400);
}

// ---------- Results & Debrief ----------

function finalizeRunXp(isSuccessfulExtraction) {
  const cardsPlayed = (state.runStats && state.runStats.cardsPlayed) || 0;
  const levelsCleared = (state.runStats && state.runStats.levelsCleared) || 0;

  const cardsPlayedXp = cardsPlayed * XP_CONFIG.cardPlayed; // 22 XP per card
  const levelsClearedXp = levelsCleared * XP_CONFIG.levelCleared; // 25 XP per level
  const runCompletionXp = isSuccessfulExtraction ? XP_CONFIG.runCompletionBonus : 0; // 50 XP

  const isFirstRun = (!progression.firstRunBonusAwarded && progression.runCount === 0);
  const firstRunXp = isFirstRun ? XP_CONFIG.firstRunBonus : 0; // +50 XP one-time on Run 1

  const totalRunXp = cardsPlayedXp + levelsClearedXp + runCompletionXp + firstRunXp;

  const prevTotalXp = progression.totalXp;
  const prevLevel = progression.level;

  progression.totalXp += totalRunXp;
  progression.runCount += 1;
  if (firstRunXp > 0) {
    progression.firstRunBonusAwarded = true;
  }

  const newLevel = getLevelFromTotalXp(progression.totalXp);
  const levelsGained = Math.max(0, newLevel - prevLevel);
  progression.level = newLevel;

  // For every XP level gained, unlock only 1 card.
  // Swiftbeak is guaranteed to be the first card unlocked, then random cards.
  const newlyUnlockedCardIds = [];
  if (levelsGained > 0) {
    for (let l = 0; l < levelsGained; l++) {
      const lockedPool = RECRUITABLE.filter(id => !progression.unlockedCards.includes(id));
      if (lockedPool.length === 0) break;
      let chosenId = null;
      if (lockedPool.includes(FIRST_UNLOCK_CARD_ID)) {
        chosenId = FIRST_UNLOCK_CARD_ID;
      } else {
        const randomIndex = Math.floor(Math.random() * lockedPool.length);
        chosenId = lockedPool[randomIndex];
      }
      progression.unlockedCards.push(chosenId);
      newlyUnlockedCardIds.push(chosenId);
    }
  }

  saveProgression();

  // Reset runStats for next run
  state.runStats = { cardsPlayed: 0, levelsCleared: 0 };

  return {
    cardsPlayed,
    cardsPlayedXp,
    levelsCleared,
    levelsClearedXp,
    isSuccessfulExtraction,
    runCompletionXp,
    isFirstRun,
    firstRunXp,
    totalRunXp,
    prevTotalXp,
    newTotalXp: progression.totalXp,
    prevLevel,
    newLevel,
    levelsGained,
    newlyUnlockedCardIds,
  };
}

function animateDebriefProgressBar(debrief) {
  const bar = $('debrief-xp-bar');
  const lvlEl = $('debrief-lvl-num');
  const numsEl = $('debrief-xp-nums');
  if (!bar || !lvlEl || !numsEl) return;

  const prevLvl = debrief.prevLevel;
  const newLvl = debrief.newLevel;
  const prevXp = debrief.prevTotalXp;
  const newXp = debrief.newTotalXp;

  const prevCurrThresh = getXpThresholdForLevel(prevLvl);
  const prevNextThresh = getXpThresholdForLevel(prevLvl + 1);
  const prevSpan = Math.max(1, prevNextThresh - prevCurrThresh);
  const prevProgress = Math.max(0, prevXp - prevCurrThresh);
  const prevPct = Math.min(100, Math.max(0, Math.round((prevProgress / prevSpan) * 100)));

  const newCurrThresh = getXpThresholdForLevel(newLvl);
  const newNextThresh = getXpThresholdForLevel(newLvl + 1);
  const newSpan = Math.max(1, newNextThresh - newCurrThresh);
  const newProgress = Math.max(0, newXp - newCurrThresh);
  const newPct = Math.min(100, Math.max(0, Math.round((newProgress / newSpan) * 100)));

  // Start at initial progression state
  lvlEl.textContent = prevLvl;
  numsEl.textContent = `${prevXp} / ${prevNextThresh} XP (${Math.max(0, prevNextThresh - prevXp)} XP to next)`;
  bar.style.transition = 'none';
  bar.style.width = prevPct + '%';

  // Animate filling after brief delay
  setTimeout(() => {
    if (debrief.levelsGained === 0) {
      bar.style.transition = 'width 1.2s cubic-bezier(0.2, 0.8, 0.25, 1)';
      bar.style.width = newPct + '%';
      animateXpNumbers(numsEl, prevXp, newXp, prevNextThresh, 1200);
    } else {
      // Step 1: fill to 100% of current level
      bar.style.transition = 'width 0.8s cubic-bezier(0.2, 0.8, 0.25, 1)';
      bar.style.width = '100%';
      animateXpNumbers(numsEl, prevXp, prevNextThresh, prevNextThresh, 800, () => {
        audio.score();
        lvlEl.textContent = newLvl;
        lvlEl.classList.add('pop');
        setTimeout(() => lvlEl.classList.remove('pop'), 600);

        // Reset to 0% and animate to new percentage in new level
        bar.style.transition = 'none';
        bar.style.width = '0%';
        void bar.offsetWidth; // force reflow

        setTimeout(() => {
          bar.style.transition = 'width 0.9s cubic-bezier(0.2, 0.8, 0.25, 1)';
          bar.style.width = newPct + '%';
          animateXpNumbers(numsEl, newCurrThresh, newXp, newNextThresh, 900);
        }, 60);
      });
    }
  }, 250);
}

function animateXpNumbers(el, fromXp, toXp, nextThresh, duration, onComplete) {
  const start = performance.now();
  const step = now => {
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / duration);
    const curr = Math.round(fromXp + (toXp - fromXp) * progress);
    const needed = Math.max(0, nextThresh - curr);
    el.textContent = `${curr} / ${nextThresh} XP (${needed} XP to next)`;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      if (onComplete) onComplete();
    }
  };
  requestAnimationFrame(step);
}

function renderDebrief(debrief, outcomeType) {
  const debriefBox = $('result-xp-debrief');
  if (!debriefBox) return;
  debriefBox.classList.remove('hidden');

  const isDefeat = outcomeType === 'defeat';
  debriefBox.classList.toggle('defeat-mode', isDefeat);

  const header = debriefBox.querySelector('.xp-debrief-header');
  const grid = debriefBox.querySelector('.xp-debrief-grid');
  if (header) header.classList.toggle('hidden', isDefeat);
  if (grid) grid.classList.toggle('hidden', isDefeat);

  const badge = $('debrief-outcome-badge');
  if (badge) {
    badge.className = `debrief-badge ${outcomeType}`;
    if (outcomeType === 'success') {
      badge.textContent = 'Extraction Complete 🚁';
    } else if (outcomeType === 'evac') {
      badge.textContent = 'Evacuated 🚨';
    } else {
      badge.textContent = 'Squad Destroyed 💀';
    }
  }

  if (!isDefeat) {
    $('xp-debrief-cards-count').textContent = debrief.cardsPlayed;
    $('xp-debrief-cards-val').textContent = `+${debrief.cardsPlayedXp} XP`;

    $('xp-debrief-levels-count').textContent = debrief.levelsCleared;
    $('xp-debrief-levels-val').textContent = `+${debrief.levelsClearedXp} XP`;

    const runCompRow = $('row-debrief-run-comp');
    if (debrief.isSuccessfulExtraction) {
      runCompRow.classList.remove('missed');
      $('xp-debrief-comp-calc').textContent = 'Extracted ✔';
      $('xp-debrief-comp-val').textContent = `+${debrief.runCompletionXp} XP`;
    } else {
      runCompRow.classList.add('missed');
      $('xp-debrief-comp-calc').textContent = 'Not Extracted ✖';
      $('xp-debrief-comp-val').textContent = '+0 XP';
    }

    const firstRunRow = $('row-debrief-first-run');
    if (debrief.firstRunXp > 0) {
      firstRunRow.classList.remove('hidden');
      $('xp-debrief-first-val').textContent = `+${debrief.firstRunXp} XP`;
    } else {
      firstRunRow.classList.add('hidden');
    }

    $('xp-debrief-total-val').textContent = `+${debrief.totalRunXp} XP`;
  }

  // Animated Level & progress bar fill
  animateDebriefProgressBar(debrief);

  // Celebration for unlocks
  const unlockBox = $('debrief-unlocks-box');
  const unlockedCardsRow = $('debrief-unlocked-cards');
  unlockedCardsRow.innerHTML = '';
  if (debrief.levelsGained > 0 && debrief.newlyUnlockedCardIds.length > 0) {
    unlockBox.classList.remove('hidden');
    $('debrief-unlock-msg').textContent = debrief.levelsGained === 1
      ? `Level ${debrief.newLevel} reached! (+${debrief.newlyUnlockedCardIds.length} card unlocked)`
      : `Gained ${debrief.levelsGained} levels! (Now Level ${debrief.newLevel}, +${debrief.newlyUnlockedCardIds.length} cards unlocked)`;

    for (const id of debrief.newlyUnlockedCardIds) {
      const def = CHARACTERS[id];
      if (!def) continue;
      const el = cardEl(id, def.atk, def.hp, { cls: 'spawn-pool-card' });
      const tag = frontTag();
      if (id === FIRST_UNLOCK_CARD_ID) {
        tag.textContent = 'SWIFTBEAK UNLOCKED 🦅';
        tag.style.background = '#0ea5e9';
        tag.style.color = '#ffffff';
      } else {
        tag.textContent = 'UNLOCKED TO POOL 🎉';
        tag.style.background = '#22c55e';
        tag.style.color = '#052e16';
      }
      el.appendChild(tag);
      unlockedCardsRow.appendChild(el);
    }
  } else if (debrief.levelsGained > 0) {
    unlockBox.classList.remove('hidden');
    $('debrief-unlock-msg').textContent = `Level ${debrief.newLevel} reached! (All cards already unlocked)`;
  } else {
    unlockBox.classList.add('hidden');
  }
}

// Whatever the outcome, the squad stays on the tile it started the combat from.
function arriveAtPendingNode() {
  if (!state.map?.pendingNode) return;
  state.map.currentNode = state.map.pendingNode;
  if (!state.map.visitedNodes.includes(state.map.currentNode)) {
    state.map.visitedNodes.push(state.map.currentNode);
  }
  state.map.pendingNode = null;
}

function showResult(result, participants, defeatedEnemy, battleDifficulty, info = {}) {
  const title = $('result-title');
  const cards = $('result-cards');
  const btn = $('btn-continue');
  cards.innerHTML = '';
  if (btn) {
    btn.classList.remove('hidden');
    btn.disabled = false;
  }
  $('btn-skip-recruit')?.classList.add('hidden');
  $('btn-extract')?.classList.add('hidden');
  $('btn-return-home')?.classList.add('hidden');
  $('result-discard-wrap')?.classList.add('hidden');
  $('result-squad-preview')?.classList.add('hidden');
  $('result-difficulty-wrap')?.classList.add('hidden');
  $('result-xp-debrief')?.classList.add('hidden');

  state.battleNum++;
  state.difficulty = state.nextDifficulty || 'easy';
  state.enemy = generateEnemy(state.battleNum, state.difficulty);

  if (result === 'win') {
    state.wins++;
    if (!state.runStats) state.runStats = { cardsPlayed: 0, levelsCleared: 0 };
    state.runStats.levelsCleared += 1;
    title.textContent = 'Victory!';
    audio.score();
    showVictoryRewards(defeatedEnemy, battleDifficulty);
  } else if (result === 'tie') {
    state.ties = (state.ties || 0) + 1;
    audio.beep(480, 250);
    onPostCardChoice('tie', 'The battle ended in a tie — no cards won.');
  } else {
    state.losses++;
    title.textContent = 'Defeat';
    audio.explosion();
    showDefeat(participants, info);
  }
  updateHud();
  $('result-overlay').classList.remove('hidden');
}

// Defeat: only the cards that fought are lost. The rest of the squad stays on the map,
// on the tile the combat was fought for. A squad with no cards left ends the expedition.
function showDefeat(participants, info = {}) {
  $('result-squad-preview')?.classList.add('hidden');
  $('result-difficulty-wrap')?.classList.add('hidden');
  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btnContinue = $('btn-continue');
  const btnReturn = $('btn-return-home');
  cards.innerHTML = '';

  const lostUids = new Set(participants.map(p => p.uid));
  const lostCards = state.roster.filter(c => lostUids.has(c.uid));
  state.roster = state.roster.filter(c => !lostUids.has(c.uid));
  state.team = state.roster.slice(0, Math.min(teamSlots(), state.roster.length)).map(c => c.uid);
  state.extractCountdown = null;
  arriveAtPendingNode();
  const wiped = state.roster.length === 0;
  if (wiped) state.map = null;
  updateHud();

  const byWorm = info.eaten === 'player';
  title.textContent = byWorm ? 'Eaten by the Giant Worm 🪱' : 'Combat Lost 💀';
  title.className = 'lose';
  const noiseLine = info.noise ? ` (Noise: you ${info.noise.player} · enemy ${info.noise.enemy})` : '';
  const why = byWorm
    ? (info.combat === 'win'
      ? `You won the fight, but your squad was louder${noiseLine}, so the Giant Worm ate them.`
      : `Your squad was louder${noiseLine}, so the Giant Worm ate them.`)
    : `Your fighters fell in combat${noiseLine}.`;
  text.textContent = wiped
    ? `${why} No cards are left — the expedition is over.`
    : `${why} The ${lostCards.length} card${lostCards.length === 1 ? '' : 's'} that fought ${lostCards.length === 1 ? 'is' : 'are'} lost. The rest of your squad (${state.roster.length}) holds this tile.`;

  for (const p of lostCards) {
    const d = CHARACTERS[p.id];
    const atkBonus = p.atkBonus || 0;
    const hpBonus = p.hpBonus || 0;
    const el = cardEl(p.id, d.atk + atkBonus, d.hp + hpBonus, { cls: 'lost discarding', atkBonus, hpBonus });
    const tag = frontTag();
    tag.textContent = 'LOST 💀';
    tag.style.background = '#ef4444';
    tag.style.color = '#ffffff';
    el.appendChild(tag);
    cards.appendChild(el);
  }

  if (wiped) {
    btnContinue.classList.add('hidden');
    btnReturn.classList.remove('hidden');
    btnReturn.disabled = false;
    btnReturn.textContent = 'Return to Base Camp 🏠';
    btnReturn.onclick = () => {
      $('result-overlay').classList.add('hidden');
      showHome();
    };
    const debrief = finalizeRunXp(false);
    renderDebrief(debrief, 'defeat');
    return;
  }

  btnReturn.classList.add('hidden');
  btnContinue.classList.remove('hidden');
  btnContinue.disabled = false;
  btnContinue.textContent = 'Return to Map 🗺️';
  btnContinue.onclick = () => {
    $('result-overlay').classList.add('hidden');
    showMap();
  };
}

// Preview player's current squad (team slots and camp) during card recruit selection
function renderSquadPreview() {
  const previewWrap = $('result-squad-preview');
  if (!previewWrap) return;
  if (previewWrap.tagName === 'DETAILS') previewWrap.removeAttribute('open');

  if ($('preview-team-count')) $('preview-team-count').textContent = state.team.length;
  if ($('preview-team-max')) $('preview-team-max').textContent = teamSlots();
  if ($('preview-camp-count')) $('preview-camp-count').textContent = campCount();
  if ($('preview-camp-max')) $('preview-camp-max').textContent = campMax();

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
    const atkBonus = c.atkBonus || 0;
    const hpBonus = c.hpBonus || 0;
    const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
    const tag = frontTag();
    tag.textContent = i === 0 ? 'FRONT (1)' : `SLOT ${i + 1}`;
    if (i !== 0) {
      tag.style.background = '#6b4a2b';
      tag.style.color = '#f8ecd6';
    }
    el.appendChild(tag);
    teamRow.appendChild(el);
  }

  // Camp preview
  const campRow = $('preview-camp-slots');
  campRow.innerHTML = '';
  const campCards = state.roster.filter(r => !state.team.includes(r.uid));
  if (campCards.length === 0) {
    campRow.innerHTML = '<span class="hint squad-empty-hint">Camp is empty. Rescued cards will wait here if team is full.</span>';
  } else {
    for (const c of campCards) {
      const d = CHARACTERS[c.id];
      const atkBonus = c.atkBonus || 0;
      const hpBonus = c.hpBonus || 0;
      const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
      const tag = document.createElement('div');
      tag.className = 'front-tag';
      tag.textContent = 'CAMP';
      tag.style.background = '#4a321d';
      tag.style.color = '#e8d3b0';
      el.appendChild(tag);
      campRow.appendChild(el);
    }
  }

  previewWrap.classList.remove('hidden');
}

// Victory Reward:
// Pick X cards as allowed by the battle difficulty (Easy: 1, Medium: 2, Hard: 3).
// Modifier `rewardFromEnemy`:
//   - true: candidate cards come from the defeated enemy team that had lost.
//   - false: candidate cards are rolled randomly from the recruitable character pool.
function showVictoryRewards(defeatedEnemy, battleDifficulty) {
  const diff = DIFFICULTIES[battleDifficulty] || DIFFICULTIES.easy;
  const pickCount = diff.pickCount || 1;
  const fromEnemy = Boolean(state.modifiers.rewardFromEnemy);
  const keepBuffs = Boolean(state.modifiers.keepEnemyBuffs);

  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btn = $('btn-continue');

  btn.classList.remove('hidden');
  btn.disabled = false;
  $('result-difficulty-wrap')?.classList.add('hidden');

  let candidates = [];
  if (fromEnemy) {
    // Cards from the enemy team that had lost
    candidates = (defeatedEnemy && defeatedEnemy.length > 0)
      ? defeatedEnemy.map(e => ({
          id: e.id,
          source: 'enemy',
          atkBonus: keepBuffs ? (e.atkBonus || 0) : 0,
          hpBonus: keepBuffs ? (e.hpBonus || 0) : 0,
        }))
      : Array.from({ length: pickCount }, () => ({
          id: randomCharacterId(),
          source: 'enemy',
          atkBonus: 0,
          hpBonus: 0,
        }));
  } else {
    // Random cards from recruitable pool (offer a selection pool of at least 3 cards)
    const poolCount = Math.max(3, pickCount + 1);
    const buffedEnemies = (defeatedEnemy || []).filter(e => (e.atkBonus || 0) > 0 || (e.hpBonus || 0) > 0);
    candidates = Array.from({ length: poolCount }, () => {
      let atkBonus = 0;
      let hpBonus = 0;
      if (keepBuffs && buffedEnemies.length > 0) {
        const sample = buffedEnemies[Math.floor(Math.random() * buffedEnemies.length)];
        atkBonus = sample.atkBonus || 0;
        hpBonus = sample.hpBonus || 0;
      }
      return {
        id: randomCharacterId(),
        source: 'random',
        atkBonus,
        hpBonus,
      };
    });
  }

  const maxPicks = Math.min(pickCount, candidates.length);
  const picks = [];
  const discards = [];
  const room = (campMax() - campCount()) + (teamSlots() - state.team.length);
  const nameOf = cand => {
    const d = CHARACTERS[cand.id];
    const bonus = ((cand.atkBonus || 0) > 0 || (cand.hpBonus || 0) > 0)
      ? ` (+${cand.atkBonus || 0}/+${cand.hpBonus || 0})`
      : '';
    return `${d.emoji} ${d.name}${bonus}`;
  };
  const ownNameOf = c => {
    const d = CHARACTERS[c.id];
    const bonus = ((c.atkBonus || 0) > 0 || (c.hpBonus || 0) > 0)
      ? ` (+${c.atkBonus || 0}/+${c.hpBonus || 0})`
      : '';
    return `${d.emoji} ${d.name}${bonus}`;
  };

  const toggle = (list, v, max) => {
    const i = list.indexOf(v);
    if (i >= 0) { list.splice(i, 1); return; }
    if (max <= 0) return;
    if (list.length >= max) list.shift();
    list.push(v);
  };

  title.textContent = 'Victory!';
  title.className = 'win';

  const draw = () => {
    btn.classList.remove('hidden');
    const needDiscard = Math.max(0, picks.length - room);
    if (discards.length > needDiscard) discards.length = needDiscard;
    text.textContent = '';

    cards.innerHTML = '';
    candidates.forEach((cand, i) => {
      const d = CHARACTERS[cand.id];
      const isPicked = picks.includes(i);
      const atkBonus = cand.atkBonus || 0;
      const hpBonus = cand.hpBonus || 0;
      const el = cardEl(cand.id, d.atk + atkBonus, d.hp + hpBonus, {
        cls: 'reward-option' + (isPicked ? ' picked' : ''),
        atkBonus,
        hpBonus,
      });
      const tag = document.createElement('div');
      tag.className = 'front-tag';
      let tagLabel = fromEnemy ? 'DEFEATED ENEMY' : 'RANDOM REWARD';
      if (atkBonus > 0 || hpBonus > 0) {
        tagLabel += ' ⭐';
      }
      tag.textContent = isPicked ? 'PICKED ✔' : tagLabel;
      tag.style.background = isPicked ? '#22c55e' : (fromEnemy ? '#f97316' : '#c8642c');
      tag.style.color = isPicked ? '#052e16' : '#ffffff';
      el.appendChild(tag);
      el.addEventListener('click', () => {
        toggle(picks, i, maxPicks);
        draw();
      });
      cards.appendChild(el);
    });

    renderSquadPreview();

    $('result-discard-wrap').classList.toggle('hidden', !needDiscard);
    $('result-discard-label').textContent = `Discard ${needDiscard} of yours (${discards.length}/${needDiscard} picked):`;
    if (needDiscard) {
      const own = $('result-discard');
      own.innerHTML = '';
      for (const c of state.roster) {
        const d = CHARACTERS[c.id];
        const atkBonus = c.atkBonus || 0;
        const hpBonus = c.hpBonus || 0;
        const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, {
          cls: 'discard-option' + (discards.includes(c.uid) ? ' discarding' : ''),
          atkBonus,
          hpBonus,
        });
        if (state.team.includes(c.uid)) {
          const tag = frontTag();
          tag.textContent = 'TEAM';
          el.appendChild(tag);
        }
        el.addEventListener('click', () => { toggle(discards, c.uid, needDiscard); draw(); });
        own.appendChild(el);
      }
    }

    const rewardText = picks.length === 1 ? nameOf(candidates[picks[0]]) : `${picks.length} cards`;
    const discardText = discards.length === 1
      ? ownNameOf(state.roster.find(r => r.uid === discards[0]))
      : `${discards.length} cards`;

    if (!picks.length) {
      btn.disabled = false;
      btn.textContent = 'Continue to Map without picking 🗺️';
    } else if (needDiscard && discards.length !== needDiscard) {
      btn.disabled = true;
      btn.textContent = `Discard ${needDiscard - discards.length} to Continue ▶`;
    } else {
      btn.disabled = false;
      btn.textContent = `Add ${rewardText} & Continue to Map 🗺️` + (needDiscard ? ` (discarding ${discardText})` : '');
    }
  };

  btn.onclick = () => {
    if (!picks.length) {
      onPostCardChoice('win');
      return;
    }
    const freed = [];
    for (const uid of discards) {
      state.roster = state.roster.filter(r => !uid || r.uid !== uid);
      const slot = state.team.indexOf(uid);
      if (slot >= 0) { state.team[slot] = null; freed.push(slot); }
    }
    const teamSize = () => state.team.filter(u => u !== null).length;
    for (const i of picks) {
      const cand = candidates[i];
      const recruit = makeCharacter(cand.id, cand.atkBonus || 0, cand.hpBonus || 0);
      const inCamp = state.roster.length - teamSize();
      if (inCamp < campMax()) { /* goes to camp */ }
      else if (freed.length) state.team[freed.shift()] = recruit.uid;
      else state.team.push(recruit.uid);
      state.roster.push(recruit);
    }
    state.team = state.team.filter(u => u !== null);
    onPostCardChoice('win');
  };

  draw();
}

function onPostCardChoice(lastResult, customMessage = null) {
  updateHud();

  const title = $('result-title');
  const text = $('result-text');
  const cards = $('result-cards');
  const btnContinue = $('btn-continue');
  const btnExtract = $('btn-extract');
  const btnReturnHome = $('btn-return-home');
  const discardWrap = $('result-discard-wrap');
  const diffWrap = $('result-difficulty-wrap');

  $('btn-skip-recruit')?.classList.add('hidden');
  discardWrap.classList.add('hidden');
  $('result-squad-preview')?.classList.add('hidden');
  diffWrap?.classList.add('hidden');
  cards.innerHTML = '';

  // 1. Forced Evacuation Check: <= 2 cards left in squad
  if (state.roster.length <= 2) {
    const survivingCount = state.roster.length;
    if (survivingCount > 0) {
      state.stash.push(...state.roster);
      saveStash();
    }
    const savedRoster = [...state.roster];
    state.roster = [];
    state.team = [];
    state.map = null;
    updateHud();

    title.textContent = survivingCount === 0 ? 'Squad Wiped Out 💀' : 'Emergency Evacuation 🚨';
    title.className = 'lose';
    text.textContent = survivingCount === 0
      ? `All characters were lost in battle. The expedition ended. You survived ${state.battleNum - 1} battle${state.battleNum === 2 ? '' : 's'}.`
      : `Critical squad loss! You have only ${survivingCount} card${survivingCount === 1 ? '' : 's'} remaining (≤ 2). You and your surviving cards have been returned to Base Stash immediately!`;

    for (const c of savedRoster) {
      const d = CHARACTERS[c.id];
      const atkBonus = c.atkBonus || 0;
      const hpBonus = c.hpBonus || 0;
      const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
      const tag = frontTag();
      tag.textContent = 'SAVED TO STASH';
      tag.style.background = '#22c55e';
      tag.style.color = '#052e16';
      el.appendChild(tag);
      cards.appendChild(el);
    }

    btnContinue.classList.add('hidden');
    btnExtract?.classList.add('hidden');
    btnReturnHome.classList.remove('hidden');
    btnReturnHome.textContent = 'Return to Home Stash 🏠';
    btnReturnHome.onclick = () => {
      $('result-overlay').classList.add('hidden');
      showHome();
    };

    const debrief = finalizeRunXp(false);
    renderDebrief(debrief, 'evac');
    return;
  }

  // 2. Victory: update map and continue to map screen
  if (lastResult === 'win') {
    arriveAtPendingNode();
    $('result-overlay').classList.add('hidden');
    showMap();
    return;
  }

  // 3. Tie: player can return to map
  if (lastResult === 'tie') {
    arriveAtPendingNode();
    title.textContent = 'Draw · Battle Tied ⚖️';
    title.className = 'tie';
    text.textContent = customMessage || 'The battle ended in a tie — no cards won. Return to map to regroup.';

    for (const c of state.roster) {
      const d = CHARACTERS[c.id];
      const atkBonus = c.atkBonus || 0;
      const hpBonus = c.hpBonus || 0;
      const el = cardEl(c.id, d.atk + atkBonus, d.hp + hpBonus, { atkBonus, hpBonus });
      if (state.team.includes(c.uid)) {
        const tag = frontTag();
        tag.textContent = 'TEAM';
        el.appendChild(tag);
      }
      cards.appendChild(el);
    }

    btnReturnHome.classList.add('hidden');
    btnExtract?.classList.add('hidden');
    btnContinue.classList.remove('hidden');
    btnContinue.disabled = false;
    btnContinue.textContent = 'Return to Map 🗺️';
    btnContinue.onclick = () => {
      $('result-overlay').classList.add('hidden');
      showMap();
    };
    return;
  }
}

function renderDifficultyOptions() {
  const container = $('difficulty-options');
  if (!container) return;
  container.innerHTML = '';

  const currentSelected = state.nextDifficulty || state.difficulty || 'easy';

  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const isSelected = (key === currentSelected);
    const btn = document.createElement('div');
    btn.className = `diff-card-btn ${key}` + (isSelected ? ' selected' : '');
    btn.innerHTML = `
      <div class="diff-card-top">
        <span class="diff-card-badge diff-badge badge-${key}">${d.emoji} ${d.name}</span>
        ${isSelected ? '<span class="diff-selected-check">✔ SELECTED</span>' : ''}
      </div>
    `;

    btn.addEventListener('click', () => {
      state.nextDifficulty = key;
      state.difficulty = key;
      state.enemy = generateEnemy(state.battleNum, state.difficulty);
      renderDifficultyOptions();
      updateContinueBtnText(state.extractCountdown === 1 ? 'final' : 'normal');
      audio.beep(key === 'hard' ? 440 : key === 'medium' ? 520 : 620);
    });

    container.appendChild(btn);
  }
}

function updateContinueBtnText(mode = 'normal') {
  const btnContinue = $('btn-continue');
  if (!btnContinue) return;
  const diffInfo = DIFFICULTIES[state.nextDifficulty || state.difficulty || 'easy'];
  if (mode === 'final') {
    btnContinue.textContent = `Continue to Final Battle (${diffInfo.badge}) ▶`;
  } else {
    btnContinue.textContent = `Continue Expedition (${diffInfo.badge}) ▶`;
  }
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
    return { key: `p${uid}`, id: c.id, atk: CHARACTERS[c.id].atk + (c.atkBonus || 0) };
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
  if (!b) return;
  b.textContent = cycling ? '■ Stop preview' : '▶ Preview battle';
  b.classList.toggle('active', cycling);
}

for (const ev of ['mousemove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(ev, resetIdle, { passive: true, capture: true });
}

$('btn-preview-battle')?.addEventListener('click', () => {
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

function startStarterPackExpedition() {
  // Free 4 starter cards without taking anything from stash
  const starterCards = STARTER_PACK_IDS.map(id => makeCharacter(id));
  state.roster = starterCards;
  const initialTeamSize = Math.min(teamSlots(), state.roster.length);
  state.team = state.roster.slice(0, initialTeamSize).map(c => c.uid);

  state.battleNum = 0;
  state.wins = 0;
  state.ties = 0;
  state.losses = 0;
  state.difficulty = 'easy';
  state.nextDifficulty = 'easy';
  state.extractCountdown = null;
  state.map = {
    currentNode: 'start',
    visitedNodes: ['start'],
    pendingNode: null,
  };

  state.runStats = {
    cardsPlayed: 0,
    levelsCleared: 0,
  };

  audio.score();
  showMap();
}

$('btn-go-expedition').addEventListener('click', startExpedition);
$('btn-starter-expedition')?.addEventListener('click', startStarterPackExpedition);

$('btn-auto-loadout')?.addEventListener('click', () => {
  if (!state.selectedStashUids) state.selectedStashUids = new Set();
  state.selectedStashUids.clear();
  const max = maxExpeditionLoadout();
  for (let i = 0; i < Math.min(state.stash.length, max); i++) {
    state.selectedStashUids.add(state.stash[i].uid);
  }
  audio.beep(550);
  renderHome();
});

$('btn-clear-loadout')?.addEventListener('click', () => {
  if (state.selectedStashUids) state.selectedStashUids.clear();
  audio.beep(400);
  renderHome();
});

$('btn-restock-stash')?.addEventListener('click', () => {
  const fresh = generateRandomStash(20);
  state.stash.push(...fresh);
  saveStash();
  audio.beep(650);
  renderHome();
});

document.addEventListener('click', e => {
  if (!e.target.closest('.arena .card')) {
    document.querySelectorAll('.arena .card.pop-open').forEach(c => c.classList.remove('pop-open'));
  }
});

$('btn-evac-base').addEventListener('click', () => {
  if (state.screen !== 'prep') return;
  if (confirm(`Evacuate now? Return all ${state.roster.length} squad cards to base stash?`)) {
    const battlesPlayed = state.runStats ? state.runStats.cardsPlayed : 0;
    const isWin = (state.runStats && state.runStats.levelsCleared > 0);
    returnAllToStash();
    if (battlesPlayed > 0) {
      const debrief = finalizeRunXp(isWin);
      $('result-title').textContent = isWin ? 'Tactical Evacuation 🚁' : 'Base Evacuation 🏠';
      $('result-title').className = isWin ? 'win' : 'lose';
      $('result-text').textContent = isWin
        ? `You safely evacuated with your squad cards deposited into Base Stash.`
        : `You returned to base camp.`;
      $('result-cards').innerHTML = '';
      $('result-difficulty-wrap')?.classList.add('hidden');
      $('result-discard-wrap')?.classList.add('hidden');
      $('result-squad-preview')?.classList.add('hidden');
      $('btn-continue')?.classList.add('hidden');
      $('btn-extract')?.classList.add('hidden');
      $('btn-skip-recruit')?.classList.add('hidden');
      $('btn-return-home')?.classList.remove('hidden');
      $('btn-return-home').onclick = () => {
        $('result-overlay').classList.add('hidden');
        showHome();
      };
      renderDebrief(debrief, isWin ? 'success' : 'evac');
      $('result-overlay').classList.remove('hidden');
    } else {
      showHome();
    }
  }
});

$('btn-view-map')?.addEventListener('click', () => {
  if (state.screen !== 'home' && state.screen !== 'map' && !state.inBattle) {
    showMap();
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
$('btn-modal-open-editor')?.addEventListener('click', openEditorModal);
$('btn-close-editor')?.addEventListener('click', closeEditorModal);

// ---------- Modifiers & Progression Modal ----------
function openModifiersModal(initialTab = 'settings') {
  const modal = $('modifiers-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  switchModalTab(initialTab);
  renderModifiers();
  renderProgressionPanel();
}

function closeModifiersModal() {
  const modal = $('modifiers-modal');
  if (modal) modal.classList.add('hidden');
  if (state.screen === 'home') renderHome();
  else if (state.screen === 'prep') renderPrep();
}

function switchModalTab(tabKey) {
  const isSettings = tabKey === 'settings';
  $('tab-mod-settings')?.classList.toggle('active', isSettings);
  $('tab-mod-progression')?.classList.toggle('active', !isSettings);
  $('modal-tab-content-settings')?.classList.toggle('hidden', !isSettings);
  $('modal-tab-content-progression')?.classList.toggle('hidden', isSettings);
}

$('btn-open-modifiers')?.addEventListener('click', () => openModifiersModal('settings'));
$('btn-close-modifiers')?.addEventListener('click', closeModifiersModal);
$('tab-mod-settings')?.addEventListener('click', () => { switchModalTab('settings'); audio.beep(520); });
$('tab-mod-progression')?.addEventListener('click', () => { switchModalTab('progression'); audio.beep(520); });
$('card-silhouette-target')?.addEventListener('click', () => { openModifiersModal('progression'); audio.beep(550); });

$('modifiers-modal')?.addEventListener('click', e => {
  if (e.target === $('modifiers-modal')) closeModifiersModal();
});
$('editor-modal')?.addEventListener('click', e => {
  if (e.target === $('editor-modal')) closeEditorModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModifiersModal();
    closeEditorModal();
  }
});

// Prep screen difficulty pill clicks
document.querySelectorAll('#prep-difficulty-picker .diff-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.battleNum === 1) return;
    const diff = btn.dataset.diff;
    if (!diff || !DIFFICULTIES[diff]) return;
    state.difficulty = diff;
    state.nextDifficulty = diff;
    state.enemy = generateEnemy(state.battleNum, state.difficulty);
    audio.beep(diff === 'hard' ? 440 : diff === 'medium' ? 520 : 620);
    renderPrep();
  });
});

renderTriggerLegend();
renderClassLegend();
initTriggerTips();
state.modifiers = loadModifiers();
loadProgression();
state.stash = loadStash();
initProgressionEvents();
showHome();
