# 🕹️ Web Game Prototypes Workspace

A modular JavaScript game development prototyping environment built with **Vite** and **Vanilla JS**.

Each game prototype lives in its own dedicated folder under `prototypes/<name>` and can be reached directly via its own URL endpoint (e.g., `http://localhost:5173/<name>/`) or navigated through the Main Menu hub.

---

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🎮 Included Prototypes & Endpoints

| Prototype | Endpoint | Folder | Description |
| :--- | :--- | :--- | :--- |
| **Main Menu Hub** | `/` | `index.html` & `src/hub/` | Visual launcher with search & filter |
| **Retro Pong** | `http://localhost:5173/pong/` | `prototypes/pong/` | 2-player / AI paddle bounce physics & sound |
| **Neon Breakout** | `http://localhost:5173/breakout/` | `prototypes/breakout/` | Brick breaker with destructible grid & lives |
| **Asteroid Dodger**| `http://localhost:5173/asteroid-dodger/` | `prototypes/asteroid-dodger/` | Spaceship inertia, thrusters & hazard dodging |
| **Template** | `http://localhost:5173/template/` | `prototypes/template/` | Clean starter template |

---

## 🛠️ Creating a New Prototype

To quickly scaffold a new prototype from the clean template, run:

```bash
npm run new <prototypename>
```

**Example:**
```bash
npm run new dungeon-crawler
```

This will automatically:
1. Create `prototypes/dungeon-crawler/` with `index.html`, `main.js`, `style.css`, and `meta.json`.
2. Map it to the endpoint `http://localhost:5173/dungeon-crawler/`.
3. Display it dynamically on the Main Menu Hub.

---

## 📁 Project Structure

```text
Prototypes/
├── index.html                   # Main Menu Hub (Arcade launcher)
├── vite.config.js               # Dynamic endpoint routing & MPA bundling
├── package.json
├── .gitignore
├── scripts/
│   └── create-prototype.js      # CLI helper for 'npm run new <name>'
├── src/
│   ├── hub/                     # Styles and script for Main Menu launcher
│   └── shared/
│       ├── nav.js               # Drop-in top navigation HUD (Hub button, FPS counter)
│       └── utils.js             # Game loop, keyboard input, WebAudio synth
└── prototypes/
    ├── template/                # Starter template for quick replication
    ├── pong/                    # Pong game prototype
    ├── breakout/                # Brick-breaker prototype
    └── asteroid-dodger/         # 2D space flight prototype
```

---

## 🔗 How Direct Endpoints Work

In [`vite.config.js`](file:///C:/Users/Shery/Github/Prototypes/vite.config.js), a custom Vite plugin inspects incoming requests:
- Visiting `/<name>` or `/<name>/` automatically maps to `prototypes/<name>/index.html`.
- Any prototype's local assets (`./main.js`, `./style.css`, images, sounds) resolve directly.
- The shared navigation bar (`/src/shared/nav.js`) gives you a 1-click **"Hub Menu"** button on every prototype screen to switch back and forth effortlessly.

---

## 📦 Building for Production

To bundle all prototypes together:
```bash
npm run build
npm run preview
```
All prototypes found in `prototypes/*` are automatically discovered and bundled.
