const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/hex-logic.js');

function sequence(values) {
  let index = 0;
  return () => values[index++];
}

test('toHex and parseHex round-trip for nibble and byte', () => {
  assert.equal(L.toHex(10, 4), 'A');
  assert.equal(L.toHex(15, 4), 'F');
  assert.equal(L.toHex(0, 4), '0');
  assert.equal(L.toHex(77, 8), '4D');
  assert.equal(L.toHex(255, 8), 'FF');
  assert.equal(L.toHex(10, 8), '0A');
  assert.equal(L.parseHex('a', 4), 10);
  assert.equal(L.parseHex('F', 4), 15);
  assert.equal(L.parseHex('4d', 8), 77);
  assert.equal(L.parseHex('0A', 8), 10);
  assert.equal(L.parseHex('A', 8), null);
  assert.equal(L.parseHex('GG', 8), null);
  assert.equal(L.parseHex('', 4), null);
});

test('bitsFor and valueOf cover nibble and byte place values', () => {
  assert.deepEqual(L.bitsFor(10, 4), [1, 0, 1, 0]);
  assert.equal(L.valueOf([1, 0, 1, 0], 4), 10);
  assert.deepEqual(L.bitsFor(77, 8), [0, 1, 0, 0, 1, 1, 0, 1]);
  assert.equal(L.valueOf(L.bitsFor(77, 8), 8), 77);
  for (let n = 0; n <= 15; n += 1) {
    assert.equal(L.valueOf(L.bitsFor(n, 4), 4), n);
    assert.equal(L.bitsFor(n, 4).length, 4);
  }
  for (let n = 0; n <= 255; n += 17) {
    assert.equal(L.valueOf(L.bitsFor(n, 8), 8), n);
    assert.equal(L.bitsFor(n, 8).length, 8);
  }
  assert.equal(L.expression(10, 4), '8 + 2');
  assert.equal(L.expression(77, 8), '64 + 8 + 4 + 1');
});

test('widthFor ramps from nibble to byte after four clean rows', () => {
  assert.equal(L.widthFor({ cleanRows: 0 }), 4);
  assert.equal(L.widthFor({ cleanRows: 3 }), 4);
  assert.equal(L.widthFor({ cleanRows: 4 }), 8);
  assert.equal(L.widthFor({ cleanRows: 8 }), 8);
  assert.equal(L.valueCap({ cleanRows: 0 }), 15);
  assert.equal(L.valueCap({ cleanRows: 4 }), 255);

  const nibble = L.spawnRow(
    { ...L.createGame(), status: 'playing', cleanRows: 0 },
    sequence([10 / 16, 0])
  ).state.rows[0];
  assert.equal(nibble.width, 4);
  assert.equal(nibble.bits.length, 4);
  assert.ok(nibble.value <= 15);

  const byte = L.spawnRow(
    { ...L.createGame(), status: 'playing', cleanRows: 4 },
    sequence([77 / 256, 0])
  ).state.rows[0];
  assert.equal(byte.width, 8);
  assert.equal(byte.bits.length, 8);
});

test('toggleBit clears a matching nibble row', () => {
  let state = L.startGame(L.createGame(), () => 0, {
    guide: true,
    now: 0
  }).state;
  const row = state.rows[0];
  assert.equal(row.value, L.GUIDE_VALUE);
  assert.equal(row.width, 4);
  assert.equal(L.toHex(row.value, 4), 'A');
  assert.equal(row.mode, 'bits');

  L.bitsFor(row.value, 4).forEach((bit, index) => {
    if (!bit) return;
    state = L.toggleBit(state, row.id, index, 1000).state;
  });
  assert.equal(state.rows.length, 0);
  assert.equal(state.guide, false);
  assert.equal(state.solved, 1);
  assert.ok(state.score > 0);
});

test('submitHex clears a matching hex row', () => {
  let state = {
    ...L.createGame(),
    status: 'playing',
    cleanRows: 4,
    spawnedBits: 1,
    spawnedHex: 0
  };
  state = L.spawnRow(state, sequence([77 / 256, 0.9]), 0).state;
  const row = state.rows[0];
  assert.equal(row.mode, 'hex');
  assert.equal(row.width, 8);
  assert.equal(row.value, 77);

  const drafted = L.setDraft(state, row.id, '4d');
  assert.equal(drafted.state.rows[0].draft, '4D');
  const cleared = L.submitHex(drafted.state, row.id, 1500);
  assert.equal(cleared.result, 'correct');
  assert.equal(cleared.state.rows.length, 0);
  assert.equal(cleared.state.solved, 1);
  assert.equal(cleared.state.score, L.pointsForTime(1500));
});

test('an overshoot bit miss enters teach, then retry can clear', () => {
  let state = L.startGame(L.createGame(), sequence([1 / 16, 0]), { now: 0 }).state;
  const row = state.rows[0];
  assert.equal(row.mode, 'bits');
  assert.equal(row.value, 1);
  assert.equal(row.width, 4);

  // Index 0 is place 8 — overshoot for target 1.
  const miss = L.toggleBit(state, row.id, 0, 500);
  assert.equal(miss.events[0].type, 'teach');
  assert.equal(miss.state.rows[0].phase, 'teach');
  assert.equal(miss.state.streak, 0);
  assert.ok(miss.state.rows[0].feedback.indexOf('Target') !== -1);
  assert.equal(miss.state.misses[1], 1); // digitIndex of value 1

  const retry = L.releaseHold(miss.state, row.id, 2500);
  assert.equal(retry.state.rows[0].phase, 'play');
  assert.deepEqual(retry.state.rows[0].bits, [0, 0, 0, 0]);

  const cleared = L.toggleBit(retry.state, row.id, 3, 4000);
  assert.equal(cleared.state.rows.length, 0);
  assert.equal(cleared.events[0].partial, true);
  assert.equal(cleared.state.score, L.partialForTime(cleared.events[0].elapsed));
});

test('eight clean clears open the time chooser, then beginRace starts the clock', () => {
  let now = 0;
  let state = L.startGame(L.createGame(), () => 0.1, { now }).state;
  let last = null;

  for (let i = 0; i < 8; i += 1) {
    if (state.rows.length === 0) {
      now += 10;
      state = L.spawnRow(state, () => 0.1, now).state;
    }
    now += 2000;
    const row = state.rows[0];
    if (row.mode === 'hex') {
      last = L.submitHex(
        L.setDraft(state, row.id, L.toHex(row.value, row.width)).state,
        row.id,
        now
      );
      state = last.state;
    } else {
      L.bitsFor(row.value, row.width).forEach((bit, index) => {
        if (!bit) return;
        last = L.toggleBit(state, row.id, index, now);
        state = last.state;
      });
    }
  }

  assert.equal(state.status, 'choose');
  assert.equal(state.racing, false);
  assert.equal(state.cleanRows, 8);
  assert.equal(state.solved, 8);
  assert.ok(last.events.some((event) => event.type === 'choose'));
  assert.equal(L.beginRace(state, 90).state.status, 'choose');

  const race = L.beginRace(state, 120, () => 0.1, now);
  assert.equal(race.state.status, 'playing');
  assert.equal(race.state.racing, true);
  assert.equal(race.state.limitSec, 120);
  assert.equal(race.state.remainingMs, 120000);
  assert.equal(race.state.score, 0);
  assert.equal(race.state.rows.length, 1);
  assert.equal(race.state.rows[0].width, 8);
  assert.ok(race.events.some((event) => event.type === 'race' && event.limitSec === 120));

  const done = L.finishRace(race.state);
  assert.equal(done.state.status, 'over');
  assert.equal(done.state.endedBy, 'time');
});
