// Usage: node import.js results.csv "Event name" 2026-10-11
const fs = require('fs');
const { importEvent } = require('./service');
const [file, name, date] = process.argv.slice(2);
if (!file || !name || !date) { console.log('Usage: node import.js file.csv "Event name" YYYY-MM-DD'); process.exit(1); }
importEvent(name, date, fs.readFileSync(file, 'utf8'))
  .then(id => console.log('Imported event id', id))
  .catch(e => { console.error(e.message); process.exit(1); });
