import { createGameLoop, Keyboard, SimpleAudio } from '/src/shared/utils.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const input = new Keyboard();
const audio = new SimpleAudio();

const scoreElem = document.getElementById('hud-score');
const bestElem = document.getElementById('hud-best');

let survivalTime = 0;
let bestTime = 0;
let gameOver = false;

// Spaceship state
const ship = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 12,
  angle: -Math.PI / 2,
  rotSpeed: 4.5,
  thrust: 350,
  vx: 0,
  vy: 0,
  friction: 0.985
};

let particles = [];
let asteroids = [];
let spawnTimer = 0;

function resetGame() {
  ship.x = canvas.width / 2;
  ship.y = canvas.height / 2;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = -Math.PI / 2;
  survivalTime = 0;
  asteroids = [];
  particles = [];
  gameOver = false;
}

function spawnAsteroid() {
  const edge = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
  let x, y;
  if (edge === 0) { x = Math.random() * canvas.width; y = -30; }
  else if (edge === 1) { x = canvas.width + 30; y = Math.random() * canvas.height; }
  else if (edge === 2) { x = Math.random() * canvas.width; y = canvas.height + 30; }
  else { x = -30; y = Math.random() * canvas.height; }

  // Target somewhere around the center / ship
  const targetX = canvas.width / 2 + (Math.random() - 0.5) * 300;
  const targetY = canvas.height / 2 + (Math.random() - 0.5) * 300;
  const angle = Math.atan2(targetY - y, targetX - x);
  const speed = 100 + Math.random() * 120 + Math.min(survivalTime * 4, 150);

  asteroids.push({
    x, y,
    radius: 15 + Math.random() * 20,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 3
  });
}

function update(dt) {
  if (gameOver) {
    if (input.isDown('Space')) resetGame();
    return;
  }

  survivalTime += dt;
  scoreElem.textContent = `${survivalTime.toFixed(1)}s`;
  if (survivalTime > bestTime) {
    bestTime = survivalTime;
    bestElem.textContent = `${bestTime.toFixed(1)}s`;
  }

  // Ship rotation
  if (input.isDown('ArrowLeft', 'KeyA')) {
    ship.angle -= ship.rotSpeed * dt;
  }
  if (input.isDown('ArrowRight', 'KeyD')) {
    ship.angle += ship.rotSpeed * dt;
  }

  // Thrust
  const isThrusting = input.isDown('ArrowUp', 'KeyW');
  if (isThrusting) {
    ship.vx += Math.cos(ship.angle) * ship.thrust * dt;
    ship.vy += Math.sin(ship.angle) * ship.thrust * dt;

    // Thruster particles
    const exhaustX = ship.x - Math.cos(ship.angle) * ship.radius;
    const exhaustY = ship.y - Math.sin(ship.angle) * ship.radius;
    particles.push({
      x: exhaustX,
      y: exhaustY,
      vx: -Math.cos(ship.angle) * 120 + (Math.random() - 0.5) * 40,
      vy: -Math.sin(ship.angle) * 120 + (Math.random() - 0.5) * 40,
      life: 0.35,
      maxLife: 0.35,
      color: Math.random() > 0.5 ? '#f97316' : '#facc15'
    });
  }

  // Apply friction
  ship.vx *= Math.pow(ship.friction, dt * 60);
  ship.vy *= Math.pow(ship.friction, dt * 60);

  // Ship position
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  // Wrap around canvas screen edges
  if (ship.x < -ship.radius) ship.x = canvas.width + ship.radius;
  if (ship.x > canvas.width + ship.radius) ship.x = -ship.radius;
  if (ship.y < -ship.radius) ship.y = canvas.height + ship.radius;
  if (ship.y > canvas.height + ship.radius) ship.y = -ship.radius;

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Asteroid spawn
  spawnTimer += dt;
  const spawnInterval = Math.max(0.4, 1.2 - survivalTime * 0.02);
  if (spawnTimer >= spawnInterval) {
    spawnAsteroid();
    spawnTimer = 0;
  }

  // Update asteroids & check collisions
  for (let i = asteroids.length - 1; i >= 0; i--) {
    const ast = asteroids[i];
    ast.x += ast.vx * dt;
    ast.y += ast.vy * dt;
    ast.rot += ast.rotSpeed * dt;

    // Check collision with ship
    const dist = Math.hypot(ship.x - ast.x, ship.y - ast.y);
    if (dist < ship.radius + ast.radius) {
      gameOver = true;
      audio.explosion();
      break;
    }

    // Remove offscreen asteroids
    if (
      ast.x < -100 || ast.x > canvas.width + 100 ||
      ast.y < -100 || ast.y > canvas.height + 100
    ) {
      asteroids.splice(i, 1);
    }
  }
}

function render() {
  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Particles
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Asteroids
  ctx.strokeStyle = '#94a3b8';
  ctx.fillStyle = '#1e293b';
  ctx.lineWidth = 2;
  for (const ast of asteroids) {
    ctx.save();
    ctx.translate(ast.x, ast.y);
    ctx.rotate(ast.rot);
    ctx.beginPath();
    ctx.arc(0, 0, ast.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Draw ship
  if (!gameOver) {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(ship.radius, 0);
    ctx.lineTo(-ship.radius * 0.8, -ship.radius * 0.7);
    ctx.lineTo(-ship.radius * 0.4, 0);
    ctx.lineTo(-ship.radius * 0.8, ship.radius * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  } else {
    // Game Over display
    ctx.fillStyle = '#f43f5e';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CRASHED!', canvas.width / 2, canvas.height / 2 - 20);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px monospace';
    ctx.fillText('Press SPACE to Restart', canvas.width / 2, canvas.height / 2 + 30);
  }
}

createGameLoop(update, render);
