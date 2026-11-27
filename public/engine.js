export const SUITS = ['spark', 'tide', 'ember', 'grove'];
export const RANKS = 6;
export const TOTAL = SUITS.length * RANKS;
export const LANES = ['rise', 'match', 'fall'];
export const HAND_SIZE = 4;
export const RECYCLE_DELAY = 850;

const rankAfter = (rank, change) => (rank - 1 + change + RANKS) % RANKS + 1;
const sample = (list, random) => list[Math.floor(random() * list.length)];

export function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function accepts(lane, top, card) {
  if (!card) return false;
  if (lane === 1) return card.suit === top.suit;
  return card.rank === rankAfter(top.rank, lane === 0 ? 1 : -1);
}

export function destinations(card, lanes) {
  return LANES.flatMap((_, lane) => accepts(lane, lanes[lane], card) ? [lane] : []);
}

export function legalMoves(hand, lanes) {
  return hand.flatMap((card, slot) => destinations(card, lanes).map(lane => ({ slot, lane })));
}

function tuneLanes(state) {
  const suit = () => sample(SUITS, state.random);
  const rank = () => Math.floor(state.random() * RANKS) + 1;
  const visible = state.players.flatMap(player => player.hand.filter(Boolean));
  const anchor = sample(visible, state.random);
  const lanes = Array.from({ length: LANES.length }, () => ({ suit: suit(), rank: rank() }));
  const lane = Math.floor(state.random() * LANES.length);
  if (lane === 1) lanes[lane].suit = anchor.suit;
  else lanes[lane].rank = rankAfter(anchor.rank, lane === 0 ? -1 : 1);
  return lanes;
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
  state.lanes = tuneLanes(state);
  return state;
}

export function play(state, playerIndex, slot, lane, expectedCard) {
  if (state.winner !== null || !Number.isInteger(lane) || !state.lanes[lane]) return null;
  const player = state.players[playerIndex];
  const card = player?.hand[slot];
  if (!card || card.id !== expectedCard || !accepts(lane, state.lanes[lane], card)) return null;

  player.hand[slot] = player.deck.shift() ?? null;
  player.played++;
  state.lanes[lane] = card;
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
  if (state.winner !== null || state.players.some(player => legalMoves(player.hand, state.lanes).length)) return false;
  state.lanes = tuneLanes(state);
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

function project(hand, lanes, move) {
  const nextHand = [...hand];
  const nextLanes = [...lanes];
  nextLanes[move.lane] = nextHand[move.slot];
  nextHand[move.slot] = null;
  return { hand: nextHand, lanes: nextLanes };
}

function continuationScore(hand, lanes) {
  const chances = legalMoves(hand, lanes);
  const options = new Set(chances.map(move => move.slot)).size;
  const chain = chances.some(move => {
    const next = project(hand, lanes, move);
    return legalMoves(next.hand, next.lanes).length > 0;
  });
  return options * 2 + chances.length * 0.3 + (chain ? 1.6 : 0);
}

export function recycleSlot(hand, lanes) {
  const blocked = hand.findIndex(card => card && !destinations(card, lanes).length);
  return blocked >= 0 ? blocked : hand.findIndex(Boolean);
}

export function chooseMove(state, playerIndex, difficulty, random = state.random) {
  const { hand, deck } = state.players[playerIndex];
  const { lanes } = state;
  const moves = legalMoves(hand, lanes);
  if (!moves.length) return deck.length ? { recycle: recycleSlot(hand, lanes) } : null;

  const profile = PROFILES[playerIndex - 1];
  if (random() < profile.oversight * DIFFICULTIES[difficulty].error) {
    return random() < 0.22 && deck.length ? { recycle: recycleSlot(hand, lanes) } : sample(moves, random);
  }

  const ranked = moves.map(move => {
    const next = project(hand, lanes, move);
    const scarcity = 1 / destinations(hand[move.slot], lanes).length;
    const score = continuationScore(next.hand, next.lanes) * profile.bias + scarcity + random() * 0.65;
    return { move, score };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0].move;
}
