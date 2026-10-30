// Builds a static copy of the site (plain HTML + JSON files) that GitHub Pages can serve.
// Usage: npm run build            -> writes to ./docs
//        node build-static.js docs --domain eventstats.live
const fs = require('fs'), path = require('path');
const q = require('./queries');
const { db } = require('./db');

const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || 'docs';
const di = args.indexOf('--domain');
const domain = di >= 0 ? args[di + 1] : null;

fs.rmSync(path.join(out, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });
const write = (f, d) => fs.writeFileSync(path.join(out, 'data', f), JSON.stringify(d));

write('leaderboard.json', q.leaderboard());
write('events.json', q.events());
const eids = db.prepare('select id from events').all(), pids = db.prepare('select id from players where events>0').all();
eids.forEach(e => write(`event-${e.id}.json`, q.event(e.id)));
pids.forEach(p => write(`player-${p.id}.json`, q.player(p.id)));

let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
html = html.replace('<script>', '<script>window.STATIC = true;</script>\n<script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
if (domain) fs.writeFileSync(path.join(out, 'CNAME'), domain + '\n');
console.log(`Built ${out}/ with ${eids.length} events and ${pids.length} players.${domain ? ' Domain: ' + domain : ''}`);
process.exit(0);
