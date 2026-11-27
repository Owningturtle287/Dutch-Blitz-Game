import {
  DEFAULT_RULES, NEW_PILE, WOOD_CARD, RANKS, OPEN_RANK, newRace, visibleCard, destinations,
  legalMoves, woodCount, isBlocked, flipWood, play, score, chooseMove, reactionTime,
} from './engine.js';

const $ = selector => document.querySelector(selector);
const table = $('.table');
const pileGrid = $('#piles');
const newPileButton = $('#new-pile');
const cardTemplate = $('#card-template').content.firstElementChild;
const backTemplate = $('#back-template').content.firstElementChild;
const seatTemplate = $('#seat-template').content.firstElementChild;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const scheme = matchMedia('(display-mode: standalone)');
const colors = { spark: 'Yellow', tide: 'Blue', ember: 'Red', grove: 'Green' };
const toolNames = { wagon: 'wagon', pump: 'hand pump', barrel: 'barrel', plow: 'plow' };
const seating = [
  { name: 'You', side: 'south' },
  { name: 'Sage', side: 'north' },
  { name: 'Nova', side: 'west' },
  { name: 'Dash', side: 'east' },
];
const ROUND_DELAY = 10000;

let race;
let settings;
let seats = [];
let selected = null;
let startedAt = null;
let elapsed = 0;
let timer;
let finishTimer;
let roundStarted = false;
let blocked = false;
let bots = [];
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

const cardName = card => `${colors[card.suit]} ${card.rank}`;
const timeNow = () => elapsed + (startedAt === null ? 0 : performance.now() - startedAt);
const openDialog = () => document.querySelector('dialog[open]');
const canPlay = () => Boolean(race && roundStarted && race.finisher === null && startedAt !== null && !openDialog());
const sourceOf = button => button.dataset.source === WOOD_CARD ? WOOD_CARD : Number(button.dataset.source);
const targetsFor = card => destinations(card, race.piles, race.rules);

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
  const key = card?.id ?? '';
  if (element.dataset.card === key) return;
  element.dataset.card = key;
  element.replaceChildren(...(card ? [cardFace(card)] : []));
}

function turningCard(card, faceUp) {
  const visual = document.createElement('span');
  visual.className = 'turning-card';
  const face = cardFace(card);
  const back = cardBack(card.tool);
  visual.append(...(faceUp ? [back, face] : [face, back]));
  return visual;
}

function announce(text, duration = 1250) {
  message = { text, ends: timeNow() + duration };
}

function makeGrip() {
  const hand = document.createElement('span');
  hand.className = 'grip';
  const image = document.createElement('img');
  image.src = './assets/card-hand.webp';
  image.alt = '';
  image.draggable = false;
  hand.append(image);
  return hand;
}

function carryCard(visual, from, to, { duration = 350, delay = 0 } = {}) {
  if (motion.matches || !from?.width || !to?.width) return;
  const flight = document.createElement('div');
  flight.className = 'flight';
  flight.setAttribute('aria-hidden', 'true');
  const grip = makeGrip();
  Object.assign(flight.style, {
    left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
  });
  flight.append(visual, grip);
  document.body.append(flight);
  const x = from.left - to.left + (from.width - to.width) / 2;
  const y = from.top - to.top + (from.height - to.height) / 2;
  const start = `translate(${x}px, ${y}px) scale(${from.width / to.width})`;
  const middle = `translate(${x * .42}px, ${y * .42 - 7}px) rotate(${x < 0 ? -7 : 7}deg)`;
  const animation = flight.animate([
    { transform: start, opacity: 1 },
    { transform: start, opacity: 1, offset: .2 },
    { transform: middle, opacity: 1, offset: .54 },
    { transform: 'translate(0, 0)', opacity: 1, offset: .88 },
    { transform: 'translate(0, 0)', opacity: 0 },
  ], { duration, delay, easing: 'ease-in-out' });
  grip.animate([
    { transform: 'translate(25%, 30%)', opacity: 0 },
    { transform: 'translate(0)', opacity: 1, offset: .2 },
    { transform: 'translate(0)', opacity: 1, offset: .83 },
    { transform: 'translate(27%, 32%)', opacity: 0 },
  ], { duration, delay });
  if (visual.classList.contains('turning-card')) {
    visual.animate([
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(0deg)', offset: .35 },
      { transform: 'rotateY(180deg)', offset: .8 },
      { transform: 'rotateY(180deg)' },
    ], { duration, delay });
  }
  animation.finished.then(() => flight.remove(), () => flight.remove());
}

