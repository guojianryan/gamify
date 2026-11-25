(function () {
  'use strict';

  var logic = window.BinaryLogic;
  var numbers = [13, 9, 45, 77, 128, 192, 255];
  var cursor = 0;
  var target = numbers[0];
  var bits = [0, 0, 0, 0, 0, 0, 0, 0];
  var ruler = document.getElementById('demo-ruler');
  var row = document.getElementById('demo-row');
  var note = document.getElementById('demo-note');
  var ticket;
  var totalNode;

  if (!logic || !ruler || !row) return;

  logic.BIT_VALUES.forEach(function (value, index) {
    var place = document.createElement('span');
    place.className = 'place';
    place.textContent = String(value);
    place.title = '2^' + (7 - index) + ' = ' + value;
    ruler.appendChild(place);
  });
  var equals = document.createElement('span');
  equals.className = 'eq';
  equals.textContent = '=';
  ruler.appendChild(equals);

  logic.BIT_VALUES.forEach(function (value, index) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'bit';
    button.addEventListener('click', function () {
      bits[index] = bits[index] ? 0 : 1;
      paint();
    });
    row.appendChild(button);
  });

  ticket = document.createElement('div');
  ticket.className = 'ticket';
  var targetNode = document.createElement('strong');
  targetNode.className = 'target';
  totalNode = document.createElement('span');
  totalNode.className = 'sum';
  ticket.append(targetNode, totalNode);
  row.appendChild(ticket);

  document.getElementById('demo-next').addEventListener('click', function () {
    cursor = (cursor + 1) % numbers.length;
    target = numbers[cursor];
    bits = [0, 0, 0, 0, 0, 0, 0, 0];
    paint();
  });

  var bestLine = document.getElementById('landing-best');
  try {
    var saved = JSON.parse(localStorage.getItem('gamify.binary.progress') || 'null');
    var scores = saved && saved.highScores ? saved.highScores : null;
    var best = scores
      ? Math.max(Number(scores[60]) || 0, Number(scores[120]) || 0, Number(scores[300]) || 0)
      : Number(localStorage.getItem('gamify.binary.highScore'));
    if (bestLine && Number.isFinite(best) && best > 0) {
      bestLine.hidden = false;
      bestLine.textContent = 'Best score on this browser: ' + best.toLocaleString('en-US') + '.';
    }
  } catch (error) {
    /* This browser is not keeping the score. */
  }

  paint();

  function paint() {
    var total = logic.valueOf(bits);
    targetNode.textContent = String(target);
    totalNode.textContent = String(total);
    totalNode.classList.toggle('over', total > target);
    totalNode.classList.toggle('met', total === target);
    ticket.classList.toggle('met', total === target);
    row.querySelectorAll('.bit').forEach(function (button, index) {
      var on = bits[index] === 1;
      button.textContent = on ? '1' : '0';
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', logic.BIT_VALUES[index] + (on ? ' on' : ' off'));
    });
    if (total === target) {
      note.textContent = 'That row would clear. In the game, the next one is already on the way.';
    } else if (total > target) {
      note.textContent = 'Over ' + target + '. Turn a bit off.';
    } else {
      note.textContent = 'Turn on the places that add up to ' + target + '.';
    }
  }
})();
