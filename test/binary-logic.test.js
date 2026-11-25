const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/binary-logic.js');

function sequence(values) {
  let index = 0;
  return () => values[index++];
}

function solveBits(state) {
  const row = state.rows[0];
  const target = L.bitsFor(row.value);
  let next = state;
  target.forEach((bit, index) => {
    if (!bit) return;
    next = L.toggleBit(next, row.id, index).state;
  });
  return next;
}

test('every byte round-trips through the place values', () => {
  for (let n = 0; n <= 255; n += 1) {
    assert.equal(L.valueOf(L.bitsFor(n)), n);
    assert.equal(L.bitsFor(n).length, 8);
  }
  assert.deepEqual(L.bitsFor(77), [0, 1, 0, 0, 1, 1, 0, 1]);
  assert.equal(L.expression(77), '64 + 8 + 4 + 1');
  assert.equal(L.expression(255), '128 + 64 + 32 + 16 + 8 + 4 + 2 + 1');
  assert.equal(L.expression(0), '0');
});

test('level pace grows the numbers, then hides place values', () => {
  assert.equal(L.levelConfig(1).maxValue, 15);
  assert.equal(L.levelConfig(1).bitsBias, 1);
  assert.equal(L.levelConfig(1).showValues, true);
  assert.equal(L.levelConfig(1).spawnMs, 11000);
  assert.equal(L.levelConfig(2).maxValue, 31);
  assert.equal(L.levelConfig(3).maxValue, 63);
  assert.equal(L.levelConfig(3).bitsBias, 0.75);
  assert.equal(L.levelConfig(3).showValues, true);
  assert.equal(L.levelConfig(4).showValues, false);
  assert.equal(L.levelConfig(4).maxValue, 127);
  assert.equal(L.levelConfig(5).maxValue, 255);
  assert.equal(L.levelConfig(5).bitsBias, 0.5);
  assert.equal(L.levelConfig(6).bitsBias, 0.45);
  assert.equal(L.levelConfig(7).spawnMs, 3200);
  assert.equal(L.levelConfig(12).spawnMs, 3200);
  assert.ok(L.levelConfig(1).spawnMs > L.levelConfig(4).spawnMs);
});

test('a warm-up row is bits only, inside 1..15, and does not repeat', () => {
  const started = L.startGame(L.createGame(40), () => 0.99, { level: 1 });
  const row = started.state.rows[0];
  assert.equal(started.state.status, 'playing');
  assert.equal(started.state.highScore, 40);
  assert.equal(started.state.score, 0);
  assert.equal(started.events[0].type, 'spawn');
  assert.equal(row.mode, 'bits');
  assert.equal(row.value, 15);
  assert.deepEqual(row.bits, [0, 0, 0, 0, 0, 0, 0, 0]);

  const again = L.spawnRow(started.state, () => 0.99);
  assert.notEqual(again.state.rows[1].value, 15);
  assert.ok(again.state.rows[1].value >= 1);
  assert.ok(again.state.rows[1].value <= 15);
});

test('setting the bits clears only that row and scores a streak', () => {
  let state = L.startGame(L.createGame(), () => 0).state;
  const first = state.rows[0];
  state = L.spawnRow(state, () => 0).state;
  const second = state.rows[1];
  assert.equal(first.value, 1);
  assert.equal(second.value, 2);

  const early = L.toggleBit(state, first.id, 0);
  assert.equal(early.state.rows.length, 2);
  assert.equal(early.state.rows[0].bits[0], 1);
  assert.deepEqual(state.rows[0].bits, [0, 0, 0, 0, 0, 0, 0, 0]);

  const back = L.toggleBit(early.state, first.id, 0).state;
  const solved = L.toggleBit(back, first.id, 7);
  assert.equal(solved.state.rows.length, 1);
  assert.equal(solved.state.rows[0].id, second.id);
  assert.equal(solved.state.score, L.pointsFor(1, 1));
  assert.equal(solved.state.streak, 1);
  assert.equal(solved.events[0].type, 'solved');
  assert.equal(L.toggleBit(solved.state, first.id, 7).state.rows.length, 1);
});

test('eight clears raise the level and total 660 at warm-up pace', () => {
  let state = L.startGame(L.createGame(), () => 0).state;
  let last = null;
  for (let i = 0; i < 7; i += 1) {
    if (state.rows.length === 0) state = L.spawnRow(state, () => 0).state;
    state = solveBits(state);
  }
  assert.equal(state.level, 1);
  if (state.rows.length === 0) state = L.spawnRow(state, () => 0).state;
  const row = state.rows[0];
  L.bitsFor(row.value).forEach((bit, index) => {
    if (!bit) return;
    last = L.toggleBit(state, row.id, index);
    state = last.state;
  });
  assert.equal(state.level, 2);
  assert.equal(state.solved, 8);
  assert.equal(state.solvedThisLevel, 0);
  assert.equal(state.score, 660);
  assert.equal(state.highScore, 660);
  assert.equal(state.bestStreak, 8);
  assert.ok(last.events.some((event) => event.type === 'level' && event.level === 2));
});

