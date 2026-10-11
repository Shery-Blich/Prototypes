// Shared Navigation HUD overlay for all prototypes
export function initPrototypeNav(customOptions = {}) {
  if (document.getElementById('proto-nav-bar')) return;

  const currentPath = window.location.pathname;
  const segments = currentPath.split('/').filter(Boolean);
  const protoId = segments[0] === 'prototypes' ? segments[1] : (segments[0] || 'Game Prototype');
  const title = customOptions.title || protoId.replace(/[-_]/g, ' ').toUpperCase();

  const nav = document.createElement('div');
  nav.id = 'proto-nav-bar';
  nav.innerHTML = `
    <div class="p-nav-left">
      <a href="/" class="p-nav-btn p-nav-home" title="Return to Hub Menu">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        <span>Hub Menu</span>
      </a>
      <span class="p-nav-separator">|</span>
      <span class="p-nav-title">${title}</span>
      <span class="p-nav-badge">/${protoId}</span>
    </div>
    <div class="p-nav-right">
      <span class="p-nav-fps" id="p-nav-fps-display">-- FPS</span>
      <button class="p-nav-btn" id="p-nav-reload" title="Restart Game">⟳ Reset</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #proto-nav-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 42px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      z-index: 999999;
      user-select: none;
    }
    .p-nav-left, .p-nav-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .p-nav-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.08);
      color: #f8fafc;
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid rgba(255, 255, 255, 0.12);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .p-nav-btn:hover {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.25);
    }
    .p-nav-home {
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.3);
    }
    .p-nav-home:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: #38bdf8;
    }
    .p-nav-separator {
      color: rgba(255, 255, 255, 0.2);
    }
    .p-nav-title {
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #ffffff;
    }
    .p-nav-badge {
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
      padding: 2px 7px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
    }
    .p-nav-fps {
      font-family: monospace;
      font-size: 11px;
      color: #94a3b8;
      min-width: 50px;
    }
    body {
      padding-top: 42px;
      margin: 0;
      box-sizing: border-box;
    }
  `;

  document.head.appendChild(style);
  document.body.prepend(nav);

  document.getElementById('p-nav-reload')?.addEventListener('click', () => {
    window.location.reload();
  });

  // Calculate & display FPS
  let lastTime = performance.now();
  let frameCount = 0;
  const fpsDisplay = document.getElementById('p-nav-fps-display');

  function updateFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastTime));
      if (fpsDisplay) fpsDisplay.textContent = `${fps} FPS`;
      frameCount = 0;
      lastTime = now;
    }
    requestAnimationFrame(updateFps);
  }
  requestAnimationFrame(updateFps);
}

// Auto-run if loaded directly in a prototype
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
      initPrototypeNav();
    }
  });
}
