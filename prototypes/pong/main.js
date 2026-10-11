import { createGameLoop, Keyboard, SimpleAudio } from '/src/shared/utils.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const input = new Keyboard();
const audio = new SimpleAudio();

const scorePlayerElem = document.getElementById('player-score');
const scoreAiElem = document.getElementById('ai-score');

let playerScore = 0;
let aiScore = 0;

const paddleHeight = 90;
const paddleWidth = 14;

const player = {
  x: 24,
  y: canvas.height / 2 - paddleHeight / 2,
  w: paddleWidth,
  h: paddleHeight,
  speed: 400
};

const ai = {
  x: canvas.width - 24 - paddleWidth,
  y: canvas.height / 2 - paddleHeight / 2,
  w: paddleWidth,
  h: paddleHeight,
  speed: 320
};

const ball = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 8,
  speed: 420,
  vx: 420,
  vy: 200
};

function resetBall(direction = 1) {
  ball.x = canvas.width / 2;
  ball.y = canvas.height / 2;
  ball.speed = 420;
  const angle = (Math.random() * Math.PI / 3) - (Math.PI / 6); // -30 to +30 deg
  ball.vx = Math.cos(angle) * ball.speed * direction;
  ball.vy = Math.sin(angle) * ball.speed;
}

function update(dt) {
  // Player control
  if (input.isDown('KeyW', 'ArrowUp')) {
    player.y -= player.speed * dt;
  }
  if (input.isDown('KeyS', 'ArrowDown')) {
    player.y += player.speed * dt;
  }
  player.y = Math.max(10, Math.min(canvas.height - player.h - 10, player.y));

  // Simple AI tracking
  const aiCenter = ai.y + ai.h / 2;
  if (ball.vx > 0) { // only track when ball comes toward AI
    if (aiCenter < ball.y - 12) {
      ai.y += ai.speed * dt;
    } else if (aiCenter > ball.y + 12) {
      ai.y -= ai.speed * dt;
    }
  }
  ai.y = Math.max(10, Math.min(canvas.height - ai.h - 10, ai.y));

  // Ball movement
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Top / bottom bounce
  if (ball.y - ball.radius <= 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy);
    audio.hit();
  } else if (ball.y + ball.radius >= canvas.height) {
    ball.y = canvas.height - ball.radius;
    ball.vy = -Math.abs(ball.vy);
    audio.hit();
  }

  // Player paddle collision
  if (
    ball.x - ball.radius <= player.x + player.w &&
    ball.x + ball.radius >= player.x &&
    ball.y >= player.y &&
    ball.y <= player.y + player.h &&
    ball.vx < 0
  ) {
    ball.x = player.x + player.w + ball.radius;
    ball.speed = Math.min(ball.speed * 1.05, 750); // accelerate slightly
    const relativeIntersectY = (ball.y - (player.y + player.h / 2)) / (player.h / 2);
    const bounceAngle = relativeIntersectY * (Math.PI / 3); // max 60 deg
    ball.vx = Math.cos(bounceAngle) * ball.speed;
    ball.vy = Math.sin(bounceAngle) * ball.speed;
    audio.beep(550);
  }

  // AI paddle collision
  if (
    ball.x + ball.radius >= ai.x &&
    ball.x - ball.radius <= ai.x + ai.w &&
    ball.y >= ai.y &&
    ball.y <= ai.y + ai.h &&
    ball.vx > 0
  ) {
    ball.x = ai.x - ball.radius;
    ball.speed = Math.min(ball.speed * 1.05, 750);
    const relativeIntersectY = (ball.y - (ai.y + ai.h / 2)) / (ai.h / 2);
    const bounceAngle = relativeIntersectY * (Math.PI / 3);
    ball.vx = -Math.cos(bounceAngle) * ball.speed;
    ball.vy = Math.sin(bounceAngle) * ball.speed;
    audio.beep(420);
  }

  // Scoring
  if (ball.x + ball.radius < 0) {
    aiScore++;
    scoreAiElem.textContent = aiScore;
    audio.hit();
    resetBall(1);
  } else if (ball.x - ball.radius > canvas.width) {
    playerScore++;
    scorePlayerElem.textContent = playerScore;
    audio.score();
    resetBall(-1);
  }
}

function render() {
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Center dashed line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Player paddle
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.roundRect(player.x, player.y, player.w, player.h, 6);
  ctx.fill();

  // Draw AI paddle
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.roundRect(ai.x, ai.y, ai.w, ai.h, 6);
  ctx.fill();

  // Draw Ball
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
}

resetBall(1);
createGameLoop(update, render);
