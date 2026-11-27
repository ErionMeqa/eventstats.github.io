const { DatabaseSync } = require('node:sqlite');
const { computeEvent, speed, decay, CFG } = require('./rating');
const db = new DatabaseSync(process.env.DB || 'elo.db');

const transaction = fn => (...a) => {
  db.exec('BEGIN');
  try { const r = fn(...a); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
create table if not exists players(id integer primary key, name text unique collate nocase, rating real default 1100, events integer default 0);
create table if not exists aliases(alias text primary key collate nocase, player_id integer);
create table if not exists events(id integer primary key, name text, date text);
create table if not exists performances(id integer primary key, event_id integer, player_id integer,
  team text, team_placement integer, placement integer, before real, after real);
`);
try { db.exec('alter table players add column uuid text'); } catch {} // already there
for (const c of ['points real', 'team_points real']) { try { db.exec('alter table performances add column ' + c); } catch {} } // event points, optional
db.exec('create unique index if not exists idx_players_uuid on players(uuid)');

// Minimal CSV parser (supports quoted fields).
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map(line => {
    const out = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
  const head = rows.shift().map(h => h.toLowerCase());
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Replays every event in date order so history stays consistent.
// skip: optional Set of event ids that are replayed without changing anyone's rating (non-canon events).
function recalc(today = new Date().toISOString().slice(0, 10), skip = null) {
  const idle = (a, b) => (new Date(b) - new Date(a)) / 864e5;
  transaction(() => {
    const rating = new Map(), count = new Map(), last = new Map();
    db.prepare('select id from players').all().forEach(p => rating.set(p.id, CFG.START));
    const upd = db.prepare('update performances set before=?, after=? where id=?');
    for (const e of db.prepare('select id,date from events order by date, id').all()) {
      const perfs = db.prepare('select * from performances where event_id=?').all(e.id);
      if (skip && skip.has(e.id)) { perfs.forEach(p => { const r = rating.get(p.player_id); upd.run(r, r, p.id); }); continue; }
      // inactivity decay since each player's previous event
      perfs.forEach(p => { if (last.has(p.player_id)) rating.set(p.player_id, decay(rating.get(p.player_id), idle(last.get(p.player_id), e.date))); });
      const ch = computeEvent(perfs.map(p => ({ ...p, rating: rating.get(p.player_id) })));
      perfs.forEach((p, i) => {
        const n = count.get(p.player_id) || 0;
        const b = rating.get(p.player_id), a = b + ch[i] * speed(n);
        rating.set(p.player_id, a);
        count.set(p.player_id, n + 1); last.set(p.player_id, e.date);
        upd.run(b, a, p.id);
      });
    }
    // decay up to today for anyone who has been away
    last.forEach((d, id) => rating.set(id, decay(rating.get(id), idle(d, today))));
    const up = db.prepare('update players set rating=?, events=? where id=?');
    rating.forEach((r, id) => up.run(r, count.get(id) || 0, id));
  })();
}

module.exports = { db, transaction, recalc, parseCsv };
