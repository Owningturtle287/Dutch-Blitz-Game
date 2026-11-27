import { NEW_PILE, OPEN_RANK, POST_SIZE, RANKS, WOOD_CARD, matchesTop, shuffled, visibleCard, woodCount } from './engine.js';
import { DIALOGUE } from './dialogue.js';

const PACE = {
  standard: { look: 555, reach: 250, flip: 380, memory: 6400, notice: .92, search: 4, tactics: .85, slip: 1.12 },
  quick: { look: 470, reach: 190, flip: 330, memory: 8100, notice: 1.12, search: 5, tactics: 1.22, slip: .92 },
  expert: { look: 375, reach: 150, flip: 305, memory: 9900, notice: 1.26, search: 6, tactics: 1.65, slip: .72 },
};
const REACTIONS = [
  ['comeOn', 'biscuit'],
  ['damn', 'biscuit', 'cursed'],
  ['shit', 'crap', 'damn', 'cursed'],
];

const sample = (items, random) => items[Math.floor(random() * items.length)];

export function newRival(player, difficulty, start, random = Math.random) {
  return {
    player, pace: PACE[difficulty] ?? PACE.standard, random, next: start + 100 + random() * 260, focus: null,
    cards: new Map(), piles: new Map(), unread: new Set(), pileCount: 0, glance: null,
    rhythm: .90 + .20 * random(), patience: .85 + .30 * random(), watchedSinceFlip: 0,
    posts: shuffled(Array.from({ length: POST_SIZE }, (_, index) => index), random),
    inspectWood: false, hasPacket: false, usedPacket: false, dryFlips: 0,
    stress: 0, lastBlitz: start, stressAt: start, spokeAt: -Infinity, speech: null, lastLine: null,
  };
}

function addStress(rival, delta, now, contested = false) {
  const before = rival.stress;
  rival.stress = Math.min(100, Math.max(0, before + delta));
  const level = rival.stress;
  const crossed = [18, 39, 65].some(mark => before < mark && level >= mark);
  if (delta <= 0 || level < 18 || now - rival.spokeAt < 6700 || (!crossed && delta < 2.2)) return;
  const tier = level >= 65 ? 2 : level >= 39 ? 1 : 0;
  const options = contested ? [...REACTIONS[tier], 'first'] : REACTIONS[tier];
  const line = sample(options.filter(key => key !== rival.lastLine), rival.random);
  rival.lastLine = line;
  rival.speech = { line, text: DIALOGUE[line], until: now + 2350 };
  rival.spokeAt = now;
}

function updateStress(rival, now) {
  if (now <= rival.stressAt) return;
  const idle = now - rival.lastBlitz;
  const delta = (now - Math.max(rival.stressAt, rival.lastBlitz + 13000)) / 1000;
  if (delta > 0) {
    const fatigue = Math.max(0, 1 - rival.stress / 78);
    addStress(rival, delta * (idle >= 38000 ? .43 : .24) * fatigue, now);
  }
  rival.stressAt = now;
  if (rival.speech && rival.speech.until <= now) rival.speech = null;
}

