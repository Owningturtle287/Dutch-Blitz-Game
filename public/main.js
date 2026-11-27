import {
  DEFAULT_RULES, DRAW_SIZE, NEW_PILE, WOOD_CARD, RANKS, OPEN_RANK, newRace, visibleCard, destinations,
  legalMoves, woodCount, isBlocked, flipWood, play, score,
} from './engine.js';
import { newMatch, recordRound, levelProgress } from './match.js';
import { createProfileStore, normalizeName } from './profiles.js';
import { showTally } from './tally.js';
import { playSound, setSoundEnabled, unlockSounds } from './sound.js';
import { newRival, noticePileChange, settleRivalPlay, stepRival } from './rival-ai.js';
import { chooseRivalNames } from './rival-names.js';

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
const cornerArt = { spark: 'girl-corners', tide: 'boy-corners', ember: 'boy-corners', grove: 'girl-corners' };
const toolNames = { wagon: 'wagon', pump: 'hand pump', barrel: 'barrel', plow: 'plow' };
const seating = [
  { side: 'south' },
  { side: 'north' },
  { side: 'west', angle: 90 },
  { side: 'east', angle: -90 },
];
const ROUND_DELAY = 10000;
const seatPan = [0, 0, -.38, .38];
const BLITZ_HOLD = 1500;

let race;
let match;
let roundNumber;
let seats = [];
let selected = null;
let startedAt = null;
let elapsed = 0;
let timer;
let finishTimer;
let roundStarted = false;
let blocked = false;
let bots = [];
let watched = new Set();
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

function browserStorage() {
  try { return localStorage; }
  catch { return undefined; }
}

const profiles = createProfileStore(browserStorage());
let soundsOn = readSetting('sound', true) !== false;
setSoundEnabled(soundsOn);
document.addEventListener('pointerdown', unlockSounds, { capture: true, passive: true });
document.addEventListener('keydown', unlockSounds, { capture: true });
const racerName = index => index === 0 ? match.settings.name : match.rivalNames[index - 1];
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
  face.querySelector('.card-figures').setAttribute('href', `./assets/card-art.svg#${cornerArt[card.suit]}`);
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

