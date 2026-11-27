const FIRST_PLACE_XP = 100;
const PLACEMENT_XP = [FIRST_PLACE_XP, 75, 50, 25];

export function newMatch(settings, id) {
  return { id, settings, completed: 0, totals: Array(settings.players).fill(0) };
}

export function rankScores(scores) {
  const ranked = scores.map((total, index) => ({ index, total })).sort((a, b) => b.total - a.total);
  let place = 0;
  return ranked.map((entry, index) => {
    if (!index || ranked[index - 1].total !== entry.total) place = index + 1;
    return { ...entry, place };
  });
}

export function recordRound(match, round, scores) {
  const { rounds } = match.settings;
  if (round !== match.completed + 1 || (rounds !== null && round > rounds)) return null;
  if (scores.length !== match.totals.length || !scores.every(Number.isInteger)) throw new RangeError('Invalid round scores');

  match.completed = round;
  const freePlay = rounds === null;
  if (!freePlay) match.totals = match.totals.map((previous, index) => previous + scores[index]);
  const ranked = rankScores(freePlay ? scores : match.totals);
  const final = !freePlay && round === rounds;
  const placement = ranked.find(row => row.index === 0).place;
  const xp = freePlay || final ? PLACEMENT_XP[placement - 1] : 0;
  return { ranked, final, freePlay, placement, xp, awardId: freePlay ? `${match.id}.${round}` : match.id };
}

export function levelProgress(totalXp) {
  let level = 0;
  let xp = totalXp;
  let goal = FIRST_PLACE_XP;
  while (xp >= goal) {
    xp -= goal;
    level++;
    goal = FIRST_PLACE_XP * (level + 1);
  }
  return { level, xp, goal };
}
