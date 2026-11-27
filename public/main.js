import {
  TOTAL, NEW_PILE, OPEN_RANK, nextRank, destinations, legalMoves, newRace, play, recycle, recycleSlot,
  retuneIfBlocked, chooseMove, reactionTime,
} from './engine.js';

const $ = selector => document.querySelector(selector);
const pileGrid = $('#piles');
const newPileButton = $('#new-pile');
const handButtons = [...document.querySelectorAll('.hand-card')];
const cardTemplate = $('#card-template').content.firstElementChild;
const backTemplate = $('#back-template').content.firstElementChild;
const yourSeat = { deck: $('#draw-deck'), slots: handButtons };
const rivals = [
  { name: 'Nova', side: 'left' },
  { name: 'Sage', side: 'top' },
  { name: 'Dash', side: 'bottom' },
];
const pileSymbols = { rise: '↑', match: '=', fall: '↓' };
const colors = { spark: 'Yellow', tide: 'Blue', ember: 'Red', grove: 'Green' };
const toolNames = { wagon: 'Wagon', pump: 'Hand pump', barrel: 'Barrel', plow: 'Plow' };
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const scheme = matchMedia('(display-mode: standalone)');

let race;
let settings;
let selected = null;
let timer;
let finishTimer;
let elapsed = 0;
let startedAt = null;
let blockedAt = null;
let bots = [];
let rivalSeats = [];
let message;
let installPrompt;
let drag;
let ignoreClicksUntil = 0;

function readSetting(key, fallback) {
  try { return JSON.parse(localStorage.getItem(`overcurrent:${key}`)) ?? fallback; }
  catch { return fallback; }
}

function saveSetting(key, value) {
  try { localStorage.setItem(`overcurrent:${key}`, JSON.stringify(value)); }
  catch { /* The game remains playable when storage is unavailable. */ }
}

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);
const cardName = card => `${colors[card.suit]} ${card.rank}`;
const timeNow = () => elapsed + (startedAt === null ? 0 : performance.now() - startedAt);
const openDialog = () => document.querySelector('dialog[open]');
const canPlay = () => Boolean(race && race.winner === null && startedAt !== null && !openDialog());

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function cardFace(card) {
  const face = cardTemplate.cloneNode(true);
  face.classList.add(`suit-${card.suit}`);
  face.querySelector('.card-rank').textContent = card.rank;
  face.querySelector('.card-corner').textContent = card.rank;
  return face;
}

function cardBack(tool) {
  const back = backTemplate.cloneNode(true);
  back.classList.add(`back-${tool}`);
  back.querySelector('use').setAttribute('href', `./assets/card-art.svg#${tool}`);
  return back;
}

function showCard(element, card) {
  const key = card ? `${card.suit}-${card.rank}` : '';
  if (element.dataset.card === key) return;
  element.dataset.card = key;
  element.replaceChildren(...(card ? [cardFace(card)] : []));
}

function playAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function announce(text, duration = 1500) {
  message = { text, ends: timeNow() + duration };
}

function carryCard(visual, from, to, { duration = 245, delay = 0 } = {}) {
  if (motion.matches || !from?.width || !to.width) return;
  const flight = document.createElement('div');
  flight.className = 'flight';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, {
    left: `${to.left}px`, top: `${to.top}px`,
    width: `${to.width}px`, height: `${to.height}px`, opacity: '0',
  });
  flight.append(visual);
  document.body.append(flight);
  const x = from.left - to.left + (from.width - to.width) / 2;
  const y = from.top - to.top + (from.height - to.height) / 2;
  const animation = flight.animate([
    { transform: `translate(${x}px, ${y}px) rotate(${x < 0 ? -8 : 8}deg) scale(${from.width / to.width})`, opacity: .88 },
    { transform: 'translate(0, 0)', opacity: .98 },
  ], { duration, delay, easing: 'cubic-bezier(.22,.73,.36,1)' });
  animation.finished.then(() => flight.remove(), () => flight.remove());
}

function createRivals(opponents) {
  rivalSeats = opponents.map(({ tool, hand }, index) => {
    const { name, side } = rivals[index];
    const element = document.createElement('div');
    element.className = `rival ${side}`;
    element.innerHTML = `<div class="seat-heading"><span class="draw-deck" role="img"></span><div><strong class="rival-name">${name}</strong><span class="rival-count"></span></div></div><div class="rival-hand" aria-hidden="true"></div>`;
    const deck = element.querySelector('.draw-deck');
    deck.append(cardBack(tool));
    const slots = hand.map(() => {
      const slot = document.createElement('span');
      slot.className = 'rival-card';
      slot.append(cardBack(tool));
      return slot;
    });
    element.querySelector('.rival-hand').append(...slots);
    return { element, deck, slots, remaining: element.querySelector('.rival-count') };
  });
  $('#rivals').replaceChildren(...rivalSeats.map(seat => seat.element));
}

