import test from 'node:test';
import assert from 'node:assert/strict';
import { newRace, WOOD_CARD, NEW_PILE, flipWood } from '../public/engine.js';
import { newRival, noticePileChange, settleRivalPlay, stepRival } from '../public/rival-ai.js';
import { chooseRivalNames, voiceForName } from '../public/rival-names.js';

const card = (rank, suit = 'spark') => ({ id: `${suit}-${rank}`, rank, suit });
const stack = top => ({ cards: [top], closed: false });
const steady = () => .5;
const observed = (rank, suit) => ({ top: card(rank, suit), at: 0 });

function setup(piles = [], posts = [card(7), card(8), card(9)]) {
  const race = newRace(2, steady);
  const rival = newRival(1, 'quick', 0, steady);
  race.piles = piles;
  race.players[1].posts = posts;
  race.players[1].wood = [];
  rival.next = 0;
  return { race, rival };
}

test('a Wood flip must settle and the exposed card needs a separate look before a play', () => {
  const { race, rival } = setup();
  race.players[1].wood = [card(8), card(9), card(1)];
  rival.posts = [];
  assert.deepEqual(stepRival(rival, race, 0), { kind: 'flip' });
  assert.equal(flipWood(race, 1).at(-1).rank, 1);
  const flippedAt = rival.next;
  assert.equal(stepRival(rival, race, flippedAt - 1), null);
  assert.equal(rival.focus, null);
  stepRival(rival, race, flippedAt);
  assert.deepEqual(rival.focus, { kind: 'card', source: WOOD_CARD });
  const inspectedAt = rival.next;
  assert.ok(inspectedAt - flippedAt > 400);
  stepRival(rival, race, inspectedAt - 1);
  assert.equal(rival.cards.has(WOOD_CARD), false);
  stepRival(rival, race, inspectedAt);
  assert.equal(rival.focus.kind, 'play');
  assert.equal(rival.focus.pile, NEW_PILE);
  assert.equal(stepRival(rival, race, rival.next).cardId, 'spark-1');
});

test('rivals look at each of their three posts and one pile at a time without repeating a static scan', () => {
  const reads = [];
  const piles = [0, 1, 2].map(index => ({
    closed: false,
    get cards() {
      reads.push(index);
      return [card(1, 'ember')];
    },
  }));
  const { race, rival } = setup(piles);
  for (const [index, step] of [0, 1, 2, 3].entries()) {
    stepRival(rival, race, index * 500);
    assert.equal(rival.cards.size, step);
    assert.deepEqual(reads, []);
  }
  assert.equal(rival.focus.kind, 'pile');
  stepRival(rival, race, rival.next);
  assert.equal(reads.length, 1);
  for (let clock = 2050; clock < 8000; clock += 50) stepRival(rival, race, clock);
  assert.deepEqual([...reads].sort(), [0, 1, 2]);
  noticePileChange(rival, 1, 0, 8000, 0);
  for (let clock = 8000; clock < 9000; clock += 50) stepRival(rival, race, clock);
  assert.deepEqual(reads.slice(3), [1]);
});

test('nearby ranks bias the scan without exposing the current pile tops', () => {
  const { race, rival } = setup([stack(card(5)), stack(card(1))]);
  rival.posts = [];
  rival.cards.set(0, card(6));
  rival.piles.set(0, observed(5));
  rival.piles.set(1, observed(1));
  rival.unread = new Set([0, 1]);
  rival.random = () => .6;
  stepRival(rival, race, 0);
  assert.deepEqual(rival.focus, { kind: 'pile', pile: 0, favored: true });
});

