// Hub Main Menu Client Logic
import prototypes from 'virtual:prototypes';

const BASE = import.meta.env.BASE_URL;

// Shared votes and highlights live in a Firebase Realtime Database (the site is static on GitHub Pages),
// accessed through its plain REST API. Layout: /<env>/votes/<id> = number, /<env>/highlights/<id> = boolean
const DB_URL = 'https://prototypes-6e2bd-default-rtdb.europe-west1.firebasedatabase.app';
// Local dev gets its own branch so testing doesn't touch the live data
const DB_ROOT = `${DB_URL}/${import.meta.env.DEV ? 'dev' : 'prod'}`;
// Bumped when the backend changed, so votes remembered from the old service don't get cancelled into the new one
const VOTED_STORAGE_KEY = 'hub-voted-prototypes-v2';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const visible = prototypes.filter(p => !p.hidden);
// List is sorted newest first, so the first dated entry is the latest
const latestId = visible[0]?.created ? visible[0].id : null;

const state = {
  query: '',
  sort: 'newest',
  highlightsOnly: false,
  highlighted: {},      // id -> true/false (undefined while loading / on error)
  highlightPending: new Set(),
  votes: {},            // id -> count (undefined while loading / on error)
  voted: loadVoted(),   // ids this browser already voted for
  votePending: new Set(),
};

// --- Per-computer vote memory ---

