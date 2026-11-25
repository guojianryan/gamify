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

test('wires meet the drawn AND / NOR outlines, not the group box', () => {
  function assertPins(ast, op) {
    const layout = sch.buildLayout(ast, logic, {});
    const gate = layout.gates.find((g) => g.op === op);
    assert.ok(gate, op + ' present');
    const pinX = gate.x + gate.inX;
    const tipX = gate.x + gate.outX;
    const hitsPin = layout.wires.some((wire) =>
      wire.segs.some((seg) => Math.abs(seg.x2 - pinX) < 0.51 || Math.abs(seg.x1 - pinX) < 0.51)
    );
    const hitsTip = layout.dots.some((dot) => Math.abs(dot.x - tipX) < 0.51);
    assert.ok(hitsPin, op + ' input wires meet inX=' + gate.inX);
    assert.ok(hitsTip, op + ' output tip meets outX=' + gate.outX);
    if (op === 'NOR' || op === 'OR' || op === 'XOR') {
      assert.ok(gate.inX >= 8, op + ' curved back sits inward');
    }
  }

  assertPins(logic.and(logic.input('A'), logic.input('B')), 'AND');
  assertPins(logic.nor(logic.input('A'), logic.input('B')), 'NOR');
});

test('AND output tip anchor matches the drawn nose', () => {
  const layout = sch.buildLayout(logic.and(logic.input('A'), logic.input('B')), logic, {});
  const gate = layout.gates[0];
  // Arc from flat=0.34w to tip=w-1: rightmost point is tip.
  const tipX = gate.x + gate.outX;
  assert.ok(Math.abs(gate.outX - (gate.w - 1)) < 0.01);
  assert.ok(layout.dots.some((dot) => Math.abs(dot.x - tipX) < 0.51));
});

test('empty ports draw a continuous stub into the gate pin', () => {
  const ast = logic.makeGateNode('AND');
  const layout = sch.buildLayout(ast, logic, {});
  const gate = layout.gates[0];
  const pinX = gate.x + gate.inX;
  const empties = layout.ports.filter((p) => p.kind === 'empty');
  assert.equal(empties.length, 2);
  empties.forEach((port) => {
    const reaches = layout.wires.some((wire) =>
      wire.segs.some((seg) =>
        (Math.abs(seg.x1 - (port.x + 7)) < 0.51 || Math.abs(seg.x2 - (port.x + 7)) < 0.51) ||
        (Math.abs(seg.x2 - pinX) < 0.51)
      )
    );
    assert.ok(reaches, 'empty port links toward the pin');
  });
  assert.ok(
    layout.wires.some((wire) => wire.segs.some((seg) => Math.abs(seg.x2 - pinX) < 0.51)),
    'a wire ends on the AND pin'
  );
});
