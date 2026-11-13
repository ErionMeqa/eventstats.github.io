"""Turn parsed.json (from parse.py) into data/sheets/*.csv + events.json for seed.js.
Usage: python3 -I convert.py parsed.json dates.tsv estimated.tsv outdir
"""
import json, sys, re, os, csv, io

parsed, dates_f, est_f, out = sys.argv[1:5]
E = json.load(open(parsed))
D = dict(l.rstrip('\n').split('\t')[:2] for l in open(dates_f) if l.strip())
EST = {l.split('\t')[0]: l.rstrip('\n').split('\t')[1:] for l in open(est_f) if l.strip()}

MCC = {  # en.wikipedia.org/wiki/MC_Championship list of champions (MCC 26 corrected to Oct 22)
 'MCC 1':'2019-11-17','MCC 2':'2020-02-09','MCC 3':'2020-03-14','MCC 4':'2020-04-18','MCC 5':'2020-05-16',
 'MCC 6':'2020-06-13','MCC 7':'2020-07-18','MCC 8':'2020-08-15','MCC 9':'2020-09-12','MCC 10':'2020-09-26',
 'MCC 11':'2020-10-24','MCC 12':'2020-11-14','MCCJJ (NC)':'2020-12-05','MCC 13':'2020-12-12','MCC 14':'2021-05-29',
 'MCCP21':'2021-06-26','MCC 15':'2021-07-24','MCC 16':'2021-08-28','MCC 17':'2021-09-18','MCCR (NC)':'2021-10-02',
 'MCC 18':'2021-10-23','MCCAS':'2021-11-13','MCC 19':'2021-12-11','MCC 20':'2022-03-26','MCC 21':'2022-04-30',
 'MCC 22':'2022-05-28','MCCP22':'2022-06-18','MCC 23':'2022-07-23','MCC 24':'2022-08-22','MCC 25':'2022-09-24',
 'MCC 26':'2022-10-22','MCC 27 (U)':'2022-11-12','MCC 28':'2022-12-03','MCC 29':'2023-03-18','MCCAF':'2023-04-01',
 'MCC 30':'2023-04-29','MCC 31':'2023-05-20','MCCP23':'2023-06-10','MCC 32':'2023-07-15','MCC 33':'2023-08-05',
 'MCCR2 (NC)':'2023-08-26','MCC 34':'2023-09-16','MCCTR':'2023-10-20','MCCP':'2023-11-11','MCC 35':'2023-12-09',
 'MCCS4KO (36)':'2024-05-04','MCCP24':'2024-06-01','MCCTR2':'2024-06-30','MCCEC':'2024-07-27','MCCR3':'2024-09-07',
 'MCCTR3':'2024-09-21','MCCHH (37)':'2024-10-26','MCCP2':'2024-12-07','MCCBC (38)':'2025-05-03',
 'MCCCTW (TR4)':'2025-06-01','MCCMET':'2025-06-14','MCCP25':'2025-06-28','MCCBG (39)':'2025-09-13',
 'MCCTCC (TR5)':'2025-10-19','MCCMU (40)':'2025-11-15','MCCSN (41)':'2025-12-13','MCCDD (42)':'2026-02-14',
 'MCCSB (43)':'2026-03-21','MCCHT':'2026-04-12','MCCPG (TR6)':'2026-05-31','MCCP26':'2026-06-27',
 'MCCHS':'2026-08-22','MCCFS (44)':'2026-09-05','MCCBW (45)':'2026-10-10'}
