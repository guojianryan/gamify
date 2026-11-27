const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/bitris-logic.js');

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('place values are an 8-bit byte', () => {
  assert.deepEqual(L.PLACE_VALUES, [128, 64, 32, 16, 8, 4, 2, 1]);
  assert.equal(L.COLS, 8);
  assert.equal(L.ROWS, 14);
});

test('rotateShape turns a horizontal bar vertical', () => {
  assert.deepEqual(L.rotateShape([[1, 1, 1]]), [[1], [1], [1]]);
  assert.deepEqual(L.rotateShape([[1], [1]]), [[1, 1]]);
});

test('rowSum and expression follow place values', () => {
  const row = {
    cells: [0, 1, 0, 0, 1, 0, 1, 0],
    target: 74
  };
  assert.equal(L.rowSum(row), 64 + 8 + 2);
  assert.equal(L.rowExpression(row), '64 + 8 + 2');
});

test('a piece locks and clears when the row hits its target exactly', () => {
  const rng = seq([0, 0, 0, 0, 0.9, 0.1, 0.2, 0.3]);
  let state = L.withRng(L.createGame(), rng);
  state = L.startGame(state, rng).state;
  state = L.withRng(state, rng);

  // Force a single-cell piece over the 1s column with a known board target.
  state.piece = { shape: [[1]], row: L.ROWS - 1, col: 7 };
  state.board = L.emptyBoard();
  state.board[L.ROWS - 1] = { cells: [0, 0, 0, 0, 0, 0, 0, 0], target: 1 };

  const locked = L.lockPiece(state, 0);
  assert.ok(locked.events.some((e) => e.type === 'clear'));
  assert.equal(locked.state.clears, 1);
  assert.ok(locked.state.score >= L.pointsForClear(1, 0));
  assert.equal(L.rowSum(locked.state.board[L.ROWS - 1]), 0);
});

test('locking without an exact sum leaves the bits in place', () => {
  const rng = () => 0.5;
  let state = L.withRng(L.startGame(L.createGame(), rng).state, rng);
  state.piece = { shape: [[1]], row: L.ROWS - 1, col: 7 };
  state.board = L.emptyBoard();
  state.board[L.ROWS - 1] = {
    cells: [0, 0, 0, 0, 0, 0, 0, 0],
    target: 3
  };
  const locked = L.lockPiece(state, 0);
  assert.ok(!locked.events.some((e) => e.type === 'clear'));
  assert.equal(locked.state.board[L.ROWS - 1].cells[7], 1);
  assert.equal(locked.state.board[L.ROWS - 1].target, 3);
  assert.equal(L.rowSum(locked.state.board[L.ROWS - 1]), 1);
});

test('move and rotate respect edges and filled cells', () => {
  const rng = () => 0.2;
  let state = L.startGame(L.createGame(), rng).state;
  state.piece = { shape: [[1, 1]], row: 0, col: 0 };
  const left = L.move(state, -1);
  assert.equal(left.state.piece.col, 0);

  state.board[0].cells[2] = 1;
  state.piece = { shape: [[1, 1]], row: 0, col: 1 };
  const right = L.move(state, 1);
  assert.equal(right.state.piece.col, 1);
});

test('hard drop locks on the lowest open row', () => {
  const rng = () => 0.4;
  let state = L.withRng(L.startGame(L.createGame(), rng).state, rng);
  state.piece = { shape: [[1]], row: 0, col: 4 };
  state.board = L.emptyBoard();
  const dropped = L.hardDrop(state);
  assert.ok(dropped.events.some((e) => e.type === 'lock'));
  assert.equal(dropped.state.piece.row, 0); // new spawn
  assert.equal(dropped.state.board[L.ROWS - 1].cells[4], 1);
});

test('warm-up finishes after the clear quota, then race can start', () => {
  const rng = () => 0.3;
  let state = L.withRng(L.startGame(L.createGame(), rng).state, rng);
  state.clears = L.WARMUP_CLEARS - 1;
  state.phase = 'warmup';
  state.piece = { shape: [[1]], row: L.ROWS - 1, col: 7 };
  state.board = L.emptyBoard();
  state.board[L.ROWS - 1] = { cells: [0, 0, 0, 0, 0, 0, 0, 0], target: 1 };

  const done = L.lockPiece(state, 0);
  assert.ok(done.events.some((e) => e.type === 'warmup_done'));
  assert.equal(done.state.status, 'warmup_done');

  assert.equal(done.state.piece, null);
  const raced = L.beginRace(done.state, 60);
  assert.equal(raced.state.phase, 'race');
  assert.equal(raced.state.remainingMs, 60000);
  assert.ok(raced.state.piece, 'race must spawn a piece after warm-up');
  assert.ok(raced.state.next);
});

test('race timer ending finishes the round', () => {
  const rng = () => 0.1;
  let state = L.startGame(L.createGame(), rng, { skipWarmup: true, timeLimit: 60 }).state;
  assert.equal(state.phase, 'race');
  const ended = L.elapse(state, 60000);
  assert.equal(ended.state.status, 'over');
  assert.ok(ended.events.some((e) => e.type === 'over' && e.reason === 'time'));
});

test('maxForProgress widens place values through warm-up', () => {
  assert.equal(L.maxForProgress(0, false), 15);
  assert.equal(L.maxForProgress(3, false), 63);
  assert.equal(L.maxForProgress(8, false), 255);
  assert.equal(L.maxForProgress(0, true), 255);
});

test('assignTarget never sits below the bits already on the row', () => {
  const row = {
    cells: [1, 0, 0, 0, 0, 0, 0, 0], // 128
    target: null
  };
  const stamped = L.assignTarget(row, 0, false, () => 0.5);
  assert.ok(stamped.target >= 128);
});

test('early warm-up spawns on the low place-value columns', () => {
  assert.equal(L.spawnColMin(0, false), 4);
  assert.equal(L.spawnColMin(3, false), 2);
  assert.equal(L.spawnColMin(8, false), 0);
  assert.equal(L.spawnColMin(0, true), 0);
  const piece = L.spawnPiece(() => 0, 4);
  assert.ok(piece.col >= 4);
});