function seatFor(player) {
  return player === 0 ? yourSeat : rivalSeats[player - 1];
}

function updateDeck(deck, player, owner) {
  const count = player.deck.length;
  const label = `${owner} ${toolNames[player.tool].toLowerCase()} deck, ${count} ${count === 1 ? 'card' : 'cards'} to draw`;
  deck.setAttribute('aria-label', label);
  deck.title = label;
  deck.classList.toggle('stacked', count > 1);
  deck.classList.toggle('empty', count === 0);
}

function animateDraw(player, slot, delay = 0) {
  if (motion.matches || !race.players[player].hand[slot]) return;
  const { deck, slots } = seatFor(player);
  const replacement = slots[slot].firstElementChild;
  const from = deck.firstElementChild.getBoundingClientRect();
  const duration = 200;
  carryCard(cardBack(race.players[player].tool), from, replacement.getBoundingClientRect(), { duration, delay });
  replacement.animate([{ opacity: 0 }, { opacity: 0, offset: .73 }, { opacity: 1 }], { duration, delay, fill: 'backwards' });
}

function updateTiming() {
  const now = timeNow();
  const player = race.players[0];
  const clock = formatTime(now);
  if ($('#clock').textContent !== clock) $('#clock').textContent = clock;
  $('#cycle').disabled = !player.deck.length || now < player.recycleAt || race.winner !== null;

  const card = player.hand[selected];
  const targets = destinations(card, race.piles);
  let hint = 'Tap a highlighted card to play it.';
  if (card && targets.length) hint = targets.includes(NEW_PILE) ? 'Choose a pile or open a new one.' : 'Choose a highlighted pile.';
  else if (card && player.deck.length) hint = 'Swap this card or wait for the piles to change.';
  else if (!legalMoves(player.hand, race.piles).length) hint = player.deck.length ? 'No match? Swap a card to keep moving.' : 'Waiting for a pile to open…';
  const status = message?.ends > now ? message.text : hint;
  if ($('#status').textContent !== status) $('#status').textContent = status;
}

function fitPiles(count, width, height, gap, labelHeight) {
  let best;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const availableWidth = Math.floor((width - gap * (columns - 1)) / columns);
    const availableHeight = Math.floor((height - gap * (rows - 1)) / rows);
    const cardWidth = Math.min(100, availableWidth - 8, Math.floor((availableHeight - labelHeight) * 5 / 7));
    // Favor larger tap targets when two layouts can fit similarly sized cards.
    const score = cardWidth + Math.min(44, availableWidth, availableHeight) / 2;
    if (!best || score > best.score || (score === best.score && rows < best.rows)) {
      best = { columns, rows, availableWidth, cardWidth, score };
    }
  }
  return best;
}

function layoutPiles() {
  const { childElementCount: count, clientWidth: width, clientHeight: height } = pileGrid;
  if (!count || !width || !height) return;
  const gap = parseFloat(getComputedStyle(pileGrid).columnGap);
  const roomy = fitPiles(count, width, height, gap, 36);
  const compact = roomy.cardWidth < 39 || roomy.availableWidth < 74;
  const fit = compact ? fitPiles(count, width, height, gap, 18) : roomy;
  const cardWidth = Math.max(1, fit.cardWidth);
  const cellWidth = Math.min(fit.availableWidth, Math.max(compact ? 40 : 74, cardWidth + 14));
  const cellHeight = Math.ceil(cardWidth * 7 / 5) + (compact ? 18 : 36);
  pileGrid.classList.toggle('compact-piles', compact);
  pileGrid.style.setProperty('--pile-columns', fit.columns);
  pileGrid.style.setProperty('--pile-cell-width', `${cellWidth}px`);
  pileGrid.style.setProperty('--pile-cell-height', `${cellHeight}px`);
}

