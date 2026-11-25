# Gamify

Lesson games for class. The landing page is the bench. Each game has its own page. The binary game is the first one.

Open it with any static server:

```bash
python3 -m http.server 8000
```

Then visit `/` and `/binary/`.

## Binary game

An 8-bit conversion drill. Rows fill a six-row column from the top.

- A decimal on the right means you click bits until the 1s add up to it. The row clears on its own.
- Bits already set, with a blank on the right, means you type the decimal and press Enter.
- The round ends when a new row would pass the top of the column.
- Eight clears raise the level. Numbers get larger, rows arrive faster, and the place values hide after level 3 unless you pin them.

Warm-up starts at numbers 1–15. Drill starts at level 3. Exam pace starts at full bytes with the place values hidden.

Scores stay in this browser (`localStorage`).

The rules live in `js/binary-logic.js` and do not touch the page, so they can be checked on their own:

```bash
node --test test/binary-logic.test.js
```