function carryCard(visual, from, to, { duration = 350, delay = 0, fromAngle = 0, toAngle = 0, returnCard = false } = {}) {
  if (motion.matches || !from?.width || !to?.width) return;
  const flight = document.createElement('div');
  flight.className = 'flight';
  flight.setAttribute('aria-hidden', 'true');
  const grip = makeGrip();
  const width = toAngle ? to.height : to.width;
  const height = toAngle ? to.width : to.height;
  Object.assign(flight.style, {
    left: `${to.left + (to.width - width) / 2}px`, top: `${to.top + (to.height - height) / 2}px`,
    width: `${width}px`, height: `${height}px`,
  });
  flight.append(visual, grip);
  document.body.append(flight);
  const x = from.left - to.left + (from.width - to.width) / 2;
  const y = from.top - to.top + (from.height - to.height) / 2;
  const sourceWidth = fromAngle ? from.height : from.width;
  const start = `translate(${x}px, ${y}px) rotate(${fromAngle}deg) scale(${sourceWidth / width})`;
  const middleAngle = fromAngle * .42 + toAngle * .58 + (x < 0 ? -7 : 7);
  const middle = `translate(${x * .42}px, ${y * .42 - 7}px) rotate(${middleAngle}deg)`;
  const end = `translate(0, 0) rotate(${toAngle}deg)`;
  const frames = returnCard ? [
    { transform: start, opacity: 1 },
    { transform: end, opacity: 1, offset: .47 },
    { transform: end, opacity: 1, offset: .58 },
    { transform: start, opacity: 1, offset: .94 },
    { transform: start, opacity: 0 },
  ] : [
    { transform: start, opacity: 1 },
    { transform: start, opacity: 1, offset: .2 },
    { transform: middle, opacity: 1, offset: .54 },
    { transform: end, opacity: 1, offset: .88 },
    { transform: end, opacity: 0 },
  ];
  const animation = flight.animate(frames, { duration, delay, easing: 'ease-in-out' });
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
    const { side, angle = 0 } = seating[index];
    const name = racerName(index);
    const element = seatTemplate.cloneNode(true);
    element.classList.add(side);
    element.setAttribute('aria-label', index === 0 ? 'Your seat' : `${name}'s seat`);
    const nameLabel = element.querySelector('.seat-name');
    nameLabel.textContent = name;
    nameLabel.title = name;
    const stress = element.querySelector('.seat-stress');
    const meter = stress.querySelector('meter');
    stress.hidden = index === 0;
    meter.setAttribute('aria-label', `${name}’s stress`);
    const stock = element.querySelector('.wood-deck');
    const blitz = element.querySelector('.blitz-deck');
    stock.append(cardBack(player.tool));
    blitz.append(cardBack(player.tool));
    const slots = new Map([...element.querySelectorAll('.play-card')].map(button => [sourceOf(button), button]));
    if (index === 0) {
      const flip = () => {
        if (canPlay() && !stock.disabled) turnWood(0);
      };
      stock.addEventListener('click', flip);
      element.querySelector('.wood-label').addEventListener('click', flip);
    }
    return {
      element, slots, stock, blitz, angle, stress, meter,
      stressValue: stress.querySelector('strong'), bubble: element.querySelector('.seat-bubble'),
      bubbleText: '', bubbleAnimation: null, looking: null,
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
    visual.style.setProperty('--offset', `${(layer - (recent.length - 1) / 2) * 3}%`);
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
  const points = score(player);
  const gameTotal = match.totals[index] + points;
  seat.points.textContent = `${gameTotal} pts`;
  seat.points.title = match.settings.rounds === null ? 'Round score' : `Round ${points} · Game ${gameTotal}`;
  seat.woodCount.textContent = wood;
  seat.blitzCount.textContent = blitz;
  seat.stock.disabled = !human || !active || !wood;
  const woodAction = player.wood.length >= Math.min(DRAW_SIZE, wood) ? 'Flip Wood cards.' : 'Flip and reshuffle Wood cards.';
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
    else if (targets.length) hint = drag?.ghost ? 'Release on the table to play.' : 'Choose a highlighted pile.';
    else if (selected === WOOD_CARD) hint = 'Wait for a match or flip the Wood pile again.';
    else if (legalMoves(player, race.piles, race.rules).length) hint = 'Drag a highlighted card, or tap a 1.';
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
  if (drag?.ghost) previewDrop(nearestTarget(drag.source, drag.clientX, drag.clientY));
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

function revealTransfer(card, from, button, { delay = 0, duration = 315, angle = 0 } = {}) {
  if (motion.matches) return;
  carryCard(turningCard(card, true), from, slotRect(button), { delay, duration, fromAngle: angle, toAngle: angle });
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
  const now = timeNow();
  bots.forEach(bot => noticePileChange(bot, index, player, now));
  if (player === 0) {
    selected = null;
    message = null;
    if (opening) announce(`Opened pile ${index + 1}.`);
  }
  render();
  const pile = race.piles[index];
  const target = pileGrid.children[index].querySelector('.pile-card').lastElementChild;
  const duration = 350;
  const landing = motion.matches ? 0 : 294;
  const pan = seatPan[player];
  playSound('place', { level: player === 0 ? .88 : .48, delay: landing, pan });
  carryCard(pile.closed ? turningCard(card, false) : cardFace(card), origin, target.getBoundingClientRect(), { duration, fromAngle: seat.angle });
  revealOnArrival(target, duration);
  if (source !== WOOD_CARD) {
    const replacement = visibleCard(race.players[player], source);
    if (replacement) {
      revealTransfer(replacement, blitzOrigin, seat.slots.get(source), { delay: 135, angle: seat.angle });
      playSound('flip', { level: player === 0 ? .54 : .26, delay: motion.matches ? 75 : 185, pan });
    }
  } else if (visibleCard(race.players[player], WOOD_CARD)) {
    playSound('flip', { level: player === 0 ? .52 : .24, delay: landing + 55, pan });
  }
  if (race.finisher !== null) finishRace();
  return true;
}

function turnWood(player) {
  const seat = seats[player];
  const origin = slotRect(seat.stock);
  const racer = race.players[player];
  const reshuffled = racer.wood.length < Math.min(DRAW_SIZE, woodCount(racer));
  const drawn = flipWood(race, player);
  if (!drawn) return;
  const volume = player === 0 ? .67 : .28;
  const pan = seatPan[player];
  if (reshuffled) playSound('shuffle', { level: volume * .63, pan });
  playSound(drawn.length > 1 ? 'fan' : 'flip', { level: volume, delay: reshuffled ? 90 : 0, pan });
  if (player === 0) {
    if (drag?.source === WOOD_CARD) cancelDrag();
    selected = null;
    const action = reshuffled ? 'Reshuffled Wood and flipped' : 'Flipped';
    announce(`${action} ${drawn.length} ${drawn.length === 1 ? 'card' : 'cards'}.`, 800);
  }
  render();
  const receiver = seat.slots.get(WOOD_CARD);
  const top = drawn.at(-1);
  for (let index = 0; index < drawn.length - 1; index++) {
    carryCard(cardBack(top.tool), origin, slotRect(receiver), { delay: index * 55, duration: 215, fromAngle: seat.angle, toAngle: seat.angle });
  }
  revealTransfer(top, origin, receiver, { delay: (drawn.length - 1) * 55, duration: 280, angle: seat.angle });
}

function showBubble(seat, text = '', blitz = false) {
  if (seat.bubbleText === text) return;
  const { bubble } = seat;
  seat.bubbleText = text;
  seat.bubbleAnimation?.cancel();

  if (text) {
    bubble.classList.toggle('blitz-call', blitz);
    bubble.textContent = text;
    bubble.hidden = false;
    if (motion.matches) return;
    seat.bubbleAnimation = bubble.animate([
      { opacity: 0, translate: '0 5px', scale: .92 },
      { opacity: 1, translate: '0 -1px', scale: 1.015, offset: .73 },
      { opacity: 1, translate: '0 0', scale: 1 },
    ], { duration: 245, easing: 'cubic-bezier(.18,.72,.32,1)' });
  } else if (motion.matches) {
    bubble.hidden = true;
    bubble.textContent = '';
  } else {
    const dismiss = bubble.animate([
      { opacity: 1, translate: '0 0' },
      { opacity: 0, translate: '0 -4px' },
    ], { duration: 165, easing: 'ease-out', fill: 'forwards' });
    seat.bubbleAnimation = dismiss;
    dismiss.finished.then(() => {
      if (seat.bubbleAnimation !== dismiss) return;
      bubble.hidden = true;
      bubble.textContent = '';
      dismiss.cancel();
    }, () => {});
  }
}

function renderRivals() {
  const nextWatched = new Set();
  for (const bot of bots) {
    const seat = seats[bot.player];
    const level = Math.round(bot.stress);
    if (seat.meter.value !== level) {
      seat.meter.value = level;
      seat.stressValue.textContent = level;
      seat.stress.dataset.level = level >= 75 ? 'high' : level >= 44 ? 'medium' : 'low';
    }
    const looking = bot.focus?.kind === 'card' ? seat.slots.get(bot.focus.source) : null;
    if (seat.looking !== looking) {
      seat.looking?.classList.remove('rival-looking');
      seat.looking = looking;
      looking?.classList.add('rival-looking');
    }
    if (bot.focus?.kind === 'pile') {
      const pile = pileGrid.children[bot.focus.pile];
      if (pile) nextWatched.add(pile);
    }
    showBubble(seat, bot.speech?.text);
  }
  for (const pile of watched) if (!nextWatched.has(pile)) pile.classList.remove('rival-watched');
  for (const pile of nextWatched) if (!watched.has(pile)) pile.classList.add('rival-watched');
  watched = nextWatched;
}

function rivalMiss(bot, move) {
  const pile = pileGrid.children[move.pile];
  const seat = seats[bot.player];
  const card = visibleCard(race.players[bot.player], move.source);
  if (!pile || card?.id !== move.cardId) return;
  const source = seat.slots.get(move.source);
  const target = pile.querySelector('.pile-card');
  const duration = 560;
  playSound('flip', { level: .22, delay: motion.matches ? 0 : 245, pan: seatPan[bot.player] });
  carryCard(cardFace(card), slotRect(source), target.getBoundingClientRect(), { duration, fromAngle: seat.angle, returnCard: true });
  if (!motion.matches) {
    source.firstElementChild.animate([
      { opacity: .28 }, { opacity: .28, offset: .88 }, { opacity: 1 },
    ], { duration });
  }
  pile.animate([{ outline: '2px solid #e7a384', offset: 0 }, { outline: '2px solid transparent', offset: 1 }], {
    delay: motion.matches ? 0 : 180, duration: 230,
  });
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

  for (const bot of [...bots].sort((a, b) => a.next - b.next)) {
    const move = stepRival(bot, race, now);
    if (move?.kind === 'flip') turnWood(bot.player);
    if (move?.kind === 'play') {
      const played = !move.mistake && applyPlay(bot.player, move.source, move.pile, move.cardId);
      const moreWood = race.players[bot.player].woodShown.length > 0;
      settleRivalPlay(bot, move, played, moreWood, now);
      if (!played) rivalMiss(bot, move);
    }
    if (race.finisher !== null) return;
  }
  renderRivals();
  updateStatus();
}

function setTableControls(disabled) {
  for (const button of table.querySelectorAll('.table-controls button')) button.disabled = disabled;
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
  roundNumber = match.completed + 1;
  race = newRace(match.settings.players, Math.random, variants);
  $('#match-round').textContent = match.settings.rounds === null ? 'Free Play' : `Round ${roundNumber}/${match.settings.rounds}`;
  selected = null;
  message = null;
  elapsed = 0;
  roundStarted = false;
  ignoreClicksUntil = 0;
  bots = race.players.slice(1).map((_, index) => newRival(index + 1, match.settings.difficulty, ROUND_DELAY));
  watched.clear();
  setTableControls(false);
  $('#lobby').hidden = true;
  $('#arena').hidden = false;
  createSeats();
  render();
  resumeClock();
}

function showSetup() {
  stopClock();
  clearTimeout(finishTimer);
  race = null;
  match = null;
  refreshProfiles();
  openDialog()?.close();
  $('#arena').hidden = true;
  $('#lobby').hidden = false;
  $('.start').focus();
}

function beginMatch(settings, previousNames = []) {
  match = newMatch(settings, crypto.randomUUID());
  match.rivalNames = chooseRivalNames(settings.players - 1, [settings.name, ...previousNames]);
  startRace();
}

function nextRound() {
  if (match.completed === match.settings.rounds) return beginMatch(match.settings, match.rivalNames);
  startRace();
}

function finishRace() {
  stopClock();
  const result = recordRound(match, roundNumber, race.players.map(score));
  if (!result) return;
  setTableControls(true);
  seats.forEach((seat, index) => {
    seat.looking?.classList.remove('rival-looking');
    showBubble(seat, index === race.finisher ? 'Blitz!' : '', index === race.finisher);
  });
  for (const pile of watched) pile.classList.remove('rival-watched');
  watched.clear();

  const racers = race.players.map((racer, index) => ({
    name: racerName(index), tool: racer.tool, played: racer.played, remaining: racer.blitz.length,
  }));
  const cards = race.piles.flatMap(pile => [...pile.cards].reverse());
  const profile = result.xp ? profiles.award(match.settings.name, result.awardId, result.xp) : null;
  const finishTime = formatTime(Math.max(0, elapsed - ROUND_DELAY));
  const caller = race.finisher === 0 ? 'You' : racerName(race.finisher);
  $('#result-round').textContent = result.freePlay ? 'Free Play' : `Round ${roundNumber} of ${match.settings.rounds}`;
  $('#finish-title').textContent = result.final ? 'Game complete' : 'Round complete';
  $('#finish-summary').textContent = `${caller} called Blitz in ${finishTime}.`;
  $('#next-label').textContent = result.final ? 'Play again' : result.freePlay ? 'Play another round' : 'Next round';
  $('#result-progress').hidden = true;

  finishTimer = setTimeout(() => {
    showBubble(seats[race.finisher]);
    openDialog()?.close();
    showTally($('#finish-dialog'), {
      result, racers, cards, face: cardFace, back: cardBack, reducedMotion: motion.matches,
      onSettled() {
        if (!profile) return;
        const place = ['1st', '2nd', '3rd', '4th'][result.placement - 1];
        const progress = $('#result-progress');
        $('#result-xp').textContent = `+${result.xp} XP · ${place} place`;
        paintProgress(progress, profile);
        progress.hidden = false;
      },
    });
  }, BLITZ_HOLD);
}

function playFromSeat(source, pile, from) {
  if (!canPlay()) return;
  const card = visibleCard(race.players[0], source);
  if (card && applyPlay(0, source, pile, card.id, from)) return;
  announce(pile === NEW_PILE ? 'Play a 1 to open a pile.' : 'That card does not fit this pile.');
  render();
}

function activateCard(button, keyboard) {
  const source = sourceOf(button);
  const card = visibleCard(race.players[0], source);
  if (card?.rank === OPEN_RANK) return playFromSeat(source, NEW_PILE);
  selected = keyboard && selected !== source ? source : null;
  if (!keyboard) announce('Drag the card onto the table.', 900);
  render();
}

function nearestTarget(source, x, y) {
  const bounds = table.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;

  const card = visibleCard(race.players[0], source);
  let best = null;
  let bestDistance = Infinity;
  for (const index of targetsFor(card)) {
    const button = index === NEW_PILE ? newPileButton : pileGrid.children[index];
    const rect = button.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return button;
    const distance = (x - (rect.left + rect.width / 2)) ** 2 + (y - (rect.top + rect.height / 2)) ** 2;
    if (distance < bestDistance) {
      best = button;
      bestDistance = distance;
    }
  }
  return best;
}

function previewDrop(target) {
  const previous = table.querySelector('.drag-over');
  if (previous !== target) previous?.classList.remove('drag-over');
  target?.classList.add('drag-over');
}

function cancelDrag() {
  if (!drag) return false;
  const hadGhost = Boolean(drag.ghost);
  drag.button.classList.remove('dragging');
  previewDrop(null);
  drag.ghost?.remove();
  if (hadGhost) selected = null;
  drag = null;
  return hadGhost;
}

table.addEventListener('pointerdown', event => {
  const button = event.target.closest('.south .play-card');
  if (!button || !event.isPrimary || event.button !== 0 || button.disabled || !canPlay()) return;
  const source = sourceOf(button);
  drag = {
    id: event.pointerId, x: event.clientX, y: event.clientY, button, source,
    cardId: visibleCard(race.players[0], source).id,
  };
  button.setPointerCapture(event.pointerId);
});

table.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId || !canPlay()) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
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
  previewDrop(nearestTarget(drag.source, event.clientX, event.clientY));
});

