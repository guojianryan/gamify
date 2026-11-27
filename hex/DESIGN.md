# Hex Match — design note

## Family fit

Same paper sheet, stamp, moss, and Binary warm-up / race shell. New page at `/hex/`. Teaches hex ↔ nibbles / bytes. No Tetris, no gravity.

## Core loop

- A column of rows (max six). Solving a row lets the ones under it move up.
- Two directions:
  - **Hex shown** — tap bits until they match (nibble or byte).
  - **Bits shown** — type the hex on a 0–F keypad.
- One teach retry for half credit; second miss reveals the answer.
- Warm-up is eight clean clears. Then pick a 1 / 2 / 5 minute race.

## Ramp

- First four warm-up clears: single nibble `0`–`F` (four bits, places 8 4 2 1).
- Rest of warm-up and race: full byte as two hex digits ↔ eight bits.

## Scoring

Same time curve as Binary: faster clears score more. Shared mute key `gamify.muted`. Progress in `gamify.hex.progress`.

## Files

| File | Role |
|------|------|
| `hex/index.html` | Page |
| `js/hex-logic.js` | Pure rules |
| `js/hex-game.js` | UI / clocks / sound |
| `test/hex-logic.test.js` | Conversion and clear tests |
