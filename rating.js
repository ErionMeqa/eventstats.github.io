// Rating model. Tune these numbers to taste.
const CFG = {
  START: 1500,
  K: 200,       // overall rating speed: a bad night costs roughly what it does on eventelo.live
  W: 0.75,       // weight of individual part (team part gets 1 - W)
  CARRY: 12,    // bonus/penalty for beating/trailing your own teammates
  // New players move faster: x(1 + BOOST) on their first event, easing back to x1 by event PROVISIONAL.
  PROVISIONAL: 10,
  BOOST: 0.5,
  // Inactivity decay: after GRACE days without an event, ratings above START drift back toward it,
  // losing DECAY of the margin per 30 idle days. Applied before a player's next event and when the site is built.
  GRACE: 180,
  DECAY: 0.04,
  // Points margin: when an event has points, each head-to-head counts by how big the gap was instead of plain
  // win/lose. A gap of one standard deviation of that event's scores is worth about a 0.76-0.24 result.
  MARGIN: true,
  // Individual head-to-heads: BLEND of the result comes from who placed higher, the rest from the points gap.
  BLEND: 0.5,
  SOFT: 2,      // gap (in standard deviations) that counts as a clear win; higher = blowouts matter less
  // Forgiving: drops are scaled by LOSS, so a bad event costs less than a good one earns.
  LOSS: 1,      // 1 = losses count in full
  // Team shield: if your team did better than expected, you never lose rating that event, even with a poor
  // individual finish. You keep at least SHIELD of your team's gain.
  SHIELD: 0,    // 0 = off
  // Most one event can move a rating, up or down.
  CAP: 120,
};

const speed = eventsPlayed => 1 + CFG.BOOST * Math.max(0, CFG.PROVISIONAL - eventsPlayed) / CFG.PROVISIONAL;
const decay = (rating, idleDays) => rating <= CFG.START || idleDays <= CFG.GRACE ? rating
  : CFG.START + (rating - CFG.START) * Math.pow(1 - CFG.DECAY, (idleDays - CFG.GRACE) / 30);

const clamp = d => Math.max(-CFG.CAP, Math.min(CFG.CAP, d));
const forgive = d => clamp(d < 0 ? d * CFG.LOSS : d);
const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
const score = (pa, pb) => (pa < pb ? 1 : pa === pb ? 0.5 : 0); // lower placement = better
const sd = xs => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length) || 1; };

// Pairwise Elo: everyone vs everyone, averaged so big events don't swing too much.
// items: [{ rating, place, pts? }]; with points on every item (and MARGIN on), results scale with the points gap.
function pairwise(items) {
  const n = items.length;
  const usePts = CFG.MARGIN && n > 1 && items.every(x => x.pts != null);
  const scale = usePts ? sd(items.map(x => x.pts)) : 1;
  return items.map((x, i) => {
    if (n < 2) return 0;
    let sum = 0;
    items.forEach((y, j) => {
      if (i === j) return;
      // result of this head-to-head: a blend of who placed higher and by how many points
      const byPlace = x.place != null && y.place != null ? score(x.place, y.place) : null;
      const byPts = usePts ? 0.5 + 0.5 * Math.tanh((x.pts - y.pts) / (CFG.SOFT * scale)) : null;
      const s = byPlace == null ? byPts : byPts == null ? byPlace : CFG.BLEND * byPlace + (1 - CFG.BLEND) * byPts;
      sum += s - expected(x.rating, y.rating);
    });
    return (CFG.K * sum) / (n - 1);
  });
}

// perfs: [{ rating, placement, team, team_placement, points?, team_points? }] -> array of rating changes
// Works with individual placements, team standings, or both.
function computeEvent(perfs) {
  const n = perfs.length;
  const hasInd = perfs.every(p => p.placement != null);
  const hasTeam = perfs.every(p => p.team && p.team_placement != null);
  const indiv = hasInd ? pairwise(perfs.map(p => ({ rating: p.rating, place: p.placement, pts: p.points }))) : null;
  if (!hasTeam) return (indiv || perfs.map(() => 0)).map(forgive);

  const teams = {};
  perfs.forEach((p, i) => {
    (teams[p.team] ||= { place: p.team_points != null && CFG.MARGIN ? null : p.team_placement, pts: p.team_points, members: [] }).members.push(i);
  });
  const list = Object.values(teams);
  list.forEach(t => { t.rating = t.members.reduce((s, i) => s + perfs[i].rating, 0) / t.members.length; });
  const teamDelta = pairwise(list);
  list.forEach((t, k) => { t.delta = teamDelta[k]; });
  if (!hasInd) return perfs.map(p => forgive(teams[p.team].delta)); // team standings only

  const usePts = CFG.MARGIN && perfs.every(p => p.points != null), spread = usePts ? sd(perfs.map(p => p.points)) : 1;
  // percentile 1 = best individual placement, 0 = worst
  const pct = p => (n > 1 ? 1 - (p.placement - 1) / (n - 1) : 0.5);
  return perfs.map((p, i) => {
    const t = teams[p.team];
    const mates = t.members.filter(j => j !== i);
    // carry: how far you outscored your teammates (points when the event has them, else placement)
    const carry = !mates.length ? 0 : usePts
      ? Math.tanh((p.points - mates.reduce((s, j) => s + perfs[j].points, 0) / mates.length) / (CFG.SOFT * spread))
      : pct(p) - mates.reduce((s, j) => s + pct(perfs[j]), 0) / mates.length;
    const d = CFG.W * indiv[i] + (1 - CFG.W) * t.delta + CFG.CARRY * carry;
    return t.delta > 0 ? clamp(Math.max(forgive(d), CFG.SHIELD * t.delta)) : forgive(d);
  });
}

module.exports = { computeEvent, speed, decay, CFG };