table.addEventListener('pointerup', event => {
  if (drag?.id !== event.pointerId) return;
  if (!drag.ghost) return cancelDrag();
  const { source, ghost, cardId } = drag;
  const origin = ghost.getBoundingClientRect();
  const sameCard = visibleCard(race.players[0], source)?.id === cardId;
  const target = sameCard ? nearestTarget(source, event.clientX, event.clientY) : null;
  ignoreClicksUntil = performance.now() + 350;
  cancelDrag();
  if (target) playFromSeat(source, Number(target.dataset.pile), origin);
  else render();
});

for (const eventName of ['pointercancel', 'lostpointercapture']) {
  table.addEventListener(eventName, event => {
    if (drag?.id === event.pointerId && cancelDrag() && canPlay()) render();
  });
}
table.addEventListener('click', event => {
  if (!canPlay()) return;
  const cardButton = event.target.closest('.south .play-card');
  const keyboard = event.detail === 0;
  if (cardButton) {
    if (keyboard || performance.now() >= ignoreClicksUntil) activateCard(cardButton, keyboard);
    return;
  }
  const button = event.target.closest('[data-pile]');
  if (!button) return;
  const pile = Number(button.dataset.pile);
  if (keyboard && selected !== null && !drag) return playFromSeat(selected, pile);
  if (pile === NEW_PILE) {
    const player = race.players[0];
    const sources = [...player.posts.keys(), WOOD_CARD];
    const source = sources.find(option => visibleCard(player, option)?.rank === OPEN_RANK);
    if (source !== undefined) return playFromSeat(source, pile);
  }
  announce('Drag a face-up card onto the table.');
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
  soundsOn = variantsForm.elements.sound.checked;
  saveSetting('sound', soundsOn);
  setSoundEnabled(soundsOn);
  unlockSounds();
});

