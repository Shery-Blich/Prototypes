import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPrototypesList() {
  const prototypesDir = path.resolve(__dirname, 'prototypes');
  if (!fs.existsSync(prototypesDir)) return [];

  const entries = fs.readdirSync(prototypesDir, { withFileTypes: true });
  const prototypes = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const protoName = entry.name;
    const protoDir = path.resolve(prototypesDir, protoName);
    const htmlFile = path.resolve(protoDir, 'index.html');
    if (!fs.existsSync(htmlFile)) continue;

    const metaFile = path.resolve(protoDir, 'meta.json');
    let meta = {
      id: protoName,
      title: protoName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: 'Game prototype',
      tags: ['prototype'],
      controls: 'Keyboard & Mouse',
      date: new Date().toISOString().split('T')[0],
      isTemplate: protoName === 'template'
    };

    if (fs.existsSync(metaFile)) {
      try {
        const customMeta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        meta = { ...meta, ...customMeta, id: protoName };
      } catch (e) {
        console.error(`Error reading ${metaFile}:`, e);
      }
    }

    prototypes.push(meta);
  }

  return prototypes;
}

function prototypeRouterPlugin() {
  return {
    name: 'prototype-router',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/';
        const [urlPath, queryString] = rawUrl.split('?');
        const query = queryString ? `?${queryString}` : '';

        // API endpoint to discover all prototypes
        if (urlPath === '/api/prototypes') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getPrototypesList()));
          return;
        }

        // Match direct prototype route: /<prototypename> or /<prototypename>/
        const singleSegmentMatch = urlPath.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
        if (singleSegmentMatch) {
          const protoName = singleSegmentMatch[1];
          const protoHtml = path.resolve(__dirname, 'prototypes', protoName, 'index.html');

          if (fs.existsSync(protoHtml)) {
            // If missing trailing slash, redirect with 302 to preserve relative path resolution
            if (!urlPath.endsWith('/')) {
              res.statusCode = 302;
              res.setHeader('Location', `/${protoName}/${query}`);
              res.end();
              return;
            }

            // Rewrite URL to the prototype index.html
            req.url = `/prototypes/${protoName}/index.html${query}`;
            return next();
          }
        }

        // Match asset requests under /<prototypename>/<asset-path>
        const assetMatch = urlPath.match(/^\/([a-zA-Z0-9_-]+)\/(.+)$/);
        if (assetMatch) {
          const protoName = assetMatch[1];
          const relativeAsset = assetMatch[2];
          const targetAssetPath = path.resolve(__dirname, 'prototypes', protoName, relativeAsset);

          // If the file exists inside that prototype's folder, rewrite the request path
          if (fs.existsSync(targetAssetPath)) {
            req.url = `/prototypes/${protoName}/${relativeAsset}${query}`;
            return next();
          }
        }

        next();
      });
    }
  };
}

// Generate rollup entry inputs dynamically for build
function getRollupInputs() {
  const inputs = {
    main: path.resolve(__dirname, 'index.html'),
  };

  const prototypesDir = path.resolve(__dirname, 'prototypes');
  if (fs.existsSync(prototypesDir)) {
    const entries = fs.readdirSync(prototypesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const htmlPath = path.resolve(prototypesDir, entry.name, 'index.html');
      if (fs.existsSync(htmlPath)) {
        inputs[entry.name] = htmlPath;
      }
    }
  }

  return inputs;
}

export default defineConfig({
  plugins: [prototypeRouterPlugin()],
  build: {
    rollupOptions: {
      input: getRollupInputs(),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
