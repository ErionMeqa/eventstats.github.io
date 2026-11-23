"""Read each team's fill colour from the sheets -> data/team-colors.json {event name: {team: '#rrggbb'}}"""
import openpyxl, json, re, sys, glob, os
parsed, manifest, out = sys.argv[1:4]
E = json.load(open(parsed))
M = json.load(open(manifest))
tab2name = {}
for m in M:
    t = re.search(r'tab "(.*?)"', m['source']).group(1); tab2name[t] = m['name']
tab2name['MCCR (NC)'] = 'MC Championship Rising'
res, miss = {}, []
books = {}
for f in glob.glob('/mnt/user-data/uploads/*.xlsx'):
    books[os.path.basename(f)[9:].rsplit('.', 1)[0]] = f
cache = {}
for e in E:
    s = e['sheet']
    if s not in tab2name or not e['teams']: continue
    b = e['book']
    if b not in cache: cache[b] = openpyxl.load_workbook(books[b])
    ws = cache[b][s]
    want = {t['name'] for t in e['teams']}
    got = {}
    for row in ws.iter_rows(min_row=1, max_row=300, min_col=2, max_col=2):
        c = row[0]; v = str(c.value).strip() if c.value is not None else ''
        if v in want and v not in got:
            fg = c.fill.fgColor if c.fill else None
            if fg is not None and fg.type == 'rgb' and isinstance(fg.rgb, str) and fg.rgb not in ('00000000', 'FFFFFFFF'):
                got[v] = '#' + fg.rgb[-6:].lower()
    if len(got) < len(want): miss.append((s, sorted(want - set(got))))
    res[tab2name[s]] = got
json.dump(res, open(out, 'w'), indent=1, ensure_ascii=False)
print(len(res), 'events with colours;', sum(len(v) for v in res.values()), 'teams')
for m in miss: print('missing', m)
