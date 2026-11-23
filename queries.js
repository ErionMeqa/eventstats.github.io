// Read-only queries shared by the server and the static site builder.
const { db } = require('./db');

function leaderboard() {
  const rows = db.prepare(`select id,name,uuid,rating,events,
    (select max(after) from performances where player_id=players.id) peak,
    (select after-before from performances p join events e on e.id=p.event_id where p.player_id=players.id
       order by e.date desc, e.id desc limit 1) last_change,
    (select count(*) from performances where player_id=players.id and placement=1) wins,
    (select count(*) from performances where player_id=players.id and placement<=3) top3,
    (select count(*) from performances where player_id=players.id and placement<=5) top5,
    (select count(*) from performances where player_id=players.id and placement<=10) top10
    from players where events>0 order by rating desc`).all();
  // rank before the most recent event, for the up/down arrows
  const last = db.prepare('select id from events order by date desc, id desc limit 1').get();
  const before = new Map(last ? db.prepare('select player_id,before from performances where event_id=?').all(last.id).map(r => [r.player_id, r.before]) : []);
  const prev = rows.map(r => ({ id: r.id, v: before.has(r.id) ? before.get(r.id) : r.rating }))
    .filter(r => !(before.has(r.id) && rows.find(x => x.id === r.id).events === 1)) // first event: had no rank before
    .sort((a, b) => b.v - a.v);
  const prevRank = new Map(prev.map((r, i) => [r.id, i + 1]));
  rows.forEach(r => { r.prev_rank = prevRank.get(r.id) ?? null; });
  // last five finishes (individual place, else team place), newest first
  const rec = db.prepare(`select coalesce(p.placement, p.team_placement) v from performances p join events e on e.id=p.event_id
    where p.player_id=? order by e.date desc, e.id desc limit 5`);
  rows.forEach(r => { r.recent = rec.all(r.id).map(x => x.v); });
  return rows;
}

const events = () => db.prepare(`select e.id,e.name,e.date,count(p.id) players from events e
    left join performances p on p.event_id=e.id group by e.id order by e.date desc, e.id desc`).all();

function event(id) {
  const ev = db.prepare('select * from events where id=?').get(id);
  if (!ev) return null;
  const players = db.prepare(`select pl.id,pl.name,pl.uuid,p.team,p.team_placement,p.placement,p.before,p.after
    from performances p join players pl on pl.id=p.player_id where p.event_id=?
    order by coalesce(p.placement, p.team_placement), p.team_placement, pl.name`).all(ev.id);
  const teams = {};
  players.forEach(p => { if (p.team) (teams[p.team] ||= { name: p.team, placement: p.team_placement, players: [] }).players.push(p.name); });
  return { event: ev, players, teams: Object.values(teams).sort((a, b) => a.placement - b.placement) };
}

function player(id) {
  const pl = db.prepare('select id,name,uuid,rating,events from players where id=?').get(id);
  if (!pl) return null;
  const history = db.prepare(`select e.id event_id,e.name,e.date,p.team,p.team_placement,p.placement,p.before,p.after
    from performances p join events e on e.id=p.event_id where p.player_id=? order by e.date,e.id`).all(pl.id);
  return { player: pl, history };
}

module.exports = { leaderboard, events, event, player };