test('decimal rows stay until the typed total is right', () => {
  let state = { ...L.createGame(), status: 'playing', level: 5, streak: 4, score: 200 };
  state = L.spawnRow(state, sequence([0, 0.99])).state;
  const row = state.rows[0];
  assert.equal(row.mode, 'decimal');
  assert.equal(row.value, 1);
  assert.deepEqual(row.bits, L.bitsFor(1));

  const ignored = L.submitDecimal(state, row.id);
  assert.equal(ignored.result, 'ignore');
  assert.equal(ignored.state.rows.length, 1);

  const typed = L.setDraft(state, row.id, 'nope9');
  assert.equal(typed.state.rows[0].draft, '9');
  const wrong = L.submitDecimal(typed.state, row.id);
  assert.equal(wrong.result, 'wrong');
  assert.equal(wrong.state.streak, 0);
  assert.equal(wrong.state.score, 200);
  assert.equal(wrong.state.rows[0].wrong, true);
  assert.equal(wrong.events[0].type, 'wrong');

  const fixed = L.setDraft(wrong.state, row.id, '1');
  assert.equal(fixed.state.rows[0].wrong, false);
  const correct = L.submitDecimal(fixed.state, row.id);
  assert.equal(correct.result, 'correct');
  assert.equal(correct.state.rows.length, 0);
  assert.equal(correct.state.streak, 1);
  assert.equal(correct.state.score, 200 + L.pointsFor(5, 1));
});

test('a matching bit pattern does not clear a decimal row by itself', () => {
  let state = { ...L.createGame(), status: 'playing', level: 5 };
  state = L.spawnRow(state, sequence([0, 0.99])).state;
  const decimal = state.rows[0];
  state = L.spawnRow(state, sequence([0.5, 0])).state;
  assert.equal(state.rows[1].mode, 'bits');
  const after = L.toggleBit(state, decimal.id, 0);
  assert.equal(after.state.rows.length, 2);
  assert.deepEqual(after.state.rows[0].bits, decimal.bits);
});

test('the column ends the round when a seventh row would arrive', () => {
  let state = { ...L.createGame(1000), status: 'playing', level: 1 };
  for (let i = 0; i < L.MAX_ROWS; i += 1) {
    const spawned = L.spawnRow(state, () => 0.2);
    state = spawned.state;
    assert.equal(spawned.events[0].type, 'spawn');
  }
  assert.equal(state.rows.length, 6);
  const over = L.spawnRow(state, () => 0.2);
  assert.equal(over.state.status, 'over');
  assert.equal(over.state.rows.length, 6);
  assert.equal(over.state.highScore, 1000);
  assert.equal(over.events[0].type, 'over');
  assert.equal(L.spawnRow(over.state, () => 0.2).state.status, 'over');
});

test('pause blocks play until resume', () => {
  const started = L.startGame(L.createGame(), () => 0);
  const paused = L.pauseGame(started.state);
  assert.equal(paused.state.status, 'paused');
  assert.equal(L.toggleBit(paused.state, paused.state.rows[0].id, 7).state.rows.length, 1);
  assert.equal(L.spawnRow(paused.state).events.length, 0);
  const resumed = L.resumeGame(paused.state);
  assert.equal(resumed.state.status, 'playing');
  assert.equal(L.pauseGame(resumed.state).state.status, 'paused');
  assert.equal(L.resumeGame(started.state).state.status, 'playing');
});

test('drafts keep at most three digits', () => {
  let state = { ...L.createGame(), status: 'playing', level: 5 };
  state = L.spawnRow(state, sequence([0, 0.99])).state;
  const drafted = L.setDraft(state, state.rows[0].id, '12a345');
  assert.equal(drafted.state.rows[0].draft, '123');
  assert.equal(L.setDraft(drafted.state, state.rows[0].id, '123').state, drafted.state);
});

test('points cap the streak bonus at ten', () => {
  assert.equal(L.pointsFor(1, 1), 65);
  assert.equal(L.pointsFor(1, 10), 110);
  assert.equal(L.pointsFor(1, 11), 110);
  assert.equal(L.pointsFor(5, 1), 105);
});
