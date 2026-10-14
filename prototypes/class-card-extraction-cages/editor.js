import {
  BASE_CHARACTERS,
  CHARACTERS,
  CLASSES,
  TRIGGERS,
  buildCardLogic,
  generateAbilityText,
  getSavedOverrides,
  saveCharacterOverrides,
  resetCharacterOverrides,
  exportCharactersJs,
} from './characters.js';

// Animal emojis for quick picking
const QUICK_EMOJIS = [
  '🐯', '🐆', '🐅', '🦁', '🦅', '🦜', '🦢', '🦩',
  '🐍', '🦂', '🐊', '🦎', '🐜', '🦗', '🦟', '🐝',
  '🦌', '🦙', '🦘', '🐐', '🦛', '🐘', '🐪', '🦬',
  '🐛', '🪲', '🐺', '🦊', '🐻', '🐗', '🦇', '🦖'
];

// Predefined test opponents for sandbox
const TEST_OPPONENTS = {
  cage: { id: 'cage', name: 'Cage', emoji: '⛓️', class: 'cage', atk: 0, hp: 2, trigger: 'death', text: '0 ATK, 2 HP. Destroy this cage to rescue a captive card if you win combat!' },
  dummy_target: { id: 'dummy_target', name: 'Training Dummy', emoji: '🎯', class: 'tank', atk: 2, hp: 5, trigger: 'start', text: 'Stands firm and absorbs hits.' },
  rotator_start: { id: 'rotator_start', name: 'Swiftbeak', emoji: '🦅', class: 'rotator', atk: 2, hp: 1, trigger: 'start', text: 'When 🏁 push the first enemy to last.' },
  support_attack: { id: 'support_attack', name: 'Healer Doe', emoji: '🦙', class: 'support', atk: 1, hp: 2, trigger: 'attack', text: 'When 🗡️ give HP to friend behind equal to this ATK.' },
  dps_hurt: { id: 'dps_hurt', name: 'Retaliate', emoji: '🐅', class: 'dps', atk: 3, hp: 2, trigger: 'hurt', text: 'When 💢 deal half the damage taken back to attacker.' },
  tank_hurt: { id: 'tank_hurt', name: 'Thick Skin', emoji: '🐪', class: 'tank', atk: 1, hp: 3, trigger: 'hurt', text: 'When 💢 give a random friend +1 HP.' },
  dps_attack: { id: 'dps_attack', name: 'Frenzy', emoji: '🐆', class: 'dps', atk: 3, hp: 3, trigger: 'attack', text: 'When 🗡️ gain +1 ATK.' },
};

