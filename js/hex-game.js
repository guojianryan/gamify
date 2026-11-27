(function () {
  'use strict';

  var logic = window.HexLogic;
  if (!logic) return;

  var GUIDE_KEY = 'gamify.hex.seenGuide';
  var PROGRESS_KEY = 'gamify.hex.progress';
  var COACH_KEY = 'gamify.hex.coach';
  var HOLD_MS = 2000;
  var CLEAR_MS = 450;

  var progress = readProgress();
  var state = logic.createGame({ highScores: progress.highScores });
  if (progress.misses) state.misses = progress.misses;

  var selectedId = null;
  var userRowId = null;
  var markingFocus = false;
  var coachStored = storageGet(COACH_KEY);
  var coach = coachStored === null ? true : coachStored === '1';
  var muted = storageGet('gamify.muted') === '1';
  var bestAtStart = 0;
  var clock = null;
  var frameId = 0;
  var toastTimer = 0;
  var warnedFull = false;
  var audioCtx = null;
  var holds = {};
  var swallowClick = false;
  var menuOpen = false;
  var raceClock = 0;
  var raceEndsAt = 0;
  var rulerWidth = 0;
  var momentOpen = false;

  var coachBox = document.getElementById('coach');
  if (coachBox) coachBox.checked = coach;

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
    });
    if (coachBox) {
      coachBox.addEventListener('change', function () {
        coach = coachBox.checked;
        storageSet(COACH_KEY, coach ? '1' : '0');
        render();
      });
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.getElementById('keypad').addEventListener('pointerdown', onKeypadPointerDown);
    document.addEventListener('click', onSwallowClick, true);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onStart(event) {
    event.preventDefault();
    clearHolds();
    momentOpen = false;
    document.getElementById('moment').hidden = true;
    bestAtStart = 0;
    stopRaceClock();
    var started = logic.startGame(state, Math.random, {
      guide: storageGet(GUIDE_KEY) !== '1',
      now: performance.now()
    });
    state = started.state;
    selectedId = state.rows.length ? state.rows[0].id : null;
    warnedFull = false;
    document.getElementById('board').replaceChildren();
    applyEvents(started.events);
    render();
    focusSelected();
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
    var started = logic.beginRace(state, Number(button.dataset.limit), Math.random, performance.now());
    if (!started.events.length) return;
    state = started.state;
    selectedId = state.rows.length ? state.rows[0].id : null;
    document.getElementById('board').replaceChildren();
    applyEvents(started.events);
    render();
    focusSelected();
  }

  function onToggle(id, index) {
    var wasGuide = state.guide;
    var previous = state;
    var result = logic.toggleBit(state, id, index, performance.now());
    var solved = result.events.some(function (e) { return e.type === 'solved'; });
    state = result.state;
    if (!solved && state !== previous) soundTick();
    applyEvents(result.events);
    if (wasGuide && !state.guide && state.status === 'playing') spawnFollowUp();
    render();
    afterEvents(result.events);
    if (solved) focusSelected();
  }

  function onSubmit(id) {
    var result = logic.submitHex(state, id, performance.now());
    state = result.state;
    applyEvents(result.events);
    render();
    afterEvents(result.events);
    if (result.result === 'correct') focusSelected();
  }

  function applyDraft(id, draft) {
    state = logic.setDraft(state, id, draft).state;
    userRowId = id;
    if (hexReady(id)) onSubmit(id);
    else {
      render();
      focusInput(id);
    }
  }

  function hexReady(id) {
    var row = findRow(id);
    if (!row || row.mode !== 'hex' || row.phase !== 'play' || !row.draft) return false;
    var need = row.width === 4 ? 1 : 2;
    return row.draft.length === need && logic.parseHex(row.draft, row.width) === row.value;
  }

  function onDraftInput(event) {
    var input = event.currentTarget;
    var id = Number(input.closest('.row').dataset.id);
    state = logic.setDraft(state, id, input.value).state;
    userRowId = id;
    var row = findRow(id);
    if (row && input.value !== row.draft) input.value = row.draft;
    input.classList.remove('wrong');
    input.removeAttribute('aria-invalid');
    if (hexReady(id)) onSubmit(id);
  }

  function onDraftBlur(event) {
    var rowEl = event.currentTarget.closest('.row');
    if (!rowEl) return;
    var id = Number(rowEl.dataset.id);
    state = logic.setDraft(state, id, event.currentTarget.value).state;
    if (hexReady(id)) onSubmit(id);
    else syncKeypad();
  }

  function onRowClick(event) {
    if (state.status !== 'playing' || heldRows().length) return;
    var rowEl = event.currentTarget;
    selectedId = Number(rowEl.dataset.id);
    userRowId = selectedId;
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
    if (state.status !== 'playing' || !gameKeyContext(event.target)) return;
    if (event.target.matches && event.target.matches('input')) return;

    var row = findRow(selectedId) || state.rows[0];
    if (!row || row.phase !== 'play') return;
    var ch = key.length === 1 ? key.toUpperCase() : '';
    if (row.mode === 'hex' && /^[0-9A-F]$/.test(ch)) {
      event.preventDefault();
      selectedId = row.id;
      var need = row.width === 4 ? 1 : 2;
      soundLock();
      applyDraft(row.id, (row.draft + ch).slice(0, need));
      return;
    }
    if (row.mode === 'hex' && key === 'Backspace') {
      event.preventDefault();
      selectedId = row.id;
      applyDraft(row.id, row.draft.slice(0, -1));
      return;
    }
    if (row.mode === 'hex' && (key === 'Enter' || key === 'NumpadEnter')) {
      event.preventDefault();
      onSubmit(row.id);
      return;
    }
    if (row.mode === 'bits' && /^[1-8]$/.test(key)) {
      var index = Number(key) - 1;
      if (index >= row.width) return;
      event.preventDefault();
      userRowId = row.id;
      onToggle(row.id, index);
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

  function onKeypadPointerDown(event) {
    event.preventDefault();
    var key = event.target.closest('[data-key]');
    if (!key) return;
    var active = document.activeElement;
    var rowEl = active && active.closest ? active.closest('#board .row') : null;
    var id = rowEl ? Number(rowEl.dataset.id) : selectedId;
    var row = findRow(id);
    if (!row || row.mode !== 'hex' || row.phase !== 'play' || state.status !== 'playing') return;
    if (key.dataset.key === 'enter') {
      onSubmit(id);
      return;
    }
    var draft = row.draft || '';
    var need = row.width === 4 ? 1 : 2;
    if (key.dataset.key === 'back') draft = draft.slice(0, -1);
    else if (draft.length < need) {
      draft += key.dataset.key;
      soundLock();
    }
    applyDraft(id, draft);
  }

  function syncKeypad() {
    var box = document.getElementById('keypad');
    var active = document.activeElement;
    var input = active && active.matches && active.matches('#board .row input') && !active.disabled ? active : null;
    var row = input ? findRow(Number(input.closest('.row').dataset.id)) : null;
    var open = !!(row && row.mode === 'hex' && row.phase === 'play' && state.status === 'playing');
    box.hidden = !open;
    document.body.classList.toggle('keypad-open', open);
  }

  function focusInput(id) {
    var input = document.querySelector('.row[data-id="' + id + '"] input');
    if (!input || input.disabled) return;
    markingFocus = true;
    input.focus({ preventScroll: true });
    markingFocus = false;
    syncKeypad();
  }

  function focusArrival(rowId) {
    var row = findRow(rowId);
    if (!row || state.status !== 'playing' || row.phase !== 'play') return;
    if (userRowId != null && userRowId !== rowId && findRow(userRowId)) return;
    selectedId = rowId;
    if (row.mode === 'hex') focusInput(rowId);
    else focusSelected();
  }

  function focusSelected() {
    if (state.status !== 'playing') return;
    var row = findRow(selectedId);
    if (row && row.mode === 'hex' && row.phase === 'play') {
      focusInput(row.id);
      return;
    }
    var active = document.activeElement;
    if (active && active.matches && active.matches('#board .row input')) active.blur();
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
    syncKeypad();
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
    var bestValue = state.racing
      ? ((state.highScores && state.highScores[state.limitSec]) || 0)
      : bestOverall(state.highScores);
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
    pause.hidden = !(state.status === 'playing' || state.status === 'paused');
    pause.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
  }

  function activeWidth() {
    if (!state.rows.length) return 4;
    var max = 4;
    for (var i = 0; i < state.rows.length; i += 1) {
      if ((state.rows[i].width || 4) > max) max = state.rows[i].width;
    }
    return max;
  }

  function renderRuler() {
    var ruler = document.getElementById('ruler');
    var width = activeWidth();
    if (rulerWidth === width && ruler.childElementCount) return;
    rulerWidth = width;
    ruler.replaceChildren();
    ruler.dataset.width = String(width);
    var places = width === 4 ? logic.NIBBLE_VALUES : logic.BYTE_VALUES;
    places.forEach(function (value, index) {
      var span = document.createElement('span');
      span.className = 'place' + (width === 8 && index === 3 ? ' nibble-gap' : '');
      span.textContent = String(value);
      span.title = '2^' + (places.length - 1 - index) + ' = ' + value;
      ruler.appendChild(span);
    });
    var eq = document.createElement('span');
    eq.className = 'eq';
    eq.textContent = '=';
    ruler.appendChild(eq);
  }

  function syncRows() {
    var board = document.getElementById('board');
    var keep = {};
    state.rows.forEach(function (row) { keep[String(row.id)] = true; });
    Array.prototype.forEach.call(Array.from(board.children), function (child) {
      if (keep[child.dataset.id] || child.classList.contains('clearing')) return;
      child.classList.remove('selected');
      child.classList.add('clearing');
      window.setTimeout(function () {
        if (child.parentNode) child.remove();
        var empty = document.getElementById('empty');
        if (empty && !document.querySelector('#board .row') && !state.rows.length) empty.hidden = false;
      }, prefersReducedMotion() ? 0 : CLEAR_MS);
    });
    state.rows.forEach(function (row) {
      var el = board.querySelector('[data-id="' + row.id + '"]:not(.clearing)');
      if (el && (el.dataset.mode !== row.mode || el.dataset.width !== String(row.width))) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildRow(row);
        board.appendChild(el);
      }
      updateRow(el, row);
    });
  }

  function buildRow(row) {
    var el = document.createElement('article');
    el.className = 'row';
    el.dataset.id = String(row.id);
    el.dataset.mode = row.mode;
    el.dataset.width = String(row.width);
    row.bits.forEach(function (_bit, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'bit' + (row.width === 8 && index === 3 ? ' nibble-gap' : '');
      button.dataset.bit = String(index);
      el.appendChild(button);
    });
    var ticket = document.createElement('div');
    ticket.className = 'ticket';
    if (row.mode === 'bits') {
      var strong = document.createElement('strong');
      strong.className = 'target hex';
      var sum = document.createElement('span');
      sum.className = 'sum';
      ticket.append(strong, sum);
    } else {
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'none';
      input.maxLength = row.width === 4 ? 1 : 2;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = '?';
      input.setAttribute('aria-label', 'Hex value');
      input.addEventListener('input', onDraftInput);
      input.addEventListener('blur', onDraftBlur);
      input.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== 'NumpadEnter') return;
        event.preventDefault();
        event.stopPropagation();
        onSubmit(Number(el.dataset.id));
      });
      input.addEventListener('focus', function () {
        selectedId = Number(el.dataset.id);
        if (!markingFocus) userRowId = selectedId;
        paintSelection();
        syncKeypad();
      });
      ticket.appendChild(input);
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
    var places = logic.placeValues(row.width);
    el.classList.toggle('selected', row.id === selectedId);
    el.classList.toggle('teaching', teaching);
    el.setAttribute('aria-label', row.feedback && teaching
      ? row.feedback
      : (row.mode === 'bits'
        ? 'Set the bits to equal hex ' + logic.toHex(row.value, row.width)
        : 'Type the hex value of these bits'));
    el.querySelectorAll('[data-bit]').forEach(function (button, index) {
      var on = row.bits[index] === 1;
      var marked = row.wrongIndexes.indexOf(index) !== -1;
      var showMark = marked && (teaching || (row.mode === 'hex' && row.retries > 0));
      var hint = state.guide && row.phase === 'play' && !on && (index === 0 || index === 2);
      button.textContent = on ? '1' : '0';
      button.classList.toggle('on', on);
      button.classList.toggle('locked', row.mode !== 'bits');
      button.classList.toggle('miss', showMark);
      button.classList.toggle('hint', hint);
      button.disabled = row.mode !== 'bits' || state.status !== 'playing';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', places[index] + (on ? ' on' : ' off'));
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
      el.querySelector('.target').textContent = logic.toHex(row.value, row.width);
      var sum = el.querySelector('.sum');
      if (coach && row.phase === 'play') {
        var total = logic.valueOf(row.bits, row.width);
        sum.hidden = false;
        sum.textContent = String(total);
        sum.classList.toggle('exact', total === row.value);
        sum.classList.toggle('over', total > row.value);
      } else {
        sum.hidden = true;
        sum.textContent = '';
      }
    } else {
      var input = el.querySelector('input');
      input.disabled = state.status !== 'playing' || row.phase !== 'play';
      if (input.value.toUpperCase() !== row.draft) input.value = row.draft;
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
    playfield.classList.toggle('danger', state.status === 'playing' && state.rows.length >= logic.MAX_ROWS - 1);
    playfield.classList.toggle('full', state.status === 'playing' && state.rows.length >= logic.MAX_ROWS);
    playfield.classList.toggle('ended', state.status === 'over');
    playfield.classList.toggle('topout', state.status === 'over' && state.endedBy === 'column');
    var guide = document.getElementById('guide');
    var showGuide = !!(state.guide && (state.status === 'playing' || state.status === 'paused'));
    guide.hidden = !showGuide;
    if (showGuide) guide.textContent = 'Tap the 8 and the 2 to make A (10).';
    var best = document.getElementById('best-pace');
    best.hidden = false;
    best.textContent = bestLine(state.highScores);
    var empty = document.getElementById('empty');
    empty.hidden = state.rows.length !== 0 || !!document.querySelector('#board .row');
    if (state.status === 'playing') {
      empty.textContent = state.racing
        ? 'Column clear. The next row is on the way.'
        : 'Warm-up. The next row is on the way.';
    } else if (state.status === 'ready') {
      empty.textContent = storageGet(GUIDE_KEY) === '1'
        ? 'Press start. The first row appears under the place values.'
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
    if (!state.racing && state.endedBy !== 'time') heading.textContent = 'Warm-up ended.';
    else if (state.score > bestAtStart) heading.textContent = 'New best.';
    else if (state.endedBy === 'time') heading.textContent = 'Time.';
    else heading.textContent = 'The column filled.';
    var summary = document.createElement('p');
    var text = 'Score ' + formatNumber(state.score);
    if (state.racing || state.endedBy === 'time') {
      text += ' in ' + logic.limitLabel(state.limitSec);
      if (state.endedBy === 'column' && state.remainingMs > 0) {
        text += ', with ' + formatClock(state.remainingMs) + ' left';
      }
    }
    text += '. ' + state.solved + ' cleared. Best streak ' + state.bestStreak + '.';
    summary.textContent = text;
    var parts = [heading, summary];
    var weakText = logic.weakSpotText(state.misses);
    if (weakText) {
      var weak = document.createElement('p');
      weak.className = 'weak';
      weak.textContent = weakText;
      parts.push(weak);
    }
    if (state.rows.length) {
      var note = document.createElement('p');
      note.className = 'review-note';
      note.textContent = 'These rows were still open:';
      var list = document.createElement('ol');
      list.className = 'review';
      state.rows.forEach(function (row) {
        var item = document.createElement('li');
        item.textContent = logic.toHex(row.value, row.width) + ' = ' +
          logic.expression(row.value, row.width) + ' = ' + row.value;
        list.appendChild(item);
      });
      parts.push(note, list);
    }
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
    return state.racing ? count : 'Warm-up. ' + count;
  }

  function applyEvents(events) {
    var gained = 0;
    var multiplier = 1;
    var chose = false;
    var raceLimit = 0;
    events.forEach(function (event) {
      if (event.type === 'solved') {
        gained += event.gained;
        multiplier = event.multiplier || 1;
      }
      if (event.type === 'choose') chose = true;
      if (event.type === 'race') raceLimit = event.limitSec;
      if (event.type === 'teach' || event.type === 'reveal') {
        soundMiss();
        toast(event.feedback);
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
    if (events.some(function (e) {
      return e.type === 'solved' || e.type === 'teach' || e.type === 'reveal' || e.type === 'over';
    })) persistProgress();
    if (!state.guide && events.some(function (e) { return e.type === 'solved'; })) {
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
    if (events.some(function (e) { return e.type === 'over'; })) {
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
    if (released && released.mode === 'hex' && released.phase === 'play') focusInput(rowId);
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
      if (released && released.mode === 'hex' && released.phase === 'play') focusId = released.id;
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
    clock = {
      held: false,
      handle: window.setTimeout(onSpawnDue, delay),
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
    window.clearTimeout(clock.handle);
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    clock = {
      held: true,
      handle: 0,
      delay: Math.max(0, clock.delay - elapsed),
      fraction: clock.delay === 0 ? 1 : Math.min(1, elapsed / clock.delay)
    };
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
    spawned.events.forEach(function (event) {
      if (event.type === 'spawn') focusArrival(event.rowId);
    });
  }

  function tickMeter() {
    paintMeter();
    if (!clock || clock.held || state.status !== 'playing') return;
    frameId = requestAnimationFrame(tickMeter);
  }

  function paintMeter() {
    var amount = 0;
    if (clock && state.status === 'playing') {
      amount = clock.held
        ? (clock.fraction || 0)
        : Math.min(1, (performance.now() - clock.started) / clock.delay);
    }
    document.getElementById('meter').style.transform = 'scaleX(' + amount + ')';
  }

  function flashGain(amount, multiplier) {
    var gain = document.getElementById('gain');
    gain.textContent = '+' + amount;
    gain.classList.remove('pop');
    void gain.offsetWidth;
    gain.classList.add('pop');
    if (multiplier > 1) {
      var multNode = document.getElementById('mult');
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
    toastTimer = window.setTimeout(function () { node.hidden = true; }, 2200);
  }

  function announce(text) {
    var live = document.getElementById('live');
    live.textContent = '';
    window.setTimeout(function () { live.textContent = text; }, 30);
  }

  function renderMute() {
    var button = document.getElementById('mute');
    button.textContent = muted ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', muted ? 'false' : 'true');
  }

  function ensureSelection() {
    if (!state.rows.some(function (row) { return row.id === selectedId; })) {
      selectedId = state.rows.length ? state.rows[0].id : null;
    }
    if (userRowId != null && !findRow(userRowId)) userRowId = null;
  }

  function findRow(id) {
    for (var i = 0; i < state.rows.length; i += 1) {
      if (state.rows[i].id === id) return state.rows[i];
    }
    return null;
  }

  function formatNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.ceil((ms || 0) / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
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
      var misses = Array.isArray(parsed.misses) && parsed.misses.length === logic.HEX_DIGITS.length
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
    return 'Best: ' + logic.TIME_LIMITS.map(function (limit) {
      var best = scores && scores[limit] ? formatNumber(scores[limit]) : '—';
      return logic.limitLabel(limit) + ' ' + best;
    }).join(' · ');
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
    try { localStorage.setItem(key, value); } catch (error) { /* ignore */ }
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

  function soundTick() { tone(210, 0, 0.035, 'square'); }
  function soundLock() { tone(330, 0, 0.04, 'triangle'); }
  function soundClear() {
    tone(523, 0, 0.08, 'triangle');
    tone(784, 0.07, 0.11, 'triangle');
  }
  function soundMiss() { tone(130, 0, 0.14, 'triangle'); }
  function soundOver() {
    tone(349, 0, 0.16, 'square', 0.07);
    tone(262, 0.14, 0.18, 'square', 0.07);
    tone(196, 0.3, 0.32, 'triangle', 0.09);
  }
})();