function renderPiles(piles, targets) {
  const countChanged = pileGrid.childElementCount !== piles.length;
  while (pileGrid.children.length > piles.length) pileGrid.lastElementChild.remove();
  piles.forEach((pile, index) => {
    let button = pileGrid.children[index];
    if (!button) {
      button = $('#pile-template').content.firstElementChild.cloneNode(true);
      button.dataset.pile = index;
      button.querySelector('.pile-kind').textContent = `${pileSymbols[pile.rule]} ${capitalize(pile.rule)}`;
      pileGrid.append(button);
    }
    const matchesColor = pile.rule === 'match';
    const required = matchesColor ? colors[pile.top.suit] : nextRank(pile);
    const instruction = matchesColor ? `${required} only` : `Play a ${required}`;
    showCard(button.querySelector('.pile-card'), pile.top);
    button.querySelector('.pile-rule').textContent = instruction;
    button.querySelector('.pile-cue').textContent = matchesColor ? required : `${pileSymbols[pile.rule]} ${required}`;
    button.classList.toggle('target', targets.includes(index));
    button.setAttribute('aria-label', `${capitalize(pile.rule)} pile ${index + 1}, ${cardName(pile.top)}. ${instruction}`);
  });
  $('#pile-count').textContent = piles.length;
  newPileButton.classList.toggle('target', targets.includes(NEW_PILE));
  if (countChanged) layoutPiles();
}

function render() {
  const player = race.players[0];
  const targets = destinations(player.hand[selected], race.piles);
  renderPiles(race.piles, targets);
  newPileButton.classList.toggle('ready', selected === null && player.hand.some(card => card?.rank === OPEN_RANK));

  handButtons.forEach((button, slot) => {
    const card = player.hand[slot];
    const options = destinations(card, race.piles);
    showCard(button, card);
    button.disabled = !card || race.winner !== null;
    button.classList.toggle('playable', options.length > 0);
    button.classList.toggle('selected', slot === selected);
    button.setAttribute('aria-pressed', String(slot === selected));
    const choices = options.map(index => index === NEW_PILE ? 'a new pile' : `pile ${index + 1}`);
    button.setAttribute('aria-label', card ? `${cardName(card)}${choices.length ? `, playable on ${choices.join(' or ')}` : ''}` : 'Empty slot');
  });

  $('#remaining').textContent = `${TOTAL - player.played} left`;
  updateDeck(yourSeat.deck, player, 'Your');
  race.players.slice(1).forEach((opponent, index) => {
    const { deck, slots, remaining } = rivalSeats[index];
    updateDeck(deck, opponent, `${rivals[index].name}'s`);
    remaining.textContent = `${TOTAL - opponent.played} left`;
    slots.forEach((slot, slotIndex) => slot.classList.toggle('vacant', !opponent.hand[slotIndex]));
  });
  updateTiming();
}

function applyPlay(player, slot, destination, cardId, from) {
  const source = seatFor(player).slots[slot].firstElementChild;
  const origin = from ?? source.getBoundingClientRect();
  const opening = destination === NEW_PILE;
  const index = opening ? race.piles.length : destination;
  const card = play(race, player, slot, destination, cardId);
  if (!card) return false;
  if (!player) {
    selected = null;
    message = null;
    if (opening) announce(`Opened pile ${index + 1}.`, 1000);
  }
  blockedAt = null;
  render();
  const target = pileGrid.children[index];
  carryCard(cardFace(card), origin, target.querySelector('.card-face').getBoundingClientRect());
  playAnimation(target, 'hit');
  animateDraw(player, slot, 70);
  if (race.winner !== null) finishRace();
  return true;
}

function swapCard(player, slot, now) {
  const { deck, slots } = seatFor(player);
  const card = race.players[player].hand[slot];
  if (!recycle(race, player, slot, now)) return;
  const from = slots[slot].firstElementChild.getBoundingClientRect();
  const to = deck.firstElementChild.getBoundingClientRect();
  carryCard(player === 0 ? cardFace(card) : cardBack(card.tool), from, to, { duration: 180 });
  if (player === 0) {
    selected = null;
    announce(`${cardName(race.players[0].hand[slot])} drawn.`, 800);
    render();
  }
  animateDraw(player, slot, 80);
}