function createSeats() {
  seats = race.players.map((player, index) => {
    const { name, side } = seating[index];
    const element = seatTemplate.cloneNode(true);
    element.classList.add(side);
    element.setAttribute('aria-label', index === 0 ? 'Your seat' : `${name}'s seat`);
    element.querySelector('.seat-name').textContent = name;
    const stock = element.querySelector('.wood-deck');
    const blitz = element.querySelector('.blitz-deck');
    stock.append(cardBack(player.tool));
    blitz.append(cardBack(player.tool));
    const slots = new Map([...element.querySelectorAll('.play-card')].map(button => [sourceOf(button), button]));
    return {
      element, slots, stock, blitz,
      points: element.querySelector('.seat-score'),
      woodCount: element.querySelector('.wood-count'),
      blitzCount: element.querySelector('.blitz-count'),
    };
  });
  $('#seats').replaceChildren(...seats.map(seat => seat.element));
}

function fitPiles(count, width, height, gap, labelHeight) {
  let best;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const availableWidth = Math.floor((width - gap * (columns - 1)) / columns);
    const availableHeight = Math.floor((height - gap * (rows - 1)) / rows);
    const cardWidth = Math.min(102, availableWidth - 7, Math.floor((availableHeight - labelHeight) * 5 / 7));
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
  const fit = fitPiles(count, width, height, gap, 17);
  const cardWidth = Math.max(1, fit.cardWidth);
  const cellWidth = Math.min(fit.availableWidth, Math.max(40, cardWidth + 14));
  pileGrid.style.setProperty('--pile-columns', fit.columns);
  pileGrid.style.setProperty('--pile-cell-width', `${cellWidth}px`);
  pileGrid.style.setProperty('--pile-cell-height', `${Math.ceil(cardWidth * 7 / 5) + 17}px`);
}

function showStack(container, pile, index) {
  const top = pile.cards.at(-1);
  if (container.dataset.card === top.id) return;
  container.dataset.card = top.id;
  const recent = pile.cards.slice(-3);
  const tilts = [-7, 6, -4, 7];
  container.replaceChildren(...recent.map((card, layer) => {
    const isTop = layer === recent.length - 1;
    const visual = isTop && pile.closed ? cardBack(card.tool) : cardFace(card);
    visual.classList.add('pile-layer');
    const tiltIndex = (index + pile.cards.length - recent.length + layer) % tilts.length;
    visual.style.setProperty('--tilt', `${tilts[tiltIndex]}deg`);
    visual.style.setProperty('--offset', `${(layer - (recent.length - 1) / 2) * 4}%`);
    return visual;
  }));
}

function renderPiles(targets, active) {
  const count = race.piles.length;
  const countChanged = count !== pileGrid.childElementCount;
  while (pileGrid.childElementCount > count) pileGrid.lastElementChild.remove();

  race.piles.forEach((pile, index) => {
    let button = pileGrid.children[index];
    if (!button) {
      button = $('#pile-template').content.firstElementChild.cloneNode(true);
      button.dataset.pile = index;
      pileGrid.append(button);
    }
    const top = pile.cards.at(-1);
    const useRankCue = top.rank < RANKS && !race.rules.sameColor && !race.rules.descending;
    const cue = useRankCue ? `↑ ${top.rank + 1}` : `${top.rank} on top`;
    const description = useRankCue ? `Play ${race.rules.anyColor ? '' : colors[top.suit] + ' '}${top.rank + 1}.` : '';
    showStack(button.querySelector('.pile-card'), pile, index);
    button.querySelector('.pile-cue').textContent = pile.closed ? 'Closed' : cue;
    button.setAttribute('aria-label', pile.closed ? `Pile ${index + 1}, closed` : `Pile ${index + 1}, ${cardName(top)}. ${description}`.trim());
    button.disabled = !active || pile.closed;
    button.classList.toggle('closed', pile.closed);
    button.classList.toggle('target', targets.includes(index));
  });
  $('#pile-count').textContent = count;
  $('#empty-table').hidden = !roundStarted || count !== 0;
  $('#empty-table').textContent = blocked ? 'No eligible cards remain.' : 'Play a 1 to open a pile.';
  if (countChanged) layoutPiles();
}

