// Game prototyping utility helpers

/**
 * Creates a standard requestAnimationFrame game loop with delta time (seconds)
 */
export function createGameLoop(updateFn, renderFn) {
  let lastTime = performance.now();
  let isRunning = true;

  function loop(currentTime) {
    if (!isRunning) return;
    const dt = Math.min((currentTime - lastTime) / 1000, 0.1); // clamp delta time to 100ms
    lastTime = currentTime;

    if (updateFn) updateFn(dt);
    if (renderFn) renderFn();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame((time) => {
    lastTime = time;
    requestAnimationFrame(loop);
  });

  return {
    stop: () => { isRunning = false; },
    start: () => {
      if (!isRunning) {
        isRunning = true;
        lastTime = performance.now();
        requestAnimationFrame(loop);
      }
    }
  };
}

/**
 * Simple keyboard input tracker
 */
export class Keyboard {
  constructor() {
    this.keys = new Set();
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.keys.delete(e.key.toLowerCase());
    });
  }

  isDown(...keyNames) {
    return keyNames.some(k => this.keys.has(k) || this.keys.has(k.toLowerCase()));
  }
}

/**
 * Procedural Web Audio Sound Synthesizer (Zero asset dependencies)
 */
export class SimpleAudio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  playTone(frequency, type = 'sine', duration = 0.1, gainVal = 0.1) {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Audio playback might be restricted before user gesture
    }
  }

  beep(freq = 440) { this.playTone(freq, 'sine', 0.08, 0.15); }
  hit() { this.playTone(160, 'square', 0.1, 0.15); }
  score() {
    this.playTone(523.25, 'triangle', 0.1, 0.15);
    setTimeout(() => this.playTone(659.25, 'triangle', 0.15, 0.15), 80);
  }
  explosion() { this.playTone(80, 'sawtooth', 0.3, 0.2); }
}

/**
 * Auto-sizes canvas to fill parent / window while maintaining internal resolution
 */
export function setupCanvas(canvas, width = 800, height = 600) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx, width, height };
}
