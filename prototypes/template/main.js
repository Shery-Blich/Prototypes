import { createGameLoop, Keyboard, SimpleAudio } from '/src/shared/utils.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const input = new Keyboard();
const audio = new SimpleAudio();

// Example prototype state: Player circle
const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 20,
  speed: 250,
  color: '#38bdf8'
};

let spacePressed = false;

function update(dt) {
  let dx = 0;
  let dy = 0;

  if (input.isDown('ArrowUp', 'KeyW')) dy -= 1;
  if (input.isDown('ArrowDown', 'KeyS')) dy += 1;
  if (input.isDown('ArrowLeft', 'KeyA')) dx -= 1;
  if (input.isDown('ArrowRight', 'KeyD')) dx += 1;

  // Normalize diagonal
  if (dx !== 0 && dy !== 0) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
  }

  player.x += dx * player.speed * dt;
  player.y += dy * player.speed * dt;

  // Clamp within canvas boundaries
  player.x = Math.max(player.radius, Math.min(canvas.width - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(canvas.height - player.radius, player.y));

  // Audio trigger test
  if (input.isDown('Space')) {
    if (!spacePressed) {
      spacePressed = true;
      audio.beep(500);
    }
  } else {
    spacePressed = false;
  }
}

function render() {
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw player
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#bae6fd';
  ctx.lineWidth = 3;
  ctx.stroke();
}

createGameLoop(update, render);