function renderSeat(player, index, active) {
  const seat = seats[index];
  const human = index === 0;
  const wood = woodCount(player);
  const blitz = player.blitz.length;
  const tool = toolNames[player.tool];
  seat.points.textContent = `${score(player)} pts`;
  seat.woodCount.textContent = wood;
  seat.blitzCount.textContent = blitz;
  seat.stock.disabled = !human || !active || !wood;
  const woodAction = player.wood.length ? 'Flip up to 3 cards.' : 'Reshuffle and flip up to 3 cards.';
  seat.stock.setAttribute('aria-label', `Wood pile, ${wood} cards left, ${player.wood.length} in stock. ${human && wood ? woodAction : ''}`.trim());
  seat.stock.classList.toggle('stacked', player.wood.length > 1);
  seat.stock.classList.toggle('empty', !player.wood.length);
  seat.blitz.classList.toggle('stacked', blitz > 1);
  seat.blitz.classList.toggle('empty', blitz === 0);
  seat.blitz.setAttribute('aria-label', `Blitz pile, ${blitz} cards left, ${tool} backs`);

  for (const [source, button] of seat.slots) {
    const card = visibleCard(player, source);
    const options = active && human ? targetsFor(card) : [];
    const label = source === WOOD_CARD ? 'Flipped Wood card' : `Face-up card ${source + 1}`;
    showCard(button, card);
    button.disabled = !human || !active || !card;
    button.classList.toggle('playable', options.length > 0);
    button.classList.toggle('selected', human && selected === source);
    button.classList.toggle('packet', source === WOOD_CARD && player.woodShown.length > 1);
    button.setAttribute('aria-label', `${label}${card ? `, ${cardName(card)}` : ', empty'}${options.length ? ', playable' : ''}`);
    if (human) button.setAttribute('aria-pressed', String(selected === source));
  }
}

function updateClock() {
  const now = timeNow();
  const seconds = Math.max(1, Math.ceil((ROUND_DELAY - now) / 1000));
  const counter = $('#countdown-value');
  if (counter.textContent !== String(seconds)) counter.textContent = seconds;
  $('#countdown').hidden = roundStarted;
  const clock = $('#clock');
  const formatted = formatTime(Math.max(0, now - ROUND_DELAY));
  if (clock.textContent !== formatted) clock.textContent = formatted;
}

function updateStatus() {
  updateClock();
  const player = race.players[0];
  const targets = targetsFor(visibleCard(player, selected));
  let hint = '';
  if (roundStarted) {
    if (blocked) hint = 'No legal moves. Restart from Pause.';
    else if (targets.length) hint = 'Choose a highlighted pile.';
    else if (selected === WOOD_CARD) hint = 'Wait for a match or flip the Wood pile again.';
    else if (legalMoves(player, race.piles, race.rules).length) hint = 'Tap or drag a highlighted card.';
    else if (woodCount(player)) hint = 'Flip the Wood pile or wait for a match.';
    else hint = 'Waiting for a match…';
  }
  const text = message?.ends > timeNow() ? message.text : hint;
  if ($('#status').textContent !== text) $('#status').textContent = text;
}

function render() {
  const player = race.players[0];
  const active = canPlay();
  blocked = active && isBlocked(race);
  const targets = active ? targetsFor(visibleCard(player, selected)) : [];
  const canOpen = active && (selected === null
    ? [...player.posts, visibleCard(player, WOOD_CARD)].some(card => card?.rank === OPEN_RANK)
    : targets.includes(NEW_PILE));
  renderPiles(targets, active);
  race.players.forEach((racer, index) => renderSeat(racer, index, active));
  newPileButton.disabled = !canOpen;
  newPileButton.classList.toggle('ready', canOpen);
  newPileButton.classList.toggle('target', targets.includes(NEW_PILE));
  updateStatus();
}

function slotRect(button) {
  return (button.firstElementChild ?? button).getBoundingClientRect();
}

