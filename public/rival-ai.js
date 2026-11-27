import { NEW_PILE, OPEN_RANK, POST_SIZE, WOOD_CARD, matchesTop, shuffled, visibleCard, woodCount } from './engine.js';

const PACE = {
  relaxed: { look: 555, reach: 245, scanLimit: 5, slip: 1.23 },
  quick: { look: 500, reach: 195, scanLimit: 6, slip: 1 },
  expert: { look: 445, reach: 155, scanLimit: 7, slip: .72 },
};
const REACTIONS = [
  ['Come on!', 'Oh, man!', 'So close!'],
  ['Damn it!', 'Give me a break!', 'Not again!'],
  ['Shit!', 'Goddammit!', 'I had that!'],
];

const sample = (items, random) => items[Math.floor(random() * items.length)];

export function newRival(player, difficulty, start, random = Math.random) {
  return {
    player, pace: PACE[difficulty], random, next: start + 100 + random() * 260, focus: null,
    cards: new Map(), piles: new Map(), unread: new Set(), pileCount: 0,
    posts: shuffled(Array.from({ length: POST_SIZE }, (_, index) => index), random),
    inspectWood: false, hasPacket: false, usedPacket: false, dryFlips: 0, watchedSinceFlip: 0,
    stress: 0, lastBlitz: start, stressAt: start, spokeAt: -Infinity, speech: null,
  };
}

function addStress(rival, delta, now) {
  const before = rival.stress;
  rival.stress = Math.min(100, Math.max(0, before + delta));
  const level = rival.stress;
  const crossed = [29, 54, 79].some(mark => before < mark && level >= mark);
  if (delta <= 0 || level < 29 || now - rival.spokeAt < 6500 || (!crossed && delta < 2.2)) return;
  const tier = level >= 79 ? 2 : level >= 54 ? 1 : 0;
  rival.speech = { text: sample(REACTIONS[tier], rival.random), until: now + 1900 };
  rival.spokeAt = now;
}

function updateStress(rival, now) {
  if (now <= rival.stressAt) return;
  const idle = now - rival.lastBlitz;
  const delta = (now - Math.max(rival.stressAt, rival.lastBlitz + 13000)) / 1000;
  if (delta > 0) addStress(rival, delta * (idle >= 38000 ? .56 : .28), now);
  rival.stressAt = now;
  if (rival.speech && rival.speech.until <= now) rival.speech = null;
}

export function noticePileChange(rival, pile, actor, now) {
  rival.unread.add(pile);
  const focus = rival.focus;
  if (actor === rival.player || focus?.pile !== pile || focus.contested) return;
  if (focus.kind === 'play' || (focus.kind === 'pile' && focus.favored)) {
    focus.contested = true;
    addStress(rival, focus.kind === 'play' ? 4.1 : 1.7, now);
  }
}

export function settleRivalPlay(rival, move, played, moreWood, now) {
  if (!played) {
    if (move.pile !== NEW_PILE) rival.unread.add(move.pile);
    if (!move.contested) addStress(rival, 1.7, now);
    rival.next = now + 485;
    return;
  }

  rival.cards.delete(move.source);
  if (move.source === WOOD_CARD) {
    rival.inspectWood = moreWood;
    rival.usedPacket = true;
    rival.dryFlips = 0;
    addStress(rival, -2, now);
  } else {
    const position = Math.floor(rival.random() * (rival.posts.length + 1));
    rival.posts.splice(position, 0, move.source);
    rival.lastBlitz = now;
    addStress(rival, -7, now);
  }
}

function pileWeight(rival, index, rules) {
  const previous = rival.piles.get(index);
  if (!previous) return 1;
  for (const card of rival.cards.values()) {
    if (!rules.anyColor && card.suit !== previous.suit) continue;
    const gap = card.rank - previous.rank;
    if (gap >= 0 && gap <= 2) return 3.2;
    if (rules.descending && gap === -1) return 3.2;
  }
  return 1;
}

function choosePile(rival, rules) {
  const choices = [...rival.unread].map(index => ({ index, weight: pileWeight(rival, index, rules) }));
  let threshold = rival.random() * choices.reduce((sum, item) => sum + item.weight, 0);
  for (const choice of choices) {
    threshold -= choice.weight;
    if (threshold < 0) return choice;
  }
  return choices.at(-1);
}

