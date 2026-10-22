const { DatabaseSync } = require('node:sqlite');
const { computeEvent, CFG } = require('./rating');
const db = new DatabaseSync(process.env.DB || 'elo.db');

const transaction = fn => (...a) => {
  db.exec('BEGIN');
  try { const r = fn(...a); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

db.exec(`
create table if not exists players(id integer primary key, name text unique collate nocase, rating real default 1500, events integer default 0);
create table if not exists aliases(alias text primary key collate nocase, player_id integer);
create table if not exists events(id integer primary key, name text, date text);
create table if not exists performances(id integer primary key, event_id integer, player_id integer,
  team text, team_placement integer, placement integer, before real, after real);
`);
try { db.exec('alter table players add column uuid text'); } catch {} // already there
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
function recalc() {
  transaction(() => {
    const rating = new Map(), count = new Map();
    db.prepare('select id from players').all().forEach(p => rating.set(p.id, CFG.START));
    const upd = db.prepare('update performances set before=?, after=? where id=?');
    for (const e of db.prepare('select id from events order by date, id').all()) {
      const perfs = db.prepare('select * from performances where event_id=?').all(e.id);
      const ch = computeEvent(perfs.map(p => ({ ...p, rating: rating.get(p.player_id) })));
      perfs.forEach((p, i) => {
        const b = rating.get(p.player_id), a = b + ch[i];
        rating.set(p.player_id, a);
        count.set(p.player_id, (count.get(p.player_id) || 0) + 1);
        upd.run(b, a, p.id);
      });
    }
    const up = db.prepare('update players set rating=?, events=? where id=?');
    rating.forEach((r, id) => up.run(r, count.get(id) || 0, id));
  })();
}

module.exports = { db, transaction, recalc, parseCsv };