function tick() {
  if (!canPlay()) return;
  const now = timeNow();
  const due = bots.filter(bot => bot.next <= now).sort((a, b) => a.next - b.next);
  for (const bot of due) {
    if (now >= bot.rhythmUntil) {
      bot.rhythm = 0.73 + Math.random() * 0.60;
      bot.rhythmUntil = now + 2300 + Math.random() * 3900;
    }
    const move = chooseMove(race, bot.player, settings.difficulty);
    if (move && 'recycle' in move) swapCard(bot.player, move.recycle, now);
    else if (move) applyPlay(bot.player, move.slot, move.pile, race.players[bot.player].hand[move.slot].id);
    bot.next = now + reactionTime(bot.player, settings.difficulty, bot.rhythm);
    if (race.winner !== null) return;
  }

  if (race.players.some(player => legalMoves(player.hand, race.piles).length)) blockedAt = null;
  else {
    blockedAt ??= now;
    if (now - blockedAt > 1250 && retuneIfBlocked(race)) {
      blockedAt = null;
      announce('Piles reset. Look for a new match!');
      render();
      for (const button of pileGrid.children) playAnimation(button, 'hit');
    }
  }
  updateTiming();
}

function stopClock() {
  elapsed = timeNow();
  startedAt = null;
  clearInterval(timer);
  cancelDrag();
}

function resumeClock() {
  if (!race || race.winner !== null || startedAt !== null || document.hidden || openDialog()) return;
  startedAt = performance.now();
  timer = setInterval(tick, 48);
}

function startRace() {
  stopClock();
  clearTimeout(finishTimer);
  openDialog()?.close();
  race = newRace(settings.opponents + 1);
  selected = null;
  message = null;
  elapsed = 0;
  blockedAt = null;
  bots = race.players.slice(1).map((_, index) => ({
    player: index + 1, next: 900 + Math.random() * 430, rhythm: 1, rhythmUntil: 0,
  }));
  $('.lobby').hidden = true;
  $('#arena').hidden = false;
  $('#pause').hidden = false;
  yourSeat.deck.replaceChildren(cardBack(race.players[0].tool));
  createRivals(race.players.slice(1));
  render();
  layoutPiles();
  race.players.forEach(({ hand }, player) => hand.forEach((_, slot) => animateDraw(player, slot, slot * 55)));
  resumeClock();
}

function showSetup() {
  stopClock();
  clearTimeout(finishTimer);
  race = null;
  openDialog()?.close();
  $('#arena').hidden = true;
  $('#pause').hidden = true;
  $('.lobby').hidden = false;
  $('.start').focus();
}

function finishRace() {
  stopClock();
  const win = race.winner === 0;
  const winner = win ? 'You' : rivals[race.winner - 1].name;
  const speed = formatTime(elapsed);
  const recordKey = `record:${TOTAL}:${settings.difficulty}:${settings.opponents}`;
  const previousBest = readSetting(recordKey, null);
  const improved = win && (previousBest === null || elapsed < previousBest);
  if (improved) saveSetting(recordKey, elapsed);

  $('#finish-title').textContent = win ? 'You won!' : `${winner} won`;
  $('#finish-summary').textContent = win ? `Deck cleared in ${speed}.${improved ? ' New personal best!' : ''}` : `${winner} cleared their deck in ${speed}. You played ${race.players[0].played} cards.`;
  const positions = race.players.map((player, index) => ({ played: player.played, name: index ? rivals[index - 1].name : 'You' }));
  positions.sort((a, b) => b.played - a.played);
  $('#standings').replaceChildren(...positions.map(({ name, played }) => {
    const row = document.createElement('li');
    const count = document.createElement('span');
    count.textContent = `${played} / ${TOTAL} played`;
    row.append(name, count);
    return row;
  }));
  finishTimer = setTimeout(() => {
    openDialog()?.close();
    $('#finish-dialog').showModal();
  }, motion.matches ? 0 : 250);
}

function playFromHand(slot, pile, from) {
  if (!canPlay()) return;
  const card = race.players[0].hand[slot];
  if (card && applyPlay(0, slot, pile, card.id, from)) return;
  announce(pile === NEW_PILE ? 'Play a 1 to start a new pile.' : 'That card doesn’t fit here. Try another pile.');
  render();
}

function selectCard(slot) {
  if (!canPlay()) return;
  const card = race.players[0].hand[slot];
  const options = destinations(card, race.piles);
  message = null;
  if (options.length === 1) return playFromHand(slot, options[0]);
  selected = selected === slot ? null : slot;
  render();
}

function cancelDrag() {
  if (!drag) return;
  handButtons[drag.slot].classList.remove('dragging');
  $('.table .drag-over')?.classList.remove('drag-over');
  drag.ghost?.remove();
  drag = null;
}

$('#hand').addEventListener('pointerdown', event => {
  const button = event.target.closest('.hand-card');
  if (!button || !event.isPrimary || event.button !== 0 || button.disabled || !canPlay()) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, slot: Number(button.dataset.slot) };
  button.setPointerCapture(event.pointerId);
});