function planMove(rival, rules) {
  const moves = [];
  const seenPiles = [...rival.piles].filter(([index, top]) => top && !rival.unread.has(index));
  for (const [source, card] of rival.cards) {
    if (card.rank === OPEN_RANK) moves.push({ source, card, pile: NEW_PILE });
    for (const [index, top] of seenPiles) {
      if (matchesTop(top, card, rules)) moves.push({ source, card, pile: index });
    }
  }
  if (!moves.length) return null;

  const blitzMoves = moves.filter(move => move.source !== WOOD_CARD);
  const choice = sample(blitzMoves.length ? blitzMoves : moves, rival.random);
  const stress = rival.stress / 100;
  const roll = rival.random();
  const colorSlip = (.0008 + .004 * stress ** 3.4) * rival.pace.slip;
  const rankSlip = (.003 + .075 * stress ** 2.8) * rival.pace.slip;
  if (roll >= colorSlip + rankSlip) return choice;

  const wrongPiles = seenPiles.filter(([, top]) => {
    if (matchesTop(top, choice.card, rules)) return false;
    const gap = choice.card.rank - top.rank;
    if (roll < colorSlip) {
      return top.suit !== choice.card.suit && (gap === 1 || (rules.descending && gap === -1));
    }
    return top.suit === choice.card.suit && Math.abs(gap - 1) <= 1;
  });
  if (wrongPiles.length) return { ...choice, pile: sample(wrongPiles, rival.random)[0], mistake: true };
  return choice;
}

function inspect(rival, focus, now) {
  rival.focus = focus;
  const jitter = rival.random() * 96 - 48;
  rival.next = now + rival.pace.look + jitter + rival.stress * 1.35;
}

export function stepRival(rival, state, now) {
  if (state.finisher !== null) return null;
  updateStress(rival, now);
  if (rival.next > now) return null;
  const player = state.players[rival.player];

  while (rival.pileCount < state.piles.length) rival.unread.add(rival.pileCount++);
  const focus = rival.focus;
  rival.focus = null;
  if (focus?.kind === 'play') {
    rival.next = now + 150 + rival.stress;
    return focus;
  }
  if (focus?.kind === 'card') {
    const card = visibleCard(player, focus.source);
    if (card) rival.cards.set(focus.source, card);
    else rival.cards.delete(focus.source);
  }
  if (focus?.kind === 'pile') {
    const pile = state.piles[focus.pile];
    rival.piles.set(focus.pile, pile.closed ? null : pile.cards.at(-1));
    rival.unread.delete(focus.pile);
    rival.watchedSinceFlip++;
  }

  if (rival.inspectWood) {
    rival.inspectWood = false;
    inspect(rival, { kind: 'card', source: WOOD_CARD }, now);
    return null;
  }
  const move = planMove(rival, state.rules);
  if (move) {
    rival.focus = { kind: 'play', source: move.source, pile: move.pile, cardId: move.card.id, mistake: move.mistake };
    rival.next = now + rival.pace.reach + rival.random() * 80 + rival.stress * 1.55;
    return null;
  }
  if (rival.posts.length) {
    inspect(rival, { kind: 'card', source: rival.posts.pop() }, now);
    return null;
  }

  const wood = woodCount(player);
  if (rival.unread.size && rival.cards.size && (!wood || rival.watchedSinceFlip < rival.pace.scanLimit)) {
    const { index, weight } = choosePile(rival, state.rules);
    inspect(rival, { kind: 'pile', pile: index, favored: weight > 1 }, now);
    return null;
  }
  if (wood) {
    if (rival.hasPacket && !rival.usedPacket) {
      rival.dryFlips++;
      addStress(rival, 1 + Math.min(rival.dryFlips, 4) * .12, now);
    }
    rival.hasPacket = true;
    rival.usedPacket = false;
    rival.watchedSinceFlip = 0;
    rival.cards.delete(WOOD_CARD);
    rival.inspectWood = true;
    rival.next = now + 340 + rival.stress * .9;
    return { kind: 'flip' };
  }
  rival.next = now + 180;
  return null;
}
