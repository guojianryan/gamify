# Gamify

Lesson games for class. The landing page is the bench. Each game has its own page.

Open it with any static server:

```bash
python3 -m http.server 8000
```

Then visit `/`, `/binary/`, and `/gates/`.

## Binary game

An 8-bit conversion drill. Rows fill a six-row column from the top.

- A decimal on the right means you click bits until the 1s add up to it. The row clears on its own.
- Bits already set, with a blank on the right, means you type the decimal and press Enter.
- The round ends when a new row would pass the top of the column.
- A wrong pattern stays on screen with the working written out. One retry on that row scores half, and the spawn clock waits while you read it.
- Eight clean rows move the pace from Warm-up to Drill, then to Exam pace. Numbers get larger, rows arrive faster, and the place values hide at Exam pace unless you pin them.
- The first visit opens on 10, with the 8 and the 2 marked. After that, the instructions stay in the menu.

Warm-up is numbers 1–15, bits only. Drill reaches 63 and mixes in reading bits. Exam pace is full bytes, 1–255, with the place values hidden.

Best score, best pace, and which place values you miss stay in this browser (`localStorage`).

The rules live in `js/binary-logic.js` and do not touch the page, so they can be checked on their own:

```bash
node --test test/binary-logic.test.js
```

## Logic Gate Lab

Build a circuit that matches a Boolean expression. The truth table updates from the circuit you build, and a signal run walks every input combination through the gates.

- Level 1 uses AND, OR and NOT. Level 2 adds XOR, NAND and NOR after six Level 1 solves (or “try this session”).
- Matching is by truth-table behaviour, not circuit shape.
- A gentle speed bonus rewards faster correct builds; relaxed mode turns the clock off.
- Design note: `gates/DESIGN.md`. Report: `gates/REPORT.md`.

```bash
node --test test/gate-logic.test.js
```