$('#hand').addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId || !canPlay()) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 9) return;
    const button = handButtons[drag.slot];
    const rect = button.getBoundingClientRect();
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'flight drag-ghost';
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.style.width = `${rect.width}px`;
    drag.ghost.append(cardFace(race.players[0].hand[drag.slot]));
    document.body.append(drag.ghost);
    selected = drag.slot;
    message = null;
    button.classList.add('dragging');
    render();
  }
  drag.ghost.style.left = `${event.clientX - drag.ghost.offsetWidth / 2}px`;
  drag.ghost.style.top = `${event.clientY - drag.ghost.offsetHeight / 2}px`;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pile].target');
  const previous = $('.table .drag-over');
  if (previous !== target) previous?.classList.remove('drag-over');
  target?.classList.add('drag-over');
});

$('#hand').addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.ghost) return cancelDrag();
  const { slot, ghost } = drag;
  const origin = ghost.getBoundingClientRect();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pile]');
  ignoreClicksUntil = performance.now() + 350;
  cancelDrag();
  if (target) playFromHand(slot, Number(target.dataset.pile), origin);
});

$('#hand').addEventListener('pointercancel', cancelDrag);
$('#hand').addEventListener('lostpointercapture', cancelDrag);
$('#hand').addEventListener('click', event => {
  const button = event.target.closest('.hand-card');
  if (button && (event.detail === 0 || performance.now() >= ignoreClicksUntil)) selectCard(Number(button.dataset.slot));
});
$('.table').addEventListener('click', event => {
  const button = event.target.closest('[data-pile]');
  if (!button || !canPlay()) return;
  const pile = Number(button.dataset.pile);
  if (selected !== null) playFromHand(selected, pile);
  else if (pile === NEW_PILE) {
    const slot = race.players[0].hand.findIndex(card => card?.rank === OPEN_RANK);
    if (slot >= 0) playFromHand(slot, pile);
    else {
      announce('Play a 1 to start a new pile.');
      updateTiming();
    }
  } else {
    announce('Choose a card from your hand first.');
    updateTiming();
  }
});

new ResizeObserver(layoutPiles).observe(pileGrid);

$('#cycle').addEventListener('click', () => {
  if (!canPlay()) return;
  const player = race.players[0];
  swapCard(0, selected ?? recycleSlot(player.hand, race.piles), timeNow());
});

function showDialog(dialog) {
  if (openDialog()) return;
  stopClock();
  dialog.showModal();
}

const previous = readSetting('setup', {});
const lobbyArt = $('.lobby-art');
for (const card of [{ suit: 'grove', rank: 6 }, { suit: 'tide', rank: 2 }, { suit: 'ember', rank: 7 }, { suit: 'spark', rank: 10 }]) {
  const face = cardFace(card);
  face.classList.add(`art-${card.suit}`);
  lobbyArt.append(face);
}
const setupForm = $('#setup');
if ([1, 2, 3].includes(previous.opponents)) setupForm.elements.opponents.value = String(previous.opponents);
if (['relaxed', 'quick', 'expert'].includes(previous.difficulty)) setupForm.elements.difficulty.value = previous.difficulty;
setupForm.addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(setupForm);
  settings = { opponents: Number(form.get('opponents')), difficulty: form.get('difficulty') };
  saveSetting('setup', settings);
  startRace();
});

$('#help').addEventListener('click', () => showDialog($('#rules-dialog')));
$('#pause').addEventListener('click', () => showDialog($('#pause-dialog')));
$('#resume').addEventListener('click', () => $('#pause-dialog').close());
$('#exit').addEventListener('click', showSetup);
$('#rematch').addEventListener('click', startRace);
$('#setup-again').addEventListener('click', showSetup);
$('#finish-dialog').addEventListener('cancel', event => event.preventDefault());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', resumeClock));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else resumeClock();
});

function updateInstallButton() {
  $('#install').hidden = scheme.matches || navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install').hidden = true;
});
$('#install').addEventListener('click', async () => {
  if (!installPrompt) return showDialog($('#install-dialog'));
  stopClock();
  const prompt = installPrompt;
  installPrompt = null;
  try { await prompt.prompt(); }
  finally { resumeClock(); }
});
scheme.addEventListener('change', updateInstallButton);
updateInstallButton();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(error => console.error('Offline setup failed', error));
}
