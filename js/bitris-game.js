(function () {
  'use strict';

  var logic = window.BitrisLogic;
  if (!logic) return;

  var SCORE_KEY = 'gamify.bitris.highScores';
  var MUTE_KEY = 'gamify.muted';
  var COACH_KEY = 'gamify.bitris.coach';

  var state = logic.createGame(loadScores());
  var muted = storageGet(MUTE_KEY) === '1';
  var coach = storageGet(COACH_KEY) !== '0';
  var audioCtx = null;
  var gravityTimer = 0;
  var raceTimer = 0;
  var toastTimer = 0;
  var flashTimer = 0;

  var coachBox = document.getElementById('coach');
  if (coachBox) coachBox.checked = coach;

  paintRuler();
  renderMute();
  renderBest();
  bind();

  function bind() {
    document.getElementById('setup-form').addEventListener('submit', onStart);
    document.getElementById('mute').addEventListener('click', function () {
      muted = !muted;
      storageSet(MUTE_KEY, muted ? '1' : '0');
      renderMute();
    });
    document.getElementById('pause').addEventListener('click', onPauseToggle);
    document.getElementById('quit').addEventListener('click', onQuit);
    coachBox.addEventListener('change', function () {
      coach = coachBox.checked;
      storageSet(COACH_KEY, coach ? '1' : '0');
      renderBoard();
    });
    document.getElementById('pad').addEventListener('click', onPad);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onStart(event) {
    event.preventDefault();
    ensureAudio();
    var started = logic.startGame(state, Math.random);
    state = logic.withRng(started.state, Math.random);
    showPlay();
    applyEvents(started.events);
    renderAll();
    startGravity();
    announce('Warm-up started. Clear ' + logic.WARMUP_CLEARS + ' rows.');
  }

  function onQuit() {
    stopLoops();
    state = logic.createGame(state.highScores);
    document.getElementById('play').hidden = true;
    document.getElementById('setup').hidden = false;
    document.getElementById('results').hidden = true;
    document.getElementById('overlay').hidden = true;
    document.body.dataset.view = 'setup';
    document.body.dataset.status = 'ready';
    renderBest();
  }

  function onPauseToggle() {
    if (state.status === 'playing') onPause();
    else if (state.status === 'paused') onResume();
  }

  function onPause() {
    if (state.status !== 'playing') return;
    stopLoops();
    state = logic.pauseGame(state).state;
    showOverlay('Paused', 'The piece waits.', [
      { label: 'Resume', primary: true, action: onResume }
    ]);
    document.getElementById('pause').textContent = 'Resume';
    document.body.dataset.status = 'paused';
    announce('Paused.');
  }

  function onResume() {
    if (state.status !== 'paused') return;
    state = logic.resumeGame(state).state;
    hideOverlay();
    document.getElementById('pause').textContent = 'Pause';
    document.body.dataset.status = 'playing';
    startGravity();
    if (state.phase === 'race') startRaceClock();
    announce('Resumed.');
  }

  function onVisibility() {
    if (document.hidden && state.status === 'playing') onPause();
  }

  function onPad(event) {
    var btn = event.target.closest('[data-act]');
    if (!btn || state.status !== 'playing') return;
    runAct(btn.getAttribute('data-act'));
  }

  function onKey(event) {
    if (event.target.closest('input, textarea, select')) return;
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      onPauseToggle();
      return;
    }
    if (state.status === 'paused' && event.key === 'Escape') {
      onResume();
      return;
    }
    if (state.status !== 'playing') return;
    var act = null;
    if (event.key === 'ArrowLeft') act = 'left';
    else if (event.key === 'ArrowRight') act = 'right';
    else if (event.key === 'ArrowDown') act = 'soft';
    else if (event.key === 'ArrowUp' || event.key === 'x' || event.key === 'X') act = 'rotate';
    else if (event.key === ' ') act = 'hard';
    if (!act) return;
    event.preventDefault();
    runAct(act);
  }

  function runAct(act) {
    ensureAudio();
    var result = null;
    if (act === 'left') result = logic.move(state, -1);
    else if (act === 'right') result = logic.move(state, 1);
    else if (act === 'rotate') result = logic.rotate(state);
    else if (act === 'soft') result = logic.softDrop(state);
    else if (act === 'hard') result = logic.hardDrop(state);
    if (!result) return;
    state = logic.withRng(result.state, Math.random);
    applyEvents(result.events);
    renderAll();
    if (result.events.some(function (e) { return e.type === 'lock' || e.type === 'clear'; })) {
      restartGravity();
    }
  }

  function showPlay() {
    document.getElementById('setup').hidden = true;
    document.getElementById('results').hidden = true;
    document.getElementById('play').hidden = false;
    hideOverlay();
    document.body.dataset.view = 'play';
    document.body.dataset.status = 'playing';
    document.getElementById('pause').textContent = 'Pause';
  }

  function startGravity() {
    stopGravity();
    if (state.status !== 'playing') return;
    gravityTimer = window.setInterval(function () {
      if (state.status !== 'playing') return;
      var result = logic.tick(state);
      state = logic.withRng(result.state, Math.random);
      applyEvents(result.events);
      renderAll();
      if (result.events.some(function (e) { return e.type === 'lock' || e.type === 'over' || e.type === 'warmup_done'; })) {
        restartGravity();
      }
    }, state.gravityMs || 900);
  }

  function restartGravity() {
    stopGravity();
    if (state.status === 'playing') startGravity();
  }

  function stopGravity() {
    if (gravityTimer) window.clearInterval(gravityTimer);
    gravityTimer = 0;
  }

  function startRaceClock() {
    stopRaceClock();
    raceTimer = window.setInterval(function () {
      if (state.status !== 'playing' || state.phase !== 'race') return;
      var result = logic.elapse(state, 250);
      state = result.state;
      renderHud();
      if (result.events.some(function (e) { return e.type === 'over'; })) {
        applyEvents(result.events);
        renderAll();
      }
    }, 250);
  }

  function stopRaceClock() {
    if (raceTimer) window.clearInterval(raceTimer);
    raceTimer = 0;
  }

  function stopLoops() {
    stopGravity();
    stopRaceClock();
  }

  function applyEvents(events) {
    events.forEach(function (event) {
      if (event.type === 'clear') {
        soundClear();
        flashGain(event.gained);
        flashClear(event.expression);
        announce('Cleared. ' + event.expression + '. +' + event.gained);
      }
      if (event.type === 'lock' && !events.some(function (e) { return e.type === 'clear'; })) {
        soundLock();
      }
      if (event.type === 'rotate' || event.type === 'move') {
        soundTick();
      }
      if (event.type === 'warmup_done') {
        stopLoops();
        persistScores();
        showWarmupDone();
      }
      if (event.type === 'over') {
        stopLoops();
        persistScores();
        soundOver();
        showResults(event);
      }
      if (event.type === 'race') {
        startRaceClock();
        restartGravity();
      }
    });
  }

  function showWarmupDone() {
    document.body.dataset.status = 'warmup_done';
    var actions = logic.TIME_LIMITS.map(function (limit) {
      return {
        label: logic.limitLabel(limit),
        primary: limit === 120,
        action: function () { startRace(limit); }
      };
    });
    actions.push({ label: 'Menu', action: onQuit });
    showOverlay(
      'Warm-up clear',
      'Score ' + state.score + ' from ' + state.clears + ' clears. Pick a race.',
      actions
    );
    announce('Warm-up done. Choose a race length.');
  }

  function startRace(limit) {
    ensureAudio();
    var raced = logic.beginRace(state, limit);
    state = logic.withRng(raced.state, Math.random);
    hideOverlay();
    document.body.dataset.status = 'playing';
    document.getElementById('pause').textContent = 'Pause';
    applyEvents(raced.events);
    renderAll();
    startGravity();
    announce(logic.limitLabel(limit) + ' race. Go.');
  }

  function showResults(event) {
    document.body.dataset.status = 'over';
    var reason = event.reason === 'time' ? 'Time.' : 'Stack full.';
    var results = document.getElementById('results');
    results.hidden = false;
    results.innerHTML =
      '<p class="kicker">Round over</p>' +
      '<h2>' + reason + '</h2>' +
      '<p>Score <strong>' + event.score + '</strong> · ' + event.clears + ' clears' +
      (event.timeLimit ? ' · ' + logic.limitLabel(event.timeLimit) : '') +
      '.</p>' +
      '<button type="button" class="button" id="again">Play again</button>';
    document.getElementById('again').addEventListener('click', function () {
      onQuit();
      document.getElementById('start').click();
    });
    showOverlay(reason, 'Score ' + event.score + '.', [
      { label: 'Play again', primary: true, action: function () {
        hideOverlay();
        onQuit();
        document.getElementById('start').click();
      } },
      { label: 'Menu', action: onQuit }
    ]);
    announce(reason + ' Score ' + event.score + '.');
    results.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function showOverlay(title, copy, actions) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-copy').textContent = copy;
    var box = document.getElementById('overlay-actions');
    box.replaceChildren();
    (actions || []).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = item.primary ? 'button' : 'button secondary';
      btn.textContent = item.label;
      btn.addEventListener('click', item.action);
      box.appendChild(btn);
    });
    document.getElementById('overlay').hidden = false;
  }

  function hideOverlay() {
    document.getElementById('overlay').hidden = true;
  }

  function renderAll() {
    renderHud();
    renderBoard();
    renderNext();
  }

  function renderHud() {
    document.getElementById('score').textContent = String(state.score);
    document.getElementById('clears').textContent = String(state.clears);
    var phase = 'Warm-up';
    if (state.phase === 'race') phase = logic.limitLabel(state.timeLimit) || 'Race';
    if (state.phase === 'warmup_done') phase = 'Race pick';
    if (state.status === 'over') phase = 'Over';
    document.getElementById('phase').textContent = phase;
    var clockStat = document.getElementById('clock-stat');
    if (state.phase === 'race') {
      clockStat.hidden = false;
      document.getElementById('clock').textContent = formatTime(state.remainingMs);
    } else {
      clockStat.hidden = true;
    }
  }

  function paintRuler() {
    var ruler = document.getElementById('ruler');
    ruler.replaceChildren();
    logic.PLACE_VALUES.forEach(function (value) {
      var span = document.createElement('span');
      span.textContent = String(value);
      ruler.appendChild(span);
    });
    var tip = document.createElement('span');
    tip.className = 'ruler-target';
    tip.textContent = 'Σ';
    ruler.appendChild(tip);
  }

  function renderBoard() {
    var boardEl = document.getElementById('board');
    boardEl.replaceChildren();
    var ghost = state.piece ? logic.ghostRow(state.board, state.piece) : -1;
    var occupied = {};

    if (state.piece) {
      markPiece(occupied, state.piece, 'active');
      if (ghost !== state.piece.row) {
        markPiece(occupied, {
          shape: state.piece.shape,
          row: ghost,
          col: state.piece.col
        }, 'ghost');
      }
    }

    for (var r = 0; r < logic.ROWS; r += 1) {
      var rowEl = document.createElement('div');
      rowEl.className = 'well-row';
      rowEl.setAttribute('role', 'row');
      var row = state.board[r];
      for (var c = 0; c < logic.COLS; c += 1) {
        var cell = document.createElement('div');
        cell.className = 'well-cell';
        cell.setAttribute('role', 'gridcell');
        var key = r + ':' + c;
        if (row.cells[c]) cell.classList.add('on');
        if (occupied[key] === 'active') cell.classList.add('piece');
        if (occupied[key] === 'ghost') cell.classList.add('ghost');
        rowEl.appendChild(cell);
      }
      var target = document.createElement('div');
      target.className = 'row-target';
      if (row.target != null) {
        var sum = logic.rowSum(row);
        var label = document.createElement('span');
        label.className = 'target-value';
        label.textContent = String(row.target);
        target.appendChild(label);
        if (coach) {
          var hint = document.createElement('small');
          hint.textContent = sum + ' / ' + row.target;
          target.appendChild(hint);
          if (sum === row.target) target.classList.add('ready');
          if (sum > row.target) target.classList.add('over');
        }
        target.setAttribute('aria-label', 'Target ' + row.target + ', current sum ' + sum);
      } else {
        target.textContent = '·';
        target.classList.add('empty');
      }
      rowEl.appendChild(target);
      boardEl.appendChild(rowEl);
    }
  }

  function markPiece(map, piece, kind) {
    piece.shape.forEach(function (line, r) {
      line.forEach(function (bit, c) {
        if (!bit) return;
        var br = piece.row + r;
        var bc = piece.col + c;
        if (br < 0 || br >= logic.ROWS || bc < 0 || bc >= logic.COLS) return;
        if (map[br + ':' + bc] === 'active') return;
        map[br + ':' + bc] = kind;
      });
    });
  }

  function renderNext() {
    var el = document.getElementById('next-piece');
    el.replaceChildren();
    if (!state.next) return;
    var shape = state.next.shape;
    var size = logic.shapeSize(shape);
    el.style.gridTemplateColumns = 'repeat(' + size.w + ', 1fr)';
    for (var r = 0; r < size.h; r += 1) {
      for (var c = 0; c < size.w; c += 1) {
        var cell = document.createElement('span');
        cell.className = 'next-cell' + (shape[r][c] ? ' on' : '');
        el.appendChild(cell);
      }
    }
  }

  function renderBest() {
    var line = document.getElementById('best-line');
    var parts = logic.TIME_LIMITS.map(function (limit) {
      var best = state.highScores[limit] || 0;
      return logic.limitLabel(limit) + ' best ' + best;
    }).filter(Boolean);
    if (!parts.some(function (_, i) { return state.highScores[logic.TIME_LIMITS[i]]; })) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.textContent = parts.join(' · ');
  }

  function flashGain(amount) {
    var gain = document.getElementById('gain');
    gain.textContent = '+' + amount;
    gain.classList.remove('pop');
    void gain.offsetWidth;
    gain.classList.add('pop');
  }

  function flashClear(text) {
    var el = document.getElementById('clear-flash');
    el.hidden = false;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(function () {
      el.hidden = true;
    }, prefersReducedMotion() ? 1200 : 1600);
  }

  function toast(message) {
    var el = document.getElementById('toast');
    el.hidden = false;
    el.textContent = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.hidden = true; }, 2800);
  }

  function announce(message) {
    document.getElementById('live').textContent = message;
  }

  function renderMute() {
    document.getElementById('mute').textContent = muted ? 'Sound off' : 'Sound on';
  }

  function formatTime(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (err) { return null; }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadScores() {
    var raw = storageGet(SCORE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (err) { return null; }
  }

  function persistScores() {
    storageSet(SCORE_KEY, JSON.stringify(logic.copyHighScores(state.highScores)));
    renderBest();
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

  function soundTick() { ensureAudio(); beep(380, 0.03, 'triangle', 0.02); }
  function soundLock() { ensureAudio(); beep(220, 0.06, 'square', 0.035); }
  function soundClear() {
    ensureAudio();
    beep(523, 0.07, 'square', 0.05);
    window.setTimeout(function () { beep(784, 0.1, 'square', 0.05); }, 70);
  }
  function soundOver() { ensureAudio(); beep(160, 0.25, 'sawtooth', 0.04); }
})();
