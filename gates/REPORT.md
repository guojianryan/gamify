# Logic Gate Lab — report

## What shipped

A static lesson page at `/gates/` in the Gamify family style. Students read a Boolean expression, build an equivalent circuit on an **IEEE-style schematic** (distinctive gate outlines, orthogonal wires, junction dots, A/B/C → Y), watch a live truth table, and run an all-combinations signal animation. Every puzzle uses **3 or 4 gates** and **2–3 inputs**. Level 1 (AND / OR / NOT) starts unlocked; Level 2 (adds XOR / NAND / NOR) unlocks after six Level 1 solves, with a session-only bypass when storage is blocked or for a quick try.

## Key design decisions

- **Schematic tree builder** — same nested AST model as before, drawn as textbook logic symbols via SVG (`js/gate-schematic.js`) so the board matches class diagrams without freeform wiring.
- **Behaviour matching** — `compareBehaviour` equates full truth tables, so De Morgan and other equivalent shapes count as correct.
- **Gentle speed meter** — bonus decays over a per-puzzle window; running out never fails the puzzle. Relaxed mode hides the meter and still awards the full bonus so unlock progress stays fair.
- **Mismatch feedback** — lists the first disagreeing input rows with both OUT values.
- **Animations** — wire pulses, gate flashes, lamp glow, truth-table row highlight, and a short match banner/chime. `prefers-reduced-motion` switches the run to manual Step and drops motion flourishes.

## Tests

`node --test test/gate-logic.test.js` covers evaluation, equivalent circuits, incomplete circuits, scoring/speed rules, unlock, hints, and level gate sets.

## Not done / next improvements

- Drag-and-drop wiring for desktop power users (kept out to protect the phone layout).
- A shared “challenge code” so a teacher can assign the same puzzle sequence.
- Shared input rails / fan-out junctions when the same input feeds multiple gates (tree still duplicates leaf terminals today).
- Optional “show target truth table” coach mode after several misses.