function revealOnArrival(face, duration, delay = 0) {
  if (!motion.matches) {
    face.animate([{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { delay, duration, fill: 'backwards' });
  }
}

function revealTransfer(card, from, button, { delay = 0, duration = 315 } = {}) {
  if (motion.matches) return;
  carryCard(turningCard(card, true), from, slotRect(button), { delay, duration });
  revealOnArrival(button.firstElementChild, duration, delay);
}

function applyPlay(player, source, destination, cardId, from) {
  const seat = seats[player];
  const origin = from ?? slotRect(seat.slots.get(source));
  const blitzOrigin = slotRect(seat.blitz);
  const opening = destination === NEW_PILE;
  const index = opening ? race.piles.length : destination;
  const card = play(race, player, source, destination, cardId);
  if (!card) return false;
  if (player === 0) {
    selected = null;
    message = null;
    if (opening) announce(`Opened pile ${index + 1}.`);
  }
  render();
  const pile = race.piles[index];
  const target = pileGrid.children[index].querySelector('.pile-card').lastElementChild;
  const duration = 350;
  carryCard(pile.closed ? turningCard(card, false) : cardFace(card), origin, target.getBoundingClientRect(), { duration });
  revealOnArrival(target, duration);
  if (source !== WOOD_CARD) {
    const replacement = visibleCard(race.players[player], source);
    if (replacement) revealTransfer(replacement, blitzOrigin, seat.slots.get(source), { delay: 135 });
  }
  if (race.finisher !== null) finishRace();
  return true;
}

function turnWood(player) {
  const seat = seats[player];
  const origin = slotRect(seat.stock);
  const reshuffled = !race.players[player].wood.length;
  const drawn = flipWood(race, player);
  if (!drawn) return;
  if (player === 0) {
    selected = null;
    const action = reshuffled ? 'Reshuffled Wood and flipped' : 'Flipped';
    announce(`${action} ${drawn.length} ${drawn.length === 1 ? 'card' : 'cards'}.`, 800);
  }
  render();
  const receiver = seat.slots.get(WOOD_CARD);
  const top = drawn.at(-1);
  for (let index = 0; index < drawn.length - 1; index++) {
    carryCard(cardBack(top.tool), origin, slotRect(receiver), { delay: index * 55, duration: 215 });
  }
  revealTransfer(top, origin, receiver, { delay: (drawn.length - 1) * 55, duration: 280 });
}

function tick() {
  if (!race || startedAt === null || race.finisher !== null) return;
  const now = timeNow();
  if (!roundStarted) {
    if (now < ROUND_DELAY) return updateStatus();
    roundStarted = true;
    render();
  }
  if (blocked) return updateStatus();
  const due = bots.filter(bot => bot.next <= now).sort((a, b) => a.next - b.next);
  for (const bot of due) {
    if (now >= bot.rhythmUntil) {
      bot.rhythm = .73 + Math.random() * .60;
      bot.rhythmUntil = now + 2300 + Math.random() * 3900;
    }
    const move = chooseMove(race, bot.player, settings.difficulty);
    if (move?.flip) turnWood(bot.player);
    else if (move) applyPlay(bot.player, move.source, move.pile, visibleCard(race.players[bot.player], move.source).id);
    bot.next = now + reactionTime(bot.player, settings.difficulty, bot.rhythm);
    if (race.finisher !== null) return;
  }
  updateStatus();
}

function stopClock() {
  elapsed = timeNow();
  startedAt = null;
  clearInterval(timer);
  cancelDrag();
}

function resumeClock() {
  if (!race || race.finisher !== null || startedAt !== null || document.hidden || openDialog()) return;
  startedAt = performance.now();
  timer = setInterval(tick, 48);
  render();
}

function startRace() {
  stopClock();
  clearTimeout(finishTimer);
  openDialog()?.close();
  race = newRace(settings.opponents + 1, Math.random, variants);
  selected = null;
  message = null;
  elapsed = 0;
  roundStarted = false;
  ignoreClicksUntil = 0;
  bots = race.players.slice(1).map((_, index) => ({
    player: index + 1, next: ROUND_DELAY + 900 + Math.random() * 430, rhythm: 1, rhythmUntil: 0,
  }));
  $('#lobby').hidden = true;
  $('#arena').hidden = false;
  $('#pause').hidden = false;
  createSeats();
  render();
  resumeClock();
}

function showSetup() {
  stopClock();
  clearTimeout(finishTimer);
  race = null;
  openDialog()?.close();
  $('#arena').hidden = true;
  $('#pause').hidden = true;
  $('#lobby').hidden = false;
  $('.start').focus();
}

function finishRace() {
  stopClock();
  const player = race.players[0];
  const finisher = seating[race.finisher].name;
  $('#finish-title').textContent = race.finisher === 0 ? 'You called Blitz!' : `${finisher} called Blitz!`;
  $('#finish-summary').textContent = `You scored ${score(player)} points in ${formatTime(Math.max(0, elapsed - ROUND_DELAY))}.`;
  const positions = race.players.map((racer, index) => ({ ...racer, name: seating[index].name, points: score(racer) }));
  positions.sort((a, b) => b.points - a.points);
  $('#standings').replaceChildren(...positions.map(({ name, points, played, blitz }) => {
    const row = document.createElement('li');
    const total = document.createElement('strong');
    total.textContent = `${points} pts`;
    const detail = document.createElement('small');
    detail.textContent = `${played} played · ${blitz.length} left in Blitz`;
    row.append(name, total, detail);
    return row;
  }));
  finishTimer = setTimeout(() => {
    openDialog()?.close();
    $('#finish-dialog').showModal();
  }, motion.matches ? 0 : 465);
}

function playFromSeat(source, pile, from) {
  if (!canPlay()) return;
  const card = visibleCard(race.players[0], source);
  if (card && applyPlay(0, source, pile, card.id, from)) return;
  announce(pile === NEW_PILE ? 'Play a 1 to open a pile.' : 'That card does not fit this pile.');
  render();
}

function selectCard(source) {
  if (!canPlay()) return;
  const card = visibleCard(race.players[0], source);
  const options = targetsFor(card);
  message = null;
  if (options.length === 1) return playFromSeat(source, options[0]);
  selected = selected === source ? null : source;
  render();
}

function cancelDrag() {
  if (!drag) return;
  drag.button.classList.remove('dragging');
  table.querySelector('.drag-over')?.classList.remove('drag-over');
  drag.ghost?.remove();
  drag = null;
}

table.addEventListener('pointerdown', event => {
  const button = event.target.closest('.south .play-card');
  if (!button || !event.isPrimary || event.button !== 0 || button.disabled || !canPlay()) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, button, source: sourceOf(button) };
  button.setPointerCapture(event.pointerId);
});

table.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId || !canPlay()) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 9) return;
    const rect = slotRect(drag.button);
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'flight drag-ghost';
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.style.width = `${rect.width}px`;
    drag.ghost.append(cardFace(visibleCard(race.players[0], drag.source)));
    if (!motion.matches) drag.ghost.append(makeGrip());
    document.body.append(drag.ghost);
    selected = drag.source;
    message = null;
    drag.button.classList.add('dragging');
    render();
  }
  drag.ghost.style.left = `${event.clientX - drag.ghost.offsetWidth / 2}px`;
  drag.ghost.style.top = `${event.clientY - drag.ghost.offsetHeight / 2}px`;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pile].target');
  const previous = table.querySelector('.drag-over');
  if (previous !== target) previous?.classList.remove('drag-over');
  target?.classList.add('drag-over');
});

