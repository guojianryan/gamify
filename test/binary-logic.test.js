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

test('level pace keeps a full byte, then hides place values and tightens the clock', () => {
  assert.equal(L.levelConfig(1).maxValue, 255);
  assert.equal(L.levelConfig(1).bitsBias, 0.5);
  assert.equal(L.levelConfig(1).showValues, true);
  assert.equal(L.levelConfig(1).spawnMs, 4200);
  assert.equal(L.levelConfig(3).maxValue, 255);
  assert.equal(L.levelConfig(3).bitsBias, 0.5);
  assert.equal(L.levelConfig(3).showValues, true);
  assert.equal(L.levelConfig(3).spawnMs, 3100);
  assert.equal(L.levelConfig(4).showValues, true);
  assert.equal(L.levelConfig(5).maxValue, 255);
  assert.equal(L.levelConfig(5).bitsBias, 0.5);
  assert.equal(L.levelConfig(5).showValues, false);
  assert.equal(L.levelConfig(5).spawnMs, 2000);
  assert.equal(L.levelConfig(6).bitsBias, 0.5);
  assert.equal(L.levelConfig(7).spawnMs, 1600);
  assert.equal(L.levelConfig(12).spawnMs, 1600);
  assert.ok(L.levelConfig(1).spawnMs > L.levelConfig(3).spawnMs);
  assert.ok(L.levelConfig(3).spawnMs > L.levelConfig(5).spawnMs);
});

test('a row is an even draw from 0 to 255, both directions, and does not repeat', () => {
  const started = L.startGame(L.createGame(40), sequence([0.99, 0]), { level: 1 });
  const row = started.state.rows[0];
  assert.equal(started.state.status, 'playing');
  assert.equal(started.state.highScore, 40);
  assert.equal(started.state.score, 0);
  assert.equal(started.events[0].type, 'spawn');
  assert.equal(row.mode, 'bits');
  assert.equal(row.value, Math.floor(0.99 * 256));
  assert.ok(row.value >= 250);
  assert.deepEqual(row.bits, [0, 0, 0, 0, 0, 0, 0, 0]);

  const again = L.spawnRow(started.state, sequence([0.99, 0.9]));
  assert.equal(again.state.rows[1].mode, 'decimal');
  assert.notEqual(again.state.rows[1].value, row.value);
  assert.ok(again.state.rows[1].value >= 0);
  assert.ok(again.state.rows[1].value <= 255);

  const zero = L.spawnRow(
    { ...L.createGame(), status: 'playing', level: 1 },
    sequence([0, 0])
  ).state.rows[0];
  assert.equal(zero.value, 0);
  assert.equal(zero.mode, 'decimal');
  assert.deepEqual(zero.bits, L.bitsFor(0));

  const full = L.spawnRow(
    { ...L.createGame(), status: 'playing', level: 5 },
    sequence([255 / 256, 0.5])
  ).state.rows[0];
  assert.equal(full.value, 255);
  assert.equal(full.mode, 'decimal');
});