OVERVIEW = {  # Overview tabs of the Block Wars and Chillars sheets
 'BW1':'2022-11-19','BW2':'2022-12-10','BW3':'2023-01-28','BW4':'2023-03-11','BW5':'2023-04-15','BW6':'2023-05-13',
 'BW7':'2023-07-22','BW8':'2023-10-28','BW9':'2023-12-02','BW10':'2024-01-20',
 'CH^13':'2023-05-13','CH^14':'2023-06-17','CH^15':'2023-09-23','CH^16':'2023-11-04','CH^RE':'2024-06-22',
 'CH^17':'2024-08-31','CH^18':'2024-10-12','CH^19':'2024-11-16','CH^20':'2024-12-21','CH^UD':'2025-02-08',
 'CH^21':'2025-10-04','CH^22':'2025-12-20','CH^BB':'2026-03-28','CH^23':'2026-04-25','CH^24':'2026-05-23'}
SKIP = {'MCCAZ (TR7)': 'empty template (all scores 0), event not played yet',
        'MCCR (NC)': 'already in data/real as "MC Championship Rising"'}

def name_of(e):
    s, h, b = e['sheet'], re.sub(r'\s*-\s*Indiv.*$', '', e['header']).strip(), e['book']
    if b.startswith('MasterGarf'):
        if s == 'MCCMET': return 'MC Championship: Magenta eTrophy'
        if s == 'MCC 27 (U)': return 'MC Championship 27: Underdogs'
        m = re.match(r'MCC:?\s*(.*)', h)
        rest = m.group(1)
        return 'MC Championship ' + rest if re.match(r'^\d', rest) else 'MC Championship: ' + rest
    if b.startswith('Block_Wars'):
        fixed = {'BWP23 (NC)': 'Block Wars Pride 2023', 'BWR (NC)': 'Block Wars Rookies', 'BWR2 (NC)': 'Block Wars Rookies 2',
                 'BWR3 (NC)': 'Block Wars Rookies 3', 'BWCCOTR': 'Block Wars Twitch Rivals Charity Challenge',
                 'BWH (NC)': 'Block Wars Hispano', 'BWB (NC)': 'Block Wars Brawl', 'BWFB': 'Block Wars x Feinberg',
                 'BWM (NC)': 'Block Wars x Movember', 'BWCC (NC)': 'Block Wars CC', 'BWM26': 'Block Wars x Movember 2026'}
        if s in fixed: return fixed[s]
        m = re.match(r'BW(\d+)$', s)
        if m: return f'Block Wars {m.group(1)}'
        return h.replace('BW:', 'Block Wars:').replace('BW ', 'Block Wars ')
    if b.startswith('MC_Mayhem'):
        return {'MM Birthday': 'MC Mayhem Birthday Bonkers 2023', 'MMBB24': 'MC Mayhem Birthday Bonkers 2024',
                'MMP24': 'MC Mayhem Pride 2024'}.get(s, h)
    if b.startswith('MC_Mania'):
        return {'Womania': 'MC Mania: Womania', 'Mania P24': 'MC Mania Pride 2024'}.get(s, h)
    if b.startswith('Blissful'):
        return {'BCRB': 'Blissful Championship Rebirth'}.get(s, 'Blissful Championship ' + s[2:])
    if b.startswith('Biome'):
        return {'BB2': 'Biome Battle 2', 'BBM2': 'Biome Battle Mini 2', 'BB3': 'Biome Battle 3', 'BB4': 'Biome Battle 4',
                'BBWI': 'Biome Battle Wolfeei Invitational', 'BBTW': 'Biome Battle x The Wheel',
                'BBM3': 'Biome Battle Mini 3', 'BBP25': 'Biome Battle Pride 2025'}[s]
    if 'Chillars' in b:
        m = re.match(r'CH\^(\d+)$', s)
        if m: return f'Chillars Championship {m.group(1)}'
        fixed = {'CH^RE': 'Chillars Championship Rewind', 'CH^UD': 'Chillars Championship Underdogs',
                 'CH^BB': 'Chillars Championship BB', 'CH^PR': 'Chillars Championship Pride',
                 'CH^OO': 'Chillars Championship OO'}
        if s in fixed: return fixed[s]
        return 'Chillars Championship x ' + re.sub(r'^CH(\s*x\s*|\^)', '', s)
    if b.startswith('Pandoras_Box__Meow'): return "Pandora's Box x Meow Mayhem"
    if b.startswith('Pandoras_Box_Comm'):
        rest = re.sub(r'^PB\s*[xX]\s*', '', s)
        rest = {'CD & TR': 'Cdawg & ThatzRed', 'RoN4A': 'Ready or Not 4A', 'RoN4B': 'Ready or Not 4B',
                'RoN4C': 'Ready or Not 4C', 'Aries Birthday': "Aries' Birthday"}.get(rest, rest)
        return "Pandora's Box x " + rest
    raise ValueError(s)

