const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/gate-logic.js');

test('AND / OR / NOT / XOR / NAND / NOR evaluate correctly', () => {
  const env = { A: 1, B: 0, C: 1 };
  assert.equal(L.evaluate(L.and(L.input('A'), L.input('B')), env), 0);
  assert.equal(L.evaluate(L.or(L.input('A'), L.input('B')), env), 1);
  assert.equal(L.evaluate(L.not(L.input('B')), env), 1);
  assert.equal(L.evaluate(L.xor(L.input('A'), L.input('B')), env), 1);
  assert.equal(L.evaluate(L.nand(L.input('A'), L.input('A')), env), 0);
  assert.equal(L.evaluate(L.nor(L.input('B'), L.input('B')), env), 1);
  assert.equal(L.evaluate(null, env), null);
});

test('truth tables cover every input combination', () => {
  const ast = L.and(L.input('A'), L.input('B'));
  const table = L.truthTable(ast, ['A', 'B']);
  assert.equal(table.length, 4);
  assert.deepEqual(table.map((row) => row.out), [0, 0, 0, 1]);
  assert.deepEqual(table[3].bits, [1, 1]);
});

test('behaviour match accepts a differently structured but equivalent circuit', () => {
  // Target: NOT (A AND B) — De Morgan shape with OR of NOTs is equivalent (NAND).
  const target = L.not(L.and(L.input('A'), L.input('B')));
  const alternate = L.or(L.not(L.input('A')), L.not(L.input('B')));
  const sameShape = L.not(L.and(L.input('A'), L.input('B')));
  const wrong = L.and(L.input('A'), L.input('B'));

  const okAlt = L.compareBehaviour(target, alternate, ['A', 'B']);
  const okSame = L.compareBehaviour(target, sameShape, ['A', 'B']);
  const bad = L.compareBehaviour(target, wrong, ['A', 'B']);

  assert.equal(okAlt.match, true);
  assert.equal(okSame.match, true);
  assert.equal(bad.match, false);
  assert.ok(bad.mismatches.length >= 1);
  assert.equal(bad.mismatches[0].expected, 1);
  assert.equal(bad.mismatches[0].actual, 0);
});

test('incomplete circuits never match', () => {
  const target = L.and(L.input('A'), L.input('B'));
  const incomplete = L.makeGateNode('AND');
  assert.equal(L.isComplete(incomplete), false);
  assert.equal(L.compareBehaviour(target, incomplete, ['A', 'B']).match, false);
  assert.equal(L.compareBehaviour(target, null, ['A', 'B']).match, false);
});

test('formatAst keeps school-friendly brackets', () => {
  assert.equal(L.formatAst(L.and(L.input('A'), L.input('B'))), 'A AND B');
  assert.equal(L.formatAst(L.not(L.and(L.input('A'), L.input('B')))), 'NOT (A AND B)');
  assert.equal(
    L.formatAst(L.or(L.and(L.input('A'), L.input('B')), L.input('C'))),
    '(A AND B) OR C'
  );
  assert.equal(
    L.formatAst(L.or(L.input('A'), L.and(L.input('B'), L.input('C')))),
    'A OR (B AND C)'
  );
});

test('placeAt builds a nested circuit from empty ports', () => {
  let circuit = L.placeAt(null, [], { kind: 'gate', op: 'OR' });
  assert.equal(circuit.op, 'OR');
  circuit = L.placeAt(circuit, [0], { kind: 'gate', op: 'AND' });
  circuit = L.placeAt(circuit, [0, 0], { kind: 'input', name: 'A' });
  circuit = L.placeAt(circuit, [0, 1], { kind: 'input', name: 'B' });
  circuit = L.placeAt(circuit, [1], { kind: 'input', name: 'C' });
  assert.equal(L.isComplete(circuit), true);
  assert.equal(L.formatAst(circuit), '(A AND B) OR C');
});

test('speed bonus decays, relaxed keeps the max, wrong scores beat nothing', () => {
  assert.equal(L.speedBonus(0, 100000, false), 50);
  assert.equal(L.speedBonus(50000, 100000, false), 25);
  assert.equal(L.speedBonus(100000, 100000, false), 0);
  assert.equal(L.speedBonus(999999, 100000, false), 0);
  assert.equal(L.speedBonus(999999, 100000, true), 50);

  const slowCorrect = L.scoreForSolve({ band: 0, elapsedMs: 999999, fastMs: 80000, relaxed: false });
  const fastWrongPoints = 0;
  assert.ok(slowCorrect.total >= L.BASE_SCORE);
  assert.ok(slowCorrect.total > fastWrongPoints);
  assert.equal(slowCorrect.speedBonus, 0);

  const hinted = L.scoreForSolve({ band: 0, elapsedMs: 0, fastMs: 80000, relaxed: true, usedHint: true });
  assert.equal(hinted.hintPenalty, L.HINT_COST);
  assert.equal(hinted.total, L.BASE_SCORE + L.SPEED_BONUS_MAX - L.HINT_COST);
});

