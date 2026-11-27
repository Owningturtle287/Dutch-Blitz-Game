const signed = value => value > 0 ? `+${value}` : String(value).replace('-', '−');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function moveCard(dialog, card, from, target, tone, signal) {
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width || signal.aborted) return Promise.resolve();
  const flight = document.createElement('span');
  flight.className = 'tally-flight';
  flight.setAttribute('aria-hidden', 'true');
  Object.assign(flight.style, {
    left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
  });
  flight.append(card);
  dialog.append(flight);
  const x = to.left + to.width / 2 - from.left - from.width / 2;
  const y = to.top + to.height / 2 - from.top - from.height / 2;
  const midpoint = tone === 'penalty' ? [x * .38, y * .34 - 10, -20] : [x * .11, y * .66 + 10, 12];
  const animation = flight.animate([
    { transform: 'rotate(-8deg)', opacity: 1 },
    { transform: `translate(${midpoint[0]}px, ${midpoint[1]}px) rotate(${midpoint[2]}deg)`, offset: .5 },
    { transform: `translate(${x}px, ${y}px) rotate(7deg) scale(.66)`, opacity: 0 },
  ], { duration: tone === 'penalty' ? 245 : 280, easing: 'cubic-bezier(.35,.2,.37,1)' });
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
    if (!remaining) stock.classList.add('empty');
    const playerName = element.querySelector('.score-name');
    playerName.textContent = name;
    return {
      element, stock, playerName, remaining, played, tool,
      breakdown: element.querySelector('.score-breakdown'),
      round: element.querySelector('.score-round'),
      total: element.querySelector('.score-total'),
      countedBlitz: 0, countedPlayed: 0,
    };
  });

  function update(row) {
    const points = row.countedPlayed - 2 * row.countedBlitz;
    row.round.textContent = signed(points);
    row.round.dataset.tone = points < 0 ? 'loss' : points > 0 ? 'gain' : '';
    row.breakdown.textContent = `${row.countedBlitz} Blitz · ${row.countedPlayed} played`;
  }

  function settle() {
    if (signal.aborted) return;
    const moveFocus = document.activeElement === skip;
    controller.abort();
    skip.hidden = true;
    packet.replaceChildren();
    board.dataset.phase = 'done';
    phase.textContent = result.final ? 'Final standings' : result.freePlay ? 'Round standings' : 'Running standings';
    detail.textContent = result.freePlay ? 'Free Play · round score' : 'Round score and game total';
    for (const { index, total, place } of result.ranked) {
      const row = rows[index];
      row.countedBlitz = row.remaining;
      row.countedPlayed = row.played;
      update(row);
      row.playerName.textContent = `${place}. ${racers[index].name}`;
      row.element.dataset.place = place;
      row.stock.classList.add('empty');
      row.total.textContent = signed(total);
      list.append(row.element);
    }
    actions.hidden = false;
    onSettled();
    if (moveFocus) dialog.querySelector('#rematch').focus();
  }

  async function countCards() {
    await wait(200);
    if (signal.aborted) return;
    const penalties = [];
    const mostBlitz = Math.max(...rows.map(row => row.remaining));
    for (let count = 0; count < mostBlitz && !signal.aborted; count++) {
      for (const row of rows) {
        if (count >= row.remaining) continue;
        const from = row.stock.getBoundingClientRect();
        row.stock.dataset.count = row.remaining - count - 1;
        row.stock.classList.toggle('empty', count + 1 === row.remaining);
        const flight = moveCard(dialog, back(row.tool), from, row.round, 'penalty', signal).then(() => {
          if (signal.aborted) return;
          row.countedBlitz++;
          update(row);
        });
        penalties.push(flight);
      }
      await wait(74);
    }
    await Promise.all(penalties);
    if (signal.aborted) return;

    board.dataset.phase = 'played';
    phase.textContent = 'Cards on the table';
    detail.textContent = '+1 for every card played';
    const credits = [];
    const spacing = Math.min(58, Math.max(18, 1750 / Math.max(1, cards.length)));
    for (const card of cards) {
      if (signal.aborted) return;
      const row = rows[card.owner];
      if (!row) continue;
      packet.replaceChildren(face(card));
      const from = packet.getBoundingClientRect();
      const flight = moveCard(dialog, face(card), from, row.round, 'credit', signal).then(() => {
        if (signal.aborted) return;
        row.countedPlayed++;
        update(row);
      });
      credits.push(flight);
      await wait(spacing);
    }
    await Promise.all(credits);
    settle();
  }

  list.replaceChildren(...rows.map(row => row.element));
  rows.forEach(row => {
    row.total.parentElement.hidden = result.freePlay;
    if (!result.freePlay) {
      const { total } = result.ranked.find(entry => entry.index === Number(row.element.dataset.seat));
      row.total.textContent = signed(total - row.played + 2 * row.remaining);
    }
    update(row);
  });
  board.classList.toggle('single-score', result.freePlay);
  board.dataset.phase = 'blitz';
  phase.textContent = 'Blitz penalties';
  detail.textContent = '−2 for each card left';
  packet.replaceChildren(back(racers[0].tool));
  skip.hidden = reducedMotion;
  actions.hidden = true;
  skip.onclick = settle;
  dialog.showModal();
  if (reducedMotion) settle();
  else countCards().catch(settle);
}
