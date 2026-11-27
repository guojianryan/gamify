// Pure rules for Bitris — a Tetris-like 8-bit place-value game.
// Columns are 128..1. Falling bit pieces lock into the well. A row clears
// when its ON bits sum exactly to that row's target. Overshoot soft-resets
// the row (bits wipe, same target) so a bad drop is recoverable.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BitrisLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PLACE_VALUES = Object.freeze([128, 64, 32, 16, 8, 4, 2, 1]);
  var COLS = PLACE_VALUES.length;
  var ROWS = 14;
  var WARMUP_CLEARS = 8;
  var TIME_LIMITS = Object.freeze([60, 120, 300]);
  var GRAVITY_WARMUP_MS = 900;
  var GRAVITY_FLOOR_MS = 280;
  var POINTS_BASE = 40;

  // Small bit polyominoes. 1 = ON cell.
  var SHAPES = Object.freeze([
    [[1]],
    [[1, 1]],
    [[1], [1]],
    [[1, 1, 1]],
    [[1], [1], [1]],
    [[1, 1], [1, 0]],
    [[1, 1], [0, 1]],
    [[1, 0], [1, 1]],
    [[0, 1], [1, 1]]
  ]);

  function emptyHighScores() {
    return { 60: 0, 120: 0, 300: 0 };
  }

  function copyHighScores(scores) {
    var next = emptyHighScores();
    TIME_LIMITS.forEach(function (limit) {
      var n = Number(scores && scores[limit]);
      next[limit] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    });
    return next;
  }

  function limitLabel(sec) {
    if (sec === 60) return '1 minute';
    if (sec === 120) return '2 minutes';
    if (sec === 300) return '5 minutes';
    return '';
  }

  function emptyRow() {
    var cells = [];
    for (var c = 0; c < COLS; c += 1) cells.push(0);
    return { cells: cells, target: null };
  }

  // Wipe ON bits but keep the target so the player can try the same sum again.
  function softResetRow(row) {
    var cells = [];
    for (var c = 0; c < COLS; c += 1) cells.push(0);
    return { cells: cells, target: row.target };
  }

  function emptyBoard() {
    var rows = [];
    for (var r = 0; r < ROWS; r += 1) rows.push(emptyRow());
    return rows;
  }

  function cloneBoard(board) {
    return board.map(function (row) {
      return { cells: row.cells.slice(), target: row.target };
    });
  }

  function rowSum(row) {
    var sum = 0;
    for (var c = 0; c < COLS; c += 1) {
      if (row.cells[c]) sum += PLACE_VALUES[c];
    }
    return sum;
  }

  function rowExpression(row) {
    var parts = [];
    for (var c = 0; c < COLS; c += 1) {
      if (row.cells[c]) parts.push(String(PLACE_VALUES[c]));
    }
    return parts.length ? parts.join(' + ') : '0';
  }

  function emptyPlaces(row) {
    var values = [];
    for (var c = 0; c < COLS; c += 1) {
      if (!row.cells[c]) values.push(PLACE_VALUES[c]);
    }
    return values;
  }

  // Non-empty subset sum of `values`, capped at maxValue. Always returns >= 1
  // when values has something usable under the cap.
  function randomSubsetSum(values, maxValue, rng) {
    var usable = values.filter(function (v) { return v <= maxValue; });
    if (!usable.length) return 0;
    // Shuffle then take a random prefix-ish subset.
    var pool = usable.slice();
    for (var i = pool.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    var take = 1 + Math.floor(rng() * pool.length);
    var sum = 0;
    for (var k = 0; k < take; k += 1) {
      if (sum + pool[k] <= maxValue) sum += pool[k];
    }
    if (sum === 0) sum = pool[0];
    return sum;
  }

  function maxForProgress(clears, racing) {
    if (racing) return 255;
    if (clears < 3) return 15;
    if (clears < 6) return 63;
    return 255;
  }

  function assignTarget(row, clears, racing, rng) {
    if (row.target != null) return row;
    var current = rowSum(row);
    var empty = emptyPlaces(row);
    var band = maxForProgress(clears, racing);
    // Never stamp a target below what is already on the row. If the band is
    // smaller (early warm-up + a high bit), the row is already exact.
    var cap = Math.max(band, current);
    var room = cap - current;
    if (room === 0) {
      return { cells: row.cells.slice(), target: Math.max(1, current) };
    }
    var extra = randomSubsetSum(empty, room, rng);
    if (extra === 0) {
      for (var i = empty.length - 1; i >= 0; i -= 1) {
        if (empty[i] <= room) {
          extra = empty[i];
          break;
        }
      }
    }
    return { cells: row.cells.slice(), target: current + Math.max(0, extra) };
  }

  function spawnColMin(clears, racing) {
    if (racing) return 0;
    if (clears < 3) return 4; // only 8,4,2,1
    if (clears < 6) return 2; // 32..1
    return 0;
  }

  function shapeSize(shape) {
    return {
      h: shape.length,
      w: shape.reduce(function (max, row) { return Math.max(max, row.length); }, 0)
    };
  }

  function rotateShape(shape) {
    var size = shapeSize(shape);
    var next = [];
    for (var c = 0; c < size.w; c += 1) {
      var row = [];
      for (var r = size.h - 1; r >= 0; r -= 1) {
        row.push(shape[r][c] ? 1 : 0);
      }
      next.push(row);
    }
    return next;
  }

  function pickShape(rng) {
    return SHAPES[Math.floor(rng() * SHAPES.length)].map(function (row) {
      return row.slice();
    });
  }

  function spawnPiece(rng, colMin) {
    var shape = pickShape(rng);
    var size = shapeSize(shape);
    var min = Math.max(0, colMin | 0);
    var maxCol = Math.max(min, COLS - size.w);
    var span = Math.max(0, maxCol - min);
    var col = min + Math.floor(rng() * (span + 1));
    if (col > maxCol) col = maxCol;
    return {
      shape: shape,
      row: 0,
      col: col
    };
  }

  function cellFilled(board, r, c) {
    if (r < 0 || c < 0 || c >= COLS) return true;
    if (r >= ROWS) return true;
    return !!board[r].cells[c];
  }

  function fits(board, piece) {
    var shape = piece.shape;
    for (var r = 0; r < shape.length; r += 1) {
      for (var c = 0; c < shape[r].length; c += 1) {
        if (!shape[r][c]) continue;
        var br = piece.row + r;
        var bc = piece.col + c;
        if (bc < 0 || bc >= COLS || br >= ROWS) return false;
        if (br >= 0 && board[br].cells[bc]) return false;
      }
    }
    return true;
  }

  function ghostRow(board, piece) {
    var ghost = { shape: piece.shape, row: piece.row, col: piece.col };
    while (fits(board, { shape: ghost.shape, row: ghost.row + 1, col: ghost.col })) {
      ghost.row += 1;
    }
    return ghost.row;
  }

  function createGame(highScores) {
    return {
      status: 'ready',
      phase: 'warmup',
      board: emptyBoard(),
      piece: null,
      next: null,
      score: 0,
      clears: 0,
      combo: 0,
      highScores: copyHighScores(highScores),
      timeLimit: 0,
      remainingMs: 0,
      gravityMs: GRAVITY_WARMUP_MS,
      lastClear: null,
      events: []
    };
  }

  function gravityFor(state) {
    if (state.phase !== 'race') return GRAVITY_WARMUP_MS;
    var step = Math.floor(state.clears / 4) * 40;
    return Math.max(GRAVITY_FLOOR_MS, 700 - step);
  }

  function pointsForClear(target, softBonus) {
    var size = Math.min(40, Math.round((target || 0) / 4));
    return POINTS_BASE + size + Math.max(0, softBonus | 0);
  }

  function startGame(state, rng, options) {
    var opts = options || {};
    var next = createGame(state.highScores);
    next.status = 'playing';
    next.phase = 'warmup';
    next._rng = rng;
    var colMin = spawnColMin(0, false);
    next.next = spawnPiece(rng, colMin);
    next.piece = spawnPiece(rng, colMin);
    next.timeLimit = 0;
    next.remainingMs = 0;
    next.gravityMs = GRAVITY_WARMUP_MS;
    if (opts.skipWarmup && TIME_LIMITS.indexOf(opts.timeLimit) !== -1) {
      next.phase = 'race';
      next.timeLimit = opts.timeLimit;
      next.remainingMs = opts.timeLimit * 1000;
      next.gravityMs = gravityFor(next);
      next.next = spawnPiece(rng, 0);
      next.piece = spawnPiece(rng, 0);
    }
    return { state: next, events: [{ type: 'start', phase: next.phase }] };
  }

  function beginRace(state, timeLimit) {
    if (TIME_LIMITS.indexOf(timeLimit) === -1) return { state: state, events: [] };
    if (state.status !== 'playing' && state.status !== 'warmup_done') {
      return { state: state, events: [] };
    }
    var rng = state._rng || Math.random;
    var next = Object.assign({}, state, {
      status: 'playing',
      phase: 'race',
      timeLimit: timeLimit,
      remainingMs: timeLimit * 1000,
      gravityMs: gravityFor(state),
      lastClear: null
    });
    next.gravityMs = gravityFor(next);
    // Warm-up ends without spawning the next piece; race needs one.
    if (!next.piece) {
      next.piece = spawnPiece(rng, 0);
      next.next = next.next || spawnPiece(rng, 0);
    }
    return { state: next, events: [{ type: 'race', timeLimit: timeLimit }] };
  }

  function move(state, dx) {
    if (state.status !== 'playing' || !state.piece) return { state: state, events: [] };
    var piece = {
      shape: state.piece.shape,
      row: state.piece.row,
      col: state.piece.col + (dx | 0)
    };
    if (!fits(state.board, piece)) return { state: state, events: [] };
    return {
      state: Object.assign({}, state, { piece: piece }),
      events: [{ type: 'move' }]
    };
  }

  function rotate(state) {
    if (state.status !== 'playing' || !state.piece) return { state: state, events: [] };
    var rotated = rotateShape(state.piece.shape);
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i += 1) {
      var piece = {
        shape: rotated,
        row: state.piece.row,
        col: state.piece.col + kicks[i]
      };
      if (fits(state.board, piece)) {
        return {
          state: Object.assign({}, state, { piece: piece }),
          events: [{ type: 'rotate' }]
        };
      }
    }
    return { state: state, events: [] };
  }

  function softDrop(state) {
    if (state.status !== 'playing' || !state.piece) return { state: state, events: [] };
    var piece = {
      shape: state.piece.shape,
      row: state.piece.row + 1,
      col: state.piece.col
    };
    if (!fits(state.board, piece)) return lockPiece(state, 1);
    return {
      state: Object.assign({}, state, { piece: piece }),
      events: [{ type: 'soft' }]
    };
  }

  function hardDrop(state) {
    if (state.status !== 'playing' || !state.piece) return { state: state, events: [] };
    var row = ghostRow(state.board, state.piece);
    var dropped = row - state.piece.row;
    var next = Object.assign({}, state, {
      piece: { shape: state.piece.shape, row: row, col: state.piece.col }
    });
    return lockPiece(next, Math.min(20, dropped * 2));
  }

  function tick(state) {
    if (state.status !== 'playing' || !state.piece) return { state: state, events: [] };
    var piece = {
      shape: state.piece.shape,
      row: state.piece.row + 1,
      col: state.piece.col
    };
    if (!fits(state.board, piece)) return lockPiece(state, 0);
    return {
      state: Object.assign({}, state, { piece: piece }),
      events: [{ type: 'tick' }]
    };
  }

  function lockPiece(state, dropBonus) {
    var board = cloneBoard(state.board);
    var piece = state.piece;
    var touched = {};
    var r;
    var c;

    for (r = 0; r < piece.shape.length; r += 1) {
      for (c = 0; c < piece.shape[r].length; c += 1) {
        if (!piece.shape[r][c]) continue;
        var br = piece.row + r;
        var bc = piece.col + c;
        if (br < 0) {
          return endRound(state, 'topout');
        }
        board[br].cells[bc] = 1;
        touched[br] = true;
      }
    }

    var racing = state.phase === 'race';
    Object.keys(touched).forEach(function (key) {
      var index = Number(key);
      board[index] = assignTarget(board[index], state.clears, racing, state._rng || Math.random);
    });

    var cleared = [];
    var reset = [];
    var kept = [];
    for (r = 0; r < ROWS; r += 1) {
      var row = board[r];
      var sum = rowSum(row);
      if (row.target != null && sum === row.target) {
        cleared.push({
          index: r,
          target: row.target,
          expression: rowExpression(row) + ' = ' + row.target
        });
      } else if (row.target != null && sum > row.target) {
        reset.push({
          index: r,
          target: row.target,
          sum: sum,
          expression: rowExpression(row) + ' > ' + row.target
        });
        kept.push(softResetRow(row));
      } else {
        kept.push(row);
      }
    }

    while (kept.length < ROWS) kept.unshift(emptyRow());

    var events = [{ type: 'lock' }];
    var score = state.score;
    var clears = state.clears;
    var combo = cleared.length ? state.combo + cleared.length : 0;
    var lastClear = null;

    if (cleared.length) {
      var gained = 0;
      cleared.forEach(function (item) {
        gained += pointsForClear(item.target, dropBonus) + combo * 5;
      });
      score += gained;
      clears += cleared.length;
      lastClear = {
        lines: cleared.length,
        gained: gained,
        expression: cleared.map(function (item) { return item.expression; }).join(' · ')
      };
      events.push({
        type: 'clear',
        lines: cleared.length,
        gained: gained,
        expression: lastClear.expression,
        rows: cleared
      });
    } else {
      combo = 0;
    }

    if (reset.length) {
      events.push({
        type: 'soft_reset',
        lines: reset.length,
        expression: reset.map(function (item) { return item.expression; }).join(' · '),
        rows: reset
      });
    }

    var nextState = Object.assign({}, state, {
      board: kept,
      score: score,
      clears: clears,
      combo: combo,
      lastClear: lastClear,
      piece: null,
      gravityMs: gravityFor(Object.assign({}, state, { clears: clears, phase: state.phase }))
    });

    // Warm-up complete?
    if (state.phase === 'warmup' && clears >= WARMUP_CLEARS) {
      nextState.status = 'warmup_done';
      nextState.phase = 'warmup_done';
      events.push({ type: 'warmup_done', score: score, clears: clears });
      return { state: nextState, events: events };
    }

    // Spawn next piece — keep early warm-up on the low place-value columns.
    var rng = state._rng || Math.random;
    var colMin = spawnColMin(clears, racing);
    var incoming = state.next || spawnPiece(rng, colMin);
    var spawned = {
      shape: incoming.shape,
      row: 0,
      col: Math.min(incoming.col, Math.max(colMin, COLS - shapeSize(incoming.shape).w))
    };
    if (spawned.col < colMin) spawned.col = colMin;
    if (!fits(kept, spawned)) {
      return endRound(
        Object.assign({}, nextState, { next: spawnPiece(rng, colMin) }),
        'topout',
        events
      );
    }
    nextState.piece = spawned;
    nextState.next = spawnPiece(rng, colMin);
    events.push({ type: 'spawn' });
    return { state: nextState, events: events };
  }

  function endRound(state, reason, priorEvents) {
    var events = (priorEvents || []).slice();
    var highScores = copyHighScores(state.highScores);
    if (state.phase === 'race' && state.timeLimit) {
      var best = highScores[state.timeLimit] || 0;
      if (state.score > best) highScores[state.timeLimit] = state.score;
    }
    events.push({
      type: 'over',
      reason: reason || 'topout',
      score: state.score,
      clears: state.clears,
      phase: state.phase,
      timeLimit: state.timeLimit
    });
    return {
      state: Object.assign({}, state, {
        status: 'over',
        piece: null,
        highScores: highScores,
        lastClear: state.lastClear
      }),
      events: events
    };
  }

  function elapse(state, ms) {
    if (state.status !== 'playing' || state.phase !== 'race') {
      return { state: state, events: [] };
    }
    var left = Math.max(0, (state.remainingMs | 0) - Math.max(0, ms | 0));
    if (left === 0) {
      return endRound(Object.assign({}, state, { remainingMs: 0 }), 'time');
    }
    return {
      state: Object.assign({}, state, { remainingMs: left }),
      events: []
    };
  }

  function pauseGame(state) {
    if (state.status !== 'playing') return { state: state, events: [] };
    return {
      state: Object.assign({}, state, { status: 'paused' }),
      events: [{ type: 'pause' }]
    };
  }

  function resumeGame(state) {
    if (state.status !== 'paused') return { state: state, events: [] };
    return {
      state: Object.assign({}, state, { status: 'playing' }),
      events: [{ type: 'resume' }]
    };
  }

  // Test helper: inject rng onto state for deterministic targets/spawns.
  function withRng(state, rng) {
    return Object.assign({}, state, { _rng: rng });
  }

  function boardMatrix(board) {
    return board.map(function (row) { return row.cells.slice(); });
  }

  return {
    PLACE_VALUES: PLACE_VALUES,
    COLS: COLS,
    ROWS: ROWS,
    WARMUP_CLEARS: WARMUP_CLEARS,
    TIME_LIMITS: TIME_LIMITS,
    SHAPES: SHAPES,
    emptyHighScores: emptyHighScores,
    copyHighScores: copyHighScores,
    limitLabel: limitLabel,
    emptyBoard: emptyBoard,
    cloneBoard: cloneBoard,
    softResetRow: softResetRow,
    rowSum: rowSum,
    rowExpression: rowExpression,
    rotateShape: rotateShape,
    shapeSize: shapeSize,
    spawnPiece: spawnPiece,
    fits: fits,
    ghostRow: ghostRow,
    createGame: createGame,
    startGame: startGame,
    beginRace: beginRace,
    move: move,
    rotate: rotate,
    softDrop: softDrop,
    hardDrop: hardDrop,
    tick: tick,
    lockPiece: lockPiece,
    elapse: elapse,
    pauseGame: pauseGame,
    resumeGame: resumeGame,
    withRng: withRng,
    boardMatrix: boardMatrix,
    assignTarget: assignTarget,
    spawnColMin: spawnColMin,
    pointsForClear: pointsForClear,
    gravityFor: gravityFor,
    maxForProgress: maxForProgress
  };
});
