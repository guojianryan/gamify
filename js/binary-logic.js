// Pure rules for the 8-bit conversion drill.
// A row is either "bits" (a decimal is given, click bits until they add up)
// or "decimal" (bits are fixed, type the total). Rows stack until the column
// is full. The next arrival after a full column ends the round.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BinaryLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BIT_VALUES = Object.freeze([128, 64, 32, 16, 8, 4, 2, 1]);
  var MAX_ROWS = 6;
  var SOLVES_PER_LEVEL = 8;
  var SPAWN_FLOOR_MS = 3200;

  // Level 1–2 are small numbers and bit-setting only, with place values shown.
  // From level 3 the drill mixes in "read the bits". Place values hide at level 4.
  var LEVELS = [
    { maxValue: 15, bitsBias: 1, showValues: true },
    { maxValue: 31, bitsBias: 1, showValues: true },
    { maxValue: 63, bitsBias: 0.75, showValues: true },
    { maxValue: 127, bitsBias: 0.6, showValues: false },
    { maxValue: 255, bitsBias: 0.5, showValues: false }
  ];

  function normalizeLevel(level) {
    var n = level | 0;
    if (n < 1) return 1;
    if (n > 30) return 30;
    return n;
  }

  function levelConfig(level) {
    var n = normalizeLevel(level);
    var row = LEVELS[Math.min(n, LEVELS.length) - 1];
    var bitsBias = n >= 6 ? 0.45 : row.bitsBias;
    var spawnMs = Math.max(SPAWN_FLOOR_MS, 11000 - (n - 1) * 1300);
    return {
      level: n,
      bits: BIT_VALUES.length,
      maxValue: row.maxValue,
      bitsBias: bitsBias,
      showValues: row.showValues,
      spawnMs: spawnMs
    };
  }

  function createGame(highScore) {
    var best = Number(highScore);
    return {
      status: 'ready',
      rows: [],
      score: 0,
      streak: 0,
      bestStreak: 0,
      level: 1,
      solvedThisLevel: 0,
      solved: 0,
      highScore: Number.isFinite(best) && best > 0 ? Math.floor(best) : 0,
      nextId: 1,
      lastValue: null
    };
  }

  function bitsFor(value) {
    var n = value | 0;
    return BIT_VALUES.map(function (bit) {
      return (n & bit) === bit ? 1 : 0;
    });
  }

  function valueOf(bits) {
    return BIT_VALUES.reduce(function (sum, bit, index) {
      return sum + (bits[index] ? bit : 0);
    }, 0);
  }

  function expression(value) {
    var n = value | 0;
    var parts = BIT_VALUES.filter(function (bit) {
      return (n & bit) === bit;
    });
    return parts.length ? parts.join(' + ') : '0';
  }

  function pointsFor(level, streak) {
    var safeLevel = normalizeLevel(level);
    var safeStreak = Math.max(0, streak | 0);
    return 50 + safeLevel * 10 + Math.min(safeStreak, 10) * 5;
  }

  // Draws 1..max. `rng` is called once. Avoids repeating the previous target
  // when there is another number in range.
  function randomValue(max, rng, avoid) {
    var cap = Math.max(1, max | 0);
    var value = 1 + Math.floor(rng() * cap);
    if (value > cap) value = cap;
    if (value < 1) value = 1;
    if (value === avoid && cap > 1) {
      value = value === cap ? 1 : value + 1;
    }
    return value;
  }

  function awardClear(state, ids) {
    var events = [];
    var next = {
      status: state.status,
      rows: state.rows.filter(function (row) {
        return ids.indexOf(row.id) === -1;
      }),
      score: state.score,
      streak: state.streak,
      bestStreak: state.bestStreak,
      level: state.level,
      solvedThisLevel: state.solvedThisLevel,
      solved: state.solved,
      highScore: state.highScore,
      nextId: state.nextId,
      lastValue: state.lastValue
    };

    ids.forEach(function (id) {
      var streak = next.streak + 1;
      var gained = pointsFor(next.level, streak);
      var score = next.score + gained;
      var level = next.level;
      var solvedThisLevel = next.solvedThisLevel + 1;
      var leveled = false;
      if (solvedThisLevel >= SOLVES_PER_LEVEL) {
        level += 1;
        solvedThisLevel = 0;
        leveled = true;
      }
      var highScore = Math.max(next.highScore, score);
      events.push({ type: 'solved', rowId: id, gained: gained, score: score });
      if (leveled) events.push({ type: 'level', level: level });
      next = {
        status: next.status,
        rows: next.rows,
        score: score,
        streak: streak,
        bestStreak: Math.max(next.bestStreak, streak),
        level: level,
        solvedThisLevel: solvedThisLevel,
        solved: next.solved + 1,
        highScore: highScore,
        nextId: next.nextId,
        lastValue: next.lastValue
      };
    });

    return { state: next, events: events };
  }

  function settleBits(state) {
    var solvedIds = state.rows.filter(function (row) {
      return row.mode === 'bits' && valueOf(row.bits) === row.value;
    }).map(function (row) {
      return row.id;
    });
    if (!solvedIds.length) return { state: state, events: [] };
    return awardClear(state, solvedIds);
  }

  // rng is drawn twice when a row is created: once for the value, once for the mode.
  function spawnRow(state, rng) {
    var random = rng || Math.random;
    if (state.status !== 'playing') return { state: state, events: [] };
    if (state.rows.length >= MAX_ROWS) {
      var highScore = Math.max(state.highScore, state.score);
      return {
        state: copyState(state, { status: 'over', highScore: highScore }),
        events: [{ type: 'over', score: state.score, highScore: highScore }]
      };
    }
    var config = levelConfig(state.level);
    var value = randomValue(config.maxValue, random, state.lastValue);
    var mode = random() < config.bitsBias ? 'bits' : 'decimal';
    var row = {
      id: state.nextId,
      mode: mode,
      value: value,
      bits: mode === 'bits' ? BIT_VALUES.map(function () { return 0; }) : bitsFor(value),
      draft: '',
      wrong: false
    };
    return {
      state: copyState(state, {
        rows: state.rows.concat(row),
        nextId: state.nextId + 1,
        lastValue: value
      }),
      events: [{ type: 'spawn', rowId: row.id, mode: mode }]
    };
  }

  function startGame(previous, rng, options) {
    var level = normalizeLevel(options && options.level);
    var highScore = previous && previous.highScore ? previous.highScore : 0;
    var fresh = copyState(createGame(highScore), { status: 'playing', level: level });
    return spawnRow(fresh, rng || Math.random);
  }

  function toggleBit(state, rowId, index) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var current = findRow(state, rowId);
    if (!current || current.mode !== 'bits') return { state: state, events: [] };
    if (index < 0 || index >= BIT_VALUES.length) return { state: state, events: [] };
    var bits = current.bits.slice();
    bits[index] = bits[index] ? 0 : 1;
    var rows = state.rows.map(function (row) {
      return row.id === rowId ? copyRow(row, { bits: bits }) : row;
    });
    return settleBits(copyState(state, { rows: rows }));
  }

  function setDraft(state, rowId, draft) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var clean = String(draft == null ? '' : draft).replace(/\D/g, '').slice(0, 3);
    var changed = false;
    var rows = state.rows.map(function (row) {
      if (row.id !== rowId || row.mode !== 'decimal') return row;
      if (row.draft === clean && row.wrong === false) return row;
      changed = true;
      return copyRow(row, { draft: clean, wrong: false });
    });
    if (!changed) return { state: state, events: [] };
    return { state: copyState(state, { rows: rows }), events: [] };
  }

  function submitDecimal(state, rowId) {
    if (state.status !== 'playing') return { state: state, events: [], result: 'ignore' };
    var row = findRow(state, rowId);
    if (!row || row.mode !== 'decimal') return { state: state, events: [], result: 'ignore' };
    if (row.draft === '') return { state: state, events: [], result: 'ignore' };
    var guessed = Number(row.draft);
    if (!Number.isInteger(guessed)) return { state: state, events: [], result: 'ignore' };
    if (guessed === row.value) {
      var cleared = awardClear(state, [rowId]);
      cleared.result = 'correct';
      return cleared;
    }
    var rows = state.rows.map(function (item) {
      return item.id === rowId ? copyRow(item, { wrong: true }) : item;
    });
    return {
      state: copyState(state, { rows: rows, streak: 0 }),
      events: [{ type: 'wrong', rowId: rowId }],
      result: 'wrong'
    };
  }

  function pauseGame(state) {
    if (state.status !== 'playing') return { state: state, events: [] };
    return { state: copyState(state, { status: 'paused' }), events: [{ type: 'paused' }] };
  }

  function resumeGame(state) {
    if (state.status !== 'paused') return { state: state, events: [] };
    return { state: copyState(state, { status: 'playing' }), events: [{ type: 'resumed' }] };
  }

  function findRow(state, rowId) {
    for (var i = 0; i < state.rows.length; i += 1) {
      if (state.rows[i].id === rowId) return state.rows[i];
    }
    return null;
  }

  function copyRow(row, patch) {
    return {
      id: row.id,
      mode: row.mode,
      value: row.value,
      bits: patch.bits || row.bits,
      draft: patch.draft != null ? patch.draft : row.draft,
      wrong: patch.wrong != null ? patch.wrong : row.wrong
    };
  }

  function copyState(state, patch) {
    return {
      status: patch.status || state.status,
      rows: patch.rows || state.rows,
      score: patch.score != null ? patch.score : state.score,
      streak: patch.streak != null ? patch.streak : state.streak,
      bestStreak: patch.bestStreak != null ? patch.bestStreak : state.bestStreak,
      level: patch.level != null ? patch.level : state.level,
      solvedThisLevel: patch.solvedThisLevel != null ? patch.solvedThisLevel : state.solvedThisLevel,
      solved: patch.solved != null ? patch.solved : state.solved,
      highScore: patch.highScore != null ? patch.highScore : state.highScore,
      nextId: patch.nextId != null ? patch.nextId : state.nextId,
      lastValue: patch.lastValue !== undefined ? patch.lastValue : state.lastValue
    };
  }

  return {
    BIT_VALUES: BIT_VALUES,
    MAX_ROWS: MAX_ROWS,
    SOLVES_PER_LEVEL: SOLVES_PER_LEVEL,
    levelConfig: levelConfig,
    createGame: createGame,
    startGame: startGame,
    spawnRow: spawnRow,
    toggleBit: toggleBit,
    setDraft: setDraft,
    submitDecimal: submitDecimal,
    pauseGame: pauseGame,
    resumeGame: resumeGame,
    bitsFor: bitsFor,
    valueOf: valueOf,
    expression: expression,
    pointsFor: pointsFor
  };
});
