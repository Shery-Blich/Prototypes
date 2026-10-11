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
}

function renderPrep() {
  updateHud();

  const enemyRow = $('enemy-preview');
  enemyRow.innerHTML = '';
  state.enemy.forEach((e, i) => {
    const d = CHARACTERS[e.id];
    const el = cardEl(e.id, d.atk + e.atkBonus, d.hp + e.hpBonus);
    if (i === 0) el.appendChild(frontTag());
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

// ---------- Wiring ----------

$('btn-fight').addEventListener('click', startBattle);
$('btn-skip').addEventListener('click', () => setSpeed(1000));
document.querySelectorAll('.speed').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

newRun();