function loadVoted() {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTED_STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveVoted() {
  try {
    localStorage.setItem(VOTED_STORAGE_KEY, JSON.stringify([...state.voted]));
  } catch { /* storage unavailable: vote still counts, just not remembered */ }
}

// --- Database API ---

const READ_TIMEOUT_MS = 10000;

async function dbRequest(path, options = {}) {
  if (!DB_URL) throw new Error('DB_URL is not configured');
  const res = await fetch(`${DB_ROOT}/${path}.json`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// The increment runs on the server, so simultaneous votes from different computers never overwrite each other
async function changeVotes(id, delta) {
  return dbRequest(`votes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ '.sv': { increment: delta } }),
  });
}

async function setHighlightRemote(id, on) {
  return dbRequest(`highlights/${id}`, { method: 'PUT', body: JSON.stringify(on) });
}

// One request fetches every vote count and highlight
async function loadAll() {
  try {
    const data = await dbRequest('', { signal: AbortSignal.timeout(READ_TIMEOUT_MS) }) ?? {};
    for (const p of visible) {
      state.votes[p.id] = Math.max(0, data.votes?.[p.id] ?? 0);
      state.highlighted[p.id] = data.highlights?.[p.id] === true;
    }
  } catch (e) {
    console.warn(`[hub] Could not load votes and highlights: ${e.message}`);
  }
  renderList();
}

async function toggleHighlight(id) {
  if (state.highlightPending.has(id)) return;
  const prev = state.highlighted[id];
  state.highlightPending.add(id);
  state.highlighted[id] = !prev;
  renderList();

  try {
    await setHighlightRemote(id, !prev);
  } catch (e) {
    console.warn(`[hub] Highlight toggle for "${id}" failed: ${e.message}`);
    state.highlighted[id] = prev;
  }
  state.highlightPending.delete(id);
  renderList();
}

// Clicking again cancels this browser's vote
async function toggleVote(id) {
  if (state.votePending.has(id)) return;
  const cancelling = state.voted.has(id);
  const prev = state.votes[id];
  state.votePending.add(id);
  if (cancelling) state.voted.delete(id); else state.voted.add(id);
  state.votes[id] = Math.max(0, (prev ?? 0) + (cancelling ? -1 : 1));
  saveVoted();
  renderList();

  try {
    const total = await changeVotes(id, cancelling ? -1 : 1);
    if (typeof total === 'number') state.votes[id] = Math.max(0, total);
  } catch (e) {
    console.warn(`[hub] ${cancelling ? 'Cancelling vote' : 'Vote'} for "${id}" failed: ${e.message}`);
    if (cancelling) state.voted.add(id); else state.voted.delete(id);
    state.votes[id] = prev;
    saveVoted();
  }
  state.votePending.delete(id);
  renderList();
}

// --- Rendering ---

function getFilteredSorted() {
  const q = state.query.trim().toLowerCase();
  const pool = state.highlightsOnly ? visible.filter(p => state.highlighted[p.id]) : visible;
  const filtered = q
    ? pool.filter(p => [p.title, p.id, p.description].some(f => f.toLowerCase().includes(q)))
    : pool.slice();
  if (state.sort === 'votes') {
    // Stable sort keeps newest-first among ties
    filtered.sort((a, b) => (state.votes[b.id] ?? -1) - (state.votes[a.id] ?? -1));
  }
  return filtered;
}

function renderList() {
  const list = document.getElementById('prototypes-list');

  if (visible.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No prototypes yet</h3>
        <p style="margin-top: 8px;">Run <code>npm run new &lt;name&gt;</code> to make one.</p>
      </div>
    `;
    return;
  }

  const items = getFilteredSorted();
  if (items.length === 0) {
    const noHighlights = state.highlightsOnly && !visible.some(p => state.highlighted[p.id]);
    list.innerHTML = noHighlights ? `
      <div class="empty-state">
        <h3>No highlights yet</h3>
        <p style="margin-top: 8px;">Click the ☆ on a prototype to highlight it for the team.</p>
      </div>
    ` : `
      <div class="empty-state">
        <h3>No matches</h3>
        <p style="margin-top: 8px;">Nothing matches "${escapeHtml(state.query)}"${state.highlightsOnly ? ' in highlights' : ''}.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map((proto) => {
    const url = `${BASE}${proto.id}/`;
    const date = proto.created ? formatDate(proto.created) : '';
    const isLatest = proto.id === latestId;
    const hasVoted = state.voted.has(proto.id);
    const count = state.votes[proto.id];
    const isHighlighted = !!state.highlighted[proto.id];
    return `
      <div class="prototype-row${isLatest ? ' is-latest' : ''}${isHighlighted ? ' is-highlighted' : ''}">
        <a href="${url}" class="row-link">
          <div class="row-main">
            <div class="row-heading">
              <h2 class="row-title">${escapeHtml(proto.title)}</h2>
              ${isLatest ? '<span class="latest-tag">Latest</span>' : ''}
              ${isHighlighted ? '<span class="highlight-tag">Try this</span>' : ''}
              <span class="endpoint-pill">/${escapeHtml(proto.id)}</span>
            </div>
            <p class="row-desc">${escapeHtml(proto.description)}</p>
          </div>
          <div class="row-meta">
            ${date ? `<time class="row-date" datetime="${escapeHtml(proto.created)}">${date}</time>` : ''}
            <span class="row-arrow" aria-hidden="true">➔</span>
          </div>
        </a>
        <div class="vote-box">
          <button class="highlight-btn${isHighlighted ? ' on' : ''}" data-highlight="${escapeHtml(proto.id)}"
            ${state.highlightPending.has(proto.id) ? 'disabled' : ''}
            aria-pressed="${isHighlighted}"
            title="${isHighlighted ? 'Remove highlight for the team' : 'Highlight for the team to try'}"
            aria-label="${isHighlighted ? 'Remove highlight from' : 'Highlight'} ${escapeHtml(proto.title)}">${isHighlighted ? '★' : '☆'}</button>
          <button class="vote-btn${hasVoted ? ' voted' : ''}" data-vote="${escapeHtml(proto.id)}"
            ${state.votePending.has(proto.id) ? 'disabled' : ''}
            aria-pressed="${hasVoted}"
            title="${hasVoted ? 'You voted for this one. Click to cancel your vote' : 'Vote +1'}"
            aria-label="${hasVoted ? 'Cancel vote for' : 'Vote for'} ${escapeHtml(proto.title)}">${hasVoted
              ? '<span class="vote-on">✓</span><span class="vote-off">✕</span>'
              : '+1'}</button>
          <span class="vote-count" title="Votes">${count ?? '–'}</span>
        </div>
      </div>
    `;
  }).join('');
}

document.getElementById('prototypes-list')?.addEventListener('click', (e) => {
  const hlBtn = e.target.closest('[data-highlight]');
  if (hlBtn) return toggleHighlight(hlBtn.dataset.highlight);
  const btn = e.target.closest('[data-vote]');
  if (btn) toggleVote(btn.dataset.vote);
});

document.getElementById('search-input')?.addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});

document.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
  state.sort = btn.dataset.sort;
  document.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b === btn));
  renderList();
}));

document.getElementById('btn-highlights')?.addEventListener('click', (e) => {
  state.highlightsOnly = !state.highlightsOnly;
  e.currentTarget.classList.toggle('active', state.highlightsOnly);
  e.currentTarget.setAttribute('aria-pressed', String(state.highlightsOnly));
  renderList();
});

// Modal helpers
const modal = document.getElementById('modal-new-proto');
document.getElementById('btn-create-modal')?.addEventListener('click', () => modal?.classList.add('open'));
document.getElementById('modal-close')?.addEventListener('click', () => modal?.classList.remove('open'));
modal?.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});

renderList();
loadAll();
