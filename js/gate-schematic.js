// SVG schematic layout and IEEE-style gate symbols for Logic Gate Lab.
// Pure geometry: given an AST, returns SVG markup plus clickable port metadata.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GateSchematic = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GATE_W = 72;
  var GATE_H = 50;
  var NOT_W = 52;
  var NOT_H = 34;
  var COL_GAP = 56;
  var ROW_GAP = 22;
  var INPUT_PAD = 40;
  var OUT_PAD = 56;
  var PAD = 24;
  var PORT_R = 5.5;
  var EMPTY_R = 7;
  var NS = 'http://www.w3.org/2000/svg';

  function gateSize(op) {
    if (op === 'NOT') return { w: NOT_W, h: NOT_H };
    return { w: GATE_W, h: GATE_H };
  }

  // Where wires must meet the drawn outline (local coords inside the gate group).
  function gateAnchors(op, w, h) {
    var curved = op === 'OR' || op === 'NOR' || op === 'XOR';
    var bubble = op === 'NAND' || op === 'NOR' || op === 'NOT';
    return {
      inX: curved ? 10 : 1,
      outX: bubble ? w - 0.5 : w - 1,
      midY: h / 2
    };
  }

  function arityOf(node, logic) {
    if (!node || node.type !== 'gate') return 0;
    return logic.gateArity(node.op);
  }

  function measure(node, logic) {
    if (!node) {
      return { h: 40, depth: 1 };
    }
    if (node.type === 'input') {
      return { h: 36, depth: 1 };
    }
    var size = gateSize(node.op);
    var kids = (node.inputs || []).map(function (child) {
      return measure(child, logic);
    });
    var kidH = 0;
    var maxDepth = 0;
    kids.forEach(function (k, i) {
      kidH += k.h;
      if (i) kidH += ROW_GAP;
      if (k.depth > maxDepth) maxDepth = k.depth;
    });
    return {
      h: Math.max(size.h + 8, kidH || size.h),
      depth: maxDepth + 1,
      kids: kids
    };
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] == null) return;
        el.setAttribute(key, String(attrs[key]));
      });
    }
    return el;
  }

  // IEEE / ANSI distinctive shapes. Local coords: output tip near (w, h/2), inputs on x≈0.
  function gateBody(op, w, h) {
    var g = svgEl('g', { class: 'gate-body', 'data-op': op });
    var mid = h / 2;
    var ink = {
      fill: '#fffdf8',
      'stroke-width': '2.4',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round'
    };

    if (op === 'NOT') {
      g.appendChild(svgEl('polygon', Object.assign({
        points: '1,1 ' + (w - 12) + ',' + mid + ' 1,' + (h - 1)
      }, ink)));
      g.appendChild(svgEl('circle', Object.assign({
        cx: w - 5.5, cy: mid, r: 5
      }, ink)));
      return g;
    }

    if (op === 'AND' || op === 'NAND') {
      // Arc so the nose actually reaches tipX (a cubic to the same end y never does).
      var tipX = op === 'NAND' ? w - 12 : w - 1;
      var flat = w * 0.34;
      var rx = tipX - flat;
      var ry = (h - 2) / 2;
      var andD = [
        'M 1,1',
        'L ' + flat + ',1',
        'A ' + rx + ' ' + ry + ' 0 0 1 ' + flat + ',' + (h - 1),
        'L 1,' + (h - 1),
        'Z'
      ].join(' ');
      g.appendChild(svgEl('path', Object.assign({ d: andD }, ink)));
      if (op === 'NAND') {
        g.appendChild(svgEl('circle', Object.assign({
          cx: w - 5.5, cy: mid, r: 5
        }, ink)));
      }
      return g;
    }

    if (op === 'OR' || op === 'NOR' || op === 'XOR') {
      var tip = op === 'NOR' ? w - 12 : w - 1;
      // Pointed tip at `tip`, concave back at x=10.
      var orD = [
        'M 10,1',
        'Q ' + (w * 0.55) + ',1 ' + tip + ',' + mid,
        'Q ' + (w * 0.55) + ',' + (h - 1) + ' 10,' + (h - 1),
        'Q ' + (w * 0.28) + ',' + mid + ' 10,1',
        'Z'
      ].join(' ');
      g.appendChild(svgEl('path', Object.assign({ d: orD }, ink)));
      if (op === 'XOR') {
        g.appendChild(svgEl('path', Object.assign({
          d: 'M 3,1 Q ' + (w * 0.2) + ',' + mid + ' 3,' + (h - 1),
          fill: 'none'
        }, ink)));
      }
      if (op === 'NOR') {
        g.appendChild(svgEl('circle', Object.assign({
          cx: w - 5.5, cy: mid, r: 5
        }, ink)));
      }
      return g;
    }

    g.appendChild(svgEl('rect', Object.assign({
      x: 1, y: 1, width: w - 2, height: h - 2, rx: 2
    }, ink)));
    var label = svgEl('text', {
      x: w / 2, y: mid + 4, 'text-anchor': 'middle', class: 'gate-fallback-label'
    });
    label.textContent = op;
    g.appendChild(label);
    return g;
  }

  function inputPinYs(arity, h) {
    if (arity <= 1) return [h / 2];
    if (arity === 2) return [h * 0.28, h * 0.72];
    var ys = [];
    for (var i = 0; i < arity; i += 1) {
      ys.push(h * (0.2 + (0.6 * i) / (arity - 1)));
    }
    return ys;
  }

  function orthogonal(x1, y1, x2, y2) {
    if (Math.abs(y1 - y2) < 0.5) {
      return [{ x1: x1, y1: y1, x2: x2, y2: y2 }];
    }
    var mid = (x1 + x2) / 2;
    return [
      { x1: x1, y1: y1, x2: mid, y2: y1 },
      { x1: mid, y1: y1, x2: mid, y2: y2 },
      { x1: mid, y1: y2, x2: x2, y2: y2 }
    ];
  }

  function pathKey(path) {
    return path.join('.');
  }

  function signalOf(signals, path) {
    if (!signals) return 'x';
    var key = pathKey(path);
    if (Object.prototype.hasOwnProperty.call(signals, key)) return signals[key];
    return 'x';
  }

  function place(node, path, outX, outY, topY, logic, signals, acc) {
    if (!node) {
      var emptyX = outX - 20;
      acc.ports.push({
        kind: 'empty',
        path: path.slice(),
        x: emptyX,
        y: outY,
        label: path.length ? 'Empty port' : 'Add gate or input'
      });
      // Wire from the dashed circle rim all the way to the parent pin (outX).
      acc.wires.push({
        segs: [{ x1: emptyX + EMPTY_R, y1: outY, x2: outX, y2: outY }],
        signal: 'x',
        path: path.slice()
      });
      return { connectX: emptyX + EMPTY_R, connectY: outY, left: emptyX - 8 };
    }

    if (node.type === 'input') {
      var inX = outX - INPUT_PAD;
      acc.inputs.push({
        name: node.name,
        path: path.slice(),
        x: inX,
        y: outY,
        signal: signalOf(signals, path)
      });
      acc.ports.push({
        kind: 'input',
        path: path.slice(),
        x: inX,
        y: outY,
        label: 'Input ' + node.name
      });
      acc.wires.push({
        segs: [{ x1: inX + PORT_R, y1: outY, x2: outX, y2: outY }],
        signal: signalOf(signals, path),
        path: path.slice()
      });
      acc.dots.push({ x: inX, y: outY, signal: signalOf(signals, path) });
      return { connectX: inX + PORT_R, connectY: outY, left: inX - 22 };
    }

    // Gate — anchors follow the drawn outline so wires do not float.
    var size = gateSize(node.op);
    var arity = arityOf(node, logic);
    var anchors = gateAnchors(node.op, size.w, size.h);
    var tipX = outX; // parent asks this gate's output tip to sit at outX
    var bodyLeft = tipX - anchors.outX;
    var bodyTop = outY - size.h / 2;
    var pinYsLocal = inputPinYs(arity, size.h);
    var pinYs = pinYsLocal.map(function (py) {
      return bodyTop + py;
    });
    var pinX = bodyLeft + anchors.inX;

    acc.gates.push({
      op: node.op,
      path: path.slice(),
      x: bodyLeft,
      y: bodyTop,
      w: size.w,
      h: size.h,
      inX: anchors.inX,
      outX: anchors.outX,
      signal: signalOf(signals, path)
    });
    acc.ports.push({
      kind: 'gate',
      path: path.slice(),
      x: bodyLeft + size.w / 2,
      y: outY,
      w: size.w,
      h: size.h,
      label: node.op + ' gate'
    });
    acc.dots.push({ x: tipX, y: outY, signal: signalOf(signals, path) });

    var kids = node.inputs || [];
    var measures = kids.map(function (child) {
      return measure(child, logic);
    });
    var totalH = 0;
    measures.forEach(function (m, i) {
      totalH += m.h;
      if (i) totalH += ROW_GAP;
    });
    var childTop = outY - totalH / 2;
    var leftmost = bodyLeft;
    var cursor = childTop;

    kids.forEach(function (child, index) {
      var m = measures[index];
      var pinY = pinYs[index] != null ? pinYs[index] : outY;
      // Leaves sit on the pin; nested gates keep their own vertical stack center.
      var isLeaf = !child || child.type === 'input';
      var childOutY = isLeaf ? pinY : cursor + m.h / 2;
      var childOutX = pinX - COL_GAP * 0.45;
      var placed = place(
        child,
        path.concat(index),
        childOutX,
        childOutY,
        cursor,
        logic,
        signals,
        acc
      );
      if (placed.left < leftmost) leftmost = placed.left;

      // Child ends at childOutX; this run meets the gate outline at pinX.
      var segs = orthogonal(childOutX, childOutY, pinX, pinY);
      acc.wires.push({
        segs: segs,
        signal: signalOf(signals, path.concat(index)),
        path: path.concat(index)
      });
      acc.dots.push({ x: pinX, y: pinY, signal: signalOf(signals, path.concat(index)) });
      cursor += m.h + ROW_GAP;
    });

    return { connectX: tipX, connectY: outY, left: leftmost };
  }

  function shiftAll(acc, dx) {
    if (!dx) return;
    acc.outX += dx;
    ['gates', 'inputs', 'ports', 'dots'].forEach(function (listName) {
      acc[listName].forEach(function (item) {
        item.x += dx;
      });
    });
    acc.wires.forEach(function (wire) {
      wire.segs.forEach(function (seg) {
        seg.x1 += dx;
        seg.x2 += dx;
      });
    });
  }

  function boundsX(acc) {
    var minX = Infinity;
    var maxX = -Infinity;
    function hit(x) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    acc.gates.forEach(function (g) {
      hit(g.x);
      hit(g.x + g.w);
    });
    acc.inputs.forEach(function (i) { hit(i.x - 18); hit(i.x); });
    acc.ports.forEach(function (p) { hit(p.x - 8); hit(p.x + 8); });
    acc.dots.forEach(function (d) { hit(d.x); });
    acc.wires.forEach(function (wire) {
      wire.segs.forEach(function (seg) {
        hit(seg.x1);
        hit(seg.x2);
      });
    });
    hit(acc.outX);
    if (!isFinite(minX)) {
      minX = 0;
      maxX = 200;
    }
    return { minX: minX, maxX: maxX };
  }

  function buildLayout(ast, logic, signals) {
    var m = measure(ast, logic);
    var height = Math.max(160, m.h + PAD * 2);
    // Temporary wide canvas; we crop to content after placing.
    var width = 900;
    var outX = width - PAD - 40;
    var outY = height / 2;

    var acc = {
      width: width,
      height: height,
      outX: outX,
      outY: outY,
      gates: [],
      inputs: [],
      wires: [],
      ports: [],
      dots: []
    };

    place(ast, [], outX - 30, outY, PAD, logic, signals, acc);

    // Final output wire to Y
    acc.wires.push({
      segs: [{ x1: acc.outX - 30, y1: acc.outY, x2: acc.outX + 10, y2: acc.outY }],
      signal: signalOf(signals, []),
      path: [],
      role: 'final'
    });

    var box = boundsX(acc);
    shiftAll(acc, PAD + 28 - box.minX);
    box = boundsX(acc);
    acc.width = Math.max(280, box.maxX + PAD + 36);
    acc.output = {
      x: acc.outX + 10,
      y: acc.outY,
      signal: signalOf(signals, [])
    };

    return acc;
  }

  function render(ast, options) {
    var opts = options || {};
    var logic = opts.logic;
    var signals = opts.signals || {};
    var layout = buildLayout(ast, logic, signals);
    var root = svgEl('svg', {
      class: 'schematic',
      viewBox: '0 0 ' + layout.width + ' ' + layout.height,
      width: '100%',
      height: String(Math.min(420, Math.max(180, layout.height))),
      role: 'img',
      'aria-label': 'Logic circuit schematic'
    });

    // Soft sheet background is CSS; keep SVG transparent.
    var layerWires = svgEl('g', { class: 'layer-wires' });
    var layerGates = svgEl('g', { class: 'layer-gates' });
    var layerPorts = svgEl('g', { class: 'layer-ports' });
    var layerLabels = svgEl('g', { class: 'layer-labels' });

    layout.wires.forEach(function (wire) {
      wire.segs.forEach(function (seg) {
        layerWires.appendChild(svgEl('line', {
          x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
          class: 'sch-wire',
          'data-signal': wire.signal,
          'data-path': pathKey(wire.path)
        }));
      });
    });

    layout.dots.forEach(function (dot) {
      layerWires.appendChild(svgEl('circle', {
        cx: dot.x, cy: dot.y, r: 3.2,
        class: 'sch-dot',
        'data-signal': dot.signal
      }));
    });

    layout.gates.forEach(function (gate) {
      var g = svgEl('g', {
        class: 'sch-gate',
        'data-op': gate.op,
        'data-signal': gate.signal,
        'data-path': pathKey(gate.path),
        transform: 'translate(' + gate.x + ' ' + gate.y + ')'
      });
      g.appendChild(gateBody(gate.op, gate.w, gate.h));
      // Invisible hit target for keyboard/click replace
      var hit = svgEl('rect', {
        class: 'sch-hit',
        x: 0, y: 0, width: gate.w, height: gate.h,
        'data-port': '1',
        'data-path': pathKey(gate.path),
        tabindex: '0',
        role: 'button',
        'aria-label': gate.op + ' gate — press Enter to replace'
      });
      g.appendChild(hit);
      var bit = signalLabel(gate.signal);
      if (bit) {
        var t = svgEl('text', {
          x: gate.w - 2, y: -6, class: 'sch-bit', 'text-anchor': 'end'
        });
        t.textContent = bit;
        g.appendChild(t);
      }
      layerGates.appendChild(g);
    });

    layout.inputs.forEach(function (inp) {
      var label = svgEl('text', {
        x: inp.x - 12, y: inp.y + 4,
        class: 'sch-input-label',
        'text-anchor': 'end'
      });
      label.textContent = inp.name;
      layerLabels.appendChild(label);
      var bit = signalLabel(inp.signal);
      if (bit) {
        var bt = svgEl('text', {
          x: inp.x + 10, y: inp.y - 10, class: 'sch-bit'
        });
        bt.textContent = bit;
        layerLabels.appendChild(bt);
      }
    });

    // Output label Y
    var yLabel = svgEl('text', {
      x: layout.output.x + 14, y: layout.output.y + 4,
      class: 'sch-output-label'
    });
    yLabel.textContent = 'Y';
    layerLabels.appendChild(yLabel);

    var outDot = svgEl('circle', {
      cx: layout.output.x, cy: layout.output.y, r: 3.2,
      class: 'sch-dot',
      'data-signal': layout.output.signal
    });
    layerWires.appendChild(outDot);

    // Lamp sits in HTML beside the SVG; draw a small output node only.
    layout.ports.forEach(function (port) {
      if (port.kind === 'gate') return; // hit rect already on gate
      var btn = svgEl('circle', {
        cx: port.x, cy: port.y,
        r: port.kind === 'empty' ? EMPTY_R : PORT_R,
        class: port.kind === 'empty' ? 'sch-port empty' : 'sch-port',
        'data-port': '1',
        'data-path': pathKey(port.path),
        tabindex: '0',
        role: 'button',
        'aria-label': port.label + ' — press Enter to change'
      });
      layerPorts.appendChild(btn);
    });

    root.appendChild(layerWires);
    root.appendChild(layerGates);
    root.appendChild(layerPorts);
    root.appendChild(layerLabels);

    return {
      svg: root,
      layout: layout
    };
  }

  function signalLabel(signal) {
    if (signal === '0' || signal === '1') return signal;
    return '';
  }

  function collectSignals(ast, env, logic, path, out) {
    path = path || [];
    out = out || {};
    if (!ast) return out;
    if (ast.type === 'input') {
      out[pathKey(path)] = env && env[ast.name] != null ? String(env[ast.name] ? 1 : 0) : 'x';
      return out;
    }
    if (ast.type === 'gate') {
      (ast.inputs || []).forEach(function (child, i) {
        collectSignals(child, env, logic, path.concat(i), out);
      });
      if (logic.isComplete(ast) && env) {
        var v = logic.evaluate(ast, env);
        out[pathKey(path)] = v === null ? 'x' : String(v);
      } else {
        out[pathKey(path)] = 'x';
      }
    }
    return out;
  }

  return {
    render: render,
    collectSignals: collectSignals,
    buildLayout: buildLayout,
    gateBody: gateBody
  };
});
