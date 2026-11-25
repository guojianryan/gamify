(function () {
  'use strict';

  var logic = window.GateLogic;
  var schematic = window.GateSchematic;
  if (!logic || !schematic) return;

  var STORAGE_KEY = 'gamify.gates.progress';
  var MUTE_KEY = 'gamify.muted';

  var progress = logic.createProgress(loadProgress());
  var round = null;
  var history = [];
  var pickerPath = null;
  var muted = storageGet(MUTE_KEY) === '1';
  var audioCtx = null;
  var clock = null;
  var frameId = 0;
  var toastTimer = 0;
  var anim = {
    playing: false,
    index: -1,
    timer: 0,
    rows: [],
    phase: 'idle'
  };
  var justUnlocked = false;

  bind();
  renderMute();
  renderSetup();

  function bind() {
    document.getElementById('setup-form').addEventListener('submit', onStart);
    document.getElementById('session-level2').addEventListener('click', onSessionLevel2);
    document.getElementById('relaxed').checked = !!progress.relaxed;
    document.getElementById('relaxed').addEventListener('change', function (event) {
      progress.relaxed = event.target.checked;
      saveProgress();
    });
    document.getElementById('mute').addEventListener('click', function () {
      muted = !muted;
      storageSet(MUTE_KEY, muted ? '1' : '0');
      renderMute();
    });
    document.getElementById('pause').addEventListener('click', onPauseToggle);
    document.getElementById('resume').addEventListener('click', onResume);
    document.getElementById('quit').addEventListener('click', onQuit);
    document.getElementById('undo').addEventListener('click', onUndo);
    document.getElementById('clear-circuit').addEventListener('click', onClear);
    document.getElementById('hint').addEventListener('click', onHint);
    document.getElementById('check').addEventListener('click', onCheck);
    document.getElementById('picker-cancel').addEventListener('click', closePicker);
    document.getElementById('anim-play').addEventListener('click', function () { startAnim(false); });
    document.getElementById('anim-pause').addEventListener('click', pauseAnim);
    document.getElementById('anim-step').addEventListener('click', function () { stepAnim(true); });
    document.getElementById('anim-replay').addEventListener('click', function () { startAnim(true); });
    document.getElementById('unlock-dismiss').addEventListener('click', function () {
      document.getElementById('unlock-overlay').hidden = true;
    });
    document.getElementById('circuit-tree').addEventListener('click', onTreeClick);
    document.getElementById('circuit-tree').addEventListener('keydown', onTreeKey);
    document.addEventListener('keydown', onGlobalKey);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onStart(event) {
    event.preventDefault();
    ensureAudio();
    var levelInput = document.querySelector('input[name="level"]:checked');
    var level = levelInput ? Number(levelInput.value) : 1;
    var relaxed = document.getElementById('relaxed').checked;
    progress.relaxed = relaxed;
    var started = logic.createRound({
      level: level,
      progress: progress,
      relaxed: relaxed,
      score: 0,
      streak: 0,
      solvedThisRound: 0,
      rng: Math.random,
      now: performance.now()
    });
    if (!started.ok) {
      toast('Level 2 is still locked. Solve more Level 1 puzzles, or try it for this session.');
      return;
    }
    progress = started.progress;
    round = started.round;
    history = [];
    justUnlocked = false;
    saveProgress();
    stopAnim();
    showPlay();
    renderAll();
    startClock();
    announce('Puzzle ready. Build ' + logic.formatAst(round.puzzle.ast) + '.');
  }

  function onSessionLevel2() {
    progress.sessionLevel2 = true;
    var radio = document.getElementById('level2-radio');
    radio.disabled = false;
    radio.checked = true;
    renderSetup();
    toast('Level 2 is open for this session.');
    announce('Level 2 unlocked for this session.');
  }

  function onQuit() {
    holdClock();
    stopAnim();
    round = null;
    document.getElementById('play').hidden = true;
    document.getElementById('setup').hidden = false;
    document.body.dataset.view = 'setup';
    document.body.dataset.status = 'ready';
    document.getElementById('overlay').hidden = true;
    renderSetup();
  }

  function onPauseToggle() {
    if (!round) return;
    if (document.body.dataset.status === 'paused') onResume();
    else onPause();
  }

  function onPause() {
    if (!round || document.body.dataset.status !== 'playing') return;
    holdClock();
    pauseAnim();
    document.body.dataset.status = 'paused';
    document.getElementById('overlay').hidden = false;
    document.getElementById('pause').textContent = 'Resume';
    announce('Paused.');
  }

  function onResume() {
    if (!round) return;
    document.body.dataset.status = 'playing';
    document.getElementById('overlay').hidden = true;
    document.getElementById('pause').textContent = 'Pause';
    releaseClock();
    announce('Resumed.');
  }

  function onVisibility() {
    if (document.hidden) {
      if (document.body.dataset.status === 'playing') {
        holdClock();
        pauseAnim();
      }
    } else if (document.body.dataset.status === 'playing' && clock && clock.held) {
      releaseClock();
    }
  }

  function portFromEvent(event) {
    var port = event.target.closest('[data-port]');
    if (port) return port;
    var gate = event.target.closest('.sch-gate');
    return gate ? gate.querySelector('[data-port]') : null;
  }

  function onTreeClick(event) {
    var port = portFromEvent(event);
    if (!port || !round || round.status === 'matched') return;
    openPicker(parsePath(port.getAttribute('data-path') || ''));
  }

  function onTreeKey(event) {
    var port = portFromEvent(event);
    if (!port) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker(parsePath(port.getAttribute('data-path') || ''));
    }
  }

  function onGlobalKey(event) {
    if (!round) return;
    if (event.key === 'Escape') {
      if (!document.getElementById('picker').hidden) {
        closePicker();
        return;
      }
      if (document.body.dataset.status === 'paused') onResume();
      else if (document.body.dataset.status === 'playing') onPause();
      return;
    }
    if (event.target.closest('input, textarea, select, button, a')) {
      if (event.key === 'p' || event.key === 'P') {
        if (event.target.closest('#lab') || event.target.id === 'pause') {
          /* allow */
        } else return;
      } else if (event.key !== ' ') return;
    }
    if ((event.key === 'p' || event.key === 'P') && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      onPauseToggle();
    }
    if (event.key === 'c' || event.key === 'C') {
      if (event.target.closest('input, textarea')) return;
      if (round.status !== 'matched') {
        event.preventDefault();
        onCheck();
      }
    }
    if (event.key === ' ' && document.activeElement && document.activeElement.closest('#lab')) {
      event.preventDefault();
      stepAnim(true);
    }
  }

  function openPicker(path) {
    pickerPath = path;
    var picker = document.getElementById('picker');
    var grid = document.getElementById('picker-grid');
    grid.replaceChildren();
    document.getElementById('picker-title').textContent = path.length ? 'Fill this port' : 'Feed the lamp';

    round.puzzle.inputs.forEach(function (name) {
      grid.appendChild(pickerButton('Input ' + name, function () {
        applyPlace({ kind: 'input', name: name });
      }));
    });

    logic.gatesForLevel(round.level).forEach(function (op) {
      grid.appendChild(pickerButton(op + ' gate', function () {
        applyPlace({ kind: 'gate', op: op });
      }));
    });

    var existing = logic.pathGet(round.circuit, path);
    if (existing !== null && path.length >= 0) {
      grid.appendChild(pickerButton('Clear port', function () {
        applyPlace({ kind: 'clear' });
      }));
    }

    picker.hidden = false;
    picker.scrollTop = 0;
    // Keep the board tall enough that Level 2 options stay reachable on phones.
    document.getElementById('circuit-board').classList.add('picking');
    var first = grid.querySelector('button');
    if (first) first.focus();
  }

  function pickerButton(label, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function closePicker() {
    pickerPath = null;
    document.getElementById('picker').hidden = true;
    document.getElementById('circuit-board').classList.remove('picking');
  }

  function applyPlace(choice) {
    if (!round) return;
    history.push(logic.cloneAst(round.circuit));
    round = Object.assign({}, round, {
      circuit: logic.placeAt(round.circuit, pickerPath, choice),
      status: round.status === 'matched' ? 'matched' : 'building',
      lastCheck: round.status === 'matched' ? round.lastCheck : null,
      celebrate: false
    });
    closePicker();
    stopAnim();
    renderAll();
    soundPlace();
  }

  function onUndo() {
    if (!history.length || !round || round.status === 'matched') return;
    round = Object.assign({}, round, {
      circuit: history.pop(),
      lastCheck: null,
      celebrate: false,
      status: 'building'
    });
    stopAnim();
    renderAll();
  }

  function onClear() {
    if (!round || round.status === 'matched') return;
    history.push(logic.cloneAst(round.circuit));
    round = Object.assign({}, round, {
      circuit: logic.emptyCircuit(),
      lastCheck: null,
      celebrate: false,
      status: 'building'
    });
    stopAnim();
    renderAll();
  }

  function onHint() {
    if (!round || round.usedHint) return;
    round = logic.applyHint(round);
    renderHint();
    toast(round.hintText);
    announce(round.hintText);
  }

  function onCheck() {
    if (!round || round.status === 'matched') return;
    ensureAudio();
    var elapsed = currentElapsed();
    var beforeUnlock = logic.isLevel2Open(progress);
    // Clear any finished signal-run index before re-rendering the tree.
    stopAnim();
    round = logic.checkCircuit(round, elapsed);

    if (!round.lastCheck.ok) {
      renderAll();
      soundWrong();
      announce(round.lastCheck.message);
      return;
    }

    holdClock();
    var gained = round.lastCheck.score.total;
    progress = logic.recordSolve(progress, round.level, round.score);
    saveProgress();
    renderAll();
    flashGain(gained);
    soundClear();
    announce(round.lastCheck.message + ' +' + gained + ' points.');
    paintLamp(true);
    document.getElementById('lamp').dataset.celebrate = '1';

    if (!beforeUnlock && logic.isLevel2Open(progress)) {
      justUnlocked = true;
    }

    // Run the all-combinations animation, then celebrate at the end.
    startAnim(true, function () {
      playCelebration();
      paintLamp(true);
      if (justUnlocked) {
        justUnlocked = false;
        showUnlock();
      }
    });
  }

  function nextPuzzle() {
    if (!round) return;
    var started = logic.createRound({
      level: round.level,
      progress: progress,
      relaxed: round.relaxed,
      score: round.score,
      streak: round.streak,
      solvedThisRound: round.solvedThisRound,
      rng: Math.random,
      now: performance.now()
    });
    if (!started.ok) {
      toast('Could not start the next puzzle.');
      return;
    }
    progress = started.progress;
    round = started.round;
    history = [];
    saveProgress();
    stopAnim();
    document.getElementById('celebrate').hidden = true;
    document.getElementById('lamp').dataset.celebrate = '0';
    renderAll();
    startClock();
    announce('Next puzzle. Build ' + logic.formatAst(round.puzzle.ast) + '.');
  }

  function showPlay() {
    document.getElementById('setup').hidden = true;
    document.getElementById('play').hidden = false;
    document.getElementById('overlay').hidden = true;
    document.body.dataset.view = 'play';
    document.body.dataset.status = 'playing';
    document.getElementById('pause').textContent = 'Pause';
  }

  function showUnlock() {
    var overlay = document.getElementById('unlock-overlay');
    overlay.hidden = false;
    soundLevel();
    announce('Level 2 is unlocked. XOR, NAND and NOR are available.');
  }

  function renderSetup() {
    var open = logic.isLevel2Open(progress);
    var unlock = logic.unlockProgress(progress);
    var radio = document.getElementById('level2-radio');
    radio.disabled = !open;
    document.getElementById('level2-label').classList.toggle('locked', !open);
    document.getElementById('level2-copy').textContent = open
      ? 'XOR, NAND and NOR join AND, OR and NOT.'
      : 'Locked. Solve ' + unlock.remaining + ' more Level 1 puzzle' + (unlock.remaining === 1 ? '' : 's') + ' to open XOR, NAND and NOR.';
    var fill = document.getElementById('unlock-fill');
    var pct = Math.min(100, (unlock.solves / unlock.needed) * 100);
    fill.style.transform = 'scaleX(' + (pct / 100) + ')';
    document.getElementById('unlock-label').textContent = open && progress.level2Unlocked
      ? 'Level 2 unlocked · Best score ' + formatNumber(progress.highScore)
      : unlock.solves + ' / ' + unlock.needed + ' Level 1 solves toward Level 2';
    document.getElementById('session-level2').hidden = open;
  }

  function renderAll() {
    if (!round) return;
    document.getElementById('score').textContent = formatNumber(round.score);
    document.getElementById('streak').textContent = String(round.streak);
    document.getElementById('solved').textContent = String(round.solvedThisRound);
    document.getElementById('best').textContent = formatNumber(progress.highScore);
    document.getElementById('expression').textContent = logic.formatAst(round.puzzle.ast);
    document.getElementById('speed-stat').hidden = !!round.relaxed;
    document.getElementById('undo').disabled = !history.length || round.status === 'matched';
    document.getElementById('clear-circuit').disabled = round.status === 'matched';
    document.getElementById('hint').disabled = !!round.usedHint || round.status === 'matched';
    document.getElementById('check').disabled = round.status === 'matched';
    document.getElementById('check').textContent = round.status === 'matched' ? 'Matched' : 'Check circuit';

    renderPalette();
    renderGlossary();
    renderTree();
    renderTruth();
    renderFeedback();
    renderHint();
    paintSpeed();
    paintLamp(round.status === 'matched');
  }

  function renderPalette() {
    var el = document.getElementById('palette');
    el.replaceChildren();
    round.puzzle.inputs.forEach(function (name) {
      var chip = document.createElement('span');
      chip.className = 'chip input-chip';
      chip.textContent = name;
      el.appendChild(chip);
    });
    logic.gatesForLevel(round.level).forEach(function (op) {
      var chip = document.createElement('span');
      chip.className = 'chip gate-chip';
      chip.textContent = op;
      el.appendChild(chip);
    });
  }

  function renderGlossary() {
    var list = document.getElementById('glossary-list');
    list.replaceChildren();
    logic.gatesForLevel(round.level).forEach(function (op) {
      var li = document.createElement('li');
      var info = logic.GATES[op];
      li.innerHTML = '<strong>' + op + '</strong> — ' + info.meaning;
      list.appendChild(li);
    });
  }

  function renderHint() {
    var line = document.getElementById('hint-line');
    if (round && round.hintText) {
      line.hidden = false;
      line.textContent = round.hintText;
    } else {
      line.hidden = true;
      line.textContent = '';
    }
  }

  function renderTree() {
    var root = document.getElementById('circuit-tree');
    root.replaceChildren();
    var env = currentEnv();
    var signals = env
      ? schematic.collectSignals(round.circuit, env, logic)
      : {};
    // Root output signal for the final wire / lamp feed
    if (env && logic.isComplete(round.circuit)) {
      var rootOut = logic.evaluate(round.circuit, env);
      signals[''] = rootOut === null ? 'x' : String(rootOut);
    }
    var drawn = schematic.render(round.circuit, {
      logic: logic,
      signals: signals
    });
    root.appendChild(drawn.svg);
  }

  function renderTruth() {
    var inputs = round.puzzle.inputs;
    var head = document.getElementById('truth-head');
    var body = document.getElementById('truth-body');
    head.replaceChildren();
    body.replaceChildren();

    var hr = document.createElement('tr');
    inputs.forEach(function (name) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = name;
      hr.appendChild(th);
    });
    var thOut = document.createElement('th');
    thOut.scope = 'col';
    thOut.textContent = 'OUT';
    hr.appendChild(thOut);
    head.appendChild(hr);

    var table = logic.isComplete(round.circuit)
      ? logic.truthTable(round.circuit, inputs)
      : logic.combinations(inputs).map(function (row) {
        return { bits: row.bits, env: row.env, out: null };
      });

    var targetTable = logic.truthTable(round.puzzle.ast, inputs);
    var mismatchMasks = {};
    if (round.lastCheck && round.lastCheck.mismatches) {
      round.lastCheck.mismatches.forEach(function (row) {
        mismatchMasks[row.bits.join('')] = true;
      });
    }

    table.forEach(function (row, index) {
      var tr = document.createElement('tr');
      tr.dataset.row = String(index);
      if (anim.index === index) tr.classList.add('active');
      var key = row.bits.join('');
      if (mismatchMasks[key]) tr.classList.add('mismatch');
      if (round.status === 'matched' && targetTable[index].out === row.out) {
        tr.classList.add('ok');
      }
      row.bits.forEach(function (bit) {
        var td = document.createElement('td');
        td.textContent = String(bit);
        td.dataset.bit = String(bit);
        tr.appendChild(td);
      });
      var out = document.createElement('td');
      out.className = 'out-cell';
      out.textContent = row.out === null ? '—' : String(row.out);
      out.dataset.bit = row.out === null ? 'x' : String(row.out);
      tr.appendChild(out);
      body.appendChild(tr);
    });

    document.getElementById('table-caption').textContent = logic.isComplete(round.circuit)
      ? 'Live from your circuit · ' + table.length + ' rows'
      : 'Fill every port to compute OUT';
  }

  function renderFeedback() {
    var el = document.getElementById('feedback');
    if (!round.lastCheck) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    el.hidden = false;
    el.className = 'feedback ' + (round.lastCheck.ok ? 'ok' : 'bad');
    el.replaceChildren();
    var title = document.createElement('p');
    title.className = 'feedback-title';
    title.textContent = round.lastCheck.message;
    el.appendChild(title);
    if (round.lastCheck.detail && round.lastCheck.detail.length) {
      var ul = document.createElement('ul');
      round.lastCheck.detail.forEach(function (line) {
        var li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }
    if (round.lastCheck.ok && round.lastCheck.score) {
      var scoreLine = document.createElement('p');
      scoreLine.textContent = '+' + round.lastCheck.score.total + ' (base ' +
        round.lastCheck.score.base + ', speed +' + round.lastCheck.score.speedBonus +
        (round.lastCheck.score.hintPenalty ? ', hint −' + round.lastCheck.score.hintPenalty : '') +
        ')';
      el.appendChild(scoreLine);
      var next = document.createElement('button');
      next.type = 'button';
      next.className = 'button';
      next.id = 'next-puzzle';
      next.textContent = 'Next puzzle';
      next.addEventListener('click', nextPuzzle);
      el.appendChild(next);
    }
  }

  function currentEnv() {
    if (!round || !anim.rows.length) return null;
    if (anim.index < 0 || anim.index >= anim.rows.length) return null;
    return anim.rows[anim.index].env;
  }

  function paintLamp(forceOn) {
    var lamp = document.getElementById('lamp');
    var env = currentEnv();
    var on = 0;
    if (forceOn && round && round.status === 'matched') {
      on = 1;
    } else if (env && round && logic.isComplete(round.circuit)) {
      on = logic.evaluate(round.circuit, env) || 0;
    }
    lamp.dataset.on = String(on);
    lamp.setAttribute('aria-label', on ? 'Output lamp on' : 'Output lamp off');
  }

  function startAnim(fromStart, onDone) {
    if (!round || !logic.isComplete(round.circuit)) {
      toast('Fill the circuit before running the signals.');
      return;
    }
    anim.rows = logic.truthTable(round.circuit, round.puzzle.inputs);
    if (fromStart || anim.index < 0) anim.index = -1;
    anim.playing = true;
    anim.onDone = onDone || null;
    document.getElementById('anim-play').disabled = true;
    document.getElementById('anim-pause').disabled = false;
    document.getElementById('anim-status').textContent = 'Running every input combination…';
    if (prefersReducedMotion()) {
      // Reduced motion: advance one row at a time without auto-play timing.
      anim.playing = false;
      document.getElementById('anim-play').disabled = false;
      document.getElementById('anim-pause').disabled = true;
      stepAnim(true);
      document.getElementById('anim-status').textContent =
        'Reduced motion: use Step to walk each row. Replay to start over.';
      return;
    }
    scheduleAnimTick();
  }

  function scheduleAnimTick() {
    window.clearTimeout(anim.timer);
    if (!anim.playing) return;
    anim.timer = window.setTimeout(function () {
      stepAnim(false);
    }, 720);
  }

  function stepAnim(manual) {
    if (!round || !logic.isComplete(round.circuit)) return;
    if (!anim.rows.length) {
      anim.rows = logic.truthTable(round.circuit, round.puzzle.inputs);
    }
    anim.index += 1;
    if (anim.index >= anim.rows.length) {
      finishAnim();
      return;
    }
    var row = anim.rows[anim.index];
    var label = round.puzzle.inputs.map(function (name, i) {
      return name + '=' + row.bits[i];
    }).join(', ');
    document.getElementById('anim-status').textContent =
      'Combination ' + (anim.index + 1) + ' of ' + anim.rows.length + ': ' + label +
      ' → OUT ' + row.out;
    announce('Inputs ' + label + ', output ' + row.out + '.');
    pulseCircuit();
    renderTruth();
    paintLamp(false);
    if (anim.playing && !manual) scheduleAnimTick();
    if (manual && prefersReducedMotion() && anim.index === anim.rows.length - 1 && anim.onDone) {
      var done = anim.onDone;
      anim.onDone = null;
      done();
    }
  }

  function pauseAnim() {
    anim.playing = false;
    window.clearTimeout(anim.timer);
    document.getElementById('anim-play').disabled = false;
    document.getElementById('anim-pause').disabled = true;
    if (anim.index >= 0) {
      document.getElementById('anim-status').textContent =
        'Paused on combination ' + (anim.index + 1) + ' of ' + anim.rows.length + '.';
    }
  }

  function finishAnim() {
    anim.playing = false;
    window.clearTimeout(anim.timer);
    // Park on the last row so signal reads stay valid if the student checks next.
    if (anim.rows.length) anim.index = anim.rows.length - 1;
    document.getElementById('anim-play').disabled = false;
    document.getElementById('anim-pause').disabled = true;
    document.getElementById('anim-status').textContent =
      'All ' + anim.rows.length + ' combinations shown.';
    renderTruth();
    paintLamp(round && round.status === 'matched');
    var done = anim.onDone;
    anim.onDone = null;
    if (done) done();
  }

  function stopAnim() {
    anim.playing = false;
    anim.index = -1;
    anim.rows = [];
    anim.onDone = null;
    window.clearTimeout(anim.timer);
    document.getElementById('anim-play').disabled = false;
    document.getElementById('anim-pause').disabled = true;
    document.getElementById('anim-status').textContent = 'Press play to walk every input combination.';
  }

  function pulseCircuit() {
    var board = document.getElementById('circuit-board');
    board.classList.remove('pulse');
    void board.offsetWidth;
    board.classList.add('pulse');
    renderTree();
  }

  function playCelebration() {
    var el = document.getElementById('celebrate');
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    document.getElementById('lamp').dataset.celebrate = '1';
    soundCelebrate();
    announce('Celebration. Circuit matched.');
    window.setTimeout(function () {
      if (prefersReducedMotion()) return;
      // Keep banner visible but quiet after the burst.
    }, 1200);
  }

  function currentElapsed() {
    if (!round) return 0;
    if (round.relaxed) return 0;
    if (!clock) return round.elapsedMs || 0;
    if (clock.held) return clock.elapsed;
    return clock.elapsed + (performance.now() - clock.started);
  }

  function startClock() {
    stopClock();
    if (!round || round.relaxed) {
      paintSpeed();
      return;
    }
    clock = {
      held: false,
      started: performance.now(),
      elapsed: 0,
      fastMs: round.puzzle.fastMs
    };
    tickSpeed();
  }

  function stopClock() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    clock = null;
  }

  function holdClock() {
    if (!clock || clock.held) return;
    clock.elapsed += performance.now() - clock.started;
    clock.held = true;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    paintSpeed();
  }

  function releaseClock() {
    if (!clock || !clock.held) return;
    if (round && round.status === 'matched') return;
    clock.held = false;
    clock.started = performance.now();
    tickSpeed();
  }

  function tickSpeed() {
    paintSpeed();
    if (!clock || clock.held) return;
    frameId = requestAnimationFrame(tickSpeed);
  }

  function paintSpeed() {
    if (!round) return;
    var bonus = logic.speedBonus(currentElapsed(), round.puzzle.fastMs, round.relaxed);
    document.getElementById('speed-bonus').textContent = '+' + bonus;
    var fill = document.getElementById('speed-fill');
    var ratio = round.relaxed ? 1 : bonus / logic.SPEED_BONUS_MAX;
    fill.style.transform = 'scaleX(' + ratio + ')';
  }

  function flashGain(amount) {
    var gain = document.getElementById('gain');
    gain.textContent = '+' + amount;
    gain.classList.remove('pop');
    void gain.offsetWidth;
    gain.classList.add('pop');
  }

  function toast(message) {
    var el = document.getElementById('toast');
    el.hidden = false;
    el.textContent = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.hidden = true;
    }, 3200);
  }

  function announce(message) {
    document.getElementById('live').textContent = message;
  }

  function renderMute() {
    document.getElementById('mute').textContent = muted ? 'Sound off' : 'Sound on';
  }

  function parsePath(raw) {
    if (!raw) return [];
    return raw.split('.').filter(Boolean).map(Number);
  }

  function formatNumber(n) {
    return String(n | 0);
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadProgress() {
    var raw = storageGet(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function saveProgress() {
    var payload = logic.serializeProgress(progress);
    // sessionLevel2 is intentionally not persisted
    storageSet(STORAGE_KEY, JSON.stringify(payload));
  }

  function ensureAudio() {
    if (muted) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep(freq, duration, type, gainValue) {
    if (muted || !audioCtx) return;
    var now = audioCtx.currentTime;
    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(gainValue || 0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  function soundPlace() { ensureAudio(); beep(440, 0.05, 'triangle', 0.03); }
  function soundWrong() { ensureAudio(); beep(180, 0.12, 'sawtooth', 0.04); }
  function soundClear() {
    ensureAudio();
    beep(523, 0.08, 'square', 0.05);
    window.setTimeout(function () { beep(784, 0.1, 'square', 0.05); }, 70);
  }
  function soundCelebrate() {
    ensureAudio();
    beep(523, 0.07, 'square', 0.045);
    window.setTimeout(function () { beep(659, 0.07, 'square', 0.045); }, 80);
    window.setTimeout(function () { beep(784, 0.12, 'square', 0.05); }, 160);
  }
  function soundLevel() {
    ensureAudio();
    beep(392, 0.1, 'triangle', 0.05);
    window.setTimeout(function () { beep(523, 0.1, 'triangle', 0.05); }, 100);
    window.setTimeout(function () { beep(659, 0.16, 'triangle', 0.055); }, 200);
  }
})();
