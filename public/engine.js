export const SUITS = ['spark', 'tide', 'ember', 'grove'];
export const RANKS = 10;
export const TOTAL = SUITS.length * RANKS;
export const RULES = ['rise', 'match', 'fall'];
export const NEW_PILE = -1;
export const OPEN_RANK = 1;
export const HAND_SIZE = 4;
export const RECYCLE_DELAY = 850;

const rankAfter = (rank, change) => (rank - 1 + change + RANKS) % RANKS + 1;
const rankStep = rule => rule === 'rise' ? 1 : -1;
const sample = (list, random) => list[Math.floor(random() * list.length)];

export function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function nextRank({ rule, top }) {
  return rankAfter(top.rank, rankStep(rule));
}

export function accepts(pile, card) {
  if (!card) return false;
  if (pile.rule === 'match') return card.suit === pile.top.suit;
  return card.rank === nextRank(pile);
}

export function destinations(card, piles) {
  if (!card) return [];
  const targets = piles.flatMap((pile, index) => accepts(pile, card) ? [index] : []);
  if (card.rank === OPEN_RANK) targets.push(NEW_PILE);
  return targets;
}

export function legalMoves(hand, piles) {
  return hand.flatMap((card, slot) => destinations(card, piles).map(pile => ({ slot, pile })));
}

function tunePiles(state, rules) {
  const anchor = sample(state.players.flatMap(player => player.hand.filter(Boolean)), state.random);
  const piles = rules.map(rule => ({ rule, top: {
    suit: sample(SUITS, state.random), rank: Math.floor(state.random() * RANKS) + 1,
  } }));
  const { rule, top } = sample(piles, state.random);
  if (rule === 'match') top.suit = anchor.suit;
  else top.rank = rankAfter(anchor.rank, -rankStep(rule));
  return piles;
}

function placeCard(piles, destination, card) {
  if (destination === NEW_PILE) {
    piles.push({ rule: RULES[piles.length % RULES.length], top: card });
  } else {
    piles[destination] = { rule: piles[destination].rule, top: card };
  }
}

export function newRace(count, random = Math.random) {
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new RangeError('Choose 2–4 racers');
  const players = Array.from({ length: count }, (_, player) => {
    const pack = SUITS.flatMap(suit => Array.from({ length: RANKS }, (_, index) => ({
      id: `${player}-${suit}-${index + 1}`, suit, rank: index + 1,
    })));
    const deck = shuffled(pack, random);
    return { hand: deck.splice(0, HAND_SIZE), deck, played: 0, recycleAt: 0 };
  });
  const state = { players, random, winner: null, turns: 0, retunes: 0 };
  state.piles = tunePiles(state, RULES);
  return state;
}

export function play(state, playerIndex, slot, destination, expectedCard) {
  if (state.winner !== null || !Number.isInteger(destination)) return null;
  const player = state.players[playerIndex];
  const card = player?.hand[slot];
  if (!card || card.id !== expectedCard) return null;
  const pile = state.piles[destination];
  const valid = destination === NEW_PILE ? card.rank === OPEN_RANK : pile && accepts(pile, card);
  if (!valid) return null;

  player.hand[slot] = player.deck.shift() ?? null;
  player.played++;
  placeCard(state.piles, destination, card);
  state.turns++;
  if (player.played === TOTAL) state.winner = playerIndex;
  return card;
}

export function recycle(state, playerIndex, slot, now) {
  const player = state.players[playerIndex];
  if (state.winner !== null || !player?.deck.length || !player.hand[slot] || now < player.recycleAt) return false;
  const previous = player.hand[slot];
  player.hand[slot] = player.deck.shift();
  player.deck.push(previous);
  player.recycleAt = now + RECYCLE_DELAY;
  return true;
}

export function retuneIfBlocked(state) {
  if (state.winner !== null || state.players.some(player => legalMoves(player.hand, state.piles).length)) return false;
  state.piles = tunePiles(state, state.piles.map(pile => pile.rule));
  state.retunes++;
  return true;
}

const PROFILES = [
  { reaction: 660, variation: 470, oversight: 0.10, hesitation: 0.11, bias: 1.15 },
  { reaction: 570, variation: 630, oversight: 0.15, hesitation: 0.07, bias: 0.90 },
  { reaction: 620, variation: 530, oversight: 0.08, hesitation: 0.16, bias: 1.05 },
];

const DIFFICULTIES = {
  relaxed: { pace: 1.68, error: 1.45 },
  quick: { pace: 1, error: 1 },
  expert: { pace: 0.65, error: 0.60 },
};

export function reactionTime(playerIndex, difficulty, rhythm, random = Math.random) {
  const profile = PROFILES[playerIndex - 1];
  const settings = DIFFICULTIES[difficulty];
  const jitter = (random() - 0.5) * profile.variation;
  const hesitation = random() < profile.hesitation * settings.error ? 300 + random() * 600 : 0;
  return Math.max(170, (profile.reaction + jitter + hesitation) * settings.pace * rhythm);
}

function project(hand, piles, move) {
  const nextHand = [...hand];
  const nextPiles = [...piles];
  placeCard(nextPiles, move.pile, nextHand[move.slot]);
  nextHand[move.slot] = null;
  return { hand: nextHand, piles: nextPiles };
}

function continuationScore(hand, piles) {
  const chances = legalMoves(hand, piles);
  const options = new Set(chances.map(move => move.slot)).size;
  const chain = chances.some(move => {
    const next = project(hand, piles, move);
    return legalMoves(next.hand, next.piles).length > 0;
  });
  return options * 2 + Math.min(chances.length, 8) * 0.3 + (chain ? 1.6 : 0);
}

export function recycleSlot(hand, piles) {
  const blocked = hand.findIndex(card => card && !destinations(card, piles).length);
  return blocked >= 0 ? blocked : hand.findIndex(Boolean);
}

export function chooseMove(state, playerIndex, difficulty, random = state.random) {
  const { hand, deck } = state.players[playerIndex];
  const { piles } = state;
  const moves = legalMoves(hand, piles);
  if (!moves.length) return deck.length ? { recycle: recycleSlot(hand, piles) } : null;

  const profile = PROFILES[playerIndex - 1];
  if (random() < profile.oversight * DIFFICULTIES[difficulty].error) {
    return random() < 0.22 && deck.length ? { recycle: recycleSlot(hand, piles) } : sample(moves, random);
  }

  const ranked = moves.map(move => {
    const next = project(hand, piles, move);
    const scarcity = 1 / destinations(hand[move.slot], piles).length;
    const openCost = move.pile === NEW_PILE ? 0.6 : 0;
    const score = continuationScore(next.hand, next.piles) * profile.bias + scarcity - openCost + random() * 0.65;
    return { move, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0].move;
}
