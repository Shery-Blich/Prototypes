// Hub Main Menu Client Logic
import prototypes from 'virtual:prototypes';

const BASE = import.meta.env.BASE_URL;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

function renderList() {
  const list = document.getElementById('prototypes-list');
  const visible = prototypes.filter(p => !p.hidden);

  if (visible.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No prototypes yet</h3>
        <p style="margin-top: 8px;">Run <code>npm run new &lt;name&gt;</code> to make one.</p>
      </div>
    `;
    return;
  }

  // List is sorted newest first, so the first dated entry is the latest
  list.innerHTML = visible.map((proto, i) => {
    const url = `${BASE}${proto.id}/`;
    const date = proto.created ? formatDate(proto.created) : '';
    const isLatest = i === 0 && !!proto.created;
    return `
      <a href="${url}" class="prototype-row${isLatest ? ' is-latest' : ''}">
        <div class="row-main">
          <div class="row-heading">
            <h2 class="row-title">${escapeHtml(proto.title)}</h2>
            ${isLatest ? '<span class="latest-tag">Latest</span>' : ''}
            <span class="endpoint-pill">/${escapeHtml(proto.id)}</span>
          </div>
          <p class="row-desc">${escapeHtml(proto.description)}</p>
        </div>
        <div class="row-meta">
          ${date ? `<time class="row-date" datetime="${escapeHtml(proto.created)}">${date}</time>` : ''}
          <span class="row-arrow" aria-hidden="true">➔</span>
        </div>
      </a>
    `;
  }).join('');
}

// Modal helpers
const modal = document.getElementById('modal-new-proto');
document.getElementById('btn-create-modal')?.addEventListener('click', () => modal?.classList.add('open'));
document.getElementById('modal-close')?.addEventListener('click', () => modal?.classList.remove('open'));
modal?.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});

renderList();