test('a wrong bit stays up with the working, then one retry scores half', () => {
  const rng = sequence([0.004, 0, 0.008, 0]);
  let state = L.startGame(L.createGame(), rng).state;
  const first = state.rows[0];
  state = L.spawnRow(state, rng).state;
  const second = state.rows[1];
  assert.equal(first.mode, 'bits');
  assert.equal(second.mode, 'bits');
  assert.equal(first.value, 1);
  assert.equal(second.value, 2);

  const early = L.toggleBit(state, first.id, 0);
  assert.equal(early.state.rows.length, 2);
  assert.equal(early.state.rows[0].phase, 'teach');
  assert.equal(early.state.rows[0].bits[0], 1);
  assert.equal(early.state.rows[0].feedback, 'You set 128 = 128. Target 1 = 1');
  assert.deepEqual(early.state.rows[0].wrongIndexes, [0, 7]);
  assert.equal(early.state.misses[0], 1);
  assert.equal(early.events[0].type, 'teach');
  assert.deepEqual(state.rows[0].bits, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(L.toggleBit(early.state, first.id, 0).state, early.state);

  const retry = L.releaseHold(early.state, first.id);
  assert.equal(retry.state.rows[0].phase, 'play');
  assert.deepEqual(retry.state.rows[0].bits, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(retry.state.rows[0].feedback, early.state.rows[0].feedback);

  const solved = L.toggleBit(retry.state, first.id, 7);
  assert.equal(solved.state.rows.length, 1);
  assert.equal(solved.state.rows[0].id, second.id);
  assert.equal(solved.state.score, L.partialPoints(1));
  assert.equal(solved.state.streak, 0);
  assert.equal(solved.events[0].partial, true);
  assert.equal(L.weakSpotText(early.state.misses), 'Weak spots: 128s and 1s');
});

test('eight clean rows move from Warm-up to Drill and total 660', () => {
  let state = L.startGame(L.createGame(), () => 0.1).state;
  let last = null;
  for (let i = 0; i < 7; i += 1) {
    if (state.rows.length === 0) state = L.spawnRow(state, () => 0.1).state;
    state = solveBits(state);
  }
  assert.equal(state.level, 1);
  if (state.rows.length === 0) state = L.spawnRow(state, () => 0.1).state;
  const row = state.rows[0];
  L.bitsFor(row.value).forEach((bit, index) => {
    if (!bit) return;
    last = L.toggleBit(state, row.id, index);
    state = last.state;
  });
  assert.equal(state.level, 3);
  assert.equal(L.paceName(state), 'Drill');
  assert.equal(state.solved, 8);
  assert.equal(state.cleanRows, 0);
  assert.equal(state.score, 660);
  assert.equal(state.highScore, 660);
  assert.equal(state.bestStreak, 8);
  assert.equal(L.streakMultiplier(8), 5);
  assert.ok(last.events.some((event) => event.type === 'pace' && event.name === 'Drill'));
});

test('decimal rows stay until the typed total is right', () => {
  let state = { ...L.createGame(), status: 'playing', level: 5, streak: 4, score: 200 };
  state = L.spawnRow(state, sequence([0.004, 0.99])).state;
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
  assert.equal(wrong.state.rows[0].phase, 'teach');
  assert.equal(wrong.state.rows[0].feedback, '1 = 1');
  assert.deepEqual(wrong.state.rows[0].wrongIndexes, [7]);
  assert.equal(wrong.state.misses[7], 1);
  assert.equal(wrong.events[0].type, 'teach');
  assert.equal(L.setDraft(wrong.state, row.id, '1').state, wrong.state);

  const released = L.releaseHold(wrong.state, row.id);
  const fixed = L.setDraft(released.state, row.id, '1');
  assert.equal(fixed.state.rows[0].wrong, false);
  const correct = L.submitDecimal(fixed.state, row.id);
  assert.equal(correct.result, 'correct');
  assert.equal(correct.state.rows.length, 0);
  assert.equal(correct.state.streak, 0);
  assert.equal(correct.state.score, 200 + L.partialPoints(5));
  assert.equal(correct.events[0].partial, true);
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
  const started = L.startGame(L.createGame(), sequence([0.004, 0]));
  const paused = L.pauseGame(started.state);
  assert.equal(paused.state.status, 'paused');
  assert.equal(paused.state.rows[0].value, 1);
  assert.equal(paused.state.rows[0].mode, 'bits');
  const blocked = L.toggleBit(paused.state, paused.state.rows[0].id, 7);
  assert.equal(blocked.state.rows.length, 1);
  assert.equal(blocked.state.rows[0].bits[7], 0);
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
  assert.equal(L.partialPoints(5), 53);
  assert.equal(L.streakMultiplier(0), 1);
  assert.equal(L.streakMultiplier(3), 3);
});

test('a second miss reveals the byte and then leaves', () => {
  let state = { ...L.createGame(), status: 'playing', level: 5, score: 40, streak: 2 };
  state = L.spawnRow(state, sequence([0.2, 0.99])).state;
  const row = state.rows[0];
  assert.equal(row.mode, 'decimal');
  state = L.setDraft(state, row.id, '3').state;
  const first = L.submitDecimal(state, row.id);
  const released = L.releaseHold(first.state, row.id);
  const again = L.setDraft(released.state, row.id, '4').state;
  const second = L.submitDecimal(again, row.id);
  assert.equal(second.state.rows[0].phase, 'reveal');
  assert.equal(second.state.rows[0].feedback, L.expression(row.value) + ' = ' + row.value);
  assert.equal(second.state.score, 40);
  const gone = L.releaseHold(second.state, row.id);
  assert.equal(gone.state.rows.length, 0);
  assert.equal(gone.events[0].type, 'dismissed');
});

test('the guided first row is 10, and a clean miss names both places', () => {
  const started = L.startGame(L.createGame(), () => 0, { guide: true });
  const row = started.state.rows[0];
  assert.equal(row.value, 10);
  assert.equal(row.mode, 'bits');
  assert.equal(started.state.guide, true);
  assert.equal(L.spawnRow(started.state, () => 0).events.length, 0);

  let state = L.toggleBit(started.state, row.id, 5).state;
  assert.equal(state.rows[0].feedback, 'You set 4 = 4. Target 10 = 8 + 2');
  assert.equal(L.weakSpotText([0, 0, 0, 2, 5, 0, 1, 0]), 'Weak spots: 8s and 16s');
  state = L.releaseHold(state, row.id).state;
  state = L.toggleBit(state, row.id, 4).state;
  state = L.toggleBit(state, row.id, 6).state;
  assert.equal(state.rows.length, 0);
  assert.equal(state.guide, false);
  assert.equal(state.score, L.partialPoints(1));
});

test('misses and the best pace carry into the next warm-up', () => {
  let state = L.startGame(L.createGame(), sequence([0.004, 0])).state;
  state = L.toggleBit(state, state.rows[0].id, 0).state;
  const misses = state.misses.slice();
  state = { ...state, paceIndex: 2, bestPaceIndex: 2, level: 5 };
  const next = L.startGame(state, sequence([0.004, 0])).state;
  assert.deepEqual(next.misses, misses);
  assert.equal(next.bestPaceIndex, 2);
  assert.equal(next.paceIndex, 0);
  assert.equal(next.level, 1);
  assert.equal(L.paceName(2), 'Exam pace');
});

test('missing the guided row twice brings the same target back', () => {
  let state = L.startGame(L.createGame(), () => 0, { guide: true }).state;
  const row = state.rows[0];
  state = L.toggleBit(state, row.id, 0).state;
  state = L.releaseHold(state, row.id).state;
  state = L.toggleBit(state, row.id, 0).state;
  assert.equal(state.rows[0].phase, 'reveal');
  const again = L.releaseHold(state, row.id);
  assert.equal(again.state.guide, true);
  assert.equal(again.state.rows.length, 1);
  assert.equal(again.state.rows[0].value, 10);
  assert.equal(again.state.rows[0].phase, 'play');
  assert.notEqual(again.state.rows[0].id, row.id);
});
