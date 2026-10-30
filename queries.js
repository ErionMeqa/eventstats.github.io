// Read-only queries shared by the server and the static site builder.
const { db } = require('./db');

const leaderboard = () => db.prepare(`select id,name,uuid,rating,events,
    (select max(after) from performances where player_id=players.id) peak,
    (select after-before from performances p join events e on e.id=p.event_id where p.player_id=players.id
       order by e.date desc, e.id desc limit 1) last_change
    from players where events>0 order by rating desc`).all();

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