table.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.ghost) return cancelDrag();
  const { source, ghost } = drag;
  const origin = ghost.getBoundingClientRect();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-pile]:enabled');
  ignoreClicksUntil = performance.now() + 350;
  cancelDrag();
  if (target) playFromSeat(source, Number(target.dataset.pile), origin);
});

table.addEventListener('pointercancel', cancelDrag);
table.addEventListener('lostpointercapture', cancelDrag);
table.addEventListener('click', event => {
  if (!canPlay()) return;
  const cardButton = event.target.closest('.south .play-card');
  if (cardButton) {
    if (event.detail === 0 || performance.now() >= ignoreClicksUntil) selectCard(sourceOf(cardButton));
    return;
  }
  if (event.target.closest('.south .wood-deck')) return turnWood(0);
  const button = event.target.closest('[data-pile]');
  if (!button) return;
  const pile = Number(button.dataset.pile);
  if (selected !== null) return playFromSeat(selected, pile);
  if (pile === NEW_PILE) {
    const player = race.players[0];
    const sources = [...player.posts.keys(), WOOD_CARD];
    const source = sources.find(option => visibleCard(player, option)?.rank === OPEN_RANK);
    if (source !== undefined) return playFromSeat(source, pile);
  }
  announce('Choose a face-up card first.');
  updateStatus();
});

new ResizeObserver(layoutPiles).observe(pileGrid);

function showDialog(dialog) {
  if (openDialog()) return;
  stopClock();
  dialog.showModal();
}

const previous = readSetting('setup', {});
const savedVariants = readSetting('variants', {});
const variants = Object.fromEntries(Object.keys(DEFAULT_RULES).map(key => [key, savedVariants[key] === true]));
const variantsForm = $('#variant-settings');
variantsForm.addEventListener('submit', () => {
  for (const key of Object.keys(variants)) variants[key] = variantsForm.elements[key].checked;
  saveSetting('variants', variants);
});

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
$('#settings').addEventListener('click', () => {
  for (const [key, value] of Object.entries(variants)) variantsForm.elements[key].checked = value;
  showDialog($('#settings-dialog'));
});
$('#pause').addEventListener('click', () => showDialog($('#pause-dialog')));
$('#resume').addEventListener('click', () => $('#pause-dialog').close());
$('#restart').addEventListener('click', startRace);
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
