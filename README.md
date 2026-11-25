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
- A wrong pattern stays on screen with the working written out. One retry on that row scores half, and the spawn clock waits while you read it.
- Eight clean rows move the pace from Warm-up to Drill, then to Exam pace. Every pace draws evenly from 0 to 255, and setting bits is as common as reading them. Rows arrive sooner as the pace rises, and the place values hide at Exam pace unless you pin them.
- The first visit opens on 10, with the 8 and the 2 marked. After that, the instructions stay in the menu.
- A decimal row is typed with the phone keyboard or a hardware keyboard. There is no on-screen keypad.

Warm-up, Drill, and Exam pace all use the full byte. Warm-up gives about four seconds before the next row. Drill is tighter. Exam pace is about two seconds, with the place values hidden.

Best score, best pace, and which place values you miss stay in this browser (`localStorage`).

The rules live in `js/binary-logic.js` and do not touch the page, so they can be checked on their own:

```bash
node --test test/binary-logic.test.js
```
