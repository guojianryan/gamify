// Pure rules for Hex Match — nibble/byte drill (hex ↔ bits).
// Same warm-up / race shell as the Binary game. No gravity, no Tetris.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.HexLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BYTE_VALUES = Object.freeze([128, 64, 32, 16, 8, 4, 2, 1]);
  var NIBBLE_VALUES = Object.freeze([8, 4, 2, 1]);
  var HEX_DIGITS = Object.freeze('0123456789ABCDEF'.split(''));
  var MAX_ROWS = 6;
  var WARMUP_ROWS = 8;
  var WARMUP_SPAWN_MS = 8000;
  var SPAWN_FLOOR_MS = 1600;
  var SPAWN_CEILING_MS = 8000;
  var SPAWN_WINDOW = 5;
  var GUIDE_VALUE = 10; // A
  var TIME_LIMITS = Object.freeze([60, 120, 300]);
  var FAST_MS = 2000;
  var SLOW_MS = 10000;
  var POINTS_MAX = 100;
  var POINTS_MIN = 20;
  var DEFAULT_SOLVE_MS = 5000;
  var BITS_BIAS = 0.5;

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

  function pointsForTime(ms) {
    var t = typeof ms === 'number' && ms >= 0 ? ms : DEFAULT_SOLVE_MS;
    if (t <= FAST_MS) return POINTS_MAX;
    if (t >= SLOW_MS) return POINTS_MIN;
    var ratio = (t - FAST_MS) / (SLOW_MS - FAST_MS);
    return Math.round(POINTS_MAX - ratio * (POINTS_MAX - POINTS_MIN));
  }

  function partialForTime(ms) {
    return Math.max(10, Math.round(pointsForTime(ms) / 2));
  }

  function delayFromTimes(times) {
    if (!times || !times.length) return WARMUP_SPAWN_MS;
    var recent = times.slice(-SPAWN_WINDOW);
    var sum = 0;
    for (var i = 0; i < recent.length; i += 1) sum += recent[i];
    var target = Math.round((sum / recent.length) * 0.85);
    if (target < SPAWN_FLOOR_MS) return SPAWN_FLOOR_MS;
    if (target > SPAWN_CEILING_MS) return SPAWN_CEILING_MS;
    return target;
  }

  function spawnDelay(state) {
    if (!state || !state.racing) return WARMUP_SPAWN_MS;
    return delayFromTimes(state.solveTimes);
  }

  function emptyMisses() {
    return HEX_DIGITS.map(function () { return 0; });
  }

  function widthFor(state) {
    var clean = state && state.cleanRows ? state.cleanRows : 0;
    return clean < 4 ? 4 : 8;
  }

  function valueCap(state) {
    return widthFor(state) === 4 ? 15 : 255;
  }

  function placeValues(width) {
    return width === 4 ? NIBBLE_VALUES.slice() : BYTE_VALUES.slice();
  }

  function toHex(value, width) {
    var n = value | 0;
    if (width === 4) return HEX_DIGITS[n & 15];
    var hi = (n >> 4) & 15;
    var lo = n & 15;
    return HEX_DIGITS[hi] + HEX_DIGITS[lo];
  }

  function parseHex(draft, width) {
    var raw = String(draft == null ? '' : draft).trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    var need = width === 4 ? 1 : 2;
    if (raw.length !== need) return null;
    var n = parseInt(raw, 16);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function bitsFor(value, width) {
    var places = placeValues(width);
    var n = value | 0;
    return places.map(function (bit) {
      return (n & bit) === bit ? 1 : 0;
    });
  }

  function valueOf(bits, width) {
    var places = placeValues(width || bits.length);
    var sum = 0;
    for (var i = 0; i < places.length; i += 1) {
      if (bits[i]) sum += places[i];
    }
    return sum;
  }

  function expression(value, width) {
    var places = placeValues(width);
    var n = value | 0;
    var parts = places.filter(function (bit) {
      return (n & bit) === bit;
    });
    return parts.length ? parts.join(' + ') : '0';
  }

  function streakMultiplier(streak) {
    var n = streak | 0;
    if (n < 1) return 1;
    return Math.min(n, 5);
  }

  function differingIndexes(bits, value, width) {
    var target = bitsFor(value, width);
    var indexes = [];
    for (var i = 0; i < bits.length; i += 1) {
      if ((bits[i] ? 1 : 0) !== target[i]) indexes.push(i);
    }
    return indexes;
  }

  function isBuilding(bits, value, width) {
    if (valueOf(bits, width) === value) return false;
    var target = bitsFor(value, width);
    for (var i = 0; i < bits.length; i += 1) {
      if (bits[i] && !target[i]) return false;
    }
    return true;
  }

  function bitLesson(bits, value, width) {
    var sum = valueOf(bits, width);
    return 'You set ' + expression(sum, width) + ' = ' + sum +
      ' (hex ' + toHex(sum, width) + '). Target ' + toHex(value, width) +
      ' = ' + expression(value, width);
  }

  function hexLesson(value, width) {
    return toHex(value, width) + '₁₆ = ' + expression(value, width) + ' = ' + value;
  }

  function digitIndex(value, width) {
    if (width === 4) return value & 15;
    return value & 15; // low nibble as primary weak-spot signal
  }

  function addMisses(misses, indexes) {
    var next = (misses || emptyMisses()).slice();
    indexes.forEach(function (index) {
      if (index >= 0 && index < next.length) next[index] = (next[index] || 0) + 1;
    });
    return next;
  }

  function weakSpotText(misses) {
    var ranked = HEX_DIGITS.map(function (digit, index) {
      return { digit: digit, count: misses && misses[index] ? misses[index] : 0 };
    }).filter(function (item) {
      return item.count > 0;
    }).sort(function (a, b) {
      return b.count - a.count || a.digit.localeCompare(b.digit);
    }).slice(0, 2);
    if (!ranked.length) return '';
    var names = ranked.map(function (item) { return item.digit; });
    if (names.length === 1) return 'Weak spots: hex ' + names[0];
    return 'Weak spots: hex ' + names[0] + ' and ' + names[1];
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

  function chooseMode(state, random) {
    var bits = state.spawnedBits || 0;
    var hexes = state.spawnedHex || 0;
    if (bits < hexes) return 'bits';
    if (hexes < bits) return 'hex';
    return random() < BITS_BIAS ? 'bits' : 'hex';
  }

  function blankRow(id, mode, value, width, now) {
    return {
      id: id,
      mode: mode,
      value: value,
      width: width,
      bits: mode === 'bits' ? placeValues(width).map(function () { return 0; }) : bitsFor(value, width),
      draft: '',
      wrong: false,
      retries: 0,
      phase: 'play',
      feedback: '',
      wrongIndexes: [],
      spawnedAt: typeof now === 'number' ? now : null,
      heldMs: 0,
      holdStarted: null
    };
  }

  function createGame(saved) {
    var highScores = emptyHighScores();
    var legacy = 0;
    if (saved && typeof saved === 'object') {
      highScores = copyHighScores(saved.highScores || saved);
      var carried = Number(saved.highScore);
      if (Number.isFinite(carried) && carried > 0) legacy = Math.floor(carried);
    }
    return {
      status: 'ready',
      rows: [],
      score: 0,
      streak: 0,
      bestStreak: 0,
      cleanRows: 0,
      solved: 0,
      highScore: legacy,
      highScores: highScores,
      racing: false,
      choosing: false,
      limitSec: 0,
      remainingMs: 0,
      solveTimes: [],
      endedBy: '',
      pauseStarted: null,
      nextId: 1,
      lastValue: null,
      misses: emptyMisses(),
      guide: false,
      spawnedBits: 0,
      spawnedHex: 0
    };
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
      width: patch.width != null ? patch.width : row.width,
      bits: bits,
      draft: patch.draft != null ? patch.draft : row.draft,
      wrong: patch.wrong != null ? patch.wrong : row.wrong,
      retries: patch.retries != null ? patch.retries : (row.retries || 0),
      phase: patch.phase || row.phase || 'play',
      feedback: patch.feedback != null ? patch.feedback : (row.feedback || ''),
      wrongIndexes: wrongIndexes,
      spawnedAt: patch.spawnedAt !== undefined ? patch.spawnedAt : (row.spawnedAt != null ? row.spawnedAt : null),
      heldMs: patch.heldMs != null ? patch.heldMs : (row.heldMs || 0),
      holdStarted: patch.holdStarted !== undefined ? patch.holdStarted : (row.holdStarted != null ? row.holdStarted : null)
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
      cleanRows: patch.cleanRows != null ? patch.cleanRows : (state.cleanRows || 0),
      solved: patch.solved != null ? patch.solved : state.solved,
      highScore: patch.highScore != null ? patch.highScore : state.highScore,
      highScores: patch.highScores ? copyHighScores(patch.highScores) : copyHighScores(state.highScores),
      racing: patch.racing != null ? patch.racing : !!state.racing,
      choosing: patch.choosing != null ? patch.choosing : !!state.choosing,
      limitSec: patch.limitSec != null ? patch.limitSec : (state.limitSec || 0),
      remainingMs: patch.remainingMs != null ? patch.remainingMs : (state.remainingMs || 0),
      solveTimes: patch.solveTimes ? patch.solveTimes.slice() : (state.solveTimes ? state.solveTimes.slice() : []),
      endedBy: patch.endedBy != null ? patch.endedBy : (state.endedBy || ''),
      pauseStarted: patch.pauseStarted !== undefined ? patch.pauseStarted : (state.pauseStarted != null ? state.pauseStarted : null),
      nextId: patch.nextId != null ? patch.nextId : state.nextId,
      lastValue: patch.lastValue !== undefined ? patch.lastValue : state.lastValue,
      misses: misses,
      guide: patch.guide != null ? patch.guide : !!state.guide,
      spawnedBits: patch.spawnedBits != null ? patch.spawnedBits : (state.spawnedBits || 0),
      spawnedHex: patch.spawnedHex != null ? patch.spawnedHex : (state.spawnedHex || 0)
    };
  }

  function elapsedMs(row, state, now) {
    if (!row || typeof now !== 'number' || typeof row.spawnedAt !== 'number') return null;
    var held = row.heldMs || 0;
    if (typeof row.holdStarted === 'number') held += Math.max(0, now - row.holdStarted);
    if (state && typeof state.pauseStarted === 'number') held += Math.max(0, now - state.pauseStarted);
    return Math.max(0, now - row.spawnedAt - held);
  }

  function bumpHigh(state) {
    var scores = copyHighScores(state.highScores);
    var limit = state.limitSec | 0;
    if (!state.racing || !scores.hasOwnProperty(limit)) return scores;
    scores[limit] = Math.max(scores[limit] || 0, state.score | 0);
    return scores;
  }

  function awardClear(state, ids, now) {
    var events = [];
    var kept = state.rows.filter(function (row) {
      return ids.indexOf(row.id) === -1;
    });
    var next = copyState(state, { rows: kept });

    ids.forEach(function (id) {
      var source = findRow(state, id);
      var partial = !!(source && source.retries > 0);
      var elapsed = elapsedMs(source, state, now);
      var streak = partial ? next.streak : next.streak + 1;
      var gained = partial ? partialForTime(elapsed) : pointsForTime(elapsed);
      var score = next.score + gained;
      var cleanRows = next.cleanRows || 0;
      var times = (next.solveTimes || []).slice();
      if (typeof elapsed === 'number') times.push(elapsed);
      var choosing = false;
      if (!partial) {
        cleanRows += 1;
        if (!next.racing && cleanRows >= WARMUP_ROWS) choosing = true;
      }
      var highScores = next.highScores;
      var highScore = next.highScore;
      if (next.racing) {
        highScores = copyHighScores(next.highScores);
        var limit = next.limitSec | 0;
        if (highScores.hasOwnProperty(limit)) {
          highScores[limit] = Math.max(highScores[limit] || 0, score);
          highScore = highScores[limit];
        }
      }
      events.push({
        type: 'solved',
        rowId: id,
        gained: gained,
        score: score,
        partial: partial,
        elapsed: elapsed,
        multiplier: streakMultiplier(streak)
      });
      if (choosing) events.push({ type: 'choose' });
      next = copyState(next, {
        score: score,
        streak: streak,
        bestStreak: Math.max(next.bestStreak, streak),
        cleanRows: cleanRows,
        solved: next.solved + 1,
        highScore: highScore,
        highScores: highScores,
        solveTimes: times,
        guide: false,
        choosing: choosing || next.choosing,
        status: choosing ? 'choose' : next.status
      });
    });

    return { state: next, events: events };
  }

  function settleBits(state, now) {
    var solvedIds = state.rows.filter(function (row) {
      return row.mode === 'bits' && row.phase === 'play' && valueOf(row.bits, row.width) === row.value;
    }).map(function (row) {
      return row.id;
    });
    if (!solvedIds.length) return { state: state, events: [] };
    return awardClear(state, solvedIds, now);
  }

  function beginMiss(state, row, indexes, feedback, digitMisses, now) {
    var retries = (row.retries || 0) + 1;
    var misses = addMisses(state.misses, digitMisses || []);
    if (retries >= 2) {
      var revealedBits = row.mode === 'bits' ? bitsFor(row.value, row.width) : row.bits.slice();
      var rows = state.rows.map(function (item) {
        if (item.id !== row.id) return item;
        return copyRow(item, {
          bits: revealedBits,
          phase: 'reveal',
          retries: retries,
          feedback: feedback,
          wrongIndexes: indexes,
          wrong: true,
          draft: '',
          holdStarted: typeof now === 'number' ? now : null
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
        wrong: true,
        holdStarted: typeof now === 'number' ? now : null
      });
    });
    return {
      state: copyState(state, { rows: teaching, misses: misses, streak: 0 }),
      events: [{ type: 'teach', rowId: row.id, feedback: feedback }],
      result: 'teach'
    };
  }

  function spawnRow(state, rng, now) {
    var random = rng || Math.random;
    if (state.status !== 'playing') return { state: state, events: [] };
    if (state.guide && state.rows.length) return { state: state, events: [] };
    if (state.rows.length >= MAX_ROWS) {
      var highScores = state.racing ? bumpHigh(state) : copyHighScores(state.highScores);
      var highScore = state.racing ? (highScores[state.limitSec] || state.score) : state.highScore;
      return {
        state: copyState(state, {
          status: 'over',
          endedBy: 'column',
          highScores: highScores,
          highScore: highScore
        }),
        events: [{ type: 'over', score: state.score, highScore: highScore, endedBy: 'column' }]
      };
    }
    var width = widthFor(state);
    var cap = valueCap(state);
    var value = randomValue(cap, random, state.lastValue);
    var mode = chooseMode(state, random);
    if (mode === 'bits' && value === 0) value = state.lastValue === 1 && cap > 1 ? 2 : 1;
    var row = blankRow(state.nextId, mode, value, width, now);
    return {
      state: copyState(state, {
        rows: state.rows.concat(row),
        nextId: state.nextId + 1,
        lastValue: value,
        spawnedBits: (state.spawnedBits || 0) + (mode === 'bits' ? 1 : 0),
        spawnedHex: (state.spawnedHex || 0) + (mode === 'hex' ? 1 : 0)
      }),
      events: [{ type: 'spawn', rowId: row.id, mode: mode, width: width }]
    };
  }

  function spawnGuide(state, now) {
    var row = blankRow(state.nextId, 'bits', GUIDE_VALUE, 4, now);
    return {
      state: copyState(state, {
        rows: [row],
        nextId: state.nextId + 1,
        lastValue: GUIDE_VALUE,
        guide: true,
        spawnedBits: 1,
        spawnedHex: 0
      }),
      events: [{ type: 'spawn', rowId: row.id, mode: 'bits', width: 4, guide: true }]
    };
  }

  function startGame(previous, rng, options) {
    var guide = !!(options && options.guide);
    var now = options && typeof options.now === 'number' ? options.now : undefined;
    var misses = previous && previous.misses && previous.misses.length
      ? previous.misses.slice()
      : emptyMisses();
    var fresh = copyState(createGame({
      highScore: previous && previous.highScore ? previous.highScore : 0,
      highScores: previous && previous.highScores
    }), {
      status: 'playing',
      misses: misses,
      guide: guide
    });
    if (guide) return spawnGuide(fresh, now);
    return spawnRow(fresh, rng || Math.random, now);
  }

  function beginRace(state, limitSec, rng, now) {
    var limit = limitSec | 0;
    if (TIME_LIMITS.indexOf(limit) < 0) return { state: state, events: [] };
    if (state.status !== 'choose') return { state: state, events: [] };
    var fresh = copyState(state, {
      status: 'playing',
      racing: true,
      choosing: false,
      limitSec: limit,
      remainingMs: limit * 1000,
      score: 0,
      streak: 0,
      bestStreak: 0,
      solved: 0,
      cleanRows: Math.max(state.cleanRows || 0, 4),
      rows: [],
      guide: false,
      endedBy: ''
    });
    var spawned = spawnRow(fresh, rng || Math.random, now);
    spawned.events.unshift({ type: 'race', limitSec: limit });
    return spawned;
  }

  function finishRace(state) {
    if (!state.racing || state.status !== 'playing') return { state: state, events: [] };
    var highScores = bumpHigh(state);
    return {
      state: copyState(state, {
        status: 'over',
        endedBy: 'time',
        remainingMs: 0,
        highScores: highScores,
        highScore: highScores[state.limitSec] || state.score
      }),
      events: [{ type: 'over', score: state.score, endedBy: 'time' }]
    };
  }

  function toggleBit(state, rowId, index, now) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var current = findRow(state, rowId);
    if (!current || current.mode !== 'bits' || current.phase !== 'play') {
      return { state: state, events: [] };
    }
    if (index < 0 || index >= current.bits.length) return { state: state, events: [] };
    var bits = current.bits.slice();
    bits[index] = bits[index] ? 0 : 1;
    var updated = copyRow(current, { bits: bits, wrong: false, wrongIndexes: [] });
    var rows = state.rows.map(function (row) {
      return row.id === rowId ? updated : row;
    });
    var withBits = copyState(state, { rows: rows });
    if (valueOf(bits, current.width) === current.value) return settleBits(withBits, now);
    if (isBuilding(bits, current.value, current.width)) return { state: withBits, events: [] };
    return beginMiss(
      withBits,
      updated,
      differingIndexes(bits, current.value, current.width),
      bitLesson(bits, current.value, current.width),
      [digitIndex(current.value, current.width)],
      now
    );
  }

  function setDraft(state, rowId, draft) {
    if (state.status !== 'playing') return { state: state, events: [] };
    var row = findRow(state, rowId);
    if (!row || row.mode !== 'hex' || row.phase !== 'play') return { state: state, events: [] };
    var need = row.width === 4 ? 1 : 2;
    var clean = String(draft == null ? '' : draft).toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, need);
    if (row.draft === clean && row.wrong === false) return { state: state, events: [] };
    var rows = state.rows.map(function (item) {
      if (item.id !== rowId) return item;
      return copyRow(item, { draft: clean, wrong: false });
    });
    return { state: copyState(state, { rows: rows }), events: [] };
  }

  function submitHex(state, rowId, now) {
    if (state.status !== 'playing') return { state: state, events: [], result: 'ignore' };
    var row = findRow(state, rowId);
    if (!row || row.mode !== 'hex' || row.phase !== 'play') {
      return { state: state, events: [], result: 'ignore' };
    }
    if (row.draft === '') return { state: state, events: [], result: 'ignore' };
    var guessed = parseHex(row.draft, row.width);
    if (guessed == null) return { state: state, events: [], result: 'ignore' };
    if (guessed === row.value) {
      var cleared = awardClear(state, [rowId], now);
      cleared.result = 'correct';
      return cleared;
    }
    var indexes = bitsFor(row.value, row.width).reduce(function (list, bit, index) {
      if (bit) list.push(index);
      return list;
    }, []);
    var missed = beginMiss(
      state,
      row,
      indexes,
      hexLesson(row.value, row.width),
      [digitIndex(row.value, row.width)],
      now
    );
    missed.result = missed.result === 'reveal' ? 'reveal' : 'wrong';
    return missed;
  }

  function releaseHold(state, rowId, now) {
    var row = findRow(state, rowId);
    if (!row) return { state: state, events: [] };
    if (row.phase === 'teach') {
      var rows = state.rows.map(function (item) {
        if (item.id !== rowId) return item;
        var heldMs = item.heldMs || 0;
        if (typeof now === 'number' && typeof item.holdStarted === 'number') {
          heldMs += Math.max(0, now - item.holdStarted);
        }
        return copyRow(item, {
          phase: 'play',
          bits: item.mode === 'bits' ? placeValues(item.width).map(function () { return 0; }) : item.bits,
          draft: '',
          wrong: false,
          wrongIndexes: item.mode === 'hex' ? item.wrongIndexes : [],
          feedback: item.feedback,
          heldMs: heldMs,
          holdStarted: null
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
        var again = blankRow(state.nextId, 'bits', GUIDE_VALUE, 4, now);
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

  function pauseGame(state, now) {
    if (state.status !== 'playing') return { state: state, events: [] };
    return {
      state: copyState(state, {
        status: 'paused',
        pauseStarted: typeof now === 'number' ? now : null
      }),
      events: [{ type: 'paused' }]
    };
  }

  function resumeGame(state, now) {
    if (state.status !== 'paused') return { state: state, events: [] };
    var delta = typeof now === 'number' && typeof state.pauseStarted === 'number'
      ? Math.max(0, now - state.pauseStarted)
      : 0;
    var rows = delta
      ? state.rows.map(function (row) {
        return copyRow(row, { heldMs: (row.heldMs || 0) + delta });
      })
      : state.rows;
    return {
      state: copyState(state, { status: 'playing', rows: rows, pauseStarted: null }),
      events: [{ type: 'resumed' }]
    };
  }

  return {
    BYTE_VALUES: BYTE_VALUES,
    NIBBLE_VALUES: NIBBLE_VALUES,
    HEX_DIGITS: HEX_DIGITS,
    MAX_ROWS: MAX_ROWS,
    WARMUP_ROWS: WARMUP_ROWS,
    WARMUP_SPAWN_MS: WARMUP_SPAWN_MS,
    TIME_LIMITS: TIME_LIMITS,
    GUIDE_VALUE: GUIDE_VALUE,
    createGame: createGame,
    startGame: startGame,
    beginRace: beginRace,
    finishRace: finishRace,
    spawnRow: spawnRow,
    spawnDelay: spawnDelay,
    toggleBit: toggleBit,
    setDraft: setDraft,
    submitHex: submitHex,
    releaseHold: releaseHold,
    pauseGame: pauseGame,
    resumeGame: resumeGame,
    bitsFor: bitsFor,
    valueOf: valueOf,
    placeValues: placeValues,
    toHex: toHex,
    parseHex: parseHex,
    expression: expression,
    widthFor: widthFor,
    valueCap: valueCap,
    pointsForTime: pointsForTime,
    partialForTime: partialForTime,
    limitLabel: limitLabel,
    streakMultiplier: streakMultiplier,
    weakSpotText: weakSpotText,
    emptyHighScores: emptyHighScores,
    copyHighScores: copyHighScores
  };
});
