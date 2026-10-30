const express = require('express');
const q = require('./queries');
const { importEvent, renamePlayer, unmatched, linkPlayer, refreshNames } = require('./service');
const app = express();
const TOKEN = process.env.ADMIN_TOKEN || 'change-me';

app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const admin = (req, res, next) =>
  req.get('x-admin-token') === TOKEN ? next() : res.status(401).json({ error: 'Bad admin token' });
const found = (res, d) => (d ? res.json(d) : res.status(404).json({ error: 'Not found' }));

app.get('/api/leaderboard', (req, res) => res.json(q.leaderboard()));
app.get('/api/events', (req, res) => res.json(q.events()));
app.get('/api/events/:id', (req, res) => found(res, q.event(req.params.id)));
app.get('/api/players/:id', (req, res) => found(res, q.player(req.params.id)));

app.post('/api/import', admin, async (req, res) => {
  try {
    const { name, date, csv } = req.body;
    if (!name || !date || !csv) throw new Error('name, date and csv are required');
    res.json({ id: await importEvent(name, date, csv) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/rename', admin, (req, res) => {
  try { renamePlayer(req.body.old, req.body.new); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/unmatched', admin, (req, res) => res.json(unmatched()));

app.post('/api/link', admin, async (req, res) => {
  try { res.json({ id: await linkPlayer(req.body.player_id, req.body.uuid) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/refresh-names', admin, async (req, res) => res.json(await refreshNames()));
setInterval(() => refreshNames().catch(console.error), 24 * 60 * 60 * 1000); // daily

app.listen(process.env.PORT || 3000, () => console.log('Event Elo running on http://localhost:3000'));
