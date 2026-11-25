// Pure rules for the 8-bit conversion drill.
// A row is either "bits" (a decimal is given, click bits until they add up)
// or "decimal" (bits are fixed, type the total). A wrong pattern stays up
// long enough to read, with one retry for partial credit.
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
  var CLEAN_ROWS_PER_PACE = 8;
  var SPAWN_FLOOR_MS = 1600;
  var GUIDE_VALUE = 10;
  var PACES = [
    { id: 'warmup', name: 'Warm-up', level: 1 },
    { id: 'drill', name: 'Drill', level: 3 },
    { id: 'exam', name: 'Exam pace', level: 5 }
  ];

  function normalizeLevel(level) {
    var n = level | 0;
    if (n < 1) return 1;
    if (n > 30) return 30;
    return n;
  }

  // Every pace draws uniformly from 0..255, and setting bits is as common as
  // reading them. Hardness is the clock and, at Exam pace, hidden place values.
  function levelConfig(level) {
    var n = normalizeLevel(level);
    var spawnMs = Math.max(SPAWN_FLOOR_MS, 4200 - (n - 1) * 550);
    return {
      level: n,
      bits: BIT_VALUES.length,
      maxValue: 255,
      bitsBias: 0.5,
      showValues: n < 5,
      spawnMs: spawnMs
    };
  }

  function emptyMisses() {
    return BIT_VALUES.map(function () { return 0; });
  }

  function paceIndexForLevel(level) {
    if (level >= 5) return 2;
    if (level >= 3) return 1;
    return 0;
  }

  function paceName(stateOrIndex) {
    var index = typeof stateOrIndex === 'number'
      ? stateOrIndex
      : (stateOrIndex && stateOrIndex.paceIndex) || 0;
    if (index < 0) index = 0;
    if (index >= PACES.length) index = PACES.length - 1;
    return PACES[index].name;
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
      paceIndex: 0,
      cleanRows: 0,
      solvedThisLevel: 0,
      solved: 0,
      highScore: Number.isFinite(best) && best > 0 ? Math.floor(best) : 0,
      bestPaceIndex: 0,
      nextId: 1,
      lastValue: null,
      misses: emptyMisses(),
      guide: false
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

  function streakMultiplier(streak) {
    var n = streak | 0;
    if (n < 1) return 1;
    return Math.min(n, 5);
  }

  function pointsFor(level, streak) {
    var safeLevel = normalizeLevel(level);
    var safeStreak = Math.max(0, streak | 0);
    return 50 + safeLevel * 10 + Math.min(safeStreak, 10) * 5;
  }

  function partialPoints(level) {
    return Math.max(10, Math.round(pointsFor(level, 1) / 2));
  }

  function differingIndexes(bits, value) {
    var target = bitsFor(value);
    var indexes = [];
    for (var i = 0; i < BIT_VALUES.length; i += 1) {
      if ((bits[i] ? 1 : 0) !== target[i]) indexes.push(i);
    }
    return indexes;
  }

  // Still building: every 1 is part of the answer, and the sum is short.
  function isBuilding(bits, value) {
    if (valueOf(bits) === value) return false;
    var target = bitsFor(value);
    for (var i = 0; i < BIT_VALUES.length; i += 1) {
      if (bits[i] && !target[i]) return false;
    }
    return true;
  }

  function bitLesson(bits, value) {
    var sum = valueOf(bits);
    return 'You set ' + expression(sum) + ' = ' + sum + '. Target ' + value + ' = ' + expression(value);
  }

  function decimalLesson(value) {
    return expression(value) + ' = ' + value;
  }

  function addMisses(misses, indexes) {
    var next = (misses || emptyMisses()).slice();
    indexes.forEach(function (index) {
      next[index] = (next[index] || 0) + 1;
    });
    return next;
  }

  function weakSpotText(misses) {
    var ranked = BIT_VALUES.map(function (value, index) {
      return { value: value, count: misses && misses[index] ? misses[index] : 0 };
    }).filter(function (item) {
      return item.count > 0;
    }).sort(function (a, b) {
      return b.count - a.count || b.value - a.value;
    }).slice(0, 2);
    if (!ranked.length) return '';
    var names = ranked.map(function (item) { return item.value + 's'; });
    if (names.length === 1) return 'Weak spots: ' + names[0];
    return 'Weak spots: ' + names[0] + ' and ' + names[1];
  }

  function randomValue(max, rng, avoid) {
    var cap = Math.max(0, max | 0);
    var span = cap + 1;
    var value = Math.floor(rng() * span);
    if (value > cap) value = cap;
    if (value < 0) value = 0;
    if (value === avoid && span > 1) {
      value = value === cap ? 0 : value + 1;
    }
    return value;
  }

  function blankRow(id, mode, value) {
    return {
      id: id,
      mode: mode,
      value: value,
      bits: mode === 'bits' ? BIT_VALUES.map(function () { return 0; }) : bitsFor(value),
      draft: '',
      wrong: false,
      retries: 0,
      phase: 'play',
      feedback: '',
      wrongIndexes: []
    };
  }

  function awardClear(state, ids) {
    var events = [];
    var kept = state.rows.filter(function (row) {
      return ids.indexOf(row.id) === -1;
    });
    var next = copyState(state, { rows: kept });

    ids.forEach(function (id) {
      var source = findRow(state, id);
      var partial = !!(source && source.retries > 0);
      var streak = partial ? next.streak : next.streak + 1;
      var gained = partial ? partialPoints(next.level) : pointsFor(next.level, streak);
      var score = next.score + gained;
      var level = next.level;
      var paceIndex = next.paceIndex || 0;
      var cleanRows = next.cleanRows || 0;
      var paced = false;
      if (!partial) {
        cleanRows += 1;
        if (cleanRows >= CLEAN_ROWS_PER_PACE) {
          if (paceIndex < PACES.length - 1) {
            paceIndex += 1;
            level = PACES[paceIndex].level;
            paced = true;
          }
          cleanRows = 0;
        }
      }
      var highScore = Math.max(next.highScore, score);
      var bestPaceIndex = Math.max(next.bestPaceIndex || 0, paceIndex);
      events.push({
        type: 'solved',
        rowId: id,
        gained: gained,
        score: score,
        partial: partial,
        multiplier: streakMultiplier(streak)
      });
      if (paced) {
        events.push({ type: 'pace', name: PACES[paceIndex].name, level: level, paceIndex: paceIndex });
      }
      next = copyState(next, {
        score: score,
        streak: streak,
        bestStreak: Math.max(next.bestStreak, streak),
        level: level,
        paceIndex: paceIndex,
        cleanRows: cleanRows,
        solvedThisLevel: cleanRows,
        solved: next.solved + 1,
        highScore: highScore,
        bestPaceIndex: bestPaceIndex,
        guide: false
      });
    });

    return { state: next, events: events };
  }

  function settleBits(state) {
    var solvedIds = state.rows.filter(function (row) {
      return row.mode === 'bits' && row.phase === 'play' && valueOf(row.bits) === row.value;
    }).map(function (row) {
      return row.id;
    });
    if (!solvedIds.length) return { state: state, events: [] };
    return awardClear(state, solvedIds);
  }

  function beginMiss(state, row, indexes, feedback) {
    var retries = (row.retries || 0) + 1;
    var misses = addMisses(state.misses, indexes);
    if (retries >= 2) {
      var revealedBits = row.mode === 'bits' ? bitsFor(row.value) : row.bits.slice();
      var rows = state.rows.map(function (item) {
        if (item.id !== row.id) return item;
        return copyRow(item, {
          bits: revealedBits,
          phase: 'reveal',
          retries: retries,
          feedback: feedback,
          wrongIndexes: indexes,
          wrong: true,
          draft: ''
        });
      });
      return {
        state: copyState(state, { rows: rows, misses: misses, streak: 0 }),
        events: [{ type: 'reveal', rowId: row.id, feedback: feedback }],
        result: 'reveal'
      };
    }
    var teaching = state.rows.map(function (item) {
      if (item.id !== row.id) return item;
      return copyRow(item, {
        bits: row.bits,
        phase: 'teach',
        retries: retries,
        feedback: feedback,
        wrongIndexes: indexes,
        wrong: true
      });
    });
    return {
      state: copyState(state, { rows: teaching, misses: misses, streak: 0 }),
      events: [{ type: 'teach', rowId: row.id, feedback: feedback }],
      result: 'teach'
    };
  }

  function spawnRow(state, rng) {
    var random = rng || Math.random;
    if (state.status !== 'playing') return { state: state, events: [] };
    if (state.guide && state.rows.length) return { state: state, events: [] };
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
    // An all-zero bit row would already equal 0, so that draw is typed instead.
    if (mode === 'bits' && value === 0) mode = 'decimal';
    var row = blankRow(state.nextId, mode, value);
    return {
      state: copyState(state, {
        rows: state.rows.concat(row),
        nextId: state.nextId + 1,
        lastValue: value
      }),
      events: [{ type: 'spawn', rowId: row.id, mode: mode }]
    };
  }

  function spawnGuide(state) {
    var row = blankRow(state.nextId, 'bits', GUIDE_VALUE);
    return {
      state: copyState(state, {
        rows: [row],
        nextId: state.nextId + 1,
        lastValue: GUIDE_VALUE,
        guide: true,
        level: 1,
        paceIndex: 0
      }),
      events: [{ type: 'spawn', rowId: row.id, mode: 'bits', guide: true }]
    };
  }

  function startGame(previous, rng, options) {
    var guide = !!(options && options.guide);
    var level = guide ? 1 : normalizeLevel(options && options.level);
    var highScore = previous && previous.highScore ? previous.highScore : 0;
    var misses = previous && previous.misses && previous.misses.length
      ? previous.misses.slice()
      : emptyMisses();
    var paceIndex = paceIndexForLevel(level);
    var carriedBest = previous && previous.bestPaceIndex ? previous.bestPaceIndex | 0 : 0;
    var fresh = copyState(createGame(highScore), {
      status: 'playing',
      level: level,
      paceIndex: paceIndex,
      bestPaceIndex: Math.max(carriedBest, guide ? 0 : paceIndex),
      misses: misses,
      guide: guide
    });
    if (guide) return spawnGuide(fresh);
    return spawnRow(fresh, rng || Math.random);
  }

  function toggleBit(state, rowId, index) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var current = findRow(state, rowId);
    if (!current || current.mode !== 'bits' || current.phase !== 'play') {
      return { state: state, events: [] };
    }
    if (index < 0 || index >= BIT_VALUES.length) return { state: state, events: [] };
    var bits = current.bits.slice();
    bits[index] = bits[index] ? 0 : 1;
    var updated = copyRow(current, { bits: bits, wrong: false, wrongIndexes: [] });
    var rows = state.rows.map(function (row) {
      return row.id === rowId ? updated : row;
    });
    var withBits = copyState(state, { rows: rows });
    if (valueOf(bits) === current.value) return settleBits(withBits);
    if (isBuilding(bits, current.value)) return { state: withBits, events: [] };
    return beginMiss(withBits, updated, differingIndexes(bits, current.value), bitLesson(bits, current.value));
  }

  function setDraft(state, rowId, draft) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var clean = String(draft == null ? '' : draft).replace(/\D/g, '').slice(0, 3);
    var changed = false;
    var rows = state.rows.map(function (row) {
      if (row.id !== rowId || row.mode !== 'decimal' || row.phase !== 'play') return row;
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
    if (!row || row.mode !== 'decimal' || row.phase !== 'play') {
      return { state: state, events: [], result: 'ignore' };
    }
    if (row.draft === '') return { state: state, events: [], result: 'ignore' };
    var guessed = Number(row.draft);
    if (!Number.isInteger(guessed)) return { state: state, events: [], result: 'ignore' };
    if (guessed === row.value) {
      var cleared = awardClear(state, [rowId]);
      cleared.result = 'correct';
      return cleared;
    }
    var indexes = bitsFor(row.value).reduce(function (list, bit, index) {
      if (bit) list.push(index);
      return list;
    }, []);
    var missed = beginMiss(state, row, indexes, decimalLesson(row.value));
    missed.result = missed.result === 'reveal' ? 'reveal' : 'wrong';
    return missed;
  }

  function releaseHold(state, rowId) {
    var row = findRow(state, rowId);
    if (!row) return { state: state, events: [] };
    if (row.phase === 'teach') {
      var rows = state.rows.map(function (item) {
        if (item.id !== rowId) return item;
        return copyRow(item, {
          phase: 'play',
          bits: item.mode === 'bits' ? BIT_VALUES.map(function () { return 0; }) : item.bits,
          draft: '',
          wrong: false,
          wrongIndexes: item.mode === 'decimal' ? item.wrongIndexes : [],
          feedback: item.feedback
        });
      });
      return {
        state: copyState(state, { rows: rows }),
        events: [{ type: 'retry', rowId: rowId }]
      };
    }
    if (row.phase === 'reveal') {
      var remaining = state.rows.filter(function (item) { return item.id !== rowId; });
      if (state.guide && !remaining.length) {
        var again = blankRow(state.nextId, 'bits', GUIDE_VALUE);
        return {
          state: copyState(state, {
            rows: [again],
            nextId: state.nextId + 1,
            lastValue: GUIDE_VALUE
          }),
          events: [{ type: 'retry', rowId: again.id }]
        };
      }
      return {
        state: copyState(state, { rows: remaining }),
        events: [{ type: 'dismissed', rowId: rowId }]
      };
    }
    return { state: state, events: [] };
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
    var bits = patch.bits ? patch.bits.slice() : row.bits.slice();
    var wrongIndexes = patch.wrongIndexes ? patch.wrongIndexes.slice() : (row.wrongIndexes || []).slice();
    return {
      id: row.id,
      mode: row.mode,
      value: row.value,
      bits: bits,
      draft: patch.draft != null ? patch.draft : row.draft,
      wrong: patch.wrong != null ? patch.wrong : row.wrong,
      retries: patch.retries != null ? patch.retries : (row.retries || 0),
      phase: patch.phase || row.phase || 'play',
      feedback: patch.feedback != null ? patch.feedback : (row.feedback || ''),
      wrongIndexes: wrongIndexes
    };
  }

  function copyState(state, patch) {
    var misses = patch.misses
      ? patch.misses.slice()
      : (state.misses ? state.misses.slice() : emptyMisses());
    return {
      status: patch.status || state.status,
      rows: patch.rows || state.rows,
      score: patch.score != null ? patch.score : state.score,
      streak: patch.streak != null ? patch.streak : state.streak,
      bestStreak: patch.bestStreak != null ? patch.bestStreak : state.bestStreak,
      level: patch.level != null ? patch.level : state.level,
      paceIndex: patch.paceIndex != null ? patch.paceIndex : (state.paceIndex || 0),
      cleanRows: patch.cleanRows != null ? patch.cleanRows : (state.cleanRows || 0),
      solvedThisLevel: patch.solvedThisLevel != null ? patch.solvedThisLevel : (state.solvedThisLevel || 0),
      solved: patch.solved != null ? patch.solved : state.solved,
      highScore: patch.highScore != null ? patch.highScore : state.highScore,
      bestPaceIndex: patch.bestPaceIndex != null ? patch.bestPaceIndex : (state.bestPaceIndex || 0),
      nextId: patch.nextId != null ? patch.nextId : state.nextId,
      lastValue: patch.lastValue !== undefined ? patch.lastValue : state.lastValue,
      misses: misses,
      guide: patch.guide != null ? patch.guide : !!state.guide
    };
  }

  return {
    BIT_VALUES: BIT_VALUES,
    MAX_ROWS: MAX_ROWS,
    SOLVES_PER_LEVEL: SOLVES_PER_LEVEL,
    CLEAN_ROWS_PER_PACE: CLEAN_ROWS_PER_PACE,
    GUIDE_VALUE: GUIDE_VALUE,
    levelConfig: levelConfig,
    createGame: createGame,
    startGame: startGame,
    spawnRow: spawnRow,
    toggleBit: toggleBit,
    setDraft: setDraft,
    submitDecimal: submitDecimal,
    releaseHold: releaseHold,
    pauseGame: pauseGame,
    resumeGame: resumeGame,
    bitsFor: bitsFor,
    valueOf: valueOf,
    expression: expression,
    pointsFor: pointsFor,
    partialPoints: partialPoints,
    streakMultiplier: streakMultiplier,
    paceName: paceName,
    weakSpotText: weakSpotText
  };
});
