// Mojang lookups with a cache, spacing between requests, and back-off when rate limited.
const { db } = require('./db');
const API = process.env.MOJANG_API || 'https://api.mojang.com';
const SESSION = process.env.SESSION_API || 'https://sessionserver.mojang.com';
const SPACING = +process.env.MOJANG_SPACING_MS || 1100; // ms between requests
const DAY = 864e5;

db.exec('create table if not exists mojang_cache(name text primary key collate nocase, uuid text, fetched integer)');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let last = 0, blockedUntil = 0;

async function get(url, tries = 0) {
  const wait = last + SPACING - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url);
  if (res.status === 404 || res.status === 204) return null;
  if (res.status === 429) {
    if (tries >= 2) {
      blockedUntil = Date.now() + 10 * 60 * 1000; // stop asking for 10 minutes
      throw new Error('Mojang rate limit');
    }
    const secs = Math.min(Number(res.headers.get('retry-after')) || 60, 120);
    console.warn(`Mojang rate limit hit, waiting ${secs}s before retrying...`);
    await sleep(secs * 1000);
    return get(url, tries + 1);
  }
  if (!res.ok) throw new Error('Mojang error ' + res.status);
  return res.json();
}

const normUuid = s => {
  const u = String(s || '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(u) ? u : null;
};

// Current owner of an IGN -> uuid (or null). Failures return null and are not cached.
// Set SKIP_MOJANG=1 to skip lookups entirely (players can be linked later with `npm run resolve`).
async function lookupName(name) {
  if (process.env.SKIP_MOJANG) return null;
  const c = db.prepare('select uuid, fetched from mojang_cache where name=?').get(name);
  if (c && Date.now() - c.fetched < (c.uuid ? 30 : 1) * DAY) return c.uuid;
  if (Date.now() < blockedUntil) return null; // rate limited recently: don't wait again for every name
  try {
    const d = await get(`${API}/users/profiles/minecraft/${encodeURIComponent(name)}`);
    const uuid = d ? normUuid(d.id) : null;
    db.prepare('insert or replace into mojang_cache values(?,?,?)').run(name, uuid, Date.now());
    return uuid;
  } catch (e) {
    if (Date.now() < blockedUntil) console.warn('Mojang is rate limiting this connection: skipping lookups for now. Players are imported without UUIDs; run `npm run resolve` later to link them.');
    else console.warn(`Lookup failed for ${name}: ${e.message}`);
    return null;
  }
}

// uuid -> current IGN (or null)
async function lookupUuid(uuid) {
  const d = await get(`${SESSION}/session/minecraft/profile/${uuid}`);
  return d ? d.name : null;
}

module.exports = { lookupName, lookupUuid, normUuid };
