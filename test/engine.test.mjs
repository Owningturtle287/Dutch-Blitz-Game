import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, SUITS, DECK_TOOLS, TOTAL, NEW_PILE, RULES, RECYCLE_DELAY, accepts, destinations, legalMoves, newRace, play, recycle,
  retuneIfBlocked, chooseMove, reactionTime,
} from '../public/engine.js';

const card = (rank, suit = 'spark') => ({ id: `${rank}-${suit}`, rank, suit });
const pile = (rule, rank, suit) => ({ rule, top: card(rank, suit) });

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('rise and fall wrap around and match accepts any rank of the same suit', () => {
  assert.equal(accepts(pile('rise', 10), card(1, 'tide')), true);
  assert.equal(accepts(pile('rise', 6), card(7, 'tide')), true);
  assert.equal(accepts(pile('fall', 1), card(10, 'grove')), true);
  assert.equal(accepts(pile('match', 3), card(10)), true);
  assert.equal(accepts(pile('match', 3), card(10, 'tide')), false);
});

test('four racers get distinct tool decks with 40 cards per color and per tool across the set', () => {
  const state = newRace(4, randomFrom(18));
  assert.equal(RANKS, 10);
  assert.equal(SUITS.length, 4);
  assert.equal(TOTAL, 40);
  assert.deepEqual(DECK_TOOLS, ['wagon', 'pump', 'barrel', 'plow']);
  assert.deepEqual(new Set(state.players.map(player => player.tool)), new Set(DECK_TOOLS));
  const ranks = Array.from({ length: 10 }, (_, index) => index + 1);
  const allCards = state.players.flatMap(({ hand, deck }) => [...hand, ...deck]);
  assert.equal(allCards.length, 160);
  assert.equal(new Set(allCards.map(item => item.id)).size, 160);
  for (const suit of SUITS) assert.equal(allCards.filter(item => item.suit === suit).length, 40);
  for (const { tool, hand, deck } of state.players) {
    const cards = [...hand, ...deck];
    assert.equal(cards.length, 40);
    assert.ok(cards.every(item => item.tool === tool));
    for (const suit of SUITS) {
      assert.deepEqual(cards.filter(item => item.suit === suit).map(item => item.rank).sort((a, b) => a - b), ranks);
    }
  }
});

test('a concurrent play invalidates the old destination and stale card IDs cannot consume replacement cards', () => {
  const state = newRace(2, randomFrom(19));
  state.piles[0] = pile('rise', 3);
  state.players[0].hand[0] = card(4, 'tide');
  state.players[1].hand[0] = card(4, 'ember');
  assert.equal(play(state, 1, 0, 0, '4-ember').rank, 4);
  assert.equal(play(state, 0, 0, 0, '4-tide'), null);
  assert.equal(play(state, 1, 0, 0, '4-ember'), null);
  assert.equal(state.players[0].played, 0);
  assert.equal(state.players[1].played, 1);
});

test('all racers can repeatedly add piles and only a 1 can start one', () => {
  const state = newRace(4, randomFrom(119));
  for (const player of state.players) {
    const cards = [...player.hand, ...player.deck];
    player.hand = cards.filter(item => item.rank === 1);
    player.deck = cards.filter(item => item.rank !== 1);
  }

  for (let slot = 0; slot < 4; slot++) {
    for (let player = 0; player < state.players.length; player++) {
      const openingCard = state.players[player].hand[slot];
      assert.ok(destinations(openingCard, state.piles).includes(NEW_PILE));
      assert.equal(play(state, player, slot, NEW_PILE, openingCard.id), openingCard);
      const index = state.piles.length - 1;
      assert.deepEqual(state.piles[index], { rule: RULES[index % RULES.length], top: openingCard });
      const replacement = state.players[player].hand[slot];
      assert.equal(play(state, player, slot, NEW_PILE, replacement.id), null);
    }
  }
  assert.equal(state.piles.length, 19);
  assert.equal(state.turns, 16);
});

