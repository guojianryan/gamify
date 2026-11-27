# Bitris — design note

## Family fit

Same paper sheet, stamp, moss, Fraunces / Figtree / IBM Plex Mono as Binary and Logic Gate Lab. New page at `/bitris/`. Looks like Tetris; teaches the same place values as the Binary drill without copying its row-clear click/type loop.

## Core loop

- An **8-column** well. Columns are place values 128…1, left to right.
- **Bit pieces** (1–3 ON cells) fall, slide, and rotate.
- On lock, bits fill empty cells. Each row gets a **target** the first time it receives a bit.
- When a row’s ON bits **sum exactly** to its target, that row clears (with a short `64 + 8 + 2 = 74` flash). Rows above drop.
- **Overshoot soft-reset:** if a lock makes `sum > target`, that row’s bits wipe and the same target stays. No points. Exact clears still score.
- Stack to the top → round over.

## Targets

When a row first gets a bit, the target is `currentSum + random non-empty subset of the still-empty place values` (within the mode’s max). So the row is always finishable at the moment the target is stamped. Warm-up starts with max 15, then 63, then 255. Race uses the full byte.

## Modes

- **Warm-up** — fixed slow gravity, rising max value, no clock.
- **Race** — 1 / 2 / 5 minutes after warm-up (same language as Binary). Gravity edges up with score.

## Scoring

Base points per clear from the target size + a small soft-drop / hard-drop bonus. Faster clears in race are worth more via a gentle time factor. Accuracy first: no points for topping out.

## Controls

Keyboard: ← → move, ↑ / X rotate, ↓ soft drop, Space hard drop, P pause. Touch: on-screen pad. Sound toggle shared (`gamify.muted`). `prefers-reduced-motion` drops juice, keeps step-like flashes static.

## Files

| File | Role |
|------|------|
| `bitris/index.html` | Page |
| `js/bitris-logic.js` | Pure rules |
| `js/bitris-game.js` | UI / input / gravity |
| `test/bitris-logic.test.js` | Board, clear, rotate tests |
