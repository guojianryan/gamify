// Pure rules for Logic Gate Lab.
// Circuits and target expressions are the same AST shape. Matching is by
// truth-table behaviour, not structure. Scoring, unlock and the puzzle bank
// live here so the UI and the tests share one source of truth.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GateLogic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GATES = Object.freeze({
    AND: { arity: 2, label: 'AND', meaning: '1 only if both inputs are 1' },
    OR: { arity: 2, label: 'OR', meaning: '1 if either input is 1' },
    NOT: { arity: 1, label: 'NOT', meaning: 'Flips 0 to 1 and 1 to 0' },
    XOR: { arity: 2, label: 'XOR', meaning: '1 if the inputs differ' },
    NAND: { arity: 2, label: 'NAND', meaning: 'NOT of AND — 0 only if both are 1' },
    NOR: { arity: 2, label: 'NOR', meaning: 'NOT of OR — 1 only if both are 0' }
  });

  var LEVEL1_GATES = Object.freeze(['AND', 'OR', 'NOT']);
  var LEVEL2_GATES = Object.freeze(['AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR']);
  var UNLOCK_SOLVES = 6;
  var HINT_COST = 15;
  var BASE_SCORE = 100;
  var SPEED_BONUS_MAX = 50;

  // Curated puzzles. `ast` is the target expression. `inputs` names the wires.
  // `band` drives ordering inside a level: 0 easy, 1 medium, 2 hard.
  // `fastMs` is the gentle speed window for the bonus meter.
  var PUZZLES = Object.freeze([
    // Level 1 — easy
    { id: 'l1-and', level: 1, band: 0, inputs: ['A', 'B'], fastMs: 75000, ast: and(inA(), inB()) },
    { id: 'l1-or', level: 1, band: 0, inputs: ['A', 'B'], fastMs: 75000, ast: or(inA(), inB()) },
    { id: 'l1-not', level: 1, band: 0, inputs: ['A'], fastMs: 60000, ast: not(inA()) },
    { id: 'l1-not-b', level: 1, band: 0, inputs: ['A', 'B'], fastMs: 70000, ast: not(inB()) },
    { id: 'l1-and-c', level: 1, band: 0, inputs: ['A', 'B', 'C'], fastMs: 80000, ast: and(inA(), inC()) },
    // Level 1 — medium
    { id: 'l1-not-and', level: 1, band: 1, inputs: ['A', 'B'], fastMs: 90000, ast: not(and(inA(), inB())) },
    { id: 'l1-not-or', level: 1, band: 1, inputs: ['A', 'B'], fastMs: 90000, ast: not(or(inA(), inB())) },
    { id: 'l1-and-not', level: 1, band: 1, inputs: ['A', 'B'], fastMs: 90000, ast: and(not(inA()), inB()) },
    { id: 'l1-or-not', level: 1, band: 1, inputs: ['A', 'B'], fastMs: 90000, ast: or(inA(), not(inB())) },
    { id: 'l1-a-or-b-and-c', level: 1, band: 1, inputs: ['A', 'B', 'C'], fastMs: 100000, ast: or(inA(), and(inB(), inC())) },
    { id: 'l1-a-and-b-or-c', level: 1, band: 1, inputs: ['A', 'B', 'C'], fastMs: 100000, ast: or(and(inA(), inB()), inC()) },
    { id: 'l1-not-a-or-b', level: 1, band: 1, inputs: ['A', 'B'], fastMs: 90000, ast: or(not(inA()), inB()) },
    // Level 1 — hard
    { id: 'l1-demux', level: 1, band: 2, inputs: ['A', 'B', 'C'], fastMs: 120000, ast: or(and(inA(), not(inB())), and(not(inA()), inC())) },
    { id: 'l1-nand-shape', level: 1, band: 2, inputs: ['A', 'B'], fastMs: 110000, ast: or(not(inA()), not(inB())) },
    { id: 'l1-nor-shape', level: 1, band: 2, inputs: ['A', 'B'], fastMs: 110000, ast: and(not(inA()), not(inB())) },
    { id: 'l1-triple', level: 1, band: 2, inputs: ['A', 'B', 'C'], fastMs: 120000, ast: and(or(inA(), inB()), not(inC())) },
    { id: 'l1-nested', level: 1, band: 2, inputs: ['A', 'B', 'C'], fastMs: 130000, ast: not(or(and(inA(), inB()), inC())) },
    { id: 'l1-xor-shape', level: 1, band: 2, inputs: ['A', 'B'], fastMs: 120000, ast: or(and(inA(), not(inB())), and(not(inA()), inB())) },
    // Level 2 — easy
    { id: 'l2-xor', level: 2, band: 0, inputs: ['A', 'B'], fastMs: 80000, ast: xor(inA(), inB()) },
    { id: 'l2-nand', level: 2, band: 0, inputs: ['A', 'B'], fastMs: 80000, ast: nand(inA(), inB()) },
    { id: 'l2-nor', level: 2, band: 0, inputs: ['A', 'B'], fastMs: 80000, ast: nor(inA(), inB()) },
    { id: 'l2-not-xor', level: 2, band: 0, inputs: ['A', 'B'], fastMs: 90000, ast: not(xor(inA(), inB())) },
    // Level 2 — medium
    { id: 'l2-xor-c', level: 2, band: 1, inputs: ['A', 'B', 'C'], fastMs: 100000, ast: or(xor(inA(), inB()), inC()) },
    { id: 'l2-nand-or', level: 2, band: 1, inputs: ['A', 'B', 'C'], fastMs: 100000, ast: or(nand(inA(), inB()), inC()) },
    { id: 'l2-nor-and', level: 2, band: 1, inputs: ['A', 'B', 'C'], fastMs: 100000, ast: and(nor(inA(), inB()), inC()) },
    { id: 'l2-xor-and', level: 2, band: 1, inputs: ['A', 'B', 'C'], fastMs: 110000, ast: and(xor(inA(), inB()), inC()) },
    { id: 'l2-nand-not', level: 2, band: 1, inputs: ['A', 'B'], fastMs: 95000, ast: nand(not(inA()), inB()) },
    { id: 'l2-a-xor-not-b', level: 2, band: 1, inputs: ['A', 'B'], fastMs: 95000, ast: xor(inA(), not(inB())) },
    // Level 2 — hard
    { id: 'l2-mux', level: 2, band: 2, inputs: ['A', 'B', 'C'], fastMs: 130000, ast: or(and(inA(), not(inC())), and(inB(), inC())) },
    { id: 'l2-xor-nand', level: 2, band: 2, inputs: ['A', 'B', 'C'], fastMs: 130000, ast: xor(nand(inA(), inB()), inC()) },
    { id: 'l2-nor-xor', level: 2, band: 2, inputs: ['A', 'B', 'C'], fastMs: 130000, ast: nor(xor(inA(), inB()), inC()) },
    { id: 'l2-nested', level: 2, band: 2, inputs: ['A', 'B', 'C'], fastMs: 140000, ast: nand(or(inA(), inB()), xor(inB(), inC())) },
    { id: 'l2-de-morgan', level: 2, band: 2, inputs: ['A', 'B'], fastMs: 120000, ast: nor(not(inA()), not(inB())) },
    { id: 'l2-chain', level: 2, band: 2, inputs: ['A', 'B', 'C'], fastMs: 140000, ast: xor(and(inA(), inB()), nor(inB(), inC())) }
  ]);

  function inA() { return { type: 'input', name: 'A' }; }
  function inB() { return { type: 'input', name: 'B' }; }
  function inC() { return { type: 'input', name: 'C' }; }
  function gate(op, inputs) { return { type: 'gate', op: op, inputs: inputs }; }
  function and(a, b) { return gate('AND', [a, b]); }
  function or(a, b) { return gate('OR', [a, b]); }
  function not(a) { return gate('NOT', [a]); }
  function xor(a, b) { return gate('XOR', [a, b]); }
  function nand(a, b) { return gate('NAND', [a, b]); }
  function nor(a, b) { return gate('NOR', [a, b]); }

  function cloneAst(node) {
    if (!node) return null;
    if (node.type === 'input') return { type: 'input', name: node.name };
    return {
      type: 'gate',
      op: node.op,
      inputs: (node.inputs || []).map(cloneAst)
    };
  }

  function emptyCircuit() {
    return null;
  }

  function gateArity(op) {
    var info = GATES[op];
    return info ? info.arity : 0;
  }

  function gatesForLevel(level) {
    return level >= 2 ? LEVEL2_GATES.slice() : LEVEL1_GATES.slice();
  }

  function applyGate(op, values) {
    var a = values[0] ? 1 : 0;
    var b = values.length > 1 ? (values[1] ? 1 : 0) : 0;
    switch (op) {
      case 'AND': return a & b;
      case 'OR': return a | b;
      case 'NOT': return a ^ 1;
      case 'XOR': return a ^ b;
      case 'NAND': return (a & b) ^ 1;
      case 'NOR': return (a | b) ^ 1;
      default: return 0;
    }
  }

  function evaluate(ast, env) {
    if (!ast) return null;
    if (ast.type === 'input') {
      return env[ast.name] ? 1 : 0;
    }
    if (ast.type !== 'gate' || !GATES[ast.op]) return null;
    var arity = gateArity(ast.op);
    if (!ast.inputs || ast.inputs.length !== arity) return null;
    var values = [];
    for (var i = 0; i < arity; i += 1) {
      var v = evaluate(ast.inputs[i], env);
      if (v === null) return null;
      values.push(v);
    }
    return applyGate(ast.op, values);
  }

  function isComplete(ast) {
    if (!ast) return false;
    if (ast.type === 'input') return typeof ast.name === 'string' && ast.name.length > 0;
    if (ast.type !== 'gate' || !GATES[ast.op]) return false;
    var arity = gateArity(ast.op);
    if (!ast.inputs || ast.inputs.length !== arity) return false;
    return ast.inputs.every(isComplete);
  }

  function combinations(inputs) {
    var names = inputs.slice();
    var n = names.length;
    var rows = [];
    var total = 1 << n;
    for (var mask = 0; mask < total; mask += 1) {
      var env = {};
      var bits = [];
      for (var i = 0; i < n; i += 1) {
        var bit = (mask >> (n - 1 - i)) & 1;
        env[names[i]] = bit;
        bits.push(bit);
      }
      rows.push({ env: env, bits: bits, mask: mask });
    }
    return rows;
  }

  function truthTable(ast, inputs) {
    return combinations(inputs).map(function (row) {
      return {
        bits: row.bits.slice(),
        env: Object.assign({}, row.env),
        out: evaluate(ast, row.env)
      };
    });
  }

  function compareBehaviour(targetAst, circuitAst, inputs) {
    var expected = truthTable(targetAst, inputs);
    var actual = truthTable(circuitAst, inputs);
    var mismatches = [];
    for (var i = 0; i < expected.length; i += 1) {
      if (expected[i].out !== actual[i].out) {
        mismatches.push({
          bits: expected[i].bits.slice(),
          env: Object.assign({}, expected[i].env),
          expected: expected[i].out,
          actual: actual[i].out
        });
      }
    }
    return {
      match: mismatches.length === 0 && isComplete(circuitAst),
      mismatches: mismatches,
      expected: expected,
      actual: actual
    };
  }

  // Nested gates are always bracketed so precedence stays obvious in class.
  function formatChild(child, forNot) {
    if (!child) return '?';
    if (child.type === 'input') return child.name;
    // Nested gates are bracketed so precedence stays obvious in class.
    if (forNot || child.type === 'gate') {
      return '(' + formatAst(child) + ')';
    }
    return formatAst(child);
  }

  function formatAst(ast) {
    if (!ast) return '?';
    if (ast.type === 'input') return ast.name;
    var op = ast.op;
    if (op === 'NOT') {
      var child = ast.inputs[0];
      if (child && child.type === 'input') return 'NOT ' + child.name;
      return 'NOT ' + formatChild(child, true);
    }
    return formatChild(ast.inputs[0], false) + ' ' + op + ' ' + formatChild(ast.inputs[1], false);
  }

  function outermostOp(ast) {
    if (!ast || ast.type !== 'gate') return null;
    return ast.op;
  }

  function pathGet(ast, path) {
    if (!path || path.length === 0) return ast;
    var node = ast;
    for (var i = 0; i < path.length; i += 1) {
      if (!node || node.type !== 'gate' || !node.inputs) return null;
      node = node.inputs[path[i]];
    }
    return node;
  }

  function pathSet(ast, path, value) {
    if (!path || path.length === 0) return cloneAst(value);
    var root = cloneAst(ast);
    if (!root || root.type !== 'gate') return root;
    var node = root;
    for (var i = 0; i < path.length - 1; i += 1) {
      if (!node.inputs || !node.inputs[path[i]] || node.inputs[path[i]].type !== 'gate') {
        return root;
      }
      node = node.inputs[path[i]];
    }
    var index = path[path.length - 1];
    if (!node.inputs || index < 0 || index >= node.inputs.length) return root;
    node.inputs[index] = cloneAst(value);
    return root;
  }

  function makeGateNode(op) {
    var arity = gateArity(op);
    var inputs = [];
    for (var i = 0; i < arity; i += 1) inputs.push(null);
    return { type: 'gate', op: op, inputs: inputs };
  }

  function placeAt(ast, path, choice) {
    var value = null;
    if (choice && choice.kind === 'input') {
      value = { type: 'input', name: choice.name };
    } else if (choice && choice.kind === 'gate') {
      value = makeGateNode(choice.op);
    } else if (choice && choice.kind === 'clear') {
      value = null;
    } else {
      return ast;
    }
    if (!path || path.length === 0) return value;
    // Growing an incomplete tree: ensure ancestors exist is the caller's job;
    // pathSet only replaces an existing slot.
    if (!ast) return ast;
    return pathSet(ast, path, value);
  }

  function speedBonus(elapsedMs, fastMs, relaxed) {
    if (relaxed) return SPEED_BONUS_MAX;
    var windowMs = Math.max(1, fastMs | 0);
    var elapsed = Math.max(0, elapsedMs);
    if (elapsed >= windowMs) return 0;
    return Math.round(SPEED_BONUS_MAX * (1 - elapsed / windowMs));
  }

  function scoreForSolve(options) {
    var opts = options || {};
    var difficulty = opts.band | 0;
    var base = BASE_SCORE + difficulty * 20;
    var bonus = speedBonus(opts.elapsedMs || 0, opts.fastMs || 90000, !!opts.relaxed);
    var hintPenalty = opts.usedHint ? HINT_COST : 0;
    var total = Math.max(0, base + bonus - hintPenalty);
    return {
      base: base,
      speedBonus: bonus,
      hintPenalty: hintPenalty,
      total: total
    };
  }

  function puzzlesForLevel(level) {
    return PUZZLES.filter(function (p) { return p.level === level; });
  }

  function shuffle(list, rng) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // Draw the next puzzle: prefer unseen ids, walk bands 0→1→2, then reshuffle.
  function pickPuzzle(level, seenIds, rng) {
    var pool = puzzlesForLevel(level);
    var unseen = pool.filter(function (p) { return seenIds.indexOf(p.id) === -1; });
    var source = unseen.length ? unseen : pool;
    for (var band = 0; band <= 2; band += 1) {
      var bandPool = source.filter(function (p) { return p.band === band; });
      if (bandPool.length) {
        var picked = bandPool[Math.floor(rng() * bandPool.length)];
        return Object.assign({}, picked, { ast: cloneAst(picked.ast) });
      }
    }
    var fallback = source[Math.floor(rng() * source.length)];
    return Object.assign({}, fallback, { ast: cloneAst(fallback.ast) });
  }

  function createProgress(saved) {
    var data = saved && typeof saved === 'object' ? saved : {};
    return {
      level1Solves: Math.max(0, data.level1Solves | 0),
      level2Unlocked: !!data.level2Unlocked,
      sessionLevel2: !!data.sessionLevel2,
      highScore: Math.max(0, data.highScore | 0),
      seen: Array.isArray(data.seen) ? data.seen.slice() : [],
      relaxed: !!data.relaxed
    };
  }

  function isLevel2Open(progress) {
    return !!(progress.level2Unlocked || progress.sessionLevel2);
  }

  function unlockProgress(progress) {
    var solves = progress.level1Solves | 0;
    return {
      solves: solves,
      needed: UNLOCK_SOLVES,
      remaining: Math.max(0, UNLOCK_SOLVES - solves),
      unlocked: solves >= UNLOCK_SOLVES || !!progress.level2Unlocked
    };
  }

  function recordSolve(progress, level, score) {
    var next = createProgress(progress);
    if (level === 1) {
      next.level1Solves += 1;
      if (next.level1Solves >= UNLOCK_SOLVES) next.level2Unlocked = true;
    }
    if (score > next.highScore) next.highScore = score;
    return next;
  }

  function markSeen(progress, puzzleId) {
    var next = createProgress(progress);
    if (next.seen.indexOf(puzzleId) === -1) next.seen.push(puzzleId);
    return next;
  }

  function createRound(options) {
    var opts = options || {};
    var level = opts.level === 2 ? 2 : 1;
    var progress = createProgress(opts.progress);
    if (level === 2 && !isLevel2Open(progress)) {
      return { ok: false, reason: 'locked', progress: progress };
    }
    var puzzle = pickPuzzle(level, progress.seen, opts.rng || Math.random);
    progress = markSeen(progress, puzzle.id);
    return {
      ok: true,
      progress: progress,
      round: {
        status: 'building',
        level: level,
        puzzle: puzzle,
        circuit: emptyCircuit(),
        usedHint: false,
        hintText: null,
        score: opts.score | 0,
        streak: opts.streak | 0,
        solvedThisRound: opts.solvedThisRound | 0,
        relaxed: !!opts.relaxed,
        startedAt: opts.now || 0,
        elapsedMs: 0,
        lastCheck: null,
        celebrate: false
      }
    };
  }

  function checkCircuit(round, elapsedMs) {
    if (!round || !round.puzzle) return round;
    var comparison = compareBehaviour(round.puzzle.ast, round.circuit, round.puzzle.inputs);
    var next = Object.assign({}, round, {
      elapsedMs: Math.max(0, elapsedMs | 0),
      celebrate: false
    });

    if (!isComplete(round.circuit)) {
      next.lastCheck = {
        ok: false,
        reason: 'incomplete',
        message: 'Your circuit still has empty ports. Fill every input before checking.',
        mismatches: []
      };
      next.status = 'building';
      return next;
    }

    if (!comparison.match) {
      var shown = comparison.mismatches.slice(0, 3).map(function (row) {
        var bits = round.puzzle.inputs.map(function (name, i) {
          return name + '=' + row.bits[i];
        }).join(', ');
        return bits + ' → you got ' + row.actual + ', expression wants ' + row.expected;
      });
      next.lastCheck = {
        ok: false,
        reason: 'mismatch',
        message: 'The truth tables do not match yet.',
        detail: shown,
        mismatches: comparison.mismatches
      };
      next.status = 'building';
      next.streak = 0;
      return next;
    }

    var scored = scoreForSolve({
      band: round.puzzle.band,
      elapsedMs: next.elapsedMs,
      fastMs: round.puzzle.fastMs,
      relaxed: round.relaxed,
      usedHint: round.usedHint
    });
    next.lastCheck = {
      ok: true,
      reason: 'match',
      message: 'Matched! The circuit and the expression share the same truth table.',
      score: scored,
      mismatches: []
    };
    next.status = 'matched';
    next.celebrate = true;
    next.score = (round.score | 0) + scored.total;
    next.streak = (round.streak | 0) + 1;
    next.solvedThisRound = (round.solvedThisRound | 0) + 1;
    return next;
  }

  function applyHint(round) {
    if (!round || round.usedHint || !round.puzzle) return round;
    var op = outermostOp(round.puzzle.ast);
    return Object.assign({}, round, {
      usedHint: true,
      hintText: op
        ? 'The outermost gate of the expression is ' + op + '.'
        : 'Start from the output and work inward.'
    });
  }

  function serializeProgress(progress) {
    var p = createProgress(progress);
    return {
      level1Solves: p.level1Solves,
      level2Unlocked: p.level2Unlocked,
      highScore: p.highScore,
      seen: p.seen.slice(-80),
      relaxed: p.relaxed
    };
  }

  return {
    GATES: GATES,
    LEVEL1_GATES: LEVEL1_GATES,
    LEVEL2_GATES: LEVEL2_GATES,
    UNLOCK_SOLVES: UNLOCK_SOLVES,
    HINT_COST: HINT_COST,
    BASE_SCORE: BASE_SCORE,
    SPEED_BONUS_MAX: SPEED_BONUS_MAX,
    PUZZLES: PUZZLES,
    cloneAst: cloneAst,
    emptyCircuit: emptyCircuit,
    gateArity: gateArity,
    gatesForLevel: gatesForLevel,
    applyGate: applyGate,
    evaluate: evaluate,
    isComplete: isComplete,
    combinations: combinations,
    truthTable: truthTable,
    compareBehaviour: compareBehaviour,
    formatAst: formatAst,
    outermostOp: outermostOp,
    pathGet: pathGet,
    pathSet: pathSet,
    makeGateNode: makeGateNode,
    placeAt: placeAt,
    speedBonus: speedBonus,
    scoreForSolve: scoreForSolve,
    puzzlesForLevel: puzzlesForLevel,
    pickPuzzle: pickPuzzle,
    createProgress: createProgress,
    isLevel2Open: isLevel2Open,
    unlockProgress: unlockProgress,
    recordSolve: recordSolve,
    markSeen: markSeen,
    createRound: createRound,
    checkCircuit: checkCircuit,
    applyHint: applyHint,
    serializeProgress: serializeProgress,
    // builders for tests / demos
    and: and,
    or: or,
    not: not,
    xor: xor,
    nand: nand,
    nor: nor,
    input: function (name) { return { type: 'input', name: name }; }
  };
});
