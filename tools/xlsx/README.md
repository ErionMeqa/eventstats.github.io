# Importing the community stats workbooks (.xlsx)

`parse.py` reads every event tab of the MCC-style stats workbooks (per-player game table, team rows,
individual + team leaderboards) and works out each player's team by matching per-game point sums.
`convert.py` writes one CSV per event plus `events.json` into `data/sheets/`, ready for `node seed.js data/sheets`.

```
pip install openpyxl
python3 tools/xlsx/parse.py parsed.json            # reads /mnt/user-data/uploads/*.xlsx; edit the glob for your folder
python3 tools/xlsx/convert.py parsed.json tools/xlsx/dates.tsv tools/xlsx/estimated-dates.tsv data/sheets
node seed.js data/sheets && npm run resolve && npm run build
```

Dates: MCC from Wikipedia's list of events, Block Wars 1-10 and Chillars 13-24 from the sheets' Overview tabs,
most others from minecrafteventelo.vercel.app player histories and the series wikis (`dates.tsv`).
17 events had no findable date; `estimated-dates.tsv` places them between their neighbouring tabs
(the tabs are in chronological order) and `events.json` marks them with `"date_estimated": true`.
