'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = { mini: [100, 200, 400, 0, 0], full: [400, 800, 1200, 1600, 0] };
const PERFECT_CLEAR_SCORES = [0, 800, 1200, 1800, 2000];
const COMBO_CAP = 10;
const B2B_MULT = 1.5;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const soundToggle = document.getElementById('sound-toggle');
const comboEl = document.getElementById('combo');
const comboSectionEl = document.getElementById('combo-section');
const b2bEl = document.getElementById('b2b');
const b2bSectionEl = document.getElementById('b2b-section');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let comboCount, b2bCount, lastMoveWasRotate, lastKickWasZero, maxCombo, toasts, flash, muted, audioCtx;

function getGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim();
}

function cssVar(name) {
  const bare = name.replace(/^var\((.+)\)$/, '$1');
  return getComputedStyle(document.documentElement).getPropertyValue(bare).trim();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.checked = theme === 'light';
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  applyTheme(saved === 'light' ? 'light' : 'dark');
  themeToggle.addEventListener('change', () => {
    applyTheme(themeToggle.checked ? 'light' : 'dark');
  });
}

function initSound() {
  const saved = localStorage.getItem('muted');
  muted = saved === 'true';
  soundToggle.checked = !muted;
  soundToggle.addEventListener('change', () => {
    muted = !soundToggle.checked;
    localStorage.setItem('muted', String(muted));
  });
}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(freq, durMs, type = 'sine', gain = 0.15, delayMs = 0) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime + delayMs / 1000;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + durMs / 1000);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000);
}

function sfxLock() {
  beep(120, 80, 'square', 0.08);
}

function sfxLineClear(combo) {
  const freq = 220 * Math.pow(1.12, Math.max(0, combo));
  beep(freq, 140, 'triangle', 0.18);
}

function sfxTetris() {
  [523, 659, 784].forEach((f, i) => beep(f, 160, 'square', 0.16, i * 60));
}

function sfxTSpin() {
  beep(700, 90, 'sawtooth', 0.14);
  beep(350, 160, 'sawtooth', 0.14, 70);
}

function sfxPerfectClear() {
  [523, 659, 784, 988, 1318].forEach((f, i) => beep(f, 200, 'sine', 0.18, i * 70));
}

function sfxComboBreak() {
  beep(180, 100, 'sawtooth', 0.1);
}

function sfxGameOver() {
  beep(220, 500, 'sawtooth', 0.15);
  beep(110, 700, 'sawtooth', 0.15, 120);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveWasRotate = true;
      lastKickWasZero = kick === 0;
      return;
    }
  }
}

// Corner occupied for T-spin purposes: out of bounds counts as occupied.
function cornerOccupied(x, y) {
  if (x < 0 || x >= COLS || y >= ROWS) return true;
  if (y < 0) return false;
  return !!board[y][x];
}

function detectTSpin() {
  if (current.type !== 3 || !lastMoveWasRotate) return 'none';
  // Locate the T's pivot (center of its 3x3 bounding box) from its shape.
  const shape = current.shape;
  let pivotR = -1, pivotC = -1;
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] && r > 0 && r < shape.length - 1 && c > 0 && c < shape[r].length - 1) {
        pivotR = r; pivotC = c;
      }
    }
  }
  if (pivotR < 0) return 'none';
  const bx = current.x + pivotC;
  const by = current.y + pivotR;
  // Corners relative to pivot, in shape-local terms.
  const corners = {
    tl: cornerOccupied(bx - 1, by - 1),
    tr: cornerOccupied(bx + 1, by - 1),
    bl: cornerOccupied(bx - 1, by + 1),
    br: cornerOccupied(bx + 1, by + 1),
  };
  const occupiedCount = Object.values(corners).filter(Boolean).length;
  if (occupiedCount < 3) return 'none';

  // Determine which side the T's flat side (stem) points toward -> that's the "front".
  // Find the stem cell: the single protruding cell outside the 1x3 body row.
  let front;
  const stemDir = tStemDirection(shape, pivotR, pivotC);
  if (stemDir === 'up') front = ['tl', 'tr'];
  else if (stemDir === 'down') front = ['bl', 'br'];
  else if (stemDir === 'left') front = ['tl', 'bl'];
  else front = ['tr', 'br'];

  const frontOccupied = front.filter(k => corners[k]).length;
  const backOccupied = occupiedCount - frontOccupied;

  if (frontOccupied === 2) return 'full';
  if (backOccupied === 2 && !lastKickWasZero) return 'full';
  return 'mini';
}

