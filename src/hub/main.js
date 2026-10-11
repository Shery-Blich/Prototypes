// Hub Main Menu Client Logic
import prototypes from 'virtual:prototypes';

const BASE = import.meta.env.BASE_URL;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function renderGrid() {
  const grid = document.getElementById('prototypes-list');
  const visible = prototypes.filter(p => !p.hidden);

  if (visible.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: #64748b;">
        <h3>No prototypes yet</h3>
        <p style="margin-top: 8px;">Run <code>npm run new &lt;name&gt;</code> to make one.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = visible.map(proto => {
    const url = `${BASE}${proto.id}/`;
    return `
      <div class="prototype-card">
        <div class="card-top">
          <h2 class="card-title">${escapeHtml(proto.title)}</h2>
          <a href="${url}" class="endpoint-pill" title="Direct URL Endpoint">/${escapeHtml(proto.id)}</a>
        </div>
        <p class="card-desc">${escapeHtml(proto.description)}</p>
        <div class="card-actions">
          <a href="${url}" class="btn btn-launch btn-launch-primary">Play Prototype ➔</a>
        </div>
      </div>
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

renderGrid();
