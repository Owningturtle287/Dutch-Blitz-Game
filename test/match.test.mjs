import test from 'node:test';
import assert from 'node:assert/strict';
import { newMatch, recordRound, rankScores, levelProgress } from '../public/match.js';
import { createProfileStore, normalizeName } from '../public/profiles.js';

test('a fixed-round game accumulates scores and awards XP only on its final round', () => {
  const match = newMatch({ players: 3, rounds: 2 }, 'game-test');
  const first = recordRound(match, 1, [15, -5, -2]);
  assert.deepEqual(match.totals, [15, -5, -2]);
  assert.equal(first.final, false);
  assert.equal(first.xp, 0);
  assert.equal(recordRound(match, 1, [15, -5, -2]), null);

  const final = recordRound(match, 2, [4, 16, 3]);
  assert.deepEqual(match.totals, [19, 11, 1]);
  assert.equal(final.final, true);
  assert.equal(final.placement, 1);
  assert.equal(final.xp, 100);
  assert.equal(final.awardId, 'game-test');
  assert.equal(recordRound(match, 3, [1, 2, 3]), null);
});

test('Free Play ranks each round independently and awards each round once', () => {
  const match = newMatch({ players: 4, rounds: null }, 'free-test');
  const scores = [[15, 6, 2, -9], [5, 9, 4, 1], [3, 8, 9, 1], [-9, 11, 5, 4]];
  scores.forEach((round, index) => {
    const result = recordRound(match, index + 1, round);
    assert.equal(result.final, false);
    assert.equal(result.freePlay, true);
    assert.equal(result.placement, index + 1);
    assert.equal(result.xp, [100, 75, 50, 25][index]);
    assert.equal(result.awardId, `free-test.${index + 1}`);
    assert.deepEqual(match.totals, [0, 0, 0, 0]);
  });
});

test('equal scores share a place even across multiple tied players', () => {
  assert.deepEqual(rankScores([8, 8, 4, 8]).map(row => [row.index, row.place]), [[0, 1], [1, 1], [3, 1], [2, 4]]);
  const match = newMatch({ players: 4, rounds: 1 }, 'tied-game');
  assert.equal(recordRound(match, 1, [4, 9, 4, 1]).xp, 75);
});

test('levels take one, two, then three first-place wins and retain excess XP', () => {
  assert.deepEqual(levelProgress(0), { level: 0, xp: 0, goal: 100 });
  assert.deepEqual(levelProgress(100), { level: 1, xp: 0, goal: 200 });
  assert.deepEqual(levelProgress(200), { level: 1, xp: 100, goal: 200 });
  assert.deepEqual(levelProgress(300), { level: 2, xp: 0, goal: 300 });
  assert.deepEqual(levelProgress(575), { level: 2, xp: 275, goal: 300 });
  assert.deepEqual(levelProgress(625), { level: 3, xp: 25, goal: 400 });
});

function storage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test('profiles retain independent, case-insensitive progress and deduplicate match awards', () => {
  const saved = storage();
  const firstTab = createProfileStore(saved);
  const secondTab = createProfileStore(saved);
  assert.equal(normalizeName('  Sky  Blue   '), 'Sky Blue');
  assert.deepEqual(firstTab.ensure(' Sky  Blue '), { name: 'Sky Blue', totalXp: 0 });
  assert.deepEqual(firstTab.award('SKY BLUE', 'game-1', 100), { name: 'Sky Blue', totalXp: 100 });
  assert.deepEqual(secondTab.award('sky blue', 'game-1', 100), { name: 'Sky Blue', totalXp: 100 });
  secondTab.award('Sky Blue', 'game-2', 75);
  firstTab.award('Alex', 'game-1', 25);

  const reopened = createProfileStore(saved);
  assert.deepEqual(reopened.list(), [{ name: 'Alex', totalXp: 25 }, { name: 'Sky Blue', totalXp: 175 }]);
});

test('players can earn XP for the current session when storage is unavailable', () => {
  const profiles = createProfileStore(undefined);
  assert.deepEqual(profiles.award('Jun', 'local-game', 50), { name: 'Jun', totalXp: 50 });
  assert.deepEqual(profiles.find('jun'), { name: 'Jun', totalXp: 50 });
});
