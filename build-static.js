// Builds a static copy of the site (plain HTML + JSON files) that GitHub Pages can serve.
// Usage: npm run build            -> writes to ./docs
//        node build-static.js docs --domain eventstats.live
const fs = require('fs'), path = require('path');
const q = require('./queries');
const { db, recalc } = require('./db');

// Pass 1: canon only (events in data/noncanon.txt don't change ratings). Keep its numbers for the "Canon only" switch.
const NC = q.noncanonIds();
recalc(undefined, NC);
const canonLB = q.leaderboard(NC);
const canonPerf = new Map(db.prepare('select id,before,after from performances').all().map(r => [r.id, r]));
const canonPlayer = new Map(db.prepare('select id,rating,events from players').all().map(r => [r.id, r]));
// Pass 2: every event. This is what stays in elo.db.
recalc(); // replays every event so inactivity decay is up to date as of today
const perfId = db.prepare('select id from performances where event_id=? and player_id=?');
const addCanon = (o, eventId, playerId) => { const c = canonPerf.get(perfId.get(eventId, playerId).id);
  if (NC.has(eventId)) { o.noncanon = true; o.canon_before = o.canon_after = c.before; } else { o.canon_before = c.before; o.canon_after = c.after; } };

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'docs';
const di = args.indexOf('--domain');
const domain = di >= 0 ? args[di + 1] : null;

fs.rmSync(path.join(out, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
const write = (f, d) => fs.writeFileSync(path.join(out, 'data', f), JSON.stringify(d));

write('leaderboard.json', q.leaderboard());
write('leaderboard-canon.json', canonLB);
write('events.json', q.events().map(e => NC.has(e.id) ? { ...e, noncanon: true } : e));
const eids = db.prepare('select id from events').all(), pids = db.prepare('select id from players where events>0').all();
// real team colours per event (data/team-colors.json, read from the stats sheets); the page falls back to guessing from the name
const colorsFile = path.join(__dirname, 'data', 'team-colors.json');
const COLORS = fs.existsSync(colorsFile) ? JSON.parse(fs.readFileSync(colorsFile, 'utf8')) : {};
const colorOf = (event, team) => (team && COLORS[event] && COLORS[event][team]) || undefined;
eids.forEach(e => {
  const d = q.event(e.id);
  (d.teams || []).forEach(t => { t.color = colorOf(d.event.name, t.name); });
  (d.players || []).forEach(p => { p.color = colorOf(d.event.name, p.team); addCanon(p, e.id, p.id); delete p.noncanon; });
  if (NC.has(e.id)) d.event.noncanon = true;
  write(`event-${e.id}.json`, d);
});
pids.forEach(p => {
  const d = q.player(p.id);
  (d.history || []).forEach(h => { h.color = colorOf(h.name, h.team); addCanon(h, h.event_id, p.id); });
  const c = canonPlayer.get(p.id); d.player.canon_rating = c.rating; d.player.canon_events = c.events;
  write(`player-${p.id}.json`, d);
});

let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
html = html.replace('<script>', '<script>window.STATIC = true;</script>\n<script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
if (domain) fs.writeFileSync(path.join(out, 'CNAME'), domain + '\n');
console.log(`Built ${out}/ with ${eids.length} events (${NC.size} non-canon) and ${pids.length} players.${domain ? ' Domain: ' + domain : ''}`);
process.exit(0);
