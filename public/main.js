import {
  TOTAL, NEW_PILE, OPEN_RANK, nextRank, destinations, legalMoves, newRace, play, recycle, recycleSlot,
  retuneIfBlocked, chooseMove, reactionTime,
} from './engine.js';

const $ = selector => document.querySelector(selector);
const pileStrip = $('#piles');
const newPileButton = $('#new-pile');
const handButtons = [...document.querySelectorAll('.hand-card')];
const cardTemplate = $('#card-template').content.firstElementChild;
const backTemplate = $('#back-template').content.firstElementChild;
const drawDeck = $('#draw-deck');
const rivals = [
  { name: 'Nova', color: '#b2def6' },
  { name: 'Sage', color: '#bfe3a2' },
  { name: 'Dash', color: '#ffc0a4' },
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

function carryCard(card, from, to, bot) {
  if (motion.matches || !from?.width || !to.width) return;
  const flight = document.createElement('div');
  flight.className = 'flight';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, {
    left: `${from.left + (from.width - to.width) / 2}px`,
    top: `${from.top + (from.height - to.height) / 2}px`,
    width: `${to.width}px`, height: `${to.height}px`,
  });
  flight.append(cardFace(card));
  document.body.append(flight);
  const x = to.left - from.left + (to.width - from.width) / 2;
  const y = to.top - from.top + (to.height - from.height) / 2;
  const animation = flight.animate([
    { transform: `translate(0, 0) rotate(${bot ? -10 : 6}deg) scale(${bot ? .42 : from.width / to.width})`, opacity: bot ? .66 : 1 },
    { transform: `translate(${x}px, ${y}px) rotate(0) scale(1)`, opacity: 1 },
  ], { duration: bot ? 210 : 240, easing: 'cubic-bezier(.18,.75,.30,1)' });
  animation.finished.then(() => flight.remove(), () => flight.remove());
}

function createRivals(opponents) {
  $('#rivals').replaceChildren(...opponents.map(({ tool }, index) => {
    const { name, color } = rivals[index];
    const element = document.createElement('div');
    element.className = 'rival';
    element.dataset.rival = index + 1;
    element.style.setProperty('--rival-color', color);
    element.innerHTML = `<span class="rival-deck" role="img"></span><span><strong class="rival-name">${name}</strong><span class="rival-count"></span></span><span class="rival-track" aria-hidden="true"><span></span></span>`;
    const deck = element.querySelector('.rival-deck');
    const label = `${toolNames[tool]} deck`;
    deck.setAttribute('aria-label', label);
    deck.title = label;
    deck.append(cardBack(tool));
    return element;
  }));
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

function updatePileNavigation() {
  $('#pile-prev').disabled = pileStrip.scrollLeft <= 1;
  $('#pile-next').disabled = pileStrip.scrollLeft + pileStrip.clientWidth >= pileStrip.scrollWidth - 1;
}

function pileIsVisible(button) {
  const { left, right } = button.getBoundingClientRect();
  const bounds = pileStrip.getBoundingClientRect();
  return left >= bounds.left - 1 && right <= bounds.right + 1;
}

function revealPile(button, animate = false) {
  if (pileIsVisible(button)) return;
  const left = pileStrip.scrollLeft + button.getBoundingClientRect().left - pileStrip.getBoundingClientRect().left;
  pileStrip.scrollTo({ left, behavior: animate && !motion.matches ? 'smooth' : 'auto' });
}

function renderPiles(piles, targets) {
  while (pileStrip.children.length > piles.length) pileStrip.lastElementChild.remove();
  piles.forEach((pile, index) => {
    let button = pileStrip.children[index];
    if (!button) {
      button = $('#pile-template').content.firstElementChild.cloneNode(true);
      button.dataset.pile = index;
      button.querySelector('.pile-order').textContent = index + 1;
      const kind = document.createElement('span');
      kind.className = 'pile-symbol';
      kind.textContent = pileSymbols[pile.rule];
      button.querySelector('.pile-kind').append(kind, ` ${capitalize(pile.rule)}`);
      pileStrip.append(button);
    }
    const instruction = pile.rule === 'match' ? `${colors[pile.top.suit]} only` : `Play a ${nextRank(pile)}`;
    showCard(button.querySelector('.pile-card'), pile.top);
    button.querySelector('.pile-rule').textContent = instruction;
    button.classList.toggle('target', targets.includes(index));
    button.setAttribute('aria-label', `${capitalize(pile.rule)} pile ${index + 1}, ${cardName(pile.top)}. ${instruction}`);
  });
  $('#pile-count').textContent = piles.length;
  newPileButton.classList.toggle('target', targets.includes(NEW_PILE));
  updatePileNavigation();
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
  const drawCount = player.deck.length;
  const deckLabel = `Your ${toolNames[player.tool].toLowerCase()} deck, ${drawCount} ${drawCount === 1 ? 'card' : 'cards'} to draw`;
  drawDeck.setAttribute('aria-label', deckLabel);
  drawDeck.title = deckLabel;
  drawDeck.classList.toggle('stacked', drawCount > 1);
  drawDeck.classList.toggle('empty', drawCount === 0);
  race.players.slice(1).forEach((opponent, index) => {
    const element = $(`[data-rival="${index + 1}"]`);
    element.querySelector('.rival-count').textContent = `${TOTAL - opponent.played} left`;
    element.querySelector('.rival-track span').style.transform = `scaleX(${opponent.played / TOTAL})`;
  });
  updateTiming();
}

function applyPlay(player, slot, destination, cardId, from) {
  const source = player ? $(`[data-rival="${player}"]`) : handButtons[slot];
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
  const target = pileStrip.children[index];
  if (!player) revealPile(target);
  if (pileIsVisible(target)) {
    carryCard(card, origin, target.querySelector('.pile-card').getBoundingClientRect(), player !== 0);
    playAnimation(target, 'hit');
  }
  playAnimation(source, player ? 'is-playing' : 'drawn');
  if (race.winner !== null) finishRace();
  return true;
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
    if (move && 'recycle' in move) recycle(race, bot.player, move.recycle, now);
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
      for (const button of pileStrip.children) if (pileIsVisible(button)) playAnimation(button, 'hit');
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
  drawDeck.replaceChildren(cardBack(race.players[0].tool));
  createRivals(race.players.slice(1));
  render();
  pileStrip.scrollLeft = 0;
  updatePileNavigation();
  resumeClock();
}

function showSetup() {
  stopClock();
  clearTimeout(finishTimer);
  race = null;
  openDialog()?.close();
  $('#arena').hidden = true;
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
  const matches = options.filter(index => index !== NEW_PILE).map(index => pileStrip.children[index]);
  if (selected !== null && matches.length && !matches.some(pileIsVisible)) revealPile(matches[0], true);
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

pileStrip.addEventListener('scroll', updatePileNavigation, { passive: true });
window.addEventListener('resize', updatePileNavigation);
[['#pile-prev', -1], ['#pile-next', 1]].forEach(([selector, direction]) => {
  $(selector).addEventListener('click', () => {
    pileStrip.scrollBy({ left: direction * pileStrip.clientWidth, behavior: motion.matches ? 'auto' : 'smooth' });
  });
});

$('#cycle').addEventListener('click', () => {
  if (!canPlay()) return;
  const player = race.players[0];
  const slot = selected ?? recycleSlot(player.hand, race.piles);
  if (!recycle(race, 0, slot, timeNow())) return;
  selected = null;
  announce(`${cardName(player.hand[slot])} drawn.`, 800);
  render();
  playAnimation(handButtons[slot], 'drawn');
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
