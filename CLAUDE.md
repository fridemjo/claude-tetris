# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS Tetris (HTML5 Canvas). No build step, no dependencies, no package.json. Three files: `index.html` (DOM/canvas), `style.css` (dark/retro theme), `game.js` (all game logic).

## Running

No install/build required.

```bash
start index.html       # Windows: open directly
# or
python3 -m http.server 8000    # then open http://localhost:8000
npx serve .
```

There is no test suite, linter, or build tool in this repo.

## Architecture (game.js)

Single-file game with global mutable state: `board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId`.

- **Board**: `ROWS × COLS` matrix, each cell `0` (empty) or 1–7 (piece color index into `COLORS`).
- **Pieces**: square matrices in `PIECES`. Rotation is `rotateCW` (transpose + reverse), not lookup tables.
- **Collision**: `collide(shape, ox, oy)` checks bounds + existing board cells.
- **Wall kicks**: `tryRotate()` tries offsets `[0, -1, 1, -2, 2]` after rotating, keeping the first that doesn't collide.
- **Game loop**: `requestAnimationFrame`-driven `loop(ts)` accumulates `dt` into `dropAccum`; when it exceeds `dropInterval`, the piece drops one row or locks via `lockPiece()`.
- **Locking**: `lockPiece()` → `merge()` (writes piece into `board`) → `clearLines()` → `spawn()`.
- **Line clears**: `clearLines()` scans bottom-up, splices full rows out and unshifts empty rows in; re-checks the same index after a splice (`r++`).
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` × `level`; hard drop = 2 pts/cell dropped, soft drop = 1 pt/row.
- **Leveling/speed**: level = `floor(lines / 10) + 1`; `dropInterval = max(100, 1000 - (level - 1) * 90)` ms.
- **Ghost piece**: `ghostY()` projects `current` straight down until collision; drawn at `globalAlpha = 0.2`.
- **Game over**: triggered in `spawn()` when a freshly spawned piece already collides at its start position.

Keyboard input is a single `keydown` listener switching on `e.code` (arrows, `Space`, `KeyX` for rotate, `KeyP` for pause).

## Tuning constants (top of game.js)

`COLS`, `ROWS`, `BLOCK` (cell px size), `COLORS`, `LINE_SCORES`, initial `dropInterval`. If `COLS`/`ROWS`/`BLOCK` change, update the `#board` canvas `width`/`height` in `index.html` to match (`COLS × BLOCK`, `ROWS × BLOCK`).
