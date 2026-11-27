export const SUITS = ['spark', 'tide', 'ember', 'grove'];
export const DECK_TOOLS = ['wagon', 'pump', 'barrel', 'plow'];
export const RANKS = 10;
export const TOTAL = SUITS.length * RANKS;
export const BLITZ_SIZE = 10;
export const POST_SIZE = 3;
export const DRAW_SIZE = 3;
export const NEW_PILE = -1;
export const WOOD_CARD = 'wood';
export const OPEN_RANK = 1;
export const DEFAULT_RULES = Object.freeze({ anyColor: false, sameColor: false, descending: false });

const sample = (list, random) => list[Math.floor(random() * list.length)];

export function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function newRace(count, random = Math.random, rules = DEFAULT_RULES) {
  if (!Number.isInteger(count) || count < 2 || count > DECK_TOOLS.length) throw new RangeError('Choose 2–4 racers');
  const tools = shuffled(DECK_TOOLS, random).slice(0, count);
  const players = tools.map((tool, player) => {
    const pack = SUITS.flatMap(suit => Array.from({ length: RANKS }, (_, index) => ({
      id: `${player}-${suit}-${index + 1}`, suit, rank: index + 1, tool,
    })));
    const wood = shuffled(pack, random);
    const blitz = wood.splice(0, BLITZ_SIZE);
    const posts = wood.splice(0, POST_SIZE);
    return { tool, blitz, posts, wood, woodShown: [], woodDiscard: [], played: 0 };
  });
  return { players, random, rules: { ...DEFAULT_RULES, ...rules }, piles: [], finisher: null };
}

export function visibleCard(player, source) {
  return source === WOOD_CARD ? player.woodShown.at(-1) : player.posts[source];
}

export function accepts(pile, card, rules = DEFAULT_RULES) {
  if (!card || pile.closed) return false;
  const top = pile.cards.at(-1);
  const colorMatches = card.suit === top.suit;
  const difference = card.rank - top.rank;
  return (rules.sameColor && colorMatches) ||
    ((colorMatches || rules.anyColor) && (difference === 1 || (rules.descending && difference === -1)));
}

export function destinations(card, piles, rules = DEFAULT_RULES) {
  if (!card) return [];
  const targets = piles.flatMap((pile, index) => accepts(pile, card, rules) ? [index] : []);
  if (card.rank === OPEN_RANK) targets.push(NEW_PILE);
  return targets;
}

export function legalMoves(player, piles, rules = DEFAULT_RULES) {
  const sources = [...player.posts.keys(), WOOD_CARD];
  return sources.flatMap(source => destinations(visibleCard(player, source), piles, rules).map(pile => ({ source, pile })));
}

export function woodCount(player) {
  return player.wood.length + player.woodShown.length + player.woodDiscard.length;
}

export function isBlocked(state) {
  return state.players.every(({ posts, wood, woodShown, woodDiscard }) =>
    ![...posts, ...wood, ...woodShown, ...woodDiscard].some(card =>
      card && (card.rank === OPEN_RANK || state.piles.some(pile => accepts(pile, card, state.rules)))));
}

export function flipWood(state, playerIndex) {
  const player = state.players[playerIndex];
  if (state.finisher !== null || !player || !woodCount(player)) return null;

  player.woodDiscard.push(...player.woodShown);
  if (!player.wood.length) {
    player.wood = shuffled(player.woodDiscard, state.random);
    player.woodDiscard = [];
  }
  player.woodShown = player.wood.splice(0, DRAW_SIZE);
  return player.woodShown;
}

export function play(state, playerIndex, source, destination, expectedCard) {
  if (state.finisher !== null || !Number.isInteger(destination)) return null;
  const player = state.players[playerIndex];
  if (!player || (source !== WOOD_CARD && (!Number.isInteger(source) || source < 0 || source >= POST_SIZE))) return null;
  const card = visibleCard(player, source);
  if (!card || card.id !== expectedCard) return null;

  const pile = state.piles[destination];
  if (destination === NEW_PILE) {
    if (card.rank !== OPEN_RANK) return null;
    state.piles.push({ cards: [card], closed: false });
  } else {
    if (!pile || !accepts(pile, card, state.rules)) return null;
    pile.closed = pile.cards.at(-1).rank === RANKS - 1 && card.rank === RANKS;
    pile.cards.push(card);
  }

  player.played++;
  if (source === WOOD_CARD) {
    player.woodShown.pop();
  } else {
    player.posts[source] = player.blitz.pop() ?? null;
    if (!player.blitz.length) state.finisher = playerIndex;
  }
  return card;
}

export function score(player) {
  return player.played - 2 * player.blitz.length;
}

const PROFILES = [
  { reaction: 680, variation: 460, oversight: .10, hesitation: .11 },
  { reaction: 610, variation: 580, oversight: .15, hesitation: .07 },
  { reaction: 650, variation: 500, oversight: .08, hesitation: .16 },
];

const DIFFICULTIES = {
  relaxed: { pace: 1.68, error: 1.45 },
  quick: { pace: 1, error: 1 },
  expert: { pace: .65, error: .60 },
};

export function reactionTime(playerIndex, difficulty, rhythm, random = Math.random) {
  const profile = PROFILES[playerIndex - 1];
  const settings = DIFFICULTIES[difficulty];
  const jitter = (random() - .5) * profile.variation;
  const hesitation = random() < profile.hesitation * settings.error ? 300 + random() * 600 : 0;
  return Math.max(170, (profile.reaction + jitter + hesitation) * settings.pace * rhythm);
}

export function chooseMove(state, playerIndex, difficulty, random = state.random) {
  if (state.finisher !== null) return null;
  const player = state.players[playerIndex];
  const moves = legalMoves(player, state.piles, state.rules);
  if (!moves.length) return woodCount(player) ? { flip: true } : null;
  if (random() < PROFILES[playerIndex - 1].oversight * DIFFICULTIES[difficulty].error) return sample(moves, random);

  const posts = moves.filter(move => move.source !== WOOD_CARD);
  return sample(posts.length ? posts : moves, random);
}
