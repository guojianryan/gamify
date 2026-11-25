# Gamify

Lesson games for class. The landing page is the bench. Each game has its own page.

Open it with any static server:

```bash
python3 -m http.server 8000
```

Then visit `/`, `/binary/`, and `/gates/`.

## Binary game

An 8-bit conversion drill. The first row sits under the place values, and new rows are added below it. Solving a row lets the ones under it move up. A seventh row ends the round.

- A decimal on the right means you click bits until the 1s add up to it. The row clears on its own.
- Bits already set, with a blank on the right, means you type the decimal. The row leaves when the number is right. Enter checks a wrong number.
- The round ends when a new row would be the seventh. The column greys out and a short sound plays.
- Under each row, the number still left is the target minus what you have selected or typed.
- A wrong pattern stays on screen with the working written out. One retry on that row scores half, and the spawn clock waits while you read it.
- There are no levels. Warm-up is eight clean rows at a slow drip, about eight seconds apart. Numbers are an even mix from 0 to 255, and setting bits is as common as reading them.
- After warm-up, pick a fixed race: 1 minute, 2 minutes, or 5 minutes. The goal is as many points as possible before the clock runs out.
- A faster clear is worth more. Two seconds or less scores 100. Ten seconds or more scores 20. One retry scores half.
- After warm-up, the next row arrives a little sooner than the recent clears, so a fast run tightens the column. It never drops below 1.6 seconds or stretches past the warm-up drip.
- The first visit opens on 10, with the 8 and the 2 marked. After that, the instructions stay in the menu.
- Focusing a decimal box pops up an on-screen keypad with an Enter key. A hardware keyboard still works.

Best score for each time limit, and which place values you miss, stay in this browser (`localStorage`).

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
