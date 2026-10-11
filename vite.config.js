import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESERVED_NAMES } from './scripts/reserved-names.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prototypesDir = path.resolve(__dirname, 'prototypes');

// Base path: '/' locally, '/<repo>/' on GitHub Pages (set by the deploy workflow)
const base = process.env.BASE_PATH || '/';

const VIRTUAL_ID = 'virtual:prototypes';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

function toTitle(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Folder names of all valid prototypes (have an index.html and aren't reserved)
function getPrototypeNames() {
  if (!fs.existsSync(prototypesDir)) return [];
  return fs.readdirSync(prototypesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => {
      if (RESERVED_NAMES.includes(name)) {
        console.warn(`[prototypes] Skipping "${name}": reserved name.`);
        return false;
      }
      return fs.existsSync(path.resolve(prototypesDir, name, 'index.html'));
    });
}

function getPrototypesList() {
  return getPrototypeNames().map(name => {
    let meta = {};
    const metaFile = path.resolve(prototypesDir, name, 'meta.json');
    if (fs.existsSync(metaFile)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      } catch (e) {
        console.warn(`[prototypes] Invalid ${metaFile}: ${e.message}`);
      }
    }
    return {
      id: name,
      title: meta.title || toTitle(name),
      description: meta.description || '',
      hidden: !!meta.hidden,
      created: meta.created || null,
    };
  // Newest first; prototypes without a created date go last
  }).sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0) || a.title.localeCompare(b.title));
}

function prototypesPlugin() {
  return {
    name: 'prototypes',
    enforce: 'post',

    // Prototype list baked into the bundle (works in dev, build & GitHub Pages)
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return `export default ${JSON.stringify(getPrototypesList())};`;
      }
    },

    configureServer(server) {
      // Refresh the menu when prototypes are added/removed/edited
      server.watcher.add(prototypesDir);
      const refresh = (file) => {
        if (!path.resolve(file).startsWith(prototypesDir)) return;
        if (!/(meta\.json|index\.html)$/.test(file) && fs.existsSync(file) && !fs.statSync(file).isDirectory()) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      ['add', 'unlink', 'addDir', 'unlinkDir', 'change'].forEach(evt => server.watcher.on(evt, refresh));

      // Map /<name>/ to prototypes/<name>/ (same URLs as the build output)
      server.middlewares.use((req, res, next) => {
        const [urlPath, queryString] = (req.url || '/').split('?');
        const query = queryString ? `?${queryString}` : '';
        const match = urlPath.match(/^\/([a-zA-Z0-9_-]+)(\/.*)?$/);
        if (!match) return next();

        const name = match[1];
        const rest = match[2] || '';
        if (RESERVED_NAMES.includes(name)) return next();
        const protoDir = path.resolve(prototypesDir, name);
        if (!fs.existsSync(path.resolve(protoDir, 'index.html'))) return next();

        if (rest === '') {
          res.statusCode = 302;
          res.setHeader('Location', `/${name}/${query}`);
          res.end();
          return;
        }
        if (rest === '/') {
          req.url = `/prototypes/${name}/index.html${query}`;
          return next();
        }
        if (fs.existsSync(path.resolve(protoDir, '.' + rest))) {
          req.url = `/prototypes/${name}${rest}${query}`;
        }
        next();
      });
    },

    // Move built pages from prototypes/<name>/index.html to <name>/index.html
    generateBundle(_, bundle) {
      for (const [key, file] of Object.entries(bundle)) {
        const m = file.fileName.match(/^prototypes\/([^/]+)\/index\.html$/);
        if (!m) continue;
        delete bundle[key];
        this.emitFile({ type: 'asset', fileName: `${m[1]}/index.html`, source: file.source });
      }
    },
  };
}

function getRollupInputs() {
  const inputs = { main: path.resolve(__dirname, 'index.html') };
  for (const name of getPrototypeNames()) {
    inputs[name] = path.resolve(prototypesDir, name, 'index.html');
  }
  return inputs;
}

export default defineConfig({
  base,
  plugins: [prototypesPlugin()],
  build: {
    rollupOptions: { input: getRollupInputs() },
  },
  server: { port: 5173, open: true },
});
