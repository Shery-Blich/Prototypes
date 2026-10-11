// Hub Main Menu Client Logic

let allPrototypes = [];
let activeTag = 'ALL';

async function fetchPrototypes() {
  try {
    const res = await fetch('/api/prototypes');
    if (!res.ok) throw new Error('Failed to load prototypes');
    allPrototypes = await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
    allPrototypes = [];
  }
  renderTags();
  renderGrid();
}

function renderTags() {
  const container = document.getElementById('tag-filters');
  const tagsSet = new Set(['ALL']);

  allPrototypes.forEach(p => {
    (p.tags || []).forEach(t => tagsSet.add(t.toUpperCase()));
  });

  container.innerHTML = Array.from(tagsSet).map(tag => `
    <button class="tag-filter-btn ${tag === activeTag ? 'active' : ''}" data-tag="${tag}">
      ${tag}
    </button>
  `).join('');

  container.querySelectorAll('.tag-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;
      renderTags();
      renderGrid();
    });
  });
}

function renderGrid() {
  const grid = document.getElementById('prototypes-list');
  const searchQuery = (document.getElementById('search-input')?.value || '').toLowerCase();

  const filtered = allPrototypes.filter(p => {
    // Hide starter template from list unless explicitly searched
    if (p.id === 'template' && !searchQuery.includes('template')) {
      return false;
    }

    const matchesSearch = p.title.toLowerCase().includes(searchQuery) ||
                          p.description.toLowerCase().includes(searchQuery) ||
                          p.id.toLowerCase().includes(searchQuery) ||
                          (p.tags || []).some(t => t.toLowerCase().includes(searchQuery));

    const matchesTag = activeTag === 'ALL' || (p.tags || []).some(t => t.toUpperCase() === activeTag);

    return matchesSearch && matchesTag;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: #64748b;">
        <h3>No prototypes found</h3>
        <p style="margin-top: 8px;">Try a different search term or run <code>npm run new &lt;name&gt;</code> to make one.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(proto => {
    const url = `/${proto.id}/`;
    return `
      <div class="prototype-card">
        <div class="card-top">
          <h2 class="card-title">${proto.title}</h2>
          <a href="${url}" class="endpoint-pill" title="Direct URL Endpoint">/${proto.id}</a>
        </div>
        <p class="card-desc">${proto.description || 'Interactive prototype'}</p>
        
        <div class="card-controls">
          <span>🎮</span>
          <span><strong>Controls:</strong> ${proto.controls || 'Keyboard / Mouse'}</span>
        </div>

        <div class="card-tags">
          ${(proto.tags || []).map(t => `<span class="tag-badge">${t}</span>`).join('')}
        </div>

        <div class="card-actions">
          <a href="${url}" class="btn btn-launch btn-launch-primary">
            Play Prototype ➔
          </a>
        </div>
      </div>
    `;
  }).join('');
}

// Search input listener
document.getElementById('search-input')?.addEventListener('input', () => {
  renderGrid();
});

// Modal helpers
const modal = document.getElementById('modal-new-proto');
const btnOpenModal = document.getElementById('btn-create-modal');
const btnCloseModal = document.getElementById('modal-close');

btnOpenModal?.addEventListener('click', () => modal?.classList.add('open'));
btnCloseModal?.addEventListener('click', () => modal?.classList.remove('open'));
modal?.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});

// Initialize on page load
fetchPrototypes();