function tStemDirection(shape, pivotR, pivotC) {
  // The stem is the cell of the T that sticks out of the flat 3-length side.
  // Check each of the 4 neighbors of the pivot for the lone protruding cell.
  const dirs = [
    ['up', -1, 0], ['down', 1, 0], ['left', 0, -1], ['right', 0, 1],
  ];
  for (const [name, dr, dc] of dirs) {
    const r = pivotR + dr, c = pivotC + dc;
    if (shape[r] && shape[r][c]) {
      // The stem points opposite to the flat side; the flat side has the other 2 neighbors filled.
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[name];
      const [, odr, odc] = dirs.find(d => d[0] === opposite);
      if (!(shape[pivotR + odr] && shape[pivotR + odr][pivotC + odc])) return name;
    }
  }
  return 'down';
}

function isPerfectClear() {
  return board.every(row => row.every(v => v === 0));
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

function pushToast(text, colorVar) {
  toasts.push({ text, color: cssVar(colorVar), born: performance.now(), life: 1200 });
}

function scoreClear(cleared, tspin) {
  if (cleared === 0) {
    if (comboCount >= 1) sfxComboBreak();
    comboCount = -1;
    updateHUD();
    return;
  }

  comboCount++;
  maxCombo = Math.max(maxCombo, comboCount);
  const perfectClear = isPerfectClear();

  const isTSpin = tspin !== 'none';
  const base = isTSpin
    ? (TSPIN_SCORES[tspin][cleared] || 0)
    : (LINE_SCORES[cleared] || 0);

  const isHard = cleared === 4 || isTSpin;
  let b2bActive = false;
  if (isHard) {
    b2bActive = b2bCount >= 0;
    b2bCount++;
  } else {
    b2bCount = -1;
  }

  const comboMult = Math.min(COMBO_CAP, Math.max(1, comboCount + 1));
  const b2bMult = b2bActive ? B2B_MULT : 1;
  const comboBonus = comboCount > 0 ? 50 * comboCount * level : 0;
  const pcBonus = perfectClear ? (PERFECT_CLEAR_SCORES[cleared] || 0) * (b2bActive ? 2 : 1) : 0;

  score += Math.round(base * comboMult * b2bMult) * level + comboBonus + pcBonus * level;
  lines += cleared;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);

  // Feedback
  if (comboCount >= 1) pushToast(`COMBO x${comboMult}`, 'var(--combo-color)');
  if (isTSpin) {
    const TSPIN_LABELS = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };
    const suffix = TSPIN_LABELS[cleared] ? ` ${TSPIN_LABELS[cleared]}` : '';
    pushToast(tspin === 'full' ? `T-SPIN${suffix}` : `T-SPIN MINI${suffix}`, 'var(--overlay-title-color)');
    sfxTSpin();
    flash = 1;
  } else if (cleared === 4) {
    pushToast('TETRIS', 'var(--overlay-title-color)');
    sfxTetris();
    flash = 1;
  } else {
    sfxLineClear(comboCount);
  }
  if (b2bActive) {
    pushToast('BACK-TO-BACK', 'var(--b2b-color)');
    flash = Math.max(flash, 0.7);
  }
  if (perfectClear) {
    pushToast('PERFECT CLEAR!', 'var(--value-color)');
    sfxPerfectClear();
    flash = 1;
  }

  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveWasRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tspin = detectTSpin();
  merge();
  sfxLock();
  const cleared = clearLines();
  scoreClear(cleared, tspin);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  lastMoveWasRotate = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = `x${Math.max(1, comboCount + 1)}`;
  comboSectionEl.classList.toggle('combo-active', comboCount >= 1);
  b2bSectionEl.classList.toggle('combo-active', b2bCount >= 1);
  b2bEl.textContent = b2bCount >= 0 ? `x${b2bCount + 1}` : '-';
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getGridColor();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawFlash();
  drawToasts();
}

function drawFlash() {
  if (flash <= 0) return;
  ctx.globalAlpha = flash * 0.35;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
}

function drawToasts() {
  if (!toasts.length) return;
  const now = performance.now();
  toasts = toasts.filter(t => now - t.born < t.life);
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  toasts.forEach((t, i) => {
    const age = now - t.born;
    const progress = age / t.life;
    const y = canvas.height / 2 - i * 26 - progress * 24;
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, canvas.width / 2, y);
  });
  ctx.globalAlpha = 1;
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  sfxGameOver();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()} · Combo máx: x${Math.max(1, maxCombo + 1)}`;
  overlay.classList.remove('hidden');
  animId = null;
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  if (flash > 0) flash = Math.max(0, flash - dt / 250);
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastMoveWasRotate = false;
    } else {
      lockPiece();
      if (gameOver) { draw(); return; }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  comboCount = -1;
  b2bCount = -1;
  lastMoveWasRotate = false;
  lastKickWasZero = true;
  maxCombo = -1;
  toasts = [];
  flash = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyM') {
    muted = !muted;
    soundToggle.checked = !muted;
    localStorage.setItem('muted', String(muted));
    return;
  }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) {
        current.x--;
        lastMoveWasRotate = false;
      }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) {
        current.x++;
        lastMoveWasRotate = false;
      }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

initTheme();
initSound();
init();
