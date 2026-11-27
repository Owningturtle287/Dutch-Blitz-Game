import { playSound } from './sound.js';

const signed = value => value > 0 ? `+${value}` : String(value).replace('-', '−');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function moveCard(dialog, card, source, target, signal) {
  if (signal.aborted) return Promise.resolve();
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return Promise.resolve();

  const flight = document.createElement('span');
  flight.className = 'tally-flight';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, {
    left: `${Math.round(from.left)}px`, top: `${Math.round(from.top)}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  flight.append(card);
  dialog.append(flight);
  const x = Math.round(to.left - from.left + (to.width - from.width) / 2);
  const y = Math.round(to.top - from.top + (to.height - from.height) / 2);
  const bend = y < 0 ? -7 : 7;
  const animation = flight.animate([
    { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
    { transform: `translate3d(${x * .5 + bend}px, ${y * .5}px, 0) rotate(${bend}deg)`, offset: .5 },
    { transform: `translate3d(${x}px, ${y}px, 0) rotate(0deg)` },
  ], { duration: 340, easing: 'cubic-bezier(.43,.05,.28,1)', fill: 'forwards' });

  const cancel = () => animation.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  return animation.finished.catch(() => {}).finally(() => {
    signal.removeEventListener('abort', cancel);
    flight.remove();
  });
}

export function showTally(dialog, { result, racers, cards, face, back, reducedMotion, onSettled }) {
  const board = dialog.querySelector('.score-board');
  const list = dialog.querySelector('#standings');
  const phase = dialog.querySelector('#tally-phase');
  const detail = dialog.querySelector('#tally-detail');
  const packet = dialog.querySelector('#tally-packet');
  const progress = dialog.querySelector('#tally-progress');
  const skip = dialog.querySelector('#skip-tally');
  const actions = dialog.querySelector('#result-actions');
  const template = document.querySelector('#score-row-template').content.firstElementChild;
  const controller = new AbortController();
  const { signal } = controller;
  const rows = racers.map(({ name, remaining, played, tool }, index) => {
    const element = template.cloneNode(true);
    element.dataset.seat = index;
    const stock = element.querySelector('.tally-stock');
    stock.append(back(tool));
    stock.dataset.count = remaining;
    stock.classList.toggle('empty', !remaining);
    const playerName = element.querySelector('.score-name');
    playerName.textContent = name;
    return {
      element, stock, playerName, remaining, played, tool,
      breakdown: element.querySelector('.score-breakdown'),
      round: element.querySelector('.score-round'),
      total: element.querySelector('.score-total'),
      delta: element.querySelector('.score-delta'),
      countedBlitz: 0, countedPlayed: 0, pulse: null,
    };
  });

  function update(row) {
    const points = row.countedPlayed - 2 * row.countedBlitz;
    row.round.textContent = signed(points);
    row.round.dataset.tone = points < 0 ? 'loss' : points > 0 ? 'gain' : '';
    row.breakdown.textContent = `${row.countedBlitz} Blitz · ${row.countedPlayed} played`;
  }

  function showDelta(row, amount) {
    playSound(amount > 0 ? 'place' : 'flip', { level: amount > 0 ? .17 : .13 });
    update(row);
    row.pulse?.cancel();
    row.delta.textContent = signed(amount);
    row.delta.dataset.tone = amount > 0 ? 'gain' : 'loss';
    row.pulse = row.delta.animate([
      { opacity: 1, transform: 'translateY(2px)' },
      { opacity: 1, transform: 'translateY(-1px)', offset: .68 },
      { opacity: 0, transform: 'translateY(-5px)' },
    ], { duration: 330, easing: 'ease-out' });
  }

  function settle() {
    if (signal.aborted) return;
    const moveFocus = document.activeElement === skip;
    controller.abort();
    skip.hidden = true;
    progress.hidden = true;
    packet.replaceChildren();
    board.dataset.phase = 'done';
    phase.textContent = result.final ? 'Final standings' : result.freePlay ? 'Round standings' : 'Running standings';
    detail.textContent = result.freePlay ? 'Free Play · round score' : 'Round score and game total';
    for (const { index, total, place } of result.ranked) {
      const row = rows[index];
      row.countedBlitz = row.remaining;
      row.countedPlayed = row.played;
      row.pulse?.cancel();
      update(row);
      row.playerName.textContent = `${place}. ${racers[index].name}`;
      row.element.dataset.place = place;
      row.total.textContent = signed(total);
      list.append(row.element);
    }
    actions.hidden = false;
    onSettled();
    if (moveFocus) dialog.querySelector('#rematch').focus();
  }

  const totalBlitz = rows.reduce((sum, row) => sum + row.remaining, 0);
  function showProgress(count, total) {
    progress.textContent = `${count} of ${total} cards`;
  }

  async function countPenalties() {
    let counted = 0;
    const flights = [];
    const mostBlitz = Math.max(...rows.map(row => row.remaining));
    for (let count = 0; count < mostBlitz && !signal.aborted; count++) {
      for (const row of rows) {
        if (count >= row.remaining) continue;
        row.stock.dataset.count = row.remaining - count - 1;
        row.stock.classList.toggle('empty', count + 1 === row.remaining);
        flights.push(moveCard(dialog, back(row.tool), row.stock, packet, signal).then(() => {
          if (signal.aborted) return;
          row.countedBlitz++;
          packet.replaceChildren(back(row.tool));
          showDelta(row, -2);
          showProgress(++counted, totalBlitz);
        }));
        await wait(83);
        if (signal.aborted) return;
      }
    }
    await Promise.all(flights);
  }

  async function countPlayedCards() {
    board.dataset.phase = 'played';
    phase.textContent = 'Cards on the table';
    detail.textContent = '+1 for every card played';
    showProgress(0, cards.length);
    let counted = 0;
    const flights = [];
    const spacing = Math.min(138, Math.max(74, 4100 / Math.max(1, cards.length)));
    for (const [index, card] of cards.entries()) {
      if (signal.aborted) return;
      const row = rows[card.owner];
      if (!row) continue;
      const next = cards[index + 1];
      const flight = moveCard(dialog, face(card), packet, row.stock, signal);
      packet.replaceChildren(...(next ? [face(next)] : []));
      flights.push(flight.then(() => {
        if (signal.aborted) return;
        row.stock.replaceChildren(face(card));
        delete row.stock.dataset.count;
        row.stock.classList.remove('empty');
        row.countedPlayed++;
        showDelta(row, 1);
        showProgress(++counted, cards.length);
      }));
      await wait(spacing);
    }
    await Promise.all(flights);
  }

  async function countCards() {
    await wait(200);
    if (signal.aborted) return;
    await countPenalties();
    await wait(240);
    if (signal.aborted) return;
    await countPlayedCards();
    await wait(300);
    settle();
  }

  list.replaceChildren(...rows.map(row => row.element));
  rows.forEach((row, index) => {
    row.total.parentElement.hidden = result.freePlay;
    if (!result.freePlay) {
      const { total } = result.ranked.find(entry => entry.index === index);
      row.total.textContent = signed(total - row.played + 2 * row.remaining);
    }
    update(row);
  });
  board.classList.toggle('single-score', result.freePlay);
  board.dataset.phase = 'blitz';
  phase.textContent = 'Blitz penalties';
  detail.textContent = '−2 for each card left';
  packet.replaceChildren(back(racers[0].tool));
  showProgress(0, totalBlitz);
  progress.hidden = reducedMotion;
  skip.hidden = reducedMotion;
  actions.hidden = true;
  skip.onclick = settle;
  dialog.showModal();
  if (reducedMotion) settle();
  else countCards().catch(settle);
}
