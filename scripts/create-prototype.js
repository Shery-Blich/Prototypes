#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const prototypesDir = path.resolve(rootDir, 'prototypes');
const templateDir = path.resolve(prototypesDir, 'template');

let protoName = process.argv[2];

if (!protoName) {
  console.log(`
\x1b[33m[!] Please provide a prototype name.\x1b[0m
Example:
  \x1b[36mnpm run new platformer-jump\x1b[0m
`);
  process.exit(1);
}

// Sanitize name
protoName = protoName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
const targetDir = path.resolve(prototypesDir, protoName);

if (fs.existsSync(targetDir)) {
  console.error(`\x1b[31m[x] Prototype "${protoName}" already exists at: ${targetDir}\x1b[0m`);
  process.exit(1);
}

// Copy template
fs.cpSync(templateDir, targetDir, { recursive: true });

// Customize meta.json
const metaFile = path.resolve(targetDir, 'meta.json');
if (fs.existsSync(metaFile)) {
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  meta.title = protoName.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  meta.description = `Prototype for ${meta.title}`;
  meta.tags = ['2D', 'Canvas', 'Experimental'];
  meta.date = new Date().toISOString().split('T')[0];
  delete meta.isTemplate;
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');
}

// Customize index.html title
const htmlFile = path.resolve(targetDir, 'index.html');
if (fs.existsSync(htmlFile)) {
  let html = fs.readFileSync(htmlFile, 'utf-8');
  const title = protoName.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  html = html.replace('<title>Game Prototype Template</title>', `<title>${title} Prototype</title>`);
  fs.writeFileSync(htmlFile, html, 'utf-8');
}

console.log(`
\x1b[32m✔ Successfully created prototype: ${protoName}\x1b[0m
Location: \x1b[34mprototypes/${protoName}\x1b[0m
Endpoint: \x1b[36mhttp://localhost:5173/${protoName}/\x1b[0m

Run \x1b[33mnpm run dev\x1b[0m to test and start building!
`);
