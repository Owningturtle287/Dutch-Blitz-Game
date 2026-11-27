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
      id: `${player}-${suit}-${index + 1}`, suit, rank: index + 1, tool, owner: player,
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
  return !pile.closed && matchesTop(pile.cards.at(-1), card, rules);
}

export function matchesTop(top, card, rules = DEFAULT_RULES) {
  if (!top || !card) return false;
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
  const batch = player.wood.splice(0, DRAW_SIZE);
  if (batch.length < DRAW_SIZE && player.woodDiscard.length) {
    player.wood = shuffled(player.woodDiscard, state.random);
    player.woodDiscard = [];
    batch.push(...player.wood.splice(0, DRAW_SIZE - batch.length));
  }
  player.woodShown = batch;
  return batch;
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
