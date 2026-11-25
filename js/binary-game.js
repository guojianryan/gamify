(function () {
  'use strict';

  var logic = window.BinaryLogic;
  if (!logic) return;

  var GUIDE_KEY = 'gamify.binary.seenGuide';
  var PROGRESS_KEY = 'gamify.binary.progress';
  var HOLD_MS = 2000;
  var CLEAR_MS = 450;
  var MOMENT_MS = 1600;

  var progress = readProgress();
  var state = logic.createGame({ highScores: progress.highScores });
  if (progress.misses) state.misses = progress.misses;

  var selectedId = null;
  var coach = storageGet('gamify.binary.coach') === '1';
  var forceValues = storageGet('gamify.binary.forceValues') === '1';
  var muted = storageGet('gamify.muted') === '1';
  var bestAtStart = state.highScore;
  var clock = null;
  var frameId = 0;
  var toastTimer = 0;
  var momentTimer = 0;
  var momentOpen = false;
  var warnedFull = false;
  var audioCtx = null;
  var holds = {};
  var swallowClick = false;
  var menuOpen = false;
  var pendingFocusId = null;
  var raceClock = 0;
  var raceEndsAt = 0;

  var coachBox = document.getElementById('coach');
  var valuesBox = document.getElementById('force-values');
  if (coachBox) coachBox.checked = coach;
  if (valuesBox) valuesBox.checked = forceValues;

  bind();
  renderMute();
  render();

  function bind() {
    document.getElementById('setup-form').addEventListener('submit', onStart);
    document.getElementById('pause').addEventListener('click', function () {
      if (state.status === 'playing') onPause();
      else onResume();
    });
    document.getElementById('resume').addEventListener('click', onResume);
    document.getElementById('choose').addEventListener('click', onChooseLimit);
    document.getElementById('mute').addEventListener('click', function () {
      muted = !muted;
      storageSet('gamify.muted', muted ? '1' : '0');
      renderMute();
    });
    document.getElementById('menu-toggle').addEventListener('click', function () {
      menuOpen = !menuOpen;
      document.getElementById('menu-panel').hidden = !menuOpen;
      this.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    });
    document.getElementById('show-howto').addEventListener('click', function () {
      var howto = document.getElementById('howto');
      var open = howto.hidden;
      howto.hidden = !open;
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        howto.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'nearest'
        });
      }
    });
    coachBox.addEventListener('change', function () {
      coach = coachBox.checked;
      storageSet('gamify.binary.coach', coach ? '1' : '0');
      render();
    });
    valuesBox.addEventListener('change', function () {
      forceValues = valuesBox.checked;
      storageSet('gamify.binary.forceValues', forceValues ? '1' : '0');
      render();
    });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onSwallowClick, true);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onStart(event) {
    event.preventDefault();
    clearHolds();
    hideMoment();
    bestAtStart = 0;
    stopRaceClock();
    var started = logic.startGame(state, Math.random, {
      guide: storageGet(GUIDE_KEY) !== '1'
    });
    state = started.state;
    selectedId = state.rows.length ? state.rows[0].id : null;
    warnedFull = false;
    document.getElementById('board').replaceChildren();
    applyEvents(started.events);
    render();
  }

  function onPause() {
    if (state.status !== 'playing') return;
    holdClock();
    holdRaceClock();
    state = logic.pauseGame(state, performance.now()).state;
    render();
  }

  function onResume() {
    if (state.status !== 'paused') return;
    state = logic.resumeGame(state, performance.now()).state;
    render();
    releaseRaceClock();
  }

  function onChooseLimit(event) {
    var button = event.target.closest('[data-limit]');
    if (!button || state.status !== 'choose') return;
    var limit = Number(button.dataset.limit);
    var started = logic.beginRace(state, limit, Math.random, performance.now());
    if (!started.events.length) return;
    state = started.state;
    selectedId = state.rows.length ? state.rows[0].id : null;
    document.getElementById('board').replaceChildren();
    applyEvents(started.events);
    render();
  }

  function onToggle(id, index) {
    var wasGuide = state.guide;
    var previous = state;
    var result = logic.toggleBit(state, id, index, performance.now());
    var solved = result.events.some(function (event) { return event.type === 'solved'; });
    state = result.state;
    if (!solved && state !== previous) soundToggle();
    applyEvents(result.events);
    if (wasGuide && !state.guide && state.status === 'playing') spawnFollowUp();
    render();
    afterEvents(result.events);
  }

  function onSubmit(id) {
    var result = logic.submitDecimal(state, id, performance.now());
    state = result.state;
    applyEvents(result.events);
    render();
    afterEvents(result.events);
    if (result.result === 'correct') focusNextDecimal();
  }

  function onDraftInput(event) {
    var input = event.currentTarget;
    var id = Number(input.closest('.row').dataset.id);
    var drafted = logic.setDraft(state, id, input.value);
    state = drafted.state;
    var row = findRow(id);
    if (row && input.value !== row.draft) input.value = row.draft;
    input.classList.remove('wrong');
    input.removeAttribute('aria-invalid');
    if (row) paintRemainder(input.closest('.row'), row);
  }

  function onDraftKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    onSubmit(Number(event.currentTarget.closest('.row').dataset.id));
  }

  function onRowClick(event) {
    if (state.status !== 'playing') return;
    if (heldRows().length) return;
    var rowEl = event.currentTarget;
    selectedId = Number(rowEl.dataset.id);
    var bit = event.target.closest('[data-bit]');
    if (bit && !bit.disabled) {
      onToggle(selectedId, Number(bit.dataset.bit));
      return;
    }
    paintSelection();
    var input = rowEl.querySelector('input');
    if (input && event.target !== input) input.focus();
  }

  function onPointerDown(event) {
    if (!heldRows().length || state.status !== 'playing') return;
    if (event.target.closest && event.target.closest('#menu-panel, #menu-toggle')) return;
    swallowClick = true;
    releaseIfHeld();
  }

  function onSwallowClick(event) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function onKeydown(event) {
    var key = event.key;
    if ((key === 'p' || key === 'P') && !typingIn(event.target)) {
      event.preventDefault();
      if (state.status === 'playing') onPause();
      else if (state.status === 'paused') onResume();
      return;
    }
    if (key === 'Escape' && state.status === 'paused') {
      event.preventDefault();
      onResume();
      return;
    }
    if (state.status === 'playing' && heldRows().length) {
      event.preventDefault();
      releaseIfHeld();
      return;
    }
    if (state.status !== 'playing') return;
    if (!gameKeyContext(event.target)) return;
    if (event.target.matches && event.target.matches('input')) return;

    var row = selectedPlayable();
    if (!row || row.phase !== 'play') return;
    if (row.mode === 'decimal' && /^[0-9]$/.test(key)) {
      event.preventDefault();
      selectedId = row.id;
      var drafted = logic.setDraft(state, row.id, row.draft + key);
      state = drafted.state;
      render();
      focusInput(row.id);
      return;
    }
    if (row.mode === 'decimal' && key === 'Backspace') {
      event.preventDefault();
      selectedId = row.id;
      state = logic.setDraft(state, row.id, row.draft.slice(0, -1)).state;
      render();
      focusInput(row.id);
      return;
    }
    if (row.mode === 'decimal' && key === 'Enter') {
      event.preventDefault();
      onSubmit(row.id);
      return;
    }
    if (row.mode === 'bits' && /^[1-8]$/.test(key)) {
      event.preventDefault();
      onToggle(row.id, Number(key) - 1);
    }
  }

  function onVisibility() {
    if (state.status !== 'playing') return;
    if (document.hidden) {
      holdClock();
      holdRaceClock();
    } else {
      syncSpawnClock();
      releaseRaceClock();
    }
  }

  function selectedPlayable() {
    var selected = findRow(selectedId);
    if (selected) return selected;
    return state.rows[0] || null;
  }

  function focusInput(id) {
    var input = document.querySelector('.row[data-id="' + id + '"] input');
    if (input) input.focus();
  }

  function focusNextDecimal() {
    var next = state.rows.find(function (row) { return row.mode === 'decimal' && row.phase === 'play'; });
    if (!next) return;
    selectedId = next.id;
    paintSelection();
    focusInput(next.id);
  }

  function render() {
    ensureSelection();
    document.body.dataset.status = state.status;
    renderHud();
    renderRuler();
    syncRows();
    renderChrome();
    renderResults();
    syncSpawnClock();
    paintMeter();
    maybeWarn();
    if (pendingFocusId != null) {
      var focusId = pendingFocusId;
      pendingFocusId = null;
      if (state.status === 'playing' && findRow(focusId)) {
        selectedId = focusId;
        paintSelection();
        focusInput(focusId);
      }
    }
  }

  function renderHud() {
    document.getElementById('score').textContent = formatNumber(state.score);
    var pace = document.getElementById('pace');
    if (state.racing) {
      pace.textContent = formatClock(state.remainingMs);
      pace.classList.add('clock');
    } else {
      pace.textContent = 'Warm-up';
      pace.classList.remove('clock');
    }
    document.getElementById('cleared').textContent = String(state.solved);
    document.getElementById('streak').textContent = String(state.streak);
    var bestValue = state.racing ? ((state.highScores && state.highScores[state.limitSec]) || 0) : bestOverall(state.highScores);
    document.getElementById('best').textContent = bestValue ? formatNumber(bestValue) : '—';
    var mult = logic.streakMultiplier(state.streak);
    var multNode = document.getElementById('mult');
    multNode.textContent = '×' + mult;
    multNode.classList.toggle('hot', state.streak > 1);
    var pips = document.getElementById('pips');
    pips.hidden = !!state.racing;
    if (pips.childElementCount !== logic.WARMUP_ROWS) {
      pips.replaceChildren();
      for (var i = 0; i < logic.WARMUP_ROWS; i += 1) {
        var pip = document.createElement('span');
        pip.className = 'pip';
        pips.appendChild(pip);
      }
    }
    Array.prototype.forEach.call(pips.children, function (pip, index) {
      pip.classList.toggle('on', index < state.cleanRows);
    });
    var pause = document.getElementById('pause');
    var playingOrPaused = state.status === 'playing' || state.status === 'paused';
    pause.hidden = !playingOrPaused;
    pause.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
  }

  function renderRuler() {
    var ruler = document.getElementById('ruler');
    var show = true;
    if (!ruler.childElementCount) {
      logic.BIT_VALUES.forEach(function (value) {
        var span = document.createElement('span');
        span.className = 'place';
        span.textContent = String(value);
        ruler.appendChild(span);
      });
      var eq = document.createElement('span');
      eq.className = 'eq';
      eq.textContent = '=';
      ruler.appendChild(eq);
    }
    ruler.querySelectorAll('.place').forEach(function (span, index) {
      var value = logic.BIT_VALUES[index];
      var power = logic.BIT_VALUES.length - 1 - index;
      span.dataset.hidden = show ? 'false' : 'true';
      if (show) {
        span.title = '2^' + power + ' = ' + value;
        span.removeAttribute('aria-hidden');
      } else {
        span.removeAttribute('title');
        span.setAttribute('aria-hidden', 'true');
      }
    });
    var eqNode = ruler.querySelector('.eq');
    eqNode.dataset.hidden = show ? 'false' : 'true';
    if (show) eqNode.removeAttribute('aria-hidden');
    else eqNode.setAttribute('aria-hidden', 'true');
  }

  function syncRows() {
    var board = document.getElementById('board');
    var keep = new Set(state.rows.map(function (row) { return String(row.id); }));
    Array.prototype.forEach.call(Array.from(board.children), function (child) {
      if (keep.has(child.dataset.id) || child.classList.contains('clearing')) return;
      child.classList.add('clearing');
      window.setTimeout(function () {
        if (child.parentNode) child.remove();
        var empty = document.getElementById('empty');
        if (empty && !document.querySelector('#board .row') && state.rows.length === 0) {
          empty.hidden = false;
        }
      }, prefersReducedMotion() ? 0 : CLEAR_MS);
    });
    state.rows.forEach(function (row, index) {
      var el = board.querySelector('[data-id="' + row.id + '"]:not(.clearing)');
      if (el && el.dataset.mode !== row.mode) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildRow(row);
        placeAbove(board, el, row.id);
      }
      updateRow(el, row);
    });
  }

  // Newest id goes first in the column, which puts it above the rows already there.
  function placeAbove(board, el, rowId) {
    var older = null;
    Array.prototype.forEach.call(board.children, function (child) {
      if (older || child.classList.contains('clearing') || child === el) return;
      if (Number(child.dataset.id) < rowId) older = child;
    });
    if (older) board.insertBefore(el, older);
    else board.appendChild(el);
  }

  function buildRow(row) {
    var el = document.createElement('article');
    el.className = 'row';
    el.dataset.id = String(row.id);
    el.dataset.mode = row.mode;

    row.bits.forEach(function (_bit, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'bit';
      button.dataset.bit = String(index);
      el.appendChild(button);
    });

    var ticket = document.createElement('div');
    ticket.className = 'ticket';
    if (row.mode === 'bits') {
      var strong = document.createElement('strong');
      strong.className = 'target';
      var sum = document.createElement('span');
      sum.className = 'sum';
      ticket.append(strong, sum);
    } else {
      var left = document.createElement('span');
      left.className = 'left';
      left.hidden = true;
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.enterKeyHint = 'done';
      input.maxLength = 3;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = '?';
      input.setAttribute('aria-label', 'Decimal value');
      input.addEventListener('input', onDraftInput);
      input.addEventListener('keydown', onDraftKeydown);
      input.addEventListener('focus', function () {
        selectedId = Number(el.dataset.id);
        paintSelection();
      });
      ticket.append(input, left);
    }
    el.appendChild(ticket);
    var lesson = document.createElement('p');
    lesson.className = 'lesson';
    lesson.hidden = true;
    el.appendChild(lesson);
    el.addEventListener('click', onRowClick);
    return el;
  }

  function updateRow(el, row) {
    var teaching = row.phase === 'teach' || row.phase === 'reveal';
    el.classList.toggle('selected', row.id === selectedId);
    el.classList.toggle('teaching', teaching);
    var label = row.mode === 'bits'
      ? 'Set the bits to equal ' + row.value + '. ' + leftLabel(logic.remaining(row.value, logic.valueOf(row.bits)))
      : 'Type the decimal value of these bits';
    if (row.feedback && teaching) label = row.feedback;
    el.setAttribute('aria-label', label);
    el.querySelectorAll('[data-bit]').forEach(function (button, index) {
      var on = row.bits[index] === 1;
      var marked = row.wrongIndexes.indexOf(index) !== -1;
      var showMark = marked && (teaching || (row.mode === 'decimal' && row.retries > 0));
      var hint = state.guide && row.phase === 'play' && !on && (index === 4 || index === 6);
      button.textContent = on ? '1' : '0';
      button.classList.toggle('on', on);
      button.classList.toggle('locked', row.mode !== 'bits');
      button.classList.toggle('miss', showMark);
      button.classList.toggle('hint', hint);
      button.disabled = row.mode !== 'bits' || state.status !== 'playing';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', logic.BIT_VALUES[index] + (on ? ' on' : ' off'));
    });
    var lesson = el.querySelector('.lesson');
    if (row.feedback && (teaching || row.retries > 0)) {
      lesson.hidden = false;
      lesson.textContent = row.feedback;
    } else {
      lesson.hidden = true;
      lesson.textContent = '';
    }
    if (row.mode === 'bits') {
      el.querySelector('.target').textContent = String(row.value);
      paintRemainder(el, row);
    } else {
      var input = el.querySelector('input');
      paintRemainder(el, row);
      input.disabled = state.status !== 'playing' || row.phase !== 'play';
      if (input.value !== row.draft && (document.activeElement !== input || input.disabled)) {
        input.value = row.draft;
      }
      input.classList.toggle('wrong', row.wrong && teaching);
      if (row.wrong && teaching) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function paintSelection() {
    document.querySelectorAll('.row').forEach(function (el) {
      el.classList.toggle('selected', Number(el.dataset.id) === selectedId);
    });
  }

  function renderChrome() {
    var inRound = state.status === 'playing' || state.status === 'paused' || state.status === 'choose';
    document.getElementById('setup').hidden = inRound;
    document.getElementById('overlay').hidden = state.status !== 'paused';
    document.getElementById('choose').hidden = state.status !== 'choose';
    var playfield = document.getElementById('playfield');
    var nearlyFull = state.status === 'playing' && state.rows.length >= logic.MAX_ROWS - 1;
    playfield.classList.toggle('danger', nearlyFull);
    playfield.classList.toggle('full', state.status === 'playing' && state.rows.length >= logic.MAX_ROWS);
    playfield.classList.toggle('ended', state.status === 'over');
    playfield.classList.toggle('topout', state.status === 'over' && state.endedBy === 'column');
    var guide = document.getElementById('guide');
    var showGuide = !!(state.guide && (state.status === 'playing' || state.status === 'paused'));
    guide.hidden = !showGuide;
    if (showGuide) guide.textContent = 'Tap the 8 and the 2 to make 10.';
    var best = document.getElementById('best-pace');
    best.hidden = false;
    best.textContent = bestLine(state.highScores);
    var empty = document.getElementById('empty');
    empty.hidden = state.rows.length !== 0 || !!document.querySelector('#board .row');
    if (state.status === 'playing' && state.racing) {
      empty.textContent = 'Column clear. The next row is on the way.';
    } else if (state.status === 'playing') {
      empty.textContent = 'Warm-up. The next row is on the way.';
    } else if (state.status === 'ready') {
      empty.textContent = storageGet(GUIDE_KEY) === '1'
        ? 'Press start. The first row appears at the bottom of the well.'
        : 'Press start. The first row shows you which bits to tap.';
    } else {
      empty.textContent = 'Column clear.';
    }
    document.getElementById('pressure').textContent = pressureText();
    document.getElementById('start').textContent = state.status === 'over' ? 'Play again' : 'Start';
  }

  function renderResults() {
    var box = document.getElementById('results');
    if (state.status !== 'over') {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    box.replaceChildren();
    var heading = document.createElement('h2');
    if (!state.racing && state.endedBy !== 'time') {
      heading.textContent = 'Warm-up ended.';
    } else if (state.score > bestAtStart) {
      heading.textContent = 'New best.';
    } else if (state.endedBy === 'time') {
      heading.textContent = 'Time.';
    } else {
      heading.textContent = 'The column filled.';
    }
    var summary = document.createElement('p');
    var summaryText = 'Score ' + formatNumber(state.score);
    if (state.racing || state.endedBy === 'time') {
      summaryText += ' in ' + logic.limitLabel(state.limitSec);
      if (state.endedBy === 'column' && state.remainingMs > 0) {
        summaryText += ', with ' + formatClock(state.remainingMs) + ' left';
      }
    }
    summaryText += '. ' + state.solved + ' cleared. Best streak ' + state.bestStreak + '.';
    summary.textContent = summaryText;
    var weakText = logic.weakSpotText(state.misses);
    var weak = null;
    if (weakText) {
      weak = document.createElement('p');
      weak.className = 'weak';
      weak.textContent = weakText;
    }
    var note = document.createElement('p');
    note.className = 'review-note';
    note.textContent = 'These rows were still open:';
    var list = document.createElement('ol');
    list.className = 'review';
    state.rows.forEach(function (row) {
      var item = document.createElement('li');
      item.textContent = formatBits(row.value) + ' = ' + logic.expression(row.value) + ' = ' + row.value;
      list.appendChild(item);
    });
    var parts = [heading, summary];
    if (weak) parts.push(weak);
    if (state.rows.length) parts.push(note, list);
    box.append.apply(box, parts);
  }

  function pressureText() {
    if (state.status === 'choose') return 'Warm-up done. Pick a time.';
    if (state.status !== 'playing') return '';
    if (state.guide) return 'One row. Tap the marked bits.';
    var open = logic.MAX_ROWS - state.rows.length;
    if (open <= 0) return 'Clear a row before the next one arrives.';
    if (open === 1) return 'One empty slot.';
    var count = state.rows.length + ' of ' + logic.MAX_ROWS + ' rows on the column.';
    if (!state.racing) return 'Warm-up. ' + count;
    return count;
  }

  function applyEvents(events) {
    var gained = 0;
    var multiplier = 1;
    var chose = false;
    var raceLimit = 0;
    events.forEach(function (event) {
      if (event.type === 'spawn' && event.mode === 'decimal') pendingFocusId = event.rowId;
      if (event.type === 'solved') {
        gained += event.gained;
        multiplier = event.multiplier || 1;
      }
      if (event.type === 'choose') chose = true;
      if (event.type === 'race') raceLimit = event.limitSec;
      if (event.type === 'teach' || event.type === 'reveal') {
        soundWrong();
        announce(event.feedback);
        scheduleHold(event.rowId);
      }
      if (event.type === 'over') {
        soundOver();
        announce('Round over. Score ' + formatNumber(event.score) + '.');
        stopClock();
        stopRaceClock();
      }
    });
    if (gained) {
      soundClear();
      flashGain(gained, multiplier);
      announce('Cleared. ' + gained + ' points. Score ' + formatNumber(state.score) + '.');
    }
    if (chose) {
      stopClock();
      announce('Warm-up done. Pick 1 minute, 2 minutes, or 5 minutes.');
    }
    if (raceLimit) {
      bestAtStart = (state.highScores && state.highScores[raceLimit]) || 0;
      startRaceClock();
      announce(logic.limitLabel(raceLimit) + '. Score as many points as you can.');
    }
    if (events.some(function (event) {
      return event.type === 'solved' || event.type === 'teach' || event.type === 'reveal' || event.type === 'over' || event.type === 'pace';
    })) {
      persistBest();
      persistProgress();
    }
    if (!state.guide && events.some(function (event) { return event.type === 'solved'; })) {
      storageSet(GUIDE_KEY, '1');
    }
  }

  function afterEvents(events) {
    events.forEach(function (event) {
      if (event.type !== 'teach' && event.type !== 'reveal') return;
      var node = document.querySelector('[data-id="' + event.rowId + '"]');
      if (!node) return;
      node.classList.remove('shake');
      void node.offsetWidth;
      node.classList.add('shake');
    });
    if (events.some(function (event) { return event.type === 'over'; })) {
      document.getElementById('results').scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start'
      });
    }
  }

  function maybeWarn() {
    if (state.status === 'playing' && state.rows.length >= logic.MAX_ROWS && !warnedFull) {
      warnedFull = true;
      announce('Column full. Clear a row.');
    }
    if (state.rows.length < logic.MAX_ROWS) warnedFull = false;
  }

  function spawnFollowUp() {
    if (state.rows.length >= logic.MAX_ROWS) return;
    var spawned = logic.spawnRow(state, Math.random, performance.now());
    state = spawned.state;
    applyEvents(spawned.events);
  }

  function heldRows() {
    return state.rows.filter(function (row) {
      return row.phase === 'teach' || row.phase === 'reveal';
    });
  }

  function scheduleHold(rowId) {
    if (holds[rowId]) window.clearTimeout(holds[rowId]);
    holds[rowId] = window.setTimeout(function () {
      delete holds[rowId];
      releaseRow(rowId);
    }, HOLD_MS);
  }

  function releaseRow(rowId) {
    if (holds[rowId]) {
      window.clearTimeout(holds[rowId]);
      delete holds[rowId];
    }
    var result = logic.releaseHold(state, rowId, performance.now());
    if (!result.events.length) return;
    state = result.state;
    render();
    var released = findRow(rowId);
    if (released && released.mode === 'decimal' && released.phase === 'play') focusInput(rowId);
  }

  function releaseIfHeld() {
    var held = heldRows();
    if (!held.length) return false;
    var focusId = null;
    held.forEach(function (row) {
      if (holds[row.id]) {
        window.clearTimeout(holds[row.id]);
        delete holds[row.id];
      }
      var result = logic.releaseHold(state, row.id, performance.now());
      if (!result.events.length) return;
      state = result.state;
      var released = findRow(row.id);
      if (released && released.mode === 'decimal' && released.phase === 'play') focusId = released.id;
    });
    render();
    if (focusId) focusInput(focusId);
    return true;
  }

  function clearHolds() {
    Object.keys(holds).forEach(function (id) {
      window.clearTimeout(holds[id]);
      delete holds[id];
    });
  }

  function showMoment(name) {
    momentOpen = true;
    document.getElementById('moment-name').textContent = name;
    document.getElementById('moment').hidden = false;
    if (momentTimer) window.clearTimeout(momentTimer);
    momentTimer = window.setTimeout(function () {
      momentTimer = 0;
      momentOpen = false;
      document.getElementById('moment').hidden = true;
      if (state.status === 'playing') syncSpawnClock();
    }, MOMENT_MS);
  }

  function hideMoment() {
    if (momentTimer) window.clearTimeout(momentTimer);
    momentTimer = 0;
    momentOpen = false;
    var node = document.getElementById('moment');
    if (node) node.hidden = true;
  }

  function shouldFreezeSpawn() {
    return !!(state.guide || momentOpen || heldRows().length);
  }

  function syncSpawnClock() {
    if (state.status !== 'playing') return;
    if (shouldFreezeSpawn()) {
      if (clock && !clock.held) holdClock();
      return;
    }
    if (!clock) startClock();
    else if (clock.held) releaseClock();
  }

  function startClock(ms) {
    stopClock();
    var delay = ms == null ? logic.spawnDelay(state) : ms;
    var handle = window.setTimeout(onSpawnDue, delay);
    clock = {
      held: false,
      handle: handle,
      started: performance.now(),
      delay: delay
    };
    tickMeter();
  }

  function stopClock() {
    if (clock && clock.handle) window.clearTimeout(clock.handle);
    clock = null;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function holdClock() {
    if (!clock || clock.held) return;
    var elapsed = performance.now() - clock.started;
    var remaining = Math.max(0, clock.delay - elapsed);
    var fraction = clock.delay === 0 ? 1 : Math.min(1, elapsed / clock.delay);
    window.clearTimeout(clock.handle);
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    clock = { held: true, handle: 0, delay: remaining, fraction: fraction };
    paintMeter();
  }

  function releaseClock() {
    if (!clock || !clock.held || state.status !== 'playing') return;
    startClock(clock.delay);
  }

  function onSpawnDue() {
    clock = null;
    if (state.status !== 'playing') return;
    var spawned = logic.spawnRow(state, Math.random, performance.now());
    state = spawned.state;
    applyEvents(spawned.events);
    render();
    afterEvents(spawned.events);
  }

  function tickMeter() {
    paintMeter();
    if (!clock || clock.held || state.status !== 'playing') return;
    frameId = requestAnimationFrame(tickMeter);
  }

  function paintMeter() {
    var meter = document.getElementById('meter');
    var amount = 0;
    if (clock && state.status === 'playing') {
      if (clock.held) amount = clock.fraction || 0;
      else amount = Math.min(1, (performance.now() - clock.started) / clock.delay);
    }
    meter.style.transform = 'scaleX(' + amount + ')';
  }

  function flashGain(amount, multiplier) {
    var gain = document.getElementById('gain');
    gain.textContent = '+' + amount;
    gain.classList.remove('pop');
    void gain.offsetWidth;
    gain.classList.add('pop');
    var multNode = document.getElementById('mult');
    if (multiplier > 1) {
      multNode.classList.remove('pop');
      void multNode.offsetWidth;
      multNode.classList.add('pop');
    }
    window.setTimeout(function () {
      gain.textContent = '';
      gain.classList.remove('pop');
    }, 760);
  }

  function toast(text) {
    var node = document.getElementById('toast');
    node.hidden = false;
    node.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      node.hidden = true;
    }, 2200);
  }

  function announce(text) {
    var live = document.getElementById('live');
    live.textContent = '';
    window.setTimeout(function () {
      live.textContent = text;
    }, 30);
  }

  function renderMute() {
    var button = document.getElementById('mute');
    button.textContent = muted ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', muted ? 'false' : 'true');
  }

  function ensureSelection() {
    var stillThere = state.rows.some(function (row) { return row.id === selectedId; });
    if (!stillThere) selectedId = state.rows.length ? state.rows[0].id : null;
  }

  function findRow(id) {
    return state.rows.find(function (row) { return row.id === id; }) || null;
  }

  function formatBits(value) {
    var text = logic.bitsFor(value).join('');
    return text.slice(0, 4) + ' ' + text.slice(4);
  }

  function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function gameKeyContext(target) {
    if (!target || !target.closest) return true;
    if (target.closest('#setup-form')) return false;
    if (target.closest('button') && !target.closest('#board')) return false;
    if (target.matches('input[type="checkbox"], input[type="radio"]')) return false;
    return true;
  }

  function typingIn(target) {
    return target && target.matches && target.matches('input[type="text"], textarea');
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function persistBest() {
    storageSet('gamify.binary.highScore', String(bestOverall(state.highScores)));
  }

  function persistProgress() {
    storageSet(PROGRESS_KEY, JSON.stringify({
      highScores: state.highScores,
      misses: state.misses
    }));
  }

  function readProgress() {
    var empty = { highScores: { 60: 0, 120: 0, 300: 0 }, misses: null };
    try {
      var parsed = JSON.parse(storageGet(PROGRESS_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return empty;
      var misses = Array.isArray(parsed.misses) && parsed.misses.length === logic.BIT_VALUES.length
        ? parsed.misses.map(function (n) { return Math.max(0, n | 0); })
        : null;
      return {
        highScores: logic.createGame({ highScores: parsed.highScores }).highScores,
        misses: misses
      };
    } catch (error) {
      return empty;
    }
  }

  function bestOverall(scores) {
    return logic.TIME_LIMITS.reduce(function (max, limit) {
      return Math.max(max, scores && scores[limit] ? scores[limit] : 0);
    }, 0);
  }

  function bestLine(scores) {
    var parts = logic.TIME_LIMITS.map(function (limit) {
      var best = scores && scores[limit] ? formatNumber(scores[limit]) : '—';
      return logic.limitLabel(limit) + ' ' + best;
    });
    return 'Best: ' + parts.join(' · ');
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.ceil((ms || 0) / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function startRaceClock() {
    stopRaceClock();
    if (!state.racing || state.status !== 'playing') return;
    raceEndsAt = performance.now() + state.remainingMs;
    raceClock = window.setTimeout(tickRace, 200);
  }

  function stopRaceClock() {
    if (raceClock) window.clearTimeout(raceClock);
    raceClock = 0;
    raceEndsAt = 0;
  }

  function holdRaceClock() {
    if (!state.racing || !raceEndsAt) return;
    state.remainingMs = Math.max(0, raceEndsAt - performance.now());
    if (raceClock) window.clearTimeout(raceClock);
    raceClock = 0;
    raceEndsAt = 0;
  }

  function releaseRaceClock() {
    if (state.status === 'playing' && state.racing) startRaceClock();
  }

  function tickRace() {
    raceClock = 0;
    if (state.status !== 'playing' || !state.racing) return;
    var left = raceEndsAt - performance.now();
    if (left <= 0) {
      state.remainingMs = 0;
      raceEndsAt = 0;
      var finished = logic.finishRace(state);
      state = finished.state;
      applyEvents(finished.events);
      render();
      return;
    }
    state.remainingMs = left;
    var node = document.getElementById('pace');
    if (node) node.textContent = formatClock(left);
    raceClock = window.setTimeout(tickRace, 200);
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* ignore full or private storage */ }
  }

  function paintRemainder(el, row) {
    if (!el || !row) return;
    if (row.mode === 'bits') {
      var total = logic.valueOf(row.bits);
      var left = logic.remaining(row.value, total);
      var sum = el.querySelector('.sum');
      if (!sum) return;
      sum.hidden = false;
      sum.textContent = (coach ? total + ' · ' : '') + leftLabel(left);
      sum.classList.toggle('over', left < 0);
      sum.classList.toggle('exact', left === 0);
      return;
    }
    var note = el.querySelector('.left');
    if (!note) return;
    var typed = row.draft === '' ? null : Number(row.draft);
    if (typed == null || !Number.isInteger(typed)) {
      note.hidden = true;
      note.textContent = '';
      note.classList.remove('over', 'exact');
      return;
    }
    var gap = logic.remaining(row.value, typed);
    note.hidden = false;
    note.textContent = leftLabel(gap);
    note.classList.toggle('over', gap < 0);
    note.classList.toggle('exact', gap === 0);
  }

  function leftLabel(left) {
    if (left > 0) return left + ' left';
    if (left < 0) return Math.abs(left) + ' over';
    return '0 left';
  }

  function tone(frequency, offset, duration, type, level) {
    var context = audio();
    if (!context) return;
    var osc = context.createOscillator();
    var gain = context.createGain();
    osc.type = type || 'square';
    osc.frequency.value = frequency;
    var start = context.currentTime + offset;
    var peak = level || 0.045;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function audio() {
    if (muted) return null;
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    if (!audioCtx) audioCtx = new Context();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function soundToggle() { tone(210, 0, 0.035, 'square'); }
  function soundClear() {
    tone(523, 0, 0.08, 'triangle');
    tone(784, 0.07, 0.11, 'triangle');
  }
  function soundWrong() { tone(130, 0, 0.14, 'triangle'); }
  function soundLevel() {
    tone(523, 0, 0.07, 'triangle');
    tone(659, 0.08, 0.07, 'triangle');
    tone(784, 0.16, 0.12, 'triangle');
  }
  function soundOver() {
    tone(349, 0, 0.16, 'square', 0.07);
    tone(262, 0.14, 0.18, 'square', 0.07);
    tone(196, 0.3, 0.32, 'triangle', 0.09);
  }
})();