test('Level 2 stays locked until six Level 1 solves', () => {
  let progress = L.createProgress();
  assert.equal(L.isLevel2Open(progress), false);
  assert.equal(L.unlockProgress(progress).remaining, 6);

  for (let i = 0; i < 5; i += 1) {
    progress = L.recordSolve(progress, 1, 100);
  }
  assert.equal(L.isLevel2Open(progress), false);

  progress = L.recordSolve(progress, 1, 100);
  assert.equal(progress.level2Unlocked, true);
  assert.equal(L.isLevel2Open(progress), true);

  const sessionOnly = L.createProgress({ sessionLevel2: true });
  assert.equal(L.isLevel2Open(sessionOnly), true);
  assert.equal(sessionOnly.level2Unlocked, false);
});

test('createRound refuses locked Level 2 and awards a matching circuit', () => {
  const locked = L.createRound({ level: 2, progress: L.createProgress(), rng: () => 0 });
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, 'locked');

  const open = L.createRound({
    level: 1,
    progress: L.createProgress(),
    rng: () => 0,
    relaxed: true,
    now: 0
  });
  assert.equal(open.ok, true);
  assert.equal(open.round.puzzle.level, 1);
  assert.ok(L.LEVEL1_GATES.includes(L.outermostOp(open.round.puzzle.ast)) || open.round.puzzle.ast.type === 'gate');

  // Build an equivalent circuit by cloning the target AST (structure may match;
  // behaviour match is what checkCircuit uses).
  let round = Object.assign({}, open.round, {
    circuit: L.cloneAst(open.round.puzzle.ast)
  });
  round = L.checkCircuit(round, 1000);
  assert.equal(round.lastCheck.ok, true);
  assert.equal(round.status, 'matched');
  assert.ok(round.lastCheck.score.total >= L.BASE_SCORE);
  assert.equal(round.lastCheck.score.speedBonus, L.SPEED_BONUS_MAX);
});

test('mismatch feedback lists disagreeing rows', () => {
  const started = L.createRound({
    level: 1,
    progress: L.createProgress(),
    rng: () => 0,
    now: 0
  });
  let round = Object.assign({}, started.round, {
    circuit: L.or(L.input('A'), L.input('B'))
  });
  // Force a known target by overwriting the puzzle AST to AND.
  round.puzzle = Object.assign({}, round.puzzle, {
    inputs: ['A', 'B'],
    ast: L.and(L.input('A'), L.input('B'))
  });
  round = L.checkCircuit(round, 0);
  assert.equal(round.lastCheck.ok, false);
  assert.equal(round.lastCheck.reason, 'mismatch');
  assert.ok(round.lastCheck.detail.length >= 1);
  assert.match(round.lastCheck.detail[0], /expression wants/);
});

test('Level 1 puzzles only use AND OR NOT; Level 2 may use the extras', () => {
  function opsIn(ast, set) {
    if (!ast || ast.type !== 'gate') return;
    set.add(ast.op);
    (ast.inputs || []).forEach((child) => opsIn(child, set));
  }
  L.puzzlesForLevel(1).forEach((puzzle) => {
    const ops = new Set();
    opsIn(puzzle.ast, ops);
    ops.forEach((op) => assert.ok(L.LEVEL1_GATES.includes(op), op + ' in level 1'));
    assert.ok(puzzle.inputs.length >= 1 && puzzle.inputs.length <= 3);
  });
  const level2Ops = new Set();
  L.puzzlesForLevel(2).forEach((puzzle) => opsIn(puzzle.ast, level2Ops));
  assert.ok(level2Ops.has('XOR') || level2Ops.has('NAND') || level2Ops.has('NOR'));
});

test('hint names the outermost operator once', () => {
  const started = L.createRound({
    level: 1,
    progress: L.createProgress(),
    rng: () => 0,
    now: 0
  });
  const hinted = L.applyHint(started.round);
  assert.equal(hinted.usedHint, true);
  assert.match(hinted.hintText, /outermost gate/i);
  const again = L.applyHint(hinted);
  assert.equal(again.hintText, hinted.hintText);
});
