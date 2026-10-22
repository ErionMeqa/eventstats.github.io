// Rating model. Tune these numbers to taste.
const CFG = {
  START: 1500,
  K: 40,        // overall rating speed
  W: 0.6,       // weight of individual part (team part gets 1 - W)
  CARRY: 12,    // bonus/penalty for beating/trailing your own teammates
};

const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
const score = (pa, pb) => (pa < pb ? 1 : pa === pb ? 0.5 : 0); // lower placement = better

// Pairwise Elo: everyone vs everyone, averaged so big events don't swing too much.
function pairwise(items) {
  const n = items.length;
  return items.map((x, i) => {
    if (n < 2) return 0;
    let sum = 0;
    items.forEach((y, j) => { if (i !== j) sum += score(x.place, y.place) - expected(x.rating, y.rating); });
    return (CFG.K * sum) / (n - 1);
  });
}

// perfs: [{ rating, placement, team, team_placement }] -> array of rating changes
// Works with individual placements, team standings, or both.
function computeEvent(perfs) {
  const n = perfs.length;
  const hasInd = perfs.every(p => p.placement != null);
  const hasTeam = perfs.every(p => p.team && p.team_placement != null);
  const indiv = hasInd ? pairwise(perfs.map(p => ({ rating: p.rating, place: p.placement }))) : null;
  if (!hasTeam) return indiv || perfs.map(() => 0);

  const teams = {};
  perfs.forEach((p, i) => {
    (teams[p.team] ||= { place: p.team_placement, members: [] }).members.push(i);
  });
  const list = Object.values(teams);
  list.forEach(t => { t.rating = t.members.reduce((s, i) => s + perfs[i].rating, 0) / t.members.length; });
  const teamDelta = pairwise(list);
  list.forEach((t, k) => { t.delta = teamDelta[k]; });
  if (!hasInd) return perfs.map(p => teams[p.team].delta); // team standings only

  // percentile 1 = best individual placement, 0 = worst
  const pct = p => (n > 1 ? 1 - (p.placement - 1) / (n - 1) : 0.5);
  return perfs.map((p, i) => {
    const t = teams[p.team];
    const mates = t.members.filter(j => j !== i);
    const carry = mates.length
      ? pct(p) - mates.reduce((s, j) => s + pct(perfs[j]), 0) / mates.length
      : 0;
    return CFG.W * indiv[i] + (1 - CFG.W) * t.delta + CFG.CARRY * carry;
  });
}

module.exports = { computeEvent, CFG };