export function initEditor(containerEl, options = {}) {
  const inModal = options.inModal || false;
  const onSave = options.onSave || (() => {});
  const onClose = options.onClose || (() => {});

  let overrides = getSavedOverrides();
  let activeId = 'dps_start';
  if (!CHARACTERS[activeId]) {
    activeId = Object.keys(CHARACTERS)[0] || 'rotator_start';
  }

  let filterClass = 'all';
  let filterTrigger = 'all';
  let searchQuery = '';

  let editedCard = cloneCardDef(activeId);
  let opponentId = 'dummy_target';
  let initiative = 'player'; // 'player' (edited card) or 'enemy' (opponent)

  function cloneCardDef(id) {
    const current = CHARACTERS[id] || BASE_CHARACTERS[id] || {
      id, name: 'New Card', emoji: '🐾', class: 'dps', atk: 2, hp: 2, trigger: 'attack', text: '', token: false,
      preset: { type: 'deal_damage', target: 'first_enemy', amount: 2 }
    };
    const cloned = { ...current, id };
    if (current.preset) cloned.preset = { ...current.preset };
    return cloned;
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'editor-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  function render() {
    containerEl.innerHTML = `
      <div class="editor-toolbar">
        <div class="editor-toolbar-title">
          <span>🎨 Visual Character Editor</span>
          <span style="font-size: 0.78rem; font-weight: normal; color: #94a3b8;">(${Object.keys(CHARACTERS).length} active cards)</span>
        </div>
        <div class="editor-toolbar-actions">
          <button id="ed-btn-save" class="btn btn-primary" title="Save changes and apply immediately to your game">💾 Save to Game</button>
          <button id="ed-btn-copy-js" class="btn" title="Copy updated characters.js code to clipboard">📋 Copy JS Code</button>
          <button id="ed-btn-dl-js" class="btn" title="Download updated characters.js file">📥 Download JS</button>
          <button id="ed-btn-reset-card" class="btn" title="Reset this card back to original default">🔄 Reset Card</button>
          <button id="ed-btn-reset-all" class="btn" title="Reset all cards back to defaults">⚠️ Reset All</button>
          ${inModal ? '<button id="ed-btn-close" class="btn btn-small">✕ Close</button>' : '<a href="./index.html" class="btn">⚔️ Go to Game</a>'}
        </div>
      </div>

      <div class="editor-layout">
        <!-- LEFT: Character List Sidebar -->
        <aside class="editor-sidebar">
          <div class="sidebar-search-wrap">
            <input type="text" id="ed-search" placeholder="Search cards..." value="${escapeHtml(searchQuery)}" />
            <div class="filter-chips">
              <span class="filter-chip ${filterClass === 'all' ? 'active' : ''}" data-class="all">All Classes</span>
              ${Object.entries(CLASSES).map(([k, c]) => `
                <span class="filter-chip ${filterClass === k ? 'active' : ''}" data-class="${k}">
                  <span class="card-class-dot" style="background:${c.color};"></span>${c.label}
                </span>
              `).join('')}
            </div>
            <div class="filter-chips">
              <span class="filter-chip ${filterTrigger === 'all' ? 'active' : ''}" data-trigger="all">All Triggers</span>
              ${Object.entries(TRIGGERS).map(([k, t]) => `
                <span class="filter-chip ${filterTrigger === k ? 'active' : ''}" data-trigger="${k}">
                  ${t.emoji} ${t.name}
                </span>
              `).join('')}
            </div>
          </div>

          <div class="sidebar-cards-list" id="ed-cards-list"></div>

          <div class="sidebar-footer">
            <button id="ed-btn-new-card" class="btn btn-small" style="background:#0284c7;color:#fff;">+ Add New Card</button>
          </div>
        </aside>

        <!-- CENTER: Form Editor Panel -->
        <main class="editor-form-panel">
          <!-- Identity Section -->
          <div class="form-section">
            <div class="form-section-title">🆔 Card Identity & Class</div>
            <div class="form-grid-2">
              <div class="form-field">
                <label for="f-name">Card Name</label>
                <input type="text" id="f-name" value="${escapeHtml(editedCard.name || '')}" />
              </div>
              <div class="form-field">
                <label for="f-emoji">Emoji Icon</label>
                <div class="emoji-picker-row">
                  <input type="text" id="f-emoji" value="${editedCard.emoji || '🐾'}" style="width: 50px; text-align: center; font-size: 1.3rem;" />
                  <div class="emoji-palette">
                    ${QUICK_EMOJIS.map(em => `<button class="emoji-btn" type="button">${em}</button>`).join('')}
                  </div>
                </div>
              </div>
            </div>

            <div class="form-field">
              <label>Class Outline & Theme</label>
              <div class="radio-pill-group">
                ${Object.entries(CLASSES).map(([k, c]) => `
                  <label class="radio-pill">
                    <input type="radio" name="f-class" value="${k}" ${editedCard.class === k ? 'checked' : ''} />
                    <span><b style="color:${c.color};">●</b> ${c.label}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div class="form-field">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" id="f-token" ${editedCard.token ? 'checked' : ''} />
                <span>Token card (summoned only, cannot be recruited)</span>
              </label>
            </div>
          </div>

          <!-- Combat Stats -->
          <div class="form-section">
            <div class="form-section-title">⚔️ Combat Stats</div>
            <div class="form-grid-2">
              <div class="form-field">
                <label>Attack (⚔️ ATK)</label>
                <div class="stepper-group">
                  <button type="button" class="stepper-btn" data-step-atk="-1">−</button>
                  <input type="number" id="f-atk" class="stepper-input" min="0" max="25" value="${editedCard.atk ?? 1}" />
                  <button type="button" class="stepper-btn" data-step-atk="1">+</button>
                  <input type="range" id="f-atk-range" min="0" max="20" value="${editedCard.atk ?? 1}" style="flex:1;" />
                </div>
              </div>

              <div class="form-field">
                <label>Health (❤️ HP)</label>
                <div class="stepper-group">
                  <button type="button" class="stepper-btn" data-step-hp="-1">−</button>
                  <input type="number" id="f-hp" class="stepper-input" min="1" max="50" value="${editedCard.hp ?? 1}" />
                  <button type="button" class="stepper-btn" data-step-hp="1">+</button>
                  <input type="range" id="f-hp-range" min="1" max="30" value="${editedCard.hp ?? 1}" style="flex:1;" />
                </div>
              </div>
            </div>
          </div>

          <!-- Trigger & Mechanic -->
          <div class="form-section">
            <div class="form-section-title">⚡ Trigger Timing</div>
            <div class="form-field">
              <label>When does this ability execute?</label>
              <div class="radio-pill-group">
                ${Object.entries(TRIGGERS).map(([k, t]) => `
                  <label class="radio-pill">
                    <input type="radio" name="f-trigger" value="${k}" ${editedCard.trigger === k ? 'checked' : ''} />
                    <span>${t.emoji} ${t.name}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </div>

          <!-- Ability Mechanic Preset -->
          <div class="form-section">
            <div class="form-section-title">🔮 Ability Mechanic & Parameters</div>
            <div class="form-field">
              <label for="f-preset-type">Mechanic Preset</label>
              <select id="f-preset-type">
                <option value="deal_damage" ${(editedCard.preset?.type === 'deal_damage') ? 'selected' : ''}>💥 Deal Damage</option>
                <option value="buff" ${(editedCard.preset?.type === 'buff') ? 'selected' : ''}>✨ Buff Stats (ATK / HP)</option>
                <option value="summon" ${(editedCard.preset?.type === 'summon') ? 'selected' : ''}>🐣 Summon Token</option>
                <option value="reposition" ${(editedCard.preset?.type === 'reposition') ? 'selected' : ''}>🔄 Reposition / Move</option>
                <option value="debuff" ${(editedCard.preset?.type === 'debuff') ? 'selected' : ''}>☠️ Warlock Debuff Enemy ATK</option>
                <option value="retaliate" ${(editedCard.preset?.type === 'retaliate') ? 'selected' : ''}>🛡️ Retaliate (Deal damage taken back)</option>
                <option value="shield" ${(editedCard.preset?.type === 'shield') ? 'selected' : ''}>🛡️ Gain Shield (1-time block)</option>
                <option value="custom" ${(editedCard.preset?.type === 'custom') ? 'selected' : ''}>💻 Custom JavaScript Code</option>
              </select>
            </div>

            <div id="f-preset-options" class="preset-options-box"></div>

            <div class="form-field" style="margin-top: 8px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label for="f-text">Ability Description Text</label>
                <button type="button" id="f-btn-autotext" class="btn btn-small" style="font-size:0.75rem;">✨ Auto-Generate Text</button>
              </div>
              <textarea id="f-text">${escapeHtml(editedCard.text || '')}</textarea>
            </div>
          </div>
        </main>

        <!-- RIGHT: Live Preview & Clash Sandbox -->
        <aside class="editor-preview-panel">
          <div class="preview-card-section">
            <div class="form-section-title" style="width:100%; text-align:left;">👁️ Live Card Preview</div>
            <div class="preview-card-wrap" id="ed-live-card"></div>
            <div class="preview-diff-info" id="ed-diff-info"></div>
          </div>

          <!-- Mini Test Arena -->
          <div class="editor-arena-section">
            <div class="arena-header">
              <div class="arena-title">⚔️ Mini Test Arena</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <label style="font-size:0.75rem;color:#94a3b8;">Initiative:</label>
                <select id="ed-arena-initiative" style="background:#1e293b;border:1px solid #334155;color:#fff;font-size:0.75rem;padding:2px 6px;border-radius:4px;">
                  <option value="player" ${initiative === 'player' ? 'selected' : ''}>You First ➜</option>
                  <option value="enemy" ${initiative === 'enemy' ? 'selected' : ''}>⬅ Enemy First</option>
                </select>
              </div>
            </div>

            <div class="form-field" style="margin-bottom: 4px;">
              <label for="ed-opponent-select" style="font-size:0.75rem;">Opponent Dummy:</label>
              <select id="ed-opponent-select" style="background:#090e1a;border:1px solid #334155;color:#fff;font-size:0.8rem;padding:4px 8px;border-radius:4px;">
                ${Object.entries(TEST_OPPONENTS).map(([k, op]) => `
                  <option value="${k}" ${opponentId === k ? 'selected' : ''}>${op.emoji} ${op.name} (${op.atk}⚔️/${op.hp}❤️ - ${op.trigger})</option>
                `).join('')}
              </select>
            </div>

            <div class="arena-stage" id="ed-arena-stage">
              <div id="arena-player-card"></div>
              <div class="arena-versus">VS</div>
              <div id="arena-opponent-card"></div>
            </div>

            <div class="arena-controls">
              <div class="arena-actions-row">
                <button type="button" id="ed-btn-test-trigger" class="btn btn-small" style="background:#0369a1;color:#fff;">⚡ Test Ability Trigger</button>
                <button type="button" id="ed-btn-test-clash" class="btn btn-small btn-primary">⚔️ Simulate Clash</button>
              </div>
            </div>

            <div class="arena-log" id="ed-arena-log">
              <div class="arena-log-line hl">— Test Arena Ready —</div>
              <div class="arena-log-line">Click "Test Ability" or "Simulate Clash" to test.</div>
            </div>
          </div>
        </aside>
      </div>
    `;

    renderCardsList();
    renderPresetOptions();
    renderLiveCard();
    renderArenaStage();
    attachEvents();
  }

  function renderCardsList() {
    const listEl = containerEl.querySelector('#ed-cards-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const ids = Object.keys(CHARACTERS).filter(id => {
      const def = CHARACTERS[id];
      if (filterClass !== 'all' && def.class !== filterClass) return false;
      if (filterTrigger !== 'all' && def.trigger !== filterTrigger) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = def.name?.toLowerCase().includes(q);
        const matchId = id.toLowerCase().includes(q);
        const matchEmoji = def.emoji?.includes(q);
        if (!matchName && !matchId && !matchEmoji) return false;
      }
      return true;
    });

    for (const id of ids) {
      const def = CHARACTERS[id];
      const isModified = !!overrides[id];
      const classMeta = CLASSES[def.class] || { color: '#64748b', label: 'None' };
      const trigEmoji = TRIGGERS[def.trigger]?.emoji || '';

      const item = document.createElement('div');
      item.className = `sidebar-card-item ${id === activeId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="sidebar-card-emoji">${def.emoji || '🐾'}</div>
        <div class="sidebar-card-info">
          <div class="sidebar-card-name-row">
            <span class="sidebar-card-name">${escapeHtml(def.name || id)}</span>
            ${isModified ? '<span class="sidebar-modified-badge">EDITED</span>' : ''}
          </div>
          <div class="sidebar-card-meta">
            <span class="card-class-dot" style="background:${classMeta.color};"></span>
            <span>${classMeta.label}</span>
            <span>•</span>
            <span>${def.atk}⚔️ ${def.hp}❤️</span>
            ${trigEmoji ? `<span>${trigEmoji}</span>` : ''}
          </div>
        </div>
      `;
      item.addEventListener('click', () => {
        selectCard(id);
      });
      listEl.appendChild(item);
    }
  }

  function selectCard(id) {
    activeId = id;
    editedCard = cloneCardDef(id);
    render();
  }

  function renderPresetOptions() {
    const box = containerEl.querySelector('#f-preset-options');
    if (!box) return;
    const p = editedCard.preset || { type: 'deal_damage', target: 'first_enemy', amount: 2 };

    if (p.type === 'deal_damage') {
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-field">
            <label>Target</label>
            <select id="p-dmg-target">
              <option value="first_enemy" ${p.target === 'first_enemy' ? 'selected' : ''}>First Enemy (Front)</option>
              <option value="random_enemy" ${p.target === 'random_enemy' ? 'selected' : ''}>Random Enemy</option>
              <option value="all_enemies" ${p.target === 'all_enemies' ? 'selected' : ''}>ALL Enemies</option>
              <option value="attacker" ${p.target === 'attacker' ? 'selected' : ''}>Attacker</option>
              <option value="self_hp_enemy" ${p.target === 'self_hp_enemy' ? 'selected' : ''}>Random Enemy (damage = this card's HP)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Damage Amount</label>
            <input type="number" id="p-dmg-amount" min="1" max="20" value="${p.amount ?? 3}" />
          </div>
        </div>
      `;
    } else if (p.type === 'buff') {
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-field">
            <label>Target</label>
            <select id="p-buff-target">
              <option value="self" ${p.target === 'self' ? 'selected' : ''}>Self</option>
              <option value="friend_behind" ${p.target === 'friend_behind' ? 'selected' : ''}>Friend Behind</option>
              <option value="friend_ahead" ${p.target === 'friend_ahead' ? 'selected' : ''}>Friend Ahead</option>
              <option value="two_ahead" ${p.target === 'two_ahead' ? 'selected' : ''}>Two Friends Ahead</option>
              <option value="random_friend" ${p.target === 'random_friend' ? 'selected' : ''}>Random Friend</option>
              <option value="all_friends" ${p.target === 'all_friends' ? 'selected' : ''}>All Friends</option>
            </select>
          </div>
          <div class="form-field">
            <label>Dynamic Buff</label>
            <select id="p-buff-dynamic">
              <option value="" ${!p.dynamic ? 'selected' : ''}>Fixed Stats (Use ATK/HP inputs)</option>
              <option value="equal_this_atk" ${p.dynamic === 'equal_this_atk' ? 'selected' : ''}>HP equal to this card's ATK</option>
              <option value="equal_remaining_hp" ${p.dynamic === 'equal_remaining_hp' ? 'selected' : ''}>ATK equal to this remaining HP</option>
            </select>
          </div>
        </div>
        <div class="form-grid-2">
          <div class="form-field">
            <label>+ATK Delta</label>
            <input type="number" id="p-buff-atk" min="-10" max="20" value="${p.atk ?? 1}" />
          </div>
          <div class="form-field">
            <label>+HP Delta</label>
            <input type="number" id="p-buff-hp" min="-10" max="20" value="${p.hp ?? 0}" />
          </div>
        </div>
      `;
    } else if (p.type === 'summon') {
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-field">
            <label>Token Type</label>
            <select id="p-sum-token">
              <option value="bug" ${p.token === 'bug' ? 'selected' : ''}>🐛 Bug (1/1)</option>
              <option value="beetle" ${p.token === 'beetle' ? 'selected' : ''}>🪲 Beetle (2/2)</option>
            </select>
          </div>
          <div class="form-field">
            <label>Count & Position</label>
            <div style="display:flex;gap:6px;">
              <select id="p-sum-count" style="flex:1;">
                <option value="1" ${Number(p.count) === 1 ? 'selected' : ''}>1 token</option>
                <option value="2" ${Number(p.count) === 2 ? 'selected' : ''}>2 tokens</option>
              </select>
              <select id="p-sum-pos" style="flex:1;">
                <option value="behind" ${p.pos === 'behind' ? 'selected' : ''}>Behind</option>
                <option value="front" ${p.pos === 'front' ? 'selected' : ''}>At Front</option>
              </select>
            </div>
          </div>
        </div>
      `;
    } else if (p.type === 'reposition') {
      box.innerHTML = `
        <div class="form-grid-2">
          <div class="form-field">
            <label>Movement Action</label>
            <select id="p-repo-action">
              <option value="push_last" ${p.action === 'push_last' ? 'selected' : ''}>Push to Last</option>
              <option value="bring_front" ${p.action === 'bring_front' ? 'selected' : ''}>Bring to Front</option>
            </select>
          </div>
          <div class="form-field">
            <label>Target</label>
            <select id="p-repo-target">
              <option value="first_enemy" ${p.target === 'first_enemy' ? 'selected' : ''}>First Enemy</option>
              <option value="lowest_hp_enemy" ${p.target === 'lowest_hp_enemy' ? 'selected' : ''}>Lowest-HP Enemy</option>
              <option value="highest_hp_friend" ${p.target === 'highest_hp_friend' ? 'selected' : ''}>Highest-HP Friend</option>
              <option value="highest_atk_friend" ${p.target === 'highest_atk_friend' ? 'selected' : ''}>Highest-ATK Friend</option>
            </select>
          </div>
        </div>
      `;
    } else if (p.type === 'debuff') {
      box.innerHTML = `
        <div class="form-field">
          <label>Debuff Type</label>
          <select id="p-debuff-type">
            <option value="halve_highest_atk" ${p.debuffType === 'halve_highest_atk' ? 'selected' : ''}>Halve highest-ATK enemy's ATK (rounded down)</option>
            <option value="set_atk_to_hp" ${p.debuffType === 'set_atk_to_hp' ? 'selected' : ''}>Set first enemy's ATK equal to its current HP</option>
            <option value="reduce_atk_by_hp" ${p.debuffType === 'reduce_atk_by_hp' ? 'selected' : ''}>Reduce first enemy's ATK by its current HP</option>
          </select>
        </div>
      `;
    } else if (p.type === 'retaliate') {
      box.innerHTML = `
        <p style="font-size:0.8rem;color:#94a3b8;margin:0;">
          Automatically calculates damage taken in the clash and inflicts half back (rounded down) to the attacker.
        </p>
      `;
    } else if (p.type === 'shield') {
      box.innerHTML = `
        <p style="font-size:0.8rem;color:#94a3b8;margin:0;">
          Gives this card a 1-time Shield that completely absorbs the next hit.
        </p>
      `;
    } else if (p.type === 'custom') {
      box.innerHTML = `
        <div class="form-field">
          <label>run(api, self, ctx) Async Code</label>
          <textarea id="p-code-run" class="code-field" style="min-height:90px;" placeholder="const enemies = api.enemiesOf(self);\nif (enemies.length) await api.damage(enemies[0], 3, self);">${escapeHtml(p.runCode || '')}</textarea>
        </div>
        <div class="form-field">
          <label>preview(p) Code (optional arrows/badges)</label>
          <textarea id="p-code-preview" class="code-field" style="min-height:60px;" placeholder="return [{ targets: [p.enemies[0]], hp: -3 }];">${escapeHtml(p.previewCode || '')}</textarea>
        </div>
        <div class="hint" style="font-size:0.72rem;color:#64748b;">
          Available API: api.damage(t, amt, src), api.buff(t, atk, hp, src), api.summon(side, idx, id, src), api.shield(t, src), api.enemiesOf(self), api.friendsOf(self), api.friendBehind(self), api.randomOf(arr)
        </div>
      `;
    }

    attachPresetEvents();
  }

  function attachPresetEvents() {
    const box = containerEl.querySelector('#f-preset-options');
    if (!box) return;

    box.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', () => {
        updatePresetFromInputs();
      });
    });
  }

  function updatePresetFromInputs() {
    const p = editedCard.preset || {};
    const type = containerEl.querySelector('#f-preset-type').value;
    p.type = type;

    if (type === 'deal_damage') {
      p.target = containerEl.querySelector('#p-dmg-target')?.value || 'first_enemy';
      p.amount = Number(containerEl.querySelector('#p-dmg-amount')?.value) || 1;
    } else if (type === 'buff') {
      p.target = containerEl.querySelector('#p-buff-target')?.value || 'self';
      p.dynamic = containerEl.querySelector('#p-buff-dynamic')?.value || null;
      p.atk = Number(containerEl.querySelector('#p-buff-atk')?.value) || 0;
      p.hp = Number(containerEl.querySelector('#p-buff-hp')?.value) || 0;
    } else if (type === 'summon') {
      p.token = containerEl.querySelector('#p-sum-token')?.value || 'bug';
      p.count = Number(containerEl.querySelector('#p-sum-count')?.value) || 1;
      p.pos = containerEl.querySelector('#p-sum-pos')?.value || 'behind';
    } else if (type === 'reposition') {
      p.action = containerEl.querySelector('#p-repo-action')?.value || 'push_last';
      p.target = containerEl.querySelector('#p-repo-target')?.value || 'first_enemy';
    } else if (type === 'debuff') {
      p.debuffType = containerEl.querySelector('#p-debuff-type')?.value || 'halve_highest_atk';
    } else if (type === 'custom') {
      p.runCode = containerEl.querySelector('#p-code-run')?.value || '';
      p.previewCode = containerEl.querySelector('#p-code-preview')?.value || '';
    }

    editedCard.preset = p;
    renderLiveCard();
  }

  function renderLiveCard() {
    const wrap = containerEl.querySelector('#ed-live-card');
    if (!wrap) return;

    const classMeta = CLASSES[editedCard.class] || { color: '#64748b', label: 'None' };
    const trig = TRIGGERS[editedCard.trigger] || { emoji: '🏁', name: 'Start' };

    wrap.innerHTML = `
      <div class="card card-class-${editedCard.class}" style="--class-color: ${classMeta.color}; transform: scale(1.1);">
        <div class="card-class-banner" style="background:${classMeta.color};">${classMeta.label}</div>
        <div class="badge badge-atk">⚔️ ${editedCard.atk}</div>
        <div class="badge badge-hp">❤️ ${editedCard.hp}</div>
        <div class="card-art">${editedCard.emoji || '🐾'}</div>
        <div class="card-name">${escapeHtml(editedCard.name || 'Unnamed')}</div>
        <div class="trigger-badge trigger-${editedCard.trigger}">${trig.emoji} ${trig.name}</div>
        <div class="card-ability">${escapeHtml(editedCard.text || '')}</div>
      </div>
    `;

    // Diff info
    const diffEl = containerEl.querySelector('#ed-diff-info');
    if (diffEl) {
      const base = BASE_CHARACTERS[activeId];
      if (base) {
        const changed = base.atk !== editedCard.atk || base.hp !== editedCard.hp || base.class !== editedCard.class || base.trigger !== editedCard.trigger || base.name !== editedCard.name || base.emoji !== editedCard.emoji;
        diffEl.innerHTML = changed
          ? `<span>Base stats: <b>${base.atk}⚔️ / ${base.hp}❤️</b> (${base.name})</span>`
          : `<span>Matches default template</span>`;
      } else {
        diffEl.innerHTML = `<span>✨ Custom card</span>`;
      }
    }

    renderArenaStage();
  }

  function renderArenaStage() {
    const pCardWrap = containerEl.querySelector('#arena-player-card');
    const opCardWrap = containerEl.querySelector('#arena-opponent-card');
    if (!pCardWrap || !opCardWrap) return;

    const op = TEST_OPPONENTS[opponentId] || TEST_OPPONENTS.dummy_target;
    const pClass = CLASSES[editedCard.class] || { color: '#64748b', label: 'None' };
    const opClass = CLASSES[op.class] || { color: '#64748b', label: 'None' };

    pCardWrap.innerHTML = `
      <div class="card card-class-${editedCard.class}" style="--class-color: ${pClass.color}; zoom: 0.85;">
        <div class="card-class-banner" style="background:${pClass.color};">${pClass.label}</div>
        <div class="badge badge-atk">⚔️ ${editedCard.atk}</div>
        <div class="badge badge-hp">❤️ ${editedCard.hp}</div>
        <div class="card-art">${editedCard.emoji || '🐾'}</div>
        <div class="card-name">${escapeHtml(editedCard.name || '')}</div>
        <div class="trigger-badge trigger-${editedCard.trigger}">${TRIGGERS[editedCard.trigger]?.emoji || ''}</div>
      </div>
    `;

    opCardWrap.innerHTML = `
      <div class="card card-class-${op.class}" style="--class-color: ${opClass.color}; zoom: 0.85;">
        <div class="card-class-banner" style="background:${opClass.color};">${opClass.label}</div>
        <div class="badge badge-atk">⚔️ ${op.atk}</div>
        <div class="badge badge-hp">❤️ ${op.hp}</div>
        <div class="card-art">${op.emoji}</div>
        <div class="card-name">${escapeHtml(op.name)}</div>
        <div class="trigger-badge trigger-${op.trigger}">${TRIGGERS[op.trigger]?.emoji || ''}</div>
      </div>
    `;
  }

  function arenaLog(msg, cls = '') {
    const logEl = containerEl.querySelector('#ed-arena-log');
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = `arena-log-line ${cls}`;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Mini Sandbox Tests
  async function testAbilityTrigger() {
    const logEl = containerEl.querySelector('#ed-arena-log');
    if (logEl) logEl.innerHTML = '';
    arenaLog(`⚡ Testing trigger: ${TRIGGERS[editedCard.trigger]?.emoji} ${TRIGGERS[editedCard.trigger]?.name}`, 'hl');

    const card = { ...editedCard };
    const { run } = buildCardLogic(card);

    let dummyOpponent = {
      name: TEST_OPPONENTS[opponentId].name,
      atk: TEST_OPPONENTS[opponentId].atk,
      hp: TEST_OPPONENTS[opponentId].hp,
      side: 'enemy',
    };
    let friendBehind = { name: 'Friend Behind', atk: 2, hp: 2, side: 'player' };

    const mockApi = {
      team: () => [card, friendBehind],
      enemiesOf: () => [dummyOpponent],
      friendsOf: () => [friendBehind],
      friendBehind: () => friendBehind,
      friendAhead: () => null,
      randomOf: arr => arr[0] || null,
      damage: async (t, amt, src) => {
        t.hp -= amt;
        arenaLog(`💥 ${src.name} deals ${amt} damage to ${t.name}! (HP: ${t.hp})`, 'dmg');
      },
      damageMany: async (targets, amt, src) => {
        for (const t of targets) {
          t.hp -= amt;
          arenaLog(`💥 ${src.name} deals ${amt} damage to ${t.name}!`, 'dmg');
        }
      },
      buff: async (t, atk, hp, src) => {
        t.atk += atk; t.hp += hp;
        arenaLog(`✨ ${src.name} buffs ${t.name}: +${atk}⚔️ / +${hp}❤️ (Now: ${t.atk}/${t.hp})`, 'buff');
      },
      shield: async (t, src) => {
        arenaLog(`🛡️ ${src.name} gives ${t.name} a 1-time Shield!`, 'buff');
      },
      summon: async (side, idx, id, src) => {
        arenaLog(`🐣 ${src.name} summons token ${id} at index ${idx}!`, 'buff');
      },
      pushToLast: async (t, src) => {
        arenaLog(`⬇️ ${src.name} pushes ${t.name} to last position!`, 'hl');
      },
      bringToFront: async (t, src) => {
        arenaLog(`⬆️ ${src.name} brings ${t.name} to front!`, 'hl');
      },
      halveAtk: async (t, src) => {
        const newAtk = Math.floor(t.atk / 2);
        arenaLog(`🐍 ${src.name} halves ${t.name}'s ATK: ${t.atk} ➔ ${newAtk}`, 'dmg');
        t.atk = newAtk;
      },
      setAtk: async (t, newAtk, src) => {
        arenaLog(`🦂 ${src.name} sets ${t.name}'s ATK to ${newAtk}`, 'dmg');
        t.atk = newAtk;
      },
    };

    try {
      await run(mockApi, card, { index: 0, damageAmount: 2, attacker: dummyOpponent });
      arenaLog('✔ Trigger execution complete.');
    } catch (err) {
      arenaLog(`❌ Error in ability execution: ${err.message}`, 'dmg');
    }
  }

  async function testSimultaneousClash() {
    const logEl = containerEl.querySelector('#ed-arena-log');
    if (logEl) logEl.innerHTML = '';
    arenaLog(`⚔️ Simulating Simultaneous Clash (${initiative === 'player' ? 'You trigger first' : 'Enemy triggers first'})`, 'hl');

    const opDef = TEST_OPPONENTS[opponentId] || TEST_OPPONENTS.dummy_target;
    const op = { ...opDef, side: 'enemy' };
    const player = { ...editedCard, side: 'player' };

    const playerLogic = buildCardLogic(player);
    const opLogic = buildCardLogic(op);

    const sidesInOrder = initiative === 'player' ? [player, op] : [op, player];

    // 1. Attack triggers before clash
    arenaLog('--- Step 1: Attack Triggers ---');
    for (const unit of sidesInOrder) {
      if (unit.trigger === 'attack') {
        const logic = unit === player ? playerLogic : opLogic;
        arenaLog(`🗡️ ${unit.name} (${unit.side}) attack trigger fires!`);
        const mockApi = {
          team: () => [unit],
          enemiesOf: () => [unit === player ? op : player],
          friendsOf: () => [],
          friendBehind: () => null,
          buff: async (t, atk, hp) => { unit.atk += atk; unit.hp += hp; arenaLog(`✨ ${unit.name} self-buffs +${atk}/+${hp}`, 'buff'); },
          summon: async () => arenaLog(`🐣 ${unit.name} summons a token!`, 'buff'),
        };
        await logic.run(mockApi, unit, { index: 0 });
      }
    }

    // 2. Simultaneous clash
    arenaLog('--- Step 2: Simultaneous Attack ---');
    arenaLog(`💥 ${player.name} deals ${player.atk} to ${op.name}`);
    arenaLog(`💥 ${op.name} deals ${op.atk} to ${player.name}`);

    const playerDmgTaken = op.atk;
    const opDmgTaken = player.atk;

    player.hp -= playerDmgTaken;
    op.hp -= opDmgTaken;

    arenaLog(`Result: ${player.name} HP: ${player.hp} | ${op.name} HP: ${op.hp}`);

    // 3. Hurt triggers
    arenaLog('--- Step 3: Hurt Triggers ---');
    for (const unit of sidesInOrder) {
      if (unit.hp > 0 && unit.trigger === 'hurt') {
        const dmgTaken = unit === player ? playerDmgTaken : opDmgTaken;
        const attacker = unit === player ? op : player;
        arenaLog(`💢 ${unit.name} took ${dmgTaken} damage, hurt trigger fires!`);
        if (unit.preset?.type === 'retaliate') {
          const ret = Math.floor(dmgTaken / 2);
          attacker.hp -= ret;
          arenaLog(`🐅 Retaliate inflicts ${ret} damage back to ${attacker.name} (HP: ${attacker.hp})`, 'dmg');
        }
      }
    }

    // 4. Death check
    arenaLog('--- Step 4: Outcome ---');
    if (player.hp <= 0 && op.hp <= 0) {
      arenaLog('💀 Both cards knocked out simultaneously!', 'dmg');
    } else if (player.hp <= 0) {
      arenaLog(`💀 ${player.name} was defeated. ${op.name} survives!`, 'dmg');
    } else if (op.hp <= 0) {
      arenaLog(`🎉 ${op.name} was defeated! ${player.name} wins!`, 'buff');
    } else {
      arenaLog(`⚖️ Both survived: ${player.name} (${player.hp}❤️) vs ${op.name} (${op.hp}❤️)`);
    }
  }

  function attachEvents() {
    // Search
    containerEl.querySelector('#ed-search').addEventListener('input', e => {
      searchQuery = e.target.value;
      renderCardsList();
    });

    // Class filters
    containerEl.querySelectorAll('[data-class]').forEach(b => b.addEventListener('click', () => {
      filterClass = b.dataset.class;
      containerEl.querySelectorAll('[data-class]').forEach(x => x.classList.toggle('active', x.dataset.class === filterClass));
      renderCardsList();
    }));

    // Trigger filters
    containerEl.querySelectorAll('[data-trigger]').forEach(b => b.addEventListener('click', () => {
      filterTrigger = b.dataset.trigger;
      containerEl.querySelectorAll('[data-trigger]').forEach(x => x.classList.toggle('active', x.dataset.trigger === filterTrigger));
      renderCardsList();
    }));

    // Add New Card
    containerEl.querySelector('#ed-btn-new-card').addEventListener('click', () => {
      const newId = `custom_${Date.now()}`;
      CHARACTERS[newId] = {
        name: 'New Hero',
        emoji: '🐯',
        class: 'dps',
        atk: 2,
        hp: 2,
        trigger: 'attack',
        text: 'When 🗡️ gain +1 ATK.',
        token: false,
        preset: { type: 'buff', target: 'self', atk: 1, hp: 0 },
      };
      overrides[newId] = { ...CHARACTERS[newId] };
      saveCharacterOverrides(overrides);
      selectCard(newId);
      showToast('✨ Created new card!');
    });

    // Form inputs: Name
    containerEl.querySelector('#f-name').addEventListener('input', e => {
      editedCard.name = e.target.value;
      renderLiveCard();
    });

    // Emoji input
    containerEl.querySelector('#f-emoji').addEventListener('input', e => {
      editedCard.emoji = e.target.value;
      renderLiveCard();
    });

    // Emoji palette buttons
    containerEl.querySelectorAll('.emoji-btn').forEach(btn => btn.addEventListener('click', () => {
      editedCard.emoji = btn.textContent;
      containerEl.querySelector('#f-emoji').value = btn.textContent;
      renderLiveCard();
    }));

    // Class radios
    containerEl.querySelectorAll('input[name="f-class"]').forEach(r => r.addEventListener('change', e => {
      editedCard.class = e.target.value;
      renderLiveCard();
    }));

    // Token checkbox
    containerEl.querySelector('#f-token').addEventListener('change', e => {
      editedCard.token = e.target.checked;
    });

    // Steppers & range: ATK
    const atkInput = containerEl.querySelector('#f-atk');
    const atkRange = containerEl.querySelector('#f-atk-range');
    const setAtkVal = v => {
      editedCard.atk = Math.max(0, Math.min(25, Number(v) || 0));
      atkInput.value = editedCard.atk;
      atkRange.value = editedCard.atk;
      renderLiveCard();
    };
    atkInput.addEventListener('input', e => setAtkVal(e.target.value));
    atkRange.addEventListener('input', e => setAtkVal(e.target.value));
    containerEl.querySelectorAll('[data-step-atk]').forEach(b => b.addEventListener('click', () => {
      setAtkVal(editedCard.atk + Number(b.dataset.stepAtk));
    }));

    // Steppers & range: HP
    const hpInput = containerEl.querySelector('#f-hp');
    const hpRange = containerEl.querySelector('#f-hp-range');
    const setHpVal = v => {
      editedCard.hp = Math.max(1, Math.min(50, Number(v) || 1));
      hpInput.value = editedCard.hp;
      hpRange.value = editedCard.hp;
      renderLiveCard();
    };
    hpInput.addEventListener('input', e => setHpVal(e.target.value));
    hpRange.addEventListener('input', e => setHpVal(e.target.value));
    containerEl.querySelectorAll('[data-step-hp]').forEach(b => b.addEventListener('click', () => {
      setHpVal(editedCard.hp + Number(b.dataset.stepHp));
    }));

    // Trigger radios
    containerEl.querySelectorAll('input[name="f-trigger"]').forEach(r => r.addEventListener('change', e => {
      editedCard.trigger = e.target.value;
      renderLiveCard();
    }));

    // Preset type dropdown
    containerEl.querySelector('#f-preset-type').addEventListener('change', () => {
      const type = containerEl.querySelector('#f-preset-type').value;
      if (!editedCard.preset) editedCard.preset = {};
      editedCard.preset.type = type;
      renderPresetOptions();
      renderLiveCard();
    });

    // Auto-generate text button
    containerEl.querySelector('#f-btn-autotext').addEventListener('click', () => {
      const gen = generateAbilityText(editedCard);
      editedCard.text = gen;
      containerEl.querySelector('#f-text').value = gen;
      renderLiveCard();
      showToast('✨ Description text generated!');
    });

    // Description text input
    containerEl.querySelector('#f-text').addEventListener('input', e => {
      editedCard.text = e.target.value;
      renderLiveCard();
    });

    // Sandbox controls
    containerEl.querySelector('#ed-arena-initiative').addEventListener('change', e => {
      initiative = e.target.value;
    });

    containerEl.querySelector('#ed-opponent-select').addEventListener('change', e => {
      opponentId = e.target.value;
      renderArenaStage();
    });

    containerEl.querySelector('#ed-btn-test-trigger').addEventListener('click', testAbilityTrigger);
    containerEl.querySelector('#ed-btn-test-clash').addEventListener('click', testSimultaneousClash);

    // Save to Game
    containerEl.querySelector('#ed-btn-save').addEventListener('click', () => {
      overrides[activeId] = {
        name: editedCard.name,
        emoji: editedCard.emoji,
        class: editedCard.class,
        atk: editedCard.atk,
        hp: editedCard.hp,
        trigger: editedCard.trigger,
        text: editedCard.text,
        token: editedCard.token,
        preset: editedCard.preset,
      };
      saveCharacterOverrides(overrides);
      renderCardsList();
      renderLiveCard();
      onSave();
      showToast('💾 Saved! Characters are updated in the game.');
    });

    // Copy JS Code
    containerEl.querySelector('#ed-btn-copy-js').addEventListener('click', async () => {
      const code = exportCharactersJs(CHARACTERS);
      try {
        await navigator.clipboard.writeText(code);
        showToast('📋 Copied characters.js code to clipboard!');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast('📋 Copied characters.js code!');
      }
    });

    // Download JS file
    containerEl.querySelector('#ed-btn-dl-js').addEventListener('click', () => {
      const code = exportCharactersJs(CHARACTERS);
      const blob = new Blob([code], { type: 'text/javascript' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'characters.js';
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('📥 Downloaded characters.js');
    });

    // Reset this card
    containerEl.querySelector('#ed-btn-reset-card').addEventListener('click', () => {
      if (BASE_CHARACTERS[activeId]) {
        delete overrides[activeId];
        saveCharacterOverrides(overrides);
        editedCard = cloneCardDef(activeId);
        render();
        onSave();
        showToast(`🔄 Reset ${editedCard.name} to default!`);
      } else {
        if (confirm(`Delete custom card "${editedCard.name}"?`)) {
          delete overrides[activeId];
          delete CHARACTERS[activeId];
          saveCharacterOverrides(overrides);
          activeId = Object.keys(CHARACTERS)[0];
          editedCard = cloneCardDef(activeId);
          render();
          onSave();
          showToast('🗑️ Card deleted.');
        }
      }
    });

    // Reset All
    containerEl.querySelector('#ed-btn-reset-all').addEventListener('click', () => {
      if (confirm('Reset ALL characters back to their default base stats and abilities?')) {
        resetCharacterOverrides();
        overrides = {};
        editedCard = cloneCardDef(activeId);
        render();
        onSave();
        showToast('⚠️ All cards restored to defaults.');
      }
    });

    // Close button (if in modal)
    const closeBtn = containerEl.querySelector('#ed-btn-close');
    if (closeBtn) closeBtn.addEventListener('click', onClose);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial draw
  render();
}
