# Logic Gate Lab — design note

## Family fit

Same paper sheet, stamp red, moss green, Fraunces / Figtree / IBM Plex Mono, ticket panels and mono HUD as the Binary game. New page under `/gates/`, linked from the landing bench and the mast nav. No shared game mechanics — only the look and the “lesson arcade” tone.

## How the student builds a circuit

A **schematic tree builder** drawn as an IEEE-style logic diagram (distinctive gate outlines, orthogonal wires, junction dots, A/B/C on the left and Y on the right). The output starts empty. The student fills each empty port by choosing an input (A / B / C) or a gate. Gates open new ports. Nesting builds the expression tree. Clear / undo / remove-at-port keep edits cheap on touch and keyboard.

Why this shape: freeform wiring fights phones; a tree matches how Boolean expressions nest; every circuit is a valid AST so evaluation and the signal animation stay simple; the diagram matches the symbols students see in textbooks.

## Expressions and content

Expressions are shown with the usual school forms: `AND`, `OR`, `NOT`, `XOR`, `NAND`, `NOR`, with brackets for precedence. Level 1 uses only AND / OR / NOT. Level 2 adds XOR / NAND / NOR and can mix them with the basics.

A curated bank of puzzles (not random-only) so difficulty rises smoothly and a class period does not feel repetitive. Every expression uses **3 or 4 gates** and **2 or 3 inputs**. Within each level, puzzles are tagged warm-up → medium → hard; the round draws from those bands in order, then reshuffles unseen ones.

Inputs are always 2 or 3 letters (A, B, or A–C). Single-gate drills are left out so students practise nesting from the first solve.

## Truth table and animation

The table is computed live from the **circuit**, not the target expression, so every edit updates OUT immediately. Matching is by behaviour: the circuit’s full truth table must equal the expression’s. Structurally different but equivalent circuits count as correct.

**All-combinations animation** walks every input row left-to-right through the circuit: ports show 0/1, wires pulse, gates flash when they settle, and the matching table row lights. Controls: play, pause, replay, and step (step is the reduced-motion path). The current combination is named in the HUD and highlighted in the table.

## Speed, scoring, relaxed mode

Each puzzle has a gentle **speed meter** (not a fail timer). Base score for a correct circuit is always earned. A speed bonus starts full and decays linearly to zero over the “fast” window (longer on harder puzzles). A wrong check scores 0 — a slow correct answer always beats a fast wrong one. Relaxed mode hides the meter and awards the full speed bonus on every correct solve so progress stays fair. The clock pauses on Pause and when the tab is hidden.

## Levels and unlock

- **Level 1** unlocked. Gates: AND, OR, NOT. Unlock Level 2 by solving **6** Level 1 puzzles correctly (progress shown on the level screen).
- **Level 2** locked until then. Gates: AND, OR, NOT, XOR, NAND, NOR. “Try Level 2 this session” unlocks it for the browser tab without needing storage.
- Progress and unlock are stored in `localStorage` when available; everything still works if storage is blocked.

## Celebration and sound

On a correct check, the lamp stays lit, a short Web Audio chime plays (only after a user gesture; mute toggle shared with Binary via `gamify.muted`), and a brief sparkle / banner plays at the end of the all-combinations pass. Reduced motion swaps that for a static “Matched” banner. Nothing blocks “Next puzzle”.

## Extras that serve learning

- **Mismatch feedback** lists the first few input rows where the circuit and expression disagree, with both OUT values — not just “wrong”.
- **Gate strip** with one-line meaning for each available gate.
- **Hint** (once per puzzle, small score cost) reveals only the outermost operator of the target expression.
- A short tips section mirrors the Binary page’s teaching footer.

## Files

| File | Role |
|------|------|
| `gates/index.html` | Page shell |
| `js/gate-logic.js` | Pure rules: AST, truth tables, scoring, puzzles, unlock |
| `js/gate-game.js` | UI, animation, sound, storage |
| `css/site.css` | Shared family styles + gate-specific rules |
| `test/gate-logic.test.js` | Correctness and scoring tests |
| `gates/REPORT.md` | What shipped and what to improve next |
