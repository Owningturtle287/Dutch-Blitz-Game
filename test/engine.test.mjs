import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUITS, DECK_TOOLS, TOTAL, DEFAULT_RULES, NEW_PILE, WOOD_CARD, newRace, accepts,
  destinations, legalMoves, visibleCard, flipWood, woodCount, isBlocked, play, score, chooseMove, reactionTime,
} from '../public/engine.js';

let nextId = 0;
const card = (rank, suit = 'spark') => ({ id: `${suit}-${rank}-${nextId++}`, rank, suit, tool: 'wagon' });
const pile = (rank, suit) => ({ closed: false, cards: [card(rank, suit)] });
const woodCards = player => [...player.wood, ...player.woodShown, ...player.woodDiscard];
const outstanding = player => [...player.blitz, ...player.posts.filter(Boolean), ...woodCards(player)];

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('four seats start with no shared piles and four distinct, complete tool decks', () => {
  const { players, piles } = newRace(4, randomFrom(18));
  assert.equal(piles.length, 0);
  const all = players.flatMap(outstanding);
  assert.equal(all.length, 160);
  assert.equal(new Set(all.map(item => item.id)).size, 160);
  assert.deepEqual(new Set(players.map(player => player.tool)), new Set(DECK_TOOLS));
  for (const suit of SUITS) assert.equal(all.filter(item => item.suit === suit).length, 40);
  for (const player of players) {
    assert.deepEqual([player.blitz.length, player.posts.length, woodCount(player)], [10, 3, 27]);
    assert.ok(outstanding(player).every(item => item.tool === player.tool));
    for (const suit of SUITS) {
      const ranks = outstanding(player).filter(item => item.suit === suit).map(item => item.rank).sort((a, b) => a - b);
      assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  }
});

test('default piles require the same color and exactly one higher, and only a 1 can open', () => {
  const yellowFive = pile(5);
  assert.equal(accepts(yellowFive, card(6)), true);
  for (const rejected of [card(7), card(5), card(4), card(6, 'tide')]) {
    assert.equal(accepts(yellowFive, rejected), false);
  }
  assert.equal(accepts(pile(10), card(1)), false);
  assert.deepEqual(destinations(card(1), []), [NEW_PILE]);
  assert.deepEqual(destinations(card(2), []), []);
});

test('each optional rule changes only its intended requirement', () => {
  const yellowFive = pile(5);
  assert.equal(accepts(yellowFive, card(6, 'tide'), { ...DEFAULT_RULES, anyColor: true }), true);
  assert.equal(accepts(yellowFive, card(7, 'tide'), { ...DEFAULT_RULES, anyColor: true }), false);
  assert.equal(accepts(yellowFive, card(7), { ...DEFAULT_RULES, sameColor: true }), true);
  assert.equal(accepts(yellowFive, card(7, 'tide'), { ...DEFAULT_RULES, sameColor: true }), false);
  assert.equal(accepts(yellowFive, card(4), { ...DEFAULT_RULES, descending: true }), true);
  assert.equal(accepts(yellowFive, card(4, 'tide'), { ...DEFAULT_RULES, descending: true }), false);
  assert.deepEqual(destinations(card(2), [], { anyColor: true, sameColor: true, descending: true }), []);
});

test('a 10 on a 9 closes the pile and no variant lets anyone play there again', () => {
  const state = newRace(2, randomFrom(1), { anyColor: true, sameColor: true, descending: true });
  const player = state.players[0];
  state.piles.push(pile(9));
  player.posts = [card(10), card(9), card(1)];
  const previousTen = player.posts[0];
  assert.equal(play(state, 0, 0, 0, previousTen.id), previousTen);
  assert.equal(state.piles[0].closed, true);
  assert.equal(state.piles[0].cards.at(-1), previousTen);
  assert.equal(play(state, 0, 1, 0, player.posts[1].id), null);
  assert.equal(play(state, 0, 0, 0, previousTen.id), null);
  assert.deepEqual(destinations(player.posts[2], state.piles, state.rules), [NEW_PILE]);
});

test('Wood exposes only the last of a packet and reveals each underneath in reverse order', () => {
  const state = newRace(2, randomFrom(2));
  const player = state.players[0];
  const [first, second, third, fourth] = [card(4), card(3), card(2), card(5)];
  player.wood = [first, second, third, fourth];
  state.piles = [pile(1), pile(2), pile(3)];
  assert.deepEqual(flipWood(state, 0), [first, second, third]);
  assert.equal(play(state, 0, WOOD_CARD, 1, second.id), null);
  for (const [index, item] of [third, second, first].entries()) {
    assert.equal(visibleCard(player, WOOD_CARD), item);
    assert.equal(play(state, 0, WOOD_CARD, index, item.id), item);
  }
  assert.equal(visibleCard(player, WOOD_CARD), undefined);
  assert.equal(play(state, 0, WOOD_CARD, 2, fourth.id), null);
  assert.deepEqual(flipWood(state, 0), [fourth]);
  assert.equal(player.blitz.length, 10);
  assert.equal(score(player), -17);
});

test('Wood keeps skipped cards out of the stock and reshuffles only the unplayed cards', () => {
  const state = newRace(2, randomFrom(3));
  const player = state.players[0];
  const batch = [card(1), card(2), card(3), card(4), card(5), card(1, 'tide'), card(7)];
  player.wood = [...batch];
  assert.deepEqual(flipWood(state, 0), batch.slice(0, 3));
  assert.deepEqual(player.wood, batch.slice(3));
  assert.deepEqual(flipWood(state, 0), batch.slice(3, 6));
  assert.equal(play(state, 0, WOOD_CARD, NEW_PILE, batch[5].id), batch[5]);
  assert.deepEqual(flipWood(state, 0), [batch[6]]);
  assert.equal(player.wood.length, 0);
  assert.equal(player.woodDiscard.length, 5);
  assert.equal(flipWood(state, 0).length, 3);
  assert.equal(player.woodDiscard.length, 0);
  assert.deepEqual(new Set(woodCards(player)), new Set(batch.filter(item => item !== batch[5])));
});

test('a successful face-up play replaces its own slot and the last Blitz draw ends the round', () => {
  const state = newRace(2, randomFrom(4));
  const player = state.players[0];
  const other = state.players[1];
  player.posts = [card(1), card(5, 'grove'), card(1, 'ember')];
  const lastBlitz = card(1, 'tide');
  player.blitz = [card(4), lastBlitz];
  assert.equal(play(state, 0, 1, NEW_PILE, player.posts[1].id), null);
  assert.notEqual(play(state, 0, 0, NEW_PILE, player.posts[0].id), null);
  assert.equal(player.posts[0], lastBlitz);
  assert.equal(state.finisher, null);
  assert.equal(score(player), -1);
  assert.notEqual(play(state, 0, 2, NEW_PILE, player.posts[2].id), null);
  assert.equal(player.posts[1].rank, 5);
  assert.equal(state.finisher, 0);
  assert.equal(score(player), 2);
  assert.equal(score(other), -20);
  assert.equal(woodCount(player), 27);
  assert.equal(player.posts.length, 3);
  assert.equal(play(state, 0, 0, NEW_PILE, lastBlitz.id), null);
  assert.equal(flipWood(state, 1), null);
});

test('a deal is blocked only when no post or unplayed Wood card can ever be played', () => {
  const state = newRace(2, randomFrom(5));
  for (const player of state.players) {
    player.posts = [card(2), card(5), card(8)];
    player.wood = [card(4)];
    player.blitz = [card(1)];
  }
  assert.equal(isBlocked(state), true);
  assert.equal(state.finisher, null);
  const player = state.players[0];
  player.woodDiscard.push(card(1));
  assert.equal(isBlocked(state), false);
});

test('seeded rounds conserve cards across all decks, Wood passes, and shared piles', () => {
  for (let count = 2; count <= 4; count++) {
    for (let seed = 1; seed <= 30; seed++) {
      const state = newRace(count, randomFrom(seed));
      for (let turn = 0; turn < 750 && state.finisher === null; turn++) {
        const index = turn % count;
        const player = state.players[index];
        const move = index === 0 ? legalMoves(player, state.piles, state.rules)[0] : chooseMove(state, index, 'quick');
        if (move && !move.flip) {
          assert.ok(play(state, index, move.source, move.pile, visibleCard(player, move.source).id));
        } else if (woodCount(player)) {
          assert.ok(flipWood(state, index));
        }
      }
      const tableCards = state.piles.flatMap(item => item.cards);
      assert.equal(tableCards.length, state.players.reduce((sum, player) => sum + player.played, 0));
      const all = [...tableCards, ...state.players.flatMap(outstanding)];
      assert.equal(all.length, count * TOTAL);
      assert.equal(new Set(all.map(item => item.id)).size, all.length);
    }
  }
  assert.ok(reactionTime(1, 'expert', 1, () => .5) < reactionTime(1, 'relaxed', 1, () => .5));
});
