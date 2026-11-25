(function () {
  'use strict';

  var logic = window.BinaryLogic;
  if (!logic) return;

  var state = logic.createGame(readBest());
  var selectedId = null;
  var coach = storageGet('gamify.binary.coach') === '1';
  var forceValues = storageGet('gamify.binary.forceValues') === '1';
  var muted = storageGet('gamify.muted') === '1';
  var bestAtStart = state.highScore;
  var clock = null;
  var frameId = 0;
  var toastTimer = 0;
  var warnedFull = false;
  var audioCtx = null;

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
    document.getElementById('mute').addEventListener('click', function () {
      muted = !muted;
      storageSet('gamify.muted', muted ? '1' : '0');
      renderMute();
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
    document.getElementById('keypad').addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.target.closest('button')) {
        event.preventDefault();
      }
    });
    document.getElementById('keypad').addEventListener('click', onKeypad);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function onStart(event) {
    event.preventDefault();
    var pace = document.querySelector('input[name="pace"]:checked');
    bestAtStart = state.highScore;
    var started = logic.startGame(state, Math.random, {
      level: pace ? Number(pace.value) : 1
    });
    state = started.state;
    selectedId = state.rows.length ? state.rows[0].id : null;
    warnedFull = false;
    document.getElementById('board').replaceChildren();
    applyEvents(started.events);
    render();
    startClock();
    if (!logic.levelConfig(state.level).showValues && !forceValues) {
      toast('Place values are hidden. You can pin them back on.');
    }
  }

  function onPause() {
    if (state.status !== 'playing') return;
    holdClock();
    state = logic.pauseGame(state).state;
    render();
  }

  function onResume() {
    if (state.status !== 'paused') return;
    state = logic.resumeGame(state).state;
    render();
    releaseClock();
  }

  function onToggle(id, index) {
    var previous = state;
    var result = logic.toggleBit(state, id, index);
    var solved = result.events.some(function (event) { return event.type === 'solved'; });
    state = result.state;
    if (!solved && state !== previous) soundToggle();
    applyEvents(result.events);
    render();
    afterEvents(result.events);
  }

  function onSubmit(id) {
    var result = logic.submitDecimal(state, id);
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
  }

  function onDraftKeydown(event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onSubmit(Number(event.currentTarget.closest('.row').dataset.id));
  }

  function onRowClick(event) {
    if (state.status !== 'playing') return;
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

  function onKeypad(event) {
    var key = event.target.closest('[data-key]');
    if (!key || state.status !== 'playing' || key.disabled) return;
    var name = key.dataset.key;
    if (name === 'enter') submitSelected();
    else if (name === 'clear') writeDraft('');
    else if (name === 'back') backspace();
    else appendDigit(name);
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
    if (state.status !== 'playing') return;
    if (!gameKeyContext(event.target)) return;
    if (event.target.matches && event.target.matches('input')) return;

    var row = selectedPlayable();
    if (!row) return;
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
    if (document.hidden) holdClock();
    else releaseClock();
  }

  function appendDigit(digit) {
    var row = decimalTarget();
    if (!row) return;
    selectedId = row.id;
    state = logic.setDraft(state, row.id, row.draft + digit).state;
    render();
    focusInput(row.id);
  }

  function backspace() {
    var row = decimalTarget();
    if (!row) return;
    selectedId = row.id;
    state = logic.setDraft(state, row.id, row.draft.slice(0, -1)).state;
    render();
    focusInput(row.id);
  }

  function writeDraft(value) {
    var row = decimalTarget();
    if (!row) return;
    selectedId = row.id;
    state = logic.setDraft(state, row.id, value).state;
    render();
    focusInput(row.id);
  }

  function submitSelected() {
    var row = decimalTarget();
    if (!row) return;
    selectedId = row.id;
    onSubmit(row.id);
  }

  function decimalTarget() {
    var selected = state.rows.find(function (row) {
      return row.id === selectedId && row.mode === 'decimal';
    });
    if (selected) return selected;
    return state.rows.find(function (row) { return row.mode === 'decimal'; }) || null;
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
    var next = state.rows.find(function (row) { return row.mode === 'decimal'; });
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
    paintMeter();
    maybeWarn();
  }

  function renderHud() {
    document.getElementById('score').textContent = formatNumber(state.score);
    document.getElementById('level').textContent = String(state.level);
    document.getElementById('cleared').textContent = String(state.solved);
    document.getElementById('streak').textContent = String(state.streak);
    document.getElementById('best').textContent = formatNumber(state.highScore);
    var pips = document.getElementById('pips');
    if (pips.childElementCount !== logic.SOLVES_PER_LEVEL) {
      pips.replaceChildren();
      for (var i = 0; i < logic.SOLVES_PER_LEVEL; i += 1) {
        var pip = document.createElement('span');
        pip.className = 'pip';
        pips.appendChild(pip);
      }
    }
    Array.prototype.forEach.call(pips.children, function (pip, index) {
      pip.classList.toggle('on', index < state.solvedThisLevel);
    });
    var pause = document.getElementById('pause');
    var playingOrPaused = state.status === 'playing' || state.status === 'paused';
    pause.hidden = !playingOrPaused;
    pause.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
  }

  function renderRuler() {
    var ruler = document.getElementById('ruler');
    var show = forceValues || logic.levelConfig(state.level).showValues;
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
    var eq = ruler.querySelector('.eq');
    eq.dataset.hidden = show ? 'false' : 'true';
    if (show) eq.removeAttribute('aria-hidden');
    else eq.setAttribute('aria-hidden', 'true');
  }

  function syncRows() {
    var board = document.getElementById('board');
    var keep = new Set(state.rows.map(function (row) { return String(row.id); }));
    Array.prototype.forEach.call(Array.from(board.children), function (child) {
      if (!keep.has(child.dataset.id)) child.remove();
    });
    state.rows.forEach(function (row) {
      var el = board.querySelector('[data-id="' + row.id + '"]');
      if (el && el.dataset.mode !== row.mode) {
        el.remove();
        el = null;
      }
      if (!el) {
        el = buildRow(row);
        board.appendChild(el);
      }
      updateRow(el, row);
    });
    state.rows.forEach(function (row) {
      board.appendChild(board.querySelector('[data-id="' + row.id + '"]'));
    });
  }

  function buildRow(row) {
    var el = document.createElement('article');
    el.className = 'row entering';
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
      var input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
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
      ticket.appendChild(input);
    }
    el.appendChild(ticket);
    el.addEventListener('click', onRowClick);
    return el;
  }

  function updateRow(el, row) {
    el.classList.toggle('selected', row.id === selectedId);
    el.setAttribute('aria-label', row.mode === 'bits'
      ? 'Set the bits to equal ' + row.value
      : 'Type the decimal value of these bits');
    el.querySelectorAll('[data-bit]').forEach(function (button, index) {
      var on = row.bits[index] === 1;
      button.textContent = on ? '1' : '0';
      button.classList.toggle('on', on);
      button.classList.toggle('locked', row.mode !== 'bits');
      button.disabled = row.mode !== 'bits' || state.status !== 'playing';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', logic.BIT_VALUES[index] + (on ? ' on' : ' off'));
    });
    if (row.mode === 'bits') {
      el.querySelector('.target').textContent = String(row.value);
      var sum = el.querySelector('.sum');
      if (coach) {
        var total = logic.valueOf(row.bits);
        sum.hidden = false;
        sum.textContent = String(total);
        sum.classList.toggle('over', total > row.value);
      } else {
        sum.textContent = '';
        sum.hidden = true;
      }
    } else {
      var input = el.querySelector('input');
      if (document.activeElement !== input && input.value !== row.draft) input.value = row.draft;
      input.classList.toggle('wrong', row.wrong);
      input.disabled = state.status !== 'playing';
      if (row.wrong) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function paintSelection() {
    document.querySelectorAll('.row').forEach(function (el) {
      el.classList.toggle('selected', Number(el.dataset.id) === selectedId);
    });
  }

  function renderChrome() {
    document.getElementById('setup').hidden = state.status === 'playing' || state.status === 'paused';
    document.getElementById('overlay').hidden = state.status !== 'paused';
    var playfield = document.getElementById('playfield');
    var nearlyFull = state.status === 'playing' && state.rows.length >= logic.MAX_ROWS - 1;
    playfield.classList.toggle('danger', nearlyFull);
    playfield.classList.toggle('full', state.status === 'playing' && state.rows.length >= logic.MAX_ROWS);
    var empty = document.getElementById('empty');
    empty.hidden = state.rows.length !== 0;
    if (state.status === 'playing') {
      empty.textContent = 'Column clear. The next row is on the way.';
    } else if (state.status === 'ready') {
      empty.textContent = 'Place values sit above the columns. Press start and the first row appears.';
    } else {
      empty.textContent = 'Column clear.';
    }
    document.getElementById('pressure').textContent = pressureText();
    var keypad = document.getElementById('keypad');
    keypad.querySelectorAll('button').forEach(function (button) {
      button.disabled = state.status !== 'playing';
    });
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
    heading.textContent = state.score > bestAtStart ? 'New best.' : 'The column filled.';
    var summary = document.createElement('p');
    summary.textContent = 'Score ' + formatNumber(state.score)
      + '. Level ' + state.level
      + '. ' + state.solved + ' cleared. Best streak ' + state.bestStreak + '.';
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
    box.append(heading, summary, note, list);
  }

  function pressureText() {
    if (state.status !== 'playing') return '';
    var open = logic.MAX_ROWS - state.rows.length;
    if (open <= 0) return 'Clear a row before the next one arrives.';
    if (open === 1) return 'One empty slot.';
    return state.rows.length + ' of ' + logic.MAX_ROWS + ' rows on the column.';
  }

  function applyEvents(events) {
    var gained = 0;
    var levelEvent = null;
    events.forEach(function (event) {
      if (event.type === 'solved') gained += event.gained;
      if (event.type === 'level') levelEvent = event;
      if (event.type === 'wrong') {
        soundWrong();
        announce('Not that total.');
      }
      if (event.type === 'over') {
        soundOver();
        announce('Round over. Score ' + formatNumber(event.score) + '.');
        stopClock();
      }
    });
    if (gained) {
      if (levelEvent) soundLevel();
      else soundClear();
      flashGain(gained);
      if (levelEvent) {
        announce('Cleared. Score ' + formatNumber(state.score) + '. Level ' + levelEvent.level + '.');
        toast(levelMessage(levelEvent.level));
      } else {
        announce('Cleared. Score ' + formatNumber(state.score) + '.');
      }
    }
    if (events.some(function (event) { return event.type === 'solved' || event.type === 'over'; })) {
      persistBest();
    }
  }

  function afterEvents(events) {
    events.forEach(function (event) {
      if (event.type !== 'wrong') return;
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

  function levelMessage(level) {
    var config = logic.levelConfig(level);
    if (!config.showValues && !forceValues) return 'Level ' + level + '. Place values are hidden.';
    if (config.maxValue >= 255) return 'Level ' + level + '. Full bytes.';
    return 'Level ' + level + '. Numbers up to ' + config.maxValue + '.';
  }

  function startClock(ms) {
    stopClock();
    var delay = ms == null ? logic.levelConfig(state.level).spawnMs : ms;
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
    var spawned = logic.spawnRow(state, Math.random);
    state = spawned.state;
    applyEvents(spawned.events);
    render();
    afterEvents(spawned.events);
    if (state.status === 'playing') startClock();
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

  function flashGain(amount) {
    var gain = document.getElementById('gain');
    gain.textContent = '+' + amount;
    gain.classList.remove('pop');
    void gain.offsetWidth;
    gain.classList.add('pop');
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
    if (target.closest('#keypad')) return false;
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
    storageSet('gamify.binary.highScore', String(state.highScore));
  }

  function readBest() {
    var raw = storageGet('gamify.binary.highScore');
    var number = Number(raw);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (error) { /* ignore full or private storage */ }
  }

  function tone(frequency, offset, duration, type) {
    var context = audio();
    if (!context) return;
    var osc = context.createOscillator();
    var gain = context.createGain();
    osc.type = type || 'square';
    osc.frequency.value = frequency;
    var start = context.currentTime + offset;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.01);
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
    tone(196, 0, 0.18, 'triangle');
    tone(130, 0.1, 0.26, 'triangle');
  }
})();
