const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../js/gate-logic.js');
const sch = require('../js/gate-schematic.js');

test('layout places gates left-to-right toward Y', () => {
  const ast = logic.and(logic.input('A'), logic.input('B'));
  const layout = sch.buildLayout(ast, logic, {});
  assert.equal(layout.gates.length, 1);
  assert.equal(layout.gates[0].op, 'AND');
  assert.equal(layout.inputs.length, 2);
  assert.ok(layout.inputs[0].x < layout.gates[0].x);
  assert.ok(layout.gates[0].x < layout.output.x);
  assert.ok(layout.wires.length >= 3);
});

test('empty circuit exposes a root empty port', () => {
  const layout = sch.buildLayout(null, logic, {});
  assert.ok(layout.ports.some((p) => p.kind === 'empty' && p.path.length === 0));
});

test('collectSignals tags wires for an env', () => {
  const ast = logic.not(logic.input('A'));
  const signals = sch.collectSignals(ast, { A: 1 }, logic);
  assert.equal(signals['0'], '1');
  assert.equal(signals[''], '0');
});

test('nested NAND / NOT layout stays orthogonal', () => {
  const ast = logic.and(
    logic.nand(logic.input('A'), logic.input('B')),
    logic.not(logic.input('C'))
  );
  const layout = sch.buildLayout(ast, logic, {});
  assert.equal(layout.gates.length, 3);
  const ops = layout.gates.map((g) => g.op).sort();
  assert.deepEqual(ops, ['AND', 'NAND', 'NOT']);
  layout.wires.forEach((wire) => {
    wire.segs.forEach((seg) => {
      const horiz = Math.abs(seg.y1 - seg.y2) < 0.01;
      const vert = Math.abs(seg.x1 - seg.x2) < 0.01;
      assert.ok(horiz || vert, 'wire segment must be orthogonal');
    });
  });
});