test('swapping preserves the deck and respects the cooldown', () => {
  const state = newRace(2, randomFrom(20));
  const { hand, deck } = state.players[0];
  const replaced = hand[1];
  const replacement = deck[0];
  assert.equal(recycle(state, 0, 1, 0), true);
  assert.equal(hand[1], replacement);
  assert.equal(deck.at(-1), replaced);
  assert.equal(recycle(state, 0, 2, RECYCLE_DELAY - 1), false);
  assert.equal(recycle(state, 0, 2, RECYCLE_DELAY), true);
  assert.equal(new Set([...hand, ...deck].map(item => item.id)).size, TOTAL);
});

test('blocked tables retune and open a valid move while preserving their pile count and rules', () => {
  const state = newRace(2, randomFrom(21));
  const rules = [...RULES, 'rise', 'match'];
  state.piles = rules.map(rule => pile(rule, 4));
  state.players.forEach(player => { player.hand = [card(2, 'tide'), null, null, null]; });
  assert.equal(retuneIfBlocked(state), true);
  assert.ok(state.players.some(player => legalMoves(player.hand, state.piles).length));
  assert.deepEqual(state.piles.map(item => item.rule), rules);
  assert.equal(retuneIfBlocked(state), false);
  assert.equal(state.turns, 0);
});

test('the AI keeps a continuation when a competing play shuts it off, with occasional oversights', () => {
  const state = newRace(2, randomFrom(22));
  state.piles = [pile('rise', 3, 'tide'), pile('match', 1), pile('fall', 2, 'grove')];
  state.players[1].hand = [card(4, 'spark'), card(4, 'ember'), null, null];
  const choice = chooseMove(state, 1, 'expert', () => 0.9);
  assert.deepEqual(chooseMove(state, 1, 'relaxed', () => 0), { recycle: 0 });
  state.players[1].deck = [];
  assert.ok(play(state, 1, choice.slot, choice.pile, state.players[1].hand[choice.slot].id));
  assert.ok(legalMoves(state.players[1].hand, state.piles).length);
  state.piles = RULES.map(rule => pile(rule, 4));
  state.players[1].hand = [card(1, 'tide'), null, null, null];
  assert.deepEqual(chooseMove(state, 1, 'expert', () => 0.9), { slot: 0, pile: NEW_PILE });
  assert.ok(reactionTime(1, 'expert', 1, () => 0.5) < reactionTime(1, 'relaxed', 1, () => 0.5));
  assert.ok(reactionTime(1, 'quick', .73, () => 0.5) < reactionTime(2, 'quick', 1.33, () => 0.5));
  assert.ok(reactionTime(2, 'quick', .73, () => 0.5) < reactionTime(1, 'quick', 1.33, () => 0.5));
});

test('seeded races for two, three and four players terminate and conserve all cards', () => {
  for (let count = 2; count <= 4; count++) {
    for (let seed = 1; seed <= 80; seed++) {
      const state = newRace(count, randomFrom(seed));
      assert.equal(new Set(state.players.map(player => player.tool)).size, count);
      for (let turn = 0; turn < 500 && state.winner === null; turn++) {
        const index = turn % count;
        const player = state.players[index];
        const move = index === 0 ? legalMoves(player.hand, state.piles)[0] : chooseMove(state, index, 'quick');
        if (move && 'recycle' in move) recycle(state, index, move.recycle, turn * RECYCLE_DELAY);
        else if (move) assert.ok(play(state, index, move.slot, move.pile, player.hand[move.slot].id));
        retuneIfBlocked(state);
        for (const racer of state.players) assert.equal(racer.played + racer.hand.filter(Boolean).length + racer.deck.length, TOTAL);
      }
      assert.notEqual(state.winner, null, `${count} players, seed ${seed}`);
      assert.equal(state.players[state.winner].played, TOTAL);
    }
  }
});
