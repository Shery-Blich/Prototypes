# 🕹️ Web Game Prototypes Workspace

A JavaScript game prototyping workspace built with **Vite** and **Vanilla JS + Canvas**.

Each prototype lives in its own folder under `prototypes/<name>` and has its own URL endpoint (`/<name>/`). The main menu at `/` lists all of them.

**Live:** https://shery-blich.github.io/Prototypes/ (deployed automatically on every push to `master`)

---

## 🚀 Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

---

## 🛠️ Creating a New Prototype

```bash
npm run new <name>
```

This copies `prototypes/template/` to `prototypes/<name>/`, which is then:
- reachable at `http://localhost:5173/<name>/`
- listed on the main menu (live, no restart needed)

**Reserved names** (rejected because they clash with project paths): `src`, `assets`, `prototypes`, `public`, `node_modules`, `scripts`, `dist`, `api`.

### `meta.json`

| Field | Required | Description |
| :--- | :--- | :--- |
| `title` | yes | Shown on the menu card and nav bar |
| `description` | no | Shown on the menu card |
| `hidden` | no | `true` hides it from the menu (used by `template`) |

---

## 📁 Project Structure

```text
Prototypes/
├── index.html                   # Main menu
├── vite.config.js               # Prototype discovery, /<name>/ routing, build layout
├── .github/workflows/deploy.yml # GitHub Pages deployment
├── scripts/
│   ├── create-prototype.js      # 'npm run new <name>'
│   └── reserved-names.js
├── src/
│   ├── hub/                     # Main menu script & styles
│   └── shared/
│       ├── nav.js               # Top bar with "Hub Menu" button (include in every prototype)
│       └── utils.js             # Game loop, keyboard input, WebAudio beeps
└── prototypes/
    └── template/                # Starter template (hidden from menu)
```

---

## 📦 Build & Deploy

```bash
npm run build      # outputs dist/<name>/index.html for each prototype
npm run preview
```

The site base path comes from the `BASE_PATH` env variable (default `/`). The GitHub Actions workflow sets it to `/<repo-name>/` for GitHub Pages. To test the Pages layout locally:

```bash
BASE_PATH=/Prototypes/ npm run build && BASE_PATH=/Prototypes/ npm run preview
```

> In Git Bash on Windows, prefix with `MSYS_NO_PATHCONV=1` so the path isn't rewritten.

In JavaScript, build links with `import.meta.env.BASE_URL` instead of a hard-coded `/`, so they work on GitHub Pages.
