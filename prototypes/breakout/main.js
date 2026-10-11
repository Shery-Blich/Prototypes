import { createGameLoop, Keyboard, SimpleAudio } from '/src/shared/utils.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const input = new Keyboard();
const audio = new SimpleAudio();

const scoreElem = document.getElementById('hud-score');
const livesElem = document.getElementById('hud-lives');

let score = 0;
let lives = 3;

// Paddle
const paddle = {
  w: 100,
  h: 14,
  x: canvas.width / 2 - 50,
  y: canvas.height - 40,
  speed: 500,
  color: '#38bdf8'
};

// Ball
const ball = {
  x: canvas.width / 2,
  y: paddle.y - 10,
  radius: 7,
  vx: 240,
  vy: -260,
  speed: 360,
  stuck: true
};

// Bricks
const rows = 5;
const cols = 8;
const brickPadding = 8;
const brickOffsetTop = 50;
const brickOffsetLeft = 35;
const brickWidth = (canvas.width - (brickOffsetLeft * 2) - (brickPadding * (cols - 1))) / cols;
const brickHeight = 22;

const brickColors = ['#f43f5e', '#fb923c', '#eab308', '#10b981', '#6366f1'];

let bricks = [];
function resetBricks() {
  bricks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      bricks.push({
        x: brickOffsetLeft + c * (brickWidth + brickPadding),
        y: brickOffsetTop + r * (brickHeight + brickPadding),
        w: brickWidth,
        h: brickHeight,
        color: brickColors[r % brickColors.length],
        alive: true
      });
    }
  }
}

// Mouse movement
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, mouseX - paddle.w / 2));
  if (ball.stuck) {
    ball.x = paddle.x + paddle.w / 2;
  }
});

// Launch ball on click / space
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && ball.stuck) launchBall();
});
canvas.addEventListener('click', () => {
  if (ball.stuck) launchBall();
});

function launchBall() {
  ball.stuck = false;
  ball.vx = (Math.random() - 0.5) * 200;
  ball.vy = -ball.speed;
  audio.beep(400);
}

function resetBall() {
  ball.stuck = true;
  ball.x = paddle.x + paddle.w / 2;
  ball.y = paddle.y - ball.radius - 2;
}

function update(dt) {
  // Keyboard controls
  if (input.isDown('KeyA', 'ArrowLeft')) {
    paddle.x -= paddle.speed * dt;
  }
  if (input.isDown('KeyD', 'ArrowRight')) {
    paddle.x += paddle.speed * dt;
  }
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, paddle.x));

  if (ball.stuck) {
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - ball.radius - 2;
    return;
  }

  // Move ball
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Wall collisions
  if (ball.x - ball.radius <= 0) {
    ball.x = ball.radius;
    ball.vx = Math.abs(ball.vx);
    audio.hit();
  } else if (ball.x + ball.radius >= canvas.width) {
    ball.x = canvas.width - ball.radius;
    ball.vx = -Math.abs(ball.vx);
    audio.hit();
  }

  if (ball.y - ball.radius <= 0) {
    ball.y = ball.radius;
    ball.vy = Math.abs(ball.vy);
    audio.hit();
  } else if (ball.y + ball.radius >= canvas.height) {
    // Ball lost
    lives--;
    livesElem.textContent = lives;
    audio.explosion();
    if (lives <= 0) {
      lives = 3;
      score = 0;
      scoreElem.textContent = score;
      livesElem.textContent = lives;
      resetBricks();
    }
    resetBall();
    return;
  }

  // Paddle collision
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.y - ball.radius <= paddle.y + paddle.h &&
    ball.x >= paddle.x &&
    ball.x <= paddle.x + paddle.w &&
    ball.vy > 0
  ) {
    ball.y = paddle.y - ball.radius;
    const hitOffset = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const bounceAngle = hitOffset * (Math.PI / 3); // Max 60 deg
    ball.vx = Math.sin(bounceAngle) * ball.speed;
    ball.vy = -Math.abs(Math.cos(bounceAngle) * ball.speed);
    audio.beep(600);
  }

  // Brick collisions
  let allCleared = true;
  for (const b of bricks) {
    if (!b.alive) continue;
    allCleared = false;

    if (
      ball.x + ball.radius >= b.x &&
      ball.x - ball.radius <= b.x + b.w &&
      ball.y + ball.radius >= b.y &&
      ball.y - ball.radius <= b.y + b.h
    ) {
      b.alive = false;
      ball.vy = -ball.vy;
      score += 10;
      scoreElem.textContent = score;
      audio.score();
      break;
    }
  }

  if (allCleared) {
    resetBricks();
    resetBall();
  }
}

function render() {
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw bricks
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 4);
    ctx.fill();
  }

  // Draw paddle
  ctx.fillStyle = paddle.color;
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 6);
  ctx.fill();

  // Draw ball
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();

  // Draw launch prompt
  if (ball.stuck) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CLICK OR PRESS SPACE TO LAUNCH', canvas.width / 2, canvas.height - 70);
  }
}

resetBricks();
resetBall();
createGameLoop(update, render);