const lobbyArt = $('.lobby-art');
for (const card of [{ suit: 'grove', rank: 6 }, { suit: 'tide', rank: 2 }, { suit: 'ember', rank: 7 }, { suit: 'spark', rank: 10 }]) {
  const face = cardFace(card);
  face.classList.add(`art-${card.suit}`);
  lobbyArt.append(face);
}
const setupForm = $('#setup');
const nameInput = $('#profile-name');
const roundsInput = $('#rounds');
const freePlay = $('#free-play');
const profileTemplate = $('#profile-template').content.firstElementChild;
const savedPlayers = previous.players ?? (Number.isInteger(previous.opponents) ? previous.opponents + 1 : 4);
if ([2, 3, 4].includes(savedPlayers)) setupForm.elements.players.value = String(savedPlayers);
if (['relaxed', 'quick', 'expert'].includes(previous.difficulty)) setupForm.elements.difficulty.value = previous.difficulty;
if (Number.isSafeInteger(previous.rounds) && previous.rounds > 0) roundsInput.value = previous.rounds;
freePlay.checked = previous.rounds === null;
roundsInput.disabled = freePlay.checked;
nameInput.value = readSetting('player-name', '');

function paintProgress(element, profile) {
  const { level, xp, goal } = levelProgress(profile.totalXp);
  element.querySelector('.profile-level').textContent = `Level ${level}`;
  element.querySelector('.profile-xp').textContent = `${xp} / ${goal} XP`;
  const meter = element.querySelector('progress');
  meter.max = goal;
  meter.value = xp;
  meter.setAttribute('aria-label', `${profile.name}'s level ${level} progress`);
}