def clean(n):
    return re.sub(r'\s*\((anchor|a)\)\s*$', '', n, flags=re.I).strip()

os.makedirs(out, exist_ok=True)
manifest, used, report = [], set(), []
for e in E:
    s = e['sheet']
    if s in SKIP: report.append(f'SKIP {s}: {SKIP[s]}'); continue
    name = name_of(e)
    notes, est = [], None
    date = MCC.get(s) or OVERVIEW.get(s) or D.get(s)
    src = 'MC Championship (Wikipedia)' if s in MCC else 'Overview tab' if s in OVERVIEW else 'minecrafteventelo.vercel.app / event wikis' if s in D else None
    if not date and s in EST:
        date, why = EST[s]; est = why
        notes.append(f'DATE ESTIMATED ({why})'); src = 'estimated'
    if not date: report.append(f'NO DATE {s}'); continue
    tplace = {re.sub(r'\s+', ' ', t['team']).strip().lower(): t['rank'] for t in e['standings']}
    rows, seen = [], set()
    for p in e['players']:
        n = clean(p['name'])
        if '/' in n:
            first = n.split('/')[0].strip()
            notes.append(f'"{n}" was a shared slot; credited to {first}')
            n = first
        if n.lower() in seen: notes.append(f'duplicate {n} dropped'); continue
        seen.add(n.lower())
        team = p.get('team') or ''
        tp = tplace.get(team.lower(), '') if team else ''
        if team and tp == '': notes.append(f'no standing for team {team}')
        rows.append((n, team, tp, p['rank']))
    if e.get('indiv_only'): notes.append('individual standings only: the sheet has no team rosters')
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower().replace("'", '')).strip('-')
    while slug in used: slug += '-2'
    used.add(slug)
    buf = io.StringIO(); w = csv.writer(buf, lineterminator='\n')
    w.writerow(['player', 'team', 'team_placement', 'individual_placement'])
    for r in sorted(rows, key=lambda r: (r[2] if r[2] != '' else 99, r[1], r[3])): w.writerow(r)
    open(os.path.join(out, slug + '.csv'), 'w').write(buf.getvalue())
    manifest.append({'file': slug + '.csv', 'name': name, 'date': date,
                     'source': f"{e['book'].replace('_', ' ')} / tab \"{s}\"; date: {src}",
                     'notes': '; '.join(dict.fromkeys(notes)) + ('' if notes else f"{len(rows)} players, {len(e['standings'])} teams")})
    if est: manifest[-1]['date_estimated'] = True
manifest.sort(key=lambda m: (m['date'], m['name']))
json.dump(manifest, open(os.path.join(out, 'events.json'), 'w'), indent=2, ensure_ascii=False)
for r in report: print(r)
print(len(manifest), 'events written,', sum(1 for m in manifest if m.get('date_estimated')), 'with estimated dates')
# order check: within each workbook, dates should follow tab order
by = {}
for e in E:
    s = e['sheet']
    d = MCC.get(s) or OVERVIEW.get(s) or D.get(s) or (EST.get(s) or [None])[0]
    if d and s not in SKIP: by.setdefault(e['book'], []).append((s, d))
for b, L in by.items():
    for (s1, d1), (s2, d2) in zip(L, L[1:]):
        if d2 < d1: print(f'ORDER {b}: {s1} {d1} > {s2} {d2}')
