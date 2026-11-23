// Compare rating systems on the current database without changing it.
// Usage: node tools/compare-ratings.js [today=YYYY-MM-DD]
//   A  current Elo (rating.js as is)
//   B  Elo with provisional speed for new players + inactivity decay
//   C  OpenSkill (Plackett-Luce, uncertainty-aware) + inactivity decay
const { db } = require('../db');
const { computeEvent, CFG } = require('../rating');
const baseK = 1; // computeEvent already applies CFG.K
let rate, osRating; try { ({ rate, rating: osRating } = require('openskill')); } catch { /* npm i --no-save openskill@4 to include system C */ }

const TODAY = process.argv[2] || new Date().toISOString().slice(0, 10);
const DAY = 864e5, days = (a, b) => (new Date(b) - new Date(a)) / DAY;

// --- decay: after GRACE days without an event, drift toward 1500 by RATE of the margin per 30 days
const DECAY = { GRACE: 180, RATE: 0.04 };
const decayFactor = idle => idle <= DECAY.GRACE ? 1 : Math.pow(1 - DECAY.RATE, (idle - DECAY.GRACE) / 30);

const events = db.prepare('select id,name,date from events order by date, id').all();
const perfsOf = db.prepare('select * from performances where event_id=?');
const names = new Map(db.prepare('select id,name from players').all().map(p => [p.id, p.name]));

function runElo({ provisional, decay }) {
  const r = new Map(), n = new Map(), last = new Map();
  const get = id => r.get(id) ?? CFG.START;
  const applyDecay = (id, date) => {
    if (!decay || !last.has(id)) return;
    const v = get(id); if (v <= CFG.START) return;
    r.set(id, CFG.START + (v - CFG.START) * decayFactor(days(last.get(id), date)));
  };
  for (const e of events) {
    const perfs = perfsOf.all(e.id);
    perfs.forEach(p => applyDecay(p.player_id, e.date));
    const ch = computeEvent(perfs.map(p => ({ ...p, rating: get(p.player_id) })));
    perfs.forEach((p, i) => {
      const k = n.get(p.player_id) || 0;
      const mult = provisional ? 1 + 1.5 * Math.max(0, 10 - k) / 10 : 1; // x2.5 on first event, x1 from the 10th
      r.set(p.player_id, get(p.player_id) + ch[i] * mult);
      n.set(p.player_id, k + 1); last.set(p.player_id, e.date);
    });
  }
  [...r.keys()].forEach(id => applyDecay(id, TODAY));
  return [...r].map(([id, v]) => ({ id, v, n: n.get(id), last: last.get(id) }));
}

function runOpenSkill({ decay }) {
  const s = new Map(), n = new Map(), last = new Map();
  const get = id => s.get(id) || osRating();
  const TAU = 0.35; // uncertainty added per idle month after the grace period
  const applyDecay = (id, date) => {
    if (!decay || !last.has(id)) return;
    const idle = days(last.get(id), date); if (idle <= DECAY.GRACE) return;
    const x = get(id), months = (idle - DECAY.GRACE) / 30;
    s.set(id, { mu: 25 + (x.mu - 25) * decayFactor(idle), sigma: Math.min(25 / 3, Math.sqrt(x.sigma ** 2 + months * TAU ** 2)) });
  };
  for (const e of events) {
    const perfs = perfsOf.all(e.id);
    perfs.forEach(p => applyDecay(p.player_id, e.date));
    const cur = perfs.map(p => get(p.player_id));
    const hasInd = perfs.every(p => p.placement != null), hasTeam = perfs.every(p => p.team && p.team_placement != null);
    let ind = null, team = null;
    if (hasInd) ind = rate(cur.map(x => [x]), { rank: perfs.map(p => p.placement) }).map(t => t[0]);
    if (hasTeam) {
      const order = [...new Set(perfs.map(p => p.team))];
      const out = rate(order.map(t => perfs.map((p, i) => p.team === t ? cur[i] : null).filter(Boolean)),
        { rank: order.map(t => perfs.find(p => p.team === t).team_placement) });
      const idx = {}; order.forEach((t, k) => idx[t] = 0);
      team = perfs.map(p => out[order.indexOf(p.team)][idx[p.team]++]);
    }
    perfs.forEach((p, i) => {
      const a = ind && team ? { mu: cur[i].mu + 0.6 * (ind[i].mu - cur[i].mu) + 0.4 * (team[i].mu - cur[i].mu), sigma: Math.min(ind[i].sigma, team[i].sigma) }
        : (ind || team) ? (ind || team)[i] : cur[i];
      s.set(p.player_id, a); n.set(p.player_id, (n.get(p.player_id) || 0) + 1); last.set(p.player_id, e.date);
    });
  }
  [...s.keys()].forEach(id => applyDecay(id, TODAY));
  // shown on an Elo-like scale: 1500 at the start, conservative (mu - sigma) so one lucky event can't top the board
  return [...s].map(([id, x]) => ({ id, v: 1500 + 24 * (x.mu - x.sigma - (25 - 25 / 3)), mu: x.mu, sigma: x.sigma, n: n.get(id), last: last.get(id) }));
}

const sys = {
  A: runElo({ provisional: false, decay: false }),
  B: runElo({ provisional: true, decay: true }),  // what rating.js now does
  ...(rate ? { C: runOpenSkill({ decay: true }) } : {}),
};
const ranked = {};
for (const k in sys) { sys[k].sort((a, b) => b.v - a.v); ranked[k] = new Map(sys[k].map((x, i) => [x.id, i + 1])); }
if (require.main === module) {
  const out = { today: TODAY, top: {}, rankOf: (id) => null };
  for (const k in sys) out.top[k] = sys[k].slice(0, 25).map((x, i) => ({ rank: i + 1, name: names.get(x.id), rating: Math.round(x.v), events: x.n, last: x.last }));
  const watch = ['Kelawesome', 'FireBreathMan', 'Feinberg', 'Purpled', 'Dream', 'Sapnap', 'TommyInnit', 'Antfrost'];
  out.watch = watch.map(w => { const id = [...names].find(([, n]) => n.toLowerCase() === w.toLowerCase())?.[0];
    return id ? { name: w, A: ranked.A.get(id), B: ranked.B.get(id), C: ranked.C.get(id), events: sys.A.find(x => x.id === id)?.n, last: sys.A.find(x => x.id === id)?.last } : { name: w, missing: true }; });
  console.log(JSON.stringify(out));
}
module.exports = { sys, ranked, names };