function refreshProfileProgress() {
  const name = normalizeName(nameInput.value);
  const element = $('#setup-progress');
  element.hidden = !name;
  if (name) paintProgress(element, profiles.find(name) ?? { name, totalXp: 0 });
}

function refreshProfiles() {
  const saved = profiles.list();
  const content = saved.map(profile => {
    const option = document.createElement('option');
    option.value = profile.name;
    return option;
  });
  $('#profile-names').replaceChildren(...content);
  $('#profiles').hidden = !saved.length;
  const choices = saved.map(profile => {
    const option = profileTemplate.cloneNode(true);
    option.querySelector('.saved-name').textContent = profile.name;
    paintProgress(option, profile);
    option.addEventListener('click', () => {
      nameInput.value = profile.name;
      nameInput.setCustomValidity('');
      refreshProfileProgress();
      $('#profiles-dialog').close();
      nameInput.focus();
    });
    return option;
  });
  $('#profile-list').replaceChildren(...choices);
  refreshProfileProgress();
}

nameInput.addEventListener('input', () => {
  nameInput.setCustomValidity('');
  refreshProfileProgress();
});
freePlay.addEventListener('change', () => { roundsInput.disabled = freePlay.checked; });
roundsInput.addEventListener('input', () => roundsInput.setCustomValidity(''));
$('#profiles').addEventListener('click', () => {
  refreshProfiles();
  showDialog($('#profiles-dialog'));
});
window.addEventListener('storage', event => {
  if (event.key === null || event.key.startsWith('overcurrent:profile:') || event.key.startsWith('overcurrent:award:')) refreshProfiles();
});
refreshProfiles();

setupForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = normalizeName(nameInput.value);
  if (!name) {
    nameInput.setCustomValidity('Enter a player name.');
    return nameInput.reportValidity();
  }
  const form = new FormData(setupForm);
  const settings = {
    players: Number(form.get('players')),
    difficulty: form.get('difficulty'),
    rounds: freePlay.checked ? null : Number(form.get('rounds')),
  };
  if (settings.rounds !== null && (!Number.isSafeInteger(settings.rounds) || settings.rounds < 1)) {
    roundsInput.setCustomValidity('Enter a positive whole number of rounds.');
    return roundsInput.reportValidity();
  }
  const profile = profiles.ensure(name);
  nameInput.value = profile.name;
  saveSetting('setup', settings);
  saveSetting('player-name', profile.name);
  unlockSounds();
  beginMatch({ ...settings, name: profile.name });
});

for (const button of [$('#help'), $('#lobby-rules')]) {
  button.addEventListener('click', () => showDialog($('#rules-dialog')));
}
for (const button of [$('#settings'), $('#lobby-settings')]) {
  button.addEventListener('click', () => {
    for (const [key, value] of Object.entries(variants)) variantsForm.elements[key].checked = value;
    variantsForm.elements.sound.checked = soundsOn;
    showDialog($('#settings-dialog'));
  });
}
$('#pause').addEventListener('click', () => showDialog($('#pause-dialog')));
$('#resume').addEventListener('click', () => $('#pause-dialog').close());
$('#restart').addEventListener('click', startRace);
$('#exit').addEventListener('click', showSetup);
$('#rematch').addEventListener('click', nextRound);
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