export function noticePileChange(rival, pile, actor, now, distance = 1) {
  const focus = rival.focus;
  const direct = focus?.pile === pile;
  const attention = focus?.kind === 'card' || rival.inspectWood ? .08 : .16 + .46 * (1 - distance);
  if (actor !== rival.player && !direct && rival.random() >= attention * rival.pace.notice) return;
  rival.unread.add(pile);
  if (actor === rival.player || !direct || focus.contested) return;
  if (focus.kind === 'play' || (focus.kind === 'pile' && focus.favored)) {
    focus.contested = true;
    addStress(rival, focus.kind === 'play' ? 4.1 : 1.7, now, true);
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

function pileWeight(rival, index, rules, now) {
  const observation = rival.piles.get(index);
  if (!observation?.top || now - observation.at > rival.pace.memory * 1.5) return 1;
  for (const card of rival.cards.values()) {
    const { top } = observation;
    if (!rules.anyColor && card.suit !== top.suit) continue;
    const gap = card.rank - top.rank;
    if (matchesTop(top, card, rules) || gap === 2) return 1 + 2.7 * rival.pace.tactics;
  }
  return 1;
}

function choosePile(rival, rules, now) {
  const choices = [...rival.unread].map(index => ({
    index, weight: pileWeight(rival, index, rules, now), recentlySeen: rival.piles.get(index)?.at,
  }));
  for (const choice of choices) {
    if (choice.index === rival.glance) choice.weight *= .55;
    if (choice.recentlySeen === undefined) choice.weight *= 1.45;
    else if (now - choice.recentlySeen < 900) choice.weight *= .65;
  }
  let threshold = rival.random() * choices.reduce((sum, choice) => sum + choice.weight, 0);
  for (const choice of choices) {
    threshold -= choice.weight;
    if (threshold < 0) return choice;
  }
  return choices.at(-1);
}

function planMove(rival, rules, now) {
  const moves = [];
  const seenPiles = [...rival.piles].filter(([index, observation]) =>
    observation.top && !rival.unread.has(index) && now - observation.at <= rival.pace.memory);
  for (const [source, card] of rival.cards) {
    if (card.rank === OPEN_RANK) moves.push({ source, card, pile: NEW_PILE });
    for (const [index, observation] of seenPiles) {
      if (matchesTop(observation.top, card, rules)) moves.push({ source, card, pile: index, seenAt: observation.at });
    }
  }
  if (!moves.length) return null;

  // Favor unloading Blitz, then favor plays that lead to a second known card.
  const ranked = moves.map(move => {
    const follows = [...rival.cards].some(([source, card]) => source !== move.source &&
      source !== WOOD_CARD && move.card.rank < RANKS && matchesTop(move.card, card, rules));
    return { move, value: (move.source === WOOD_CARD ? 0 : 3) +
      (follows ? 2.5 * rival.pace.tactics : 0) + (move.pile === NEW_PILE ? .55 : 0) + rival.random() * 1.3 };
  });
  const choice = ranked.reduce((best, entry) => entry.value > best.value ? entry : best).move;
  const stress = rival.stress / 100;
  if (choice.seenAt !== undefined && now - choice.seenAt > rival.pace.memory * (.48 + stress * .18)) {
    return { recheck: choice.pile };
  }
  const roll = rival.random();
  const colorSlip = (.0005 + .003 * stress ** 3.4) * rival.pace.slip;
  const rankSlip = (.002 + .051 * stress ** 2.8) * rival.pace.slip;
  if (roll >= colorSlip + rankSlip) return choice;

  const wrongPiles = seenPiles.filter(([, { top }]) => {
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
  const jitter = (rival.random() - .5) * 180;
  const shift = focus.kind === 'pile' && rival.glance !== focus.pile ? 35 : 0;
  rival.next = now + rival.pace.look * rival.rhythm + jitter + shift + rival.stress * 1.2;
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
    if (focus.contested && now - rival.next < 60 && rival.random() < .45) {
      inspect(rival, { kind: 'pile', pile: focus.pile, favored: true }, now);
      return null;
    }
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
    rival.piles.set(focus.pile, { top: pile.closed ? null : pile.cards.at(-1), at: now });
    rival.unread.delete(focus.pile);
    rival.glance = focus.pile;
    rival.watchedSinceFlip++;
  }

  if (rival.inspectWood) {
    rival.inspectWood = false;
    inspect(rival, { kind: 'card', source: WOOD_CARD }, now);
    return null;
  }
  const move = planMove(rival, state.rules, now);
  if (move) {
    if (move.recheck !== undefined) {
      inspect(rival, { kind: 'pile', pile: move.recheck, favored: true }, now);
      return null;
    }
    rival.focus = { kind: 'play', source: move.source, pile: move.pile, cardId: move.card.id, mistake: move.mistake };
    rival.next = now + rival.pace.reach * rival.rhythm + rival.random() * 115 + rival.stress * 1.55;
    return null;
  }
  if (rival.posts.length) {
    inspect(rival, { kind: 'card', source: rival.posts.pop() }, now);
    return null;
  }

  const wood = woodCount(player);
  for (const [index, observation] of rival.piles) {
    const revisit = pileWeight(rival, index, state.rules, now) > 1 ? 1 : 1.5;
    if (observation.top && now - observation.at > rival.pace.memory * revisit) rival.unread.add(index);
  }
  if (rival.unread.size && rival.cards.size) {
    const { index, weight } = choosePile(rival, state.rules, now);
    const budget = rival.pace.search * rival.patience + (weight > 1.5 ? 1.5 : 0);
    const flipChance = Math.min(.97, Math.max(.03, .28 + (rival.watchedSinceFlip - budget) * .19));
    if (!wood || rival.random() >= flipChance) {
      inspect(rival, { kind: 'pile', pile: index, favored: weight > 1.5 }, now);
      return null;
    }
  }
  if (wood) {
    if (rival.hasPacket && !rival.usedPacket) {
      rival.dryFlips++;
      addStress(rival, (1 + Math.min(rival.dryFlips, 4) * .12) * Math.max(.16, 1 - rival.stress / 88), now);
    }
    rival.hasPacket = true;
    rival.usedPacket = false;
    rival.watchedSinceFlip = 0;
    rival.cards.delete(WOOD_CARD);
    rival.inspectWood = true;
    rival.next = now + rival.pace.flip * rival.rhythm + (rival.random() - .5) * 72 + rival.stress * .9;
    return { kind: 'flip' };
  }
  rival.next = now + 180;
  return null;
}
