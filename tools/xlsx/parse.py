"""Parse event tabs from MCC-style community stats workbooks.
Usage: python3 -I parse.py out.json  (reads all /mnt/user-data/uploads/*.xlsx)
Each event: players (name, total, rank), teams (name, per-game values), team standings, team assignment.
"""
import openpyxl, glob, os, re, json, sys, itertools

SKIP = re.compile(r'^(template|template \(tr\)|averages|final averages|overview|vods|game averages|relative performance|ch template|8 team template|team strength|records)$', re.I)

def txt(v):
    return '' if v is None else str(v).strip()

def num(v):
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().lstrip('#').replace(',', '')
    try: return float(s)
    except ValueError: return None

def norm(x):
    return re.sub(r'\s+', ' ', str(x)).strip().lower()

def parse_sheet(ws):
    G = [list(r) for r in ws.iter_rows(values_only=True, max_row=400, max_col=80)]
    cell = lambda r, c: G[r][c] if 0 <= r < len(G) and c < len(G[r]) else None
    hr = rc = None
    for r in range(min(10, len(G))):
        for c, v in enumerate(G[r]):
            if re.match(r'^individual rank', txt(v), re.I): hr, rc = r, c; break
        if hr is not None: break
    if hr is None:
        # individual-board-only layout: header "... Individual Leader..." in col B, rank|name|points below
        for r in range(min(10, len(G))):
            if re.search(r'individual lead', txt(cell(r, 1)), re.I):
                board = []
                for rr in range(r + 1, len(G)):
                    a, b, p = num(cell(rr, 1)), txt(cell(rr, 2)), num(cell(rr, 3))
                    if a is None or not b: break
                    board.append({'rank': int(a), 'name': b, 'points': p})
                pl = [{'name': b['name'], 'total': b['points'], 'rank': b['rank'], 'vals': []} for b in board]
                return {'header': txt(cell(r, 1)), 'games': [], 'players': pl, 'teams': [], 'standings': [], 'board': board, 'indiv_only': True}, None
        return None, 'no Individual Rank header'
    tc, pc = rc - 1, 1
    games = [(c, txt(cell(hr, c))) for c in range(pc + 1, tc) if txt(cell(hr, c))]
    ic = next((c for c in range(rc + 1, len(G[hr])) if txt(G[hr][c])), None)
    lbname = txt(cell(hr, ic)) if ic is not None else ''
    # individual leaderboard (rank | name | points) directly under the header
    board = []
    if ic is not None:
        for r in range(hr + 1, len(G)):
            a, b, p = num(cell(r, ic)), txt(cell(r, ic + 1)), num(cell(r, ic + 2))
            if a is None or not b: break
            board.append({'rank': int(a), 'name': b, 'points': p})
    standings = []
    if ic is not None:
        for r in range(hr + 1, len(G)):
            v = txt(cell(r, ic)).lower()
            if 'team' in v and any(w in v for w in ('standing', 'leaderboard', 'board', 'placement', 'ranking')):
                rr = r + 1
                while rr < len(G):
                    a, b, p = num(cell(rr, ic)), txt(cell(rr, ic + 1)), num(cell(rr, ic + 2))
                    if a is None or not b:
                        if standings or rr - r > 3: break
                        rr += 1; continue
                    standings.append({'rank': int(a), 'team': b, 'points': p}); rr += 1
                break
    tnames = {norm(s['team']) for s in standings}
    players, teamrows = [], []
    r = hr
    while r + 1 < len(G) and r - hr < 250:
        r += 1
        name = txt(cell(r, pc))
        if not name:
            if teamrows: break
            continue
        rank, tot = num(cell(r, rc)), num(cell(r, tc))
        vals = [num(cell(r, c)) for c, _ in games]
        if norm(name) in tnames:
            teamrows.append({'name': name, 'total': tot, 'vals': vals}); continue
        if teamrows: break
        if name.upper() in ('TEAMS', 'TEAM', 'OVERVIEW', 'PLAYER', 'IGN'): continue
        if name in ('-', '--') or re.fullmatch(r'player ?\d*', name, re.I): continue
        if rank is not None or tot is not None:
            players.append({'name': name, 'total': tot, 'rank': int(rank) if rank is not None else None, 'vals': vals})
    return {'header': lbname, 'games': [g for _, g in games], 'players': players, 'teams': teamrows,
            'standings': standings, 'board': board}, None

def assign(ev):
    """Assign players to teams: consecutive blocks whose per-game sums match a team row."""
    P, T = ev['players'], ev['teams']
    if not T: return 'no team rows'
    n, k = len(P), len(T)
    def match(block, t):
        hits = 0; miss = 0
        for gi in range(len(ev['games'])):
            s = [P[i]['vals'][gi] for i in block]
            tv = t['vals'][gi] if gi < len(t['vals']) else None
            if tv is None or any(x is None for x in s): continue
            if abs(sum(s) - tv) < 0.01: hits += 1
            else: miss += 1
        return hits
    # try equal blocks first
    if n % k == 0:
        sz = n // k
        used, ok = set(), True
        for b in range(k):
            block = list(range(b * sz, (b + 1) * sz))
            best = max(range(k), key=lambda j: (match(block, T[j]) if j not in used else -1, -abs(j - b)))
            if best in used or match(block, T[best]) == 0: ok = False; break
            used.add(best)
            for i in block: P[i]['team'] = T[best]['name']
        if ok: return None
    # unequal blocks: walk players, grow a block until it matches some unused team
    used, start = set(), 0
    for p in P: p.pop('team', None)
    while start < n:
        best = None  # (hits, end, team)
        for end in range(start + 1, min(n, start + 12) + 1):
            block = list(range(start, end))
            for j in range(k):
                if j in used: continue
                h = match(block, T[j])
                if h and (best is None or h >= best[0]): best = (h, end, j)
        if not best: return f'could not match players from #{start} ({P[start]["name"]})'
        h, end, j = best
        used.add(j)
        for i in range(start, end): P[i]['team'] = T[j]['name']
        start = end
    return None

if __name__ == '__main__':
    out = []
    for f in sorted(glob.glob('/mnt/user-data/uploads/*.xlsx')):
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        book = os.path.basename(f)[9:].rsplit('.', 1)[0]
        for s in wb.sheetnames:
            if SKIP.match(s.strip()): continue
            ev, err = parse_sheet(wb[s])
            if err: print(f'{book} | {s}: SKIP {err}'); continue
            ev['book'], ev['sheet'] = book, s
            ev['assign_error'] = assign(ev)
            out.append(ev)
            tsz = {}
            for p in ev['players']: tsz[p.get('team')] = tsz.get(p.get('team'), 0) + 1
            print(f"{book[:22]:22} | {s:24} | {ev['header'][:38]:38} | {len(ev['players'])}p {len(ev['teams'])}t st={len(ev['standings'])} sizes={sorted(set(tsz.values()))} {ev['assign_error'] or ''}")
    json.dump(out, open(sys.argv[1], 'w'), indent=1)