test('unsuccessful Wood, slow Blitz progress and contested moves raise visible stress', () => {
  const { race, rival } = setup();
  rival.posts = [];
  race.players[1].wood = [card(6), card(7), card(8)];
  for (let clock = 0; clock < 24000; clock += 50) {
    if (stepRival(rival, race, clock)?.kind === 'flip') flipWood(race, 1);
  }
  assert.ok(rival.dryFlips > 3);
  assert.ok(rival.stress > 12 && rival.stress < 50);

  rival.stress = 78;
  rival.spokeAt = -Infinity;
  rival.focus = { kind: 'play', pile: 0, source: 0 };
  noticePileChange(rival, 0, 0, 25000);
  assert.ok(rival.focus.contested);
  assert.equal(rival.stress, 82.1);
  assert.match(rival.speech.text, /Shit|Damn it|crap|cursed|got there first/);
  noticePileChange(rival, 0, 0, 25010);
  assert.equal(rival.stress, 82.1);
  settleRivalPlay(rival, { source: 0, pile: 0 }, true, false, 25500);
  assert.equal(rival.stress, 75.1);
  assert.equal(rival.lastBlitz, 25500);
});

test('ordinary slips stay close in rank and in the correct color', () => {
  const { race, rival } = setup([stack(card(5)), stack(card(4)), stack(card(5, 'ember'))]);
  rival.pileCount = 3;
  rival.posts = [];
  rival.cards.set(0, card(6));
  rival.piles.set(0, observed(5));
  rival.piles.set(1, observed(4));
  rival.piles.set(2, observed(5, 'ember'));
  rival.random = () => .028;

  stepRival(rival, race, 0);
  assert.equal(rival.focus.pile, 0);
  const calmDelay = rival.next;
  rival.focus = null;
  rival.next = 0;
  rival.stress = 100;
  stepRival(rival, race, 0);
  assert.equal(rival.focus.mistake, true);
  assert.equal(rival.focus.pile, 1);
  assert.ok(rival.next > calmDelay);
  assert.equal(race.piles[1].cards.length, 1);
});

test('even at maximum stress mismatched colors need a very rare roll', () => {
  const { race, rival } = setup([stack(card(5)), stack(card(5, 'ember')), stack(card(2, 'ember'))]);
  rival.pileCount = 3;
  rival.posts = [];
  rival.cards.set(0, card(6));
  rival.piles.set(0, observed(5));
  rival.piles.set(1, observed(5, 'ember'));
  rival.piles.set(2, observed(2, 'ember'));
  rival.stress = 100;
  rival.random = () => .005;
  stepRival(rival, race, 0);
  assert.equal(rival.focus.pile, 0);
  rival.focus = null;
  rival.next = 0;
  rival.random = () => .002;
  stepRival(rival, race, 0);
  assert.equal(rival.focus.pile, 1);
  assert.equal(rival.focus.mistake, true);
});

test('there are hundreds of unique names and a new roster can exclude the old one', () => {
  const pool = chooseRivalNames(1000, [], steady);
  assert.ok(pool.length >= 200);
  assert.equal(new Set(pool).size, pool.length);
  const old = chooseRivalNames(3, [], steady);
  const next = chooseRivalNames(3, old, steady);
  assert.equal(next.length, 3);
  assert.ok(next.every(name => !old.includes(name)));
  assert.ok(pool.every(name => ['male', 'female'].includes(voiceForName(name))));
  assert.equal(voiceForName('Clara'), 'female');
  assert.equal(voiceForName(' Johann '), 'male');
});

test('a far-away play can go unnoticed and an old remembered match takes a fresh look', () => {
  const { race, rival } = setup([stack(card(5))]);
  rival.pileCount = 1;
  rival.posts = [];
  rival.cards.set(0, card(6));
  rival.piles.set(0, observed(5));
  rival.focus = { kind: 'card', source: WOOD_CARD };
  noticePileChange(rival, 0, 0, 3000, 1);
  assert.equal(rival.unread.has(0), false);
  race.piles[0].cards.push(card(6));
  stepRival(rival, race, 6000);
  assert.equal(rival.focus.kind, 'pile');
  assert.equal(rival.piles.get(0).top.rank, 5);
  stepRival(rival, race, rival.next);
  assert.equal(rival.piles.get(0).top.rank, 6);
  assert.notEqual(rival.focus?.kind, 'play');
});
