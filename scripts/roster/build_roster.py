#!/usr/bin/env python3
"""Offline roster + projection builder for Fantasy Five.

Inputs (cache dir, default /workspace/ff-cache):
  rtn/dash_2026_<tid>.json   RTN team dashboard (2026 roster with RTN gymnast ids + class year)
  rtn/ind_2026_12_<ev>.json  RTN individual event rankings, final regular-season week 12 (ave, RQS=NQS, high)
  sites/<tid>.html           official 2026-27 roster page for each team (see roster_sites.tsv)
  d1-teams.json              RTN D1 team list
Outputs: data/gymnasts.json, data/teams.json, data/demo/gymnasts-2026.json
Never invents numbers: anything not in a source is null.
"""
import json, re, sys, os, unicodedata, datetime as dt
from collections import Counter, defaultdict
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from parsers import parse
CACHE = sys.argv[1] if len(sys.argv) > 1 else '/workspace/ff-cache'
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
EVENTS = ['vault', 'bars', 'beam', 'floor']
EVFLAG = {'vault': 'vault', 'bars': 'bars', 'beam': 'beam', 'floor': 'floor'}

def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[’'`.]", '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()
def slug(s): return norm(s).replace(' ', '-')
YR = {'fr': 1, 'fy': 1, '1st': 1, 'freshman': 1, 'first year': 1, 'so': 2, '2nd': 2, 'sophomore': 2, 'jr': 3, '3rd': 3, 'junior': 3,
      'sr': 4, '4th': 4, 'senior': 4, 'gr': 5, '5th': 5, 'graduate': 5, 'graduate student': 5, 'fifth year': 5, 'fifth-year': 5, '6th': 6}
def yrnum(y):
    y = norm(y).replace('r ', '').replace('rs ', '').replace('redshirt ', '')
    return YR.get(y) or YR.get(y.split(' ')[0])
LABEL = {1: 'Fr.', 2: 'So.', 3: 'Jr.', 4: 'Sr.', 5: 'Gr.', 6: 'Gr.'}
def label(y):
    if not y: return None
    raw = str(y).strip()
    n = yrnum(raw)
    if n is None: return raw or None
    red = raw.lower().startswith(('r-', 'rs-', 'r ', 'redshirt'))
    return ('R-' if red else '') + LABEL[n]

teams = json.load(open(f'{CACHE}/d1-teams.json'))['teams']
sites = {l.split('\t')[0]: l.strip().split('\t')[1] for l in open(os.path.join(HERE, 'roster_sites.tsv'))}
dash = {}
for t in teams:
    p = f"{CACHE}/rtn/dash_2026_{t['tid']}.json"
    try: dash[t['tid']] = json.load(open(p))
    except Exception: dash[t['tid']] = None
# RTN rankings -> projections by gid
proj = defaultdict(dict); rank_rows = {}
PROJ_KEYS = EVENTS + ['aa']   # RTN event 5 = all-around
for i, ev in enumerate(PROJ_KEYS, 1):
    p = f'{CACHE}/rtn/ind_2026_12_{i}.json'
    if not os.path.exists(p): continue
    for r in json.load(open(p))['data']:
        f = lambda k: float(r[k]) if r.get(k) not in (None, '') else None
        proj[str(r['gid'])][ev] = {'avg': f('ave'), 'nqs': f('rqs'), 'high': f('high'), 'rank': r.get('rank')}
        rank_rows[str(r['gid'])] = r
# 2026 RTN rosters (D1)
rtn26 = {}  # gid -> person
for t in teams:
    d = dash[t['tid']]
    if not d: continue
    for g in d.get('roster') or []:
        gid = str(g['id'])
        rtn26[gid] = {'gid': gid, 'first': g['fname'].strip(), 'last': g['lname'].strip(), 'team': t['name'], 'tid': t['tid'],
                      'year': g.get('school_year'), 'events': [ev for ev in EVENTS if g.get(EVFLAG[ev])], 'hometown': g.get('hometown')}
rank_by_name = defaultdict(list)
for r in rank_rows.values(): rank_by_name[norm(r['fname'] + ' ' + r['lname'])].append(r)
by_team26 = defaultdict(list)
for p in rtn26.values(): by_team26[p['tid']].append(p)
name26 = defaultdict(list)
for p in rtn26.values(): name26[norm(p['first'] + ' ' + p['last'])].append(p)
last26 = defaultdict(list)
for p in rtn26.values(): last26[norm(p['last'])].append(p)

def match(first, last, tid):
    full = norm(first + ' ' + last)
    same = [p for p in by_team26.get(tid, []) if norm(p['first'] + ' ' + p['last']) == full]
    if same: return same[0], 'exact-team'
    cand = name26.get(full, [])
    if len(cand) == 1: return cand[0], 'exact-transfer'
    rk = rank_by_name.get(full, [])
    if len(rk) == 1:   # in the 2026 event rankings but not on a D1 RTN roster (e.g. a D2/D3 transfer)
        r = rk[0]
        return {'gid': str(r['gid']), 'first': r['fname'], 'last': r['lname'], 'team': r['team'], 'tid': r['tid'], 'year': None, 'events': [], 'hometown': None}, 'exact-ranking'
    # same team, same last name, first name prefix (Lexi/Alexis is not handled; Kate/Katherine prefix is)
    ln = [p for p in by_team26.get(tid, []) if norm(p['last']) == norm(last)]
    f1 = norm(first)
    pre = [p for p in ln if norm(p['first']).startswith(f1[:3]) or f1.startswith(norm(p['first'])[:3])]
    if len(pre) == 1: return pre[0], 'fuzzy-team'
    # hyphenated / compound last names on same team
    ln2 = [p for p in by_team26.get(tid, []) if norm(p['first']) == f1 and (norm(last) in norm(p['last']) or norm(p['last']) in norm(last))]
    if len(ln2) == 1: return ln2[0], 'fuzzy-team'
    return None, None

now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
people = []      # 2027 roster entries
team_out = []
for t in teams:
    tid = t['tid']; sid = str(tid)
    entry = {'id': slug(t['name']), 'name': t['name'], 'rtn_tid': tid, 'rtn_name': t['name'], 'conference': t.get('conference'),
             'roster_url': None, 'roster_source': None, 'roster_status': None, 'roster_count': 0, 'note': None}
    html_path = f'{CACHE}/sites/{sid}.html'
    site = []
    if os.path.exists(html_path):
        s = open(html_path, errors='ignore').read()
        kind, site = parse(s)
        entry['roster_url'] = f"https://{sites.get(sid)}"
        m = re.search(r'<link rel="canonical" href="([^"]+)"', s) or re.search(r'<meta property="og:url" content="([^"]+)"', s)
        if m: entry['roster_url'] = m.group(1)
        entry['roster_source'] = kind
    # dedupe
    seen = set(); site2 = []
    for x in site:
        k = norm(x['first'] + ' ' + x['last'])
        if not k or k in seen: continue
        seen.add(k); site2.append(x)
    site = site2
    # stale check: same-team returners whose listed class equals their 2026 RTN class => page still shows 2025-26
    same_cls = moved = 0
    for x in site:
        p, how = match(x['first'], x['last'], tid)
        if p and how != 'exact-transfer' and p['tid'] == tid and yrnum(x['year']) and p['year']:
            if yrnum(x['year']) == p['year']: same_cls += 1
            elif yrnum(x['year']) == p['year'] + 1: moved += 1
    stale = site and same_cls > moved
    use_site = bool(site) and not stale
    members = []
    if use_site:
        entry['roster_status'] = 'official-2026-27'
        for x in site:
            p, how = match(x['first'], x['last'], tid)
            members.append({'first': x['first'].strip(), 'last': x['last'].strip(), 'class_year': label(x['year']), 'hometown': x.get('hometown'),
                            'rtn': p, 'match': how})
    else:
        entry['roster_status'] = 'provisional-rtn-2026'
        entry['note'] = ('Official roster page still shows 2025-26' if stale else 'Official roster page could not be parsed') + \
            '; using the 2026 RTN roster minus 2026 seniors/graduate students. No 2026-27 freshmen or incoming transfers.'
        for p in by_team26.get(tid, []):
            if p['year'] and p['year'] >= 4: continue
            members.append({'first': p['first'], 'last': p['last'], 'class_year': LABEL.get((p['year'] or 0) + 1) if p['year'] else None,
                            'hometown': p.get('hometown'), 'rtn': p, 'match': 'rtn-2026-roster'})
    entry['stale_check'] = {'same_class_as_2026': same_cls, 'advanced_one_year': moved}
    for m_ in members: m_['team'] = t['name']; m_['team_id'] = entry['id']
    entry['roster_count'] = len(members)
    people.extend(members)
    team_out.append(entry)

# ids
def assign_ids(rows, key):
    cnt = Counter(slug(r['first'] + ' ' + r['last']) for r in rows)
    for r in rows:
        b = slug(r['first'] + ' ' + r['last'])
        r['id'] = b if cnt[b] == 1 else f"{b}-{slug(r[key])}"
# global id map keyed by RTN gid so 2026 demo ids == 2027 ids for the same person
assign_ids(people, 'team')
gid_to_id = {m['rtn']['gid']: m['id'] for m in people if m.get('rtn')}

def gym_record(m):
    p = m.get('rtn')
    pr = proj.get(p['gid']) if p else None
    rec = {'id': m['id'], 'name': f"{m['first']} {m['last']}", 'team': m['team'], 'team_id': m['team_id'],
           'class_year': m.get('class_year'), 'hometown': m.get('hometown'),
           'rtn_ids': [int(p['gid'])] if p else [], 'prev_team': p['team'] if p else None,
           'events': p['events'] if p and p['events'] else None,
           'proj': {ev: pr[ev] for ev in PROJ_KEYS if pr and ev in pr} or None}
    rec['projection_status'] = 'ranked' if rec['proj'] else ('unranked-2026' if p else 'none')
    if not p: rec['projection_note'] = 'No 2026 NCAA record found on Road to Nationals (freshman, or newcomer not matched).'
    elif not rec['proj']: rec['projection_note'] = 'On a 2026 RTN roster but not in the final 2026 event rankings (too few scores for an RQS).'
    return rec

gyms = [gym_record(m) for m in people]
gyms.sort(key=lambda g: (g['team'], g['name']))
cov = {'teams_total': len(teams), 'teams_with_roster': sum(1 for t in team_out if t['roster_count']),
       'teams_official_2026_27': sum(1 for t in team_out if t['roster_status'] == 'official-2026-27'),
       'teams_provisional': [t['name'] for t in team_out if t['roster_status'] != 'official-2026-27'],
       'gymnasts': len(gyms), 'with_projection': sum(1 for g in gyms if g['proj']),
       'with_aa_projection': sum(1 for g in gyms if g['proj'] and 'aa' in g['proj']),
       'no_ncaa_history': sum(1 for g in gyms if g['projection_status'] == 'none'),
       'unranked_2026': sum(1 for g in gyms if g['projection_status'] == 'unranked-2026'),
       'freshmen_listed': sum(1 for g in gyms if (g['class_year'] or '').endswith('Fr.'))}
meta = {'generated_at': now, 'season': 2027,
        'sources': {'rosters': 'Official 2026-27 team roster pages (URLs in data/teams.json)',
                    'rtn_ids_and_2026_rosters': 'https://www.roadtonationals.com/api/women/dashboard/2026/<team_id>',
                    'projections': 'https://www.roadtonationals.com/api/women/results/2026/12/1/<1-4 = VT/UB/BB/FX, 5 = AA> (final 2026 regular-season individual rankings: ave, RQS, high)'},
        'projection_fields': {'avg': '2026 season average on the event (RTN)', 'nqs': '2026 final regular-season RQS (RTN), used as NQS',
                              'high': '2026 season high', 'rank': 'RTN national rank among all divisions, week 12'},
        'coverage': cov}
os.makedirs(f'{ROOT}/data/demo', exist_ok=True)
json.dump({**meta, 'gymnasts': gyms}, open(f'{ROOT}/data/gymnasts.json', 'w'), separators=(',', ':'))
json.dump({'generated_at': now, 'source': 'RTN D1 team list (2026 final rankings, div = "Div I") + official roster pages', 'teams': team_out}, open(f'{ROOT}/data/teams.json', 'w'), indent=1)
# DEMO roster: every 2026 D1 RTN roster, same ids as 2027 where the person is on a 2027 roster
demo = []
for p in rtn26.values():
    demo.append({'first': p['first'], 'last': p['last'], 'team': p['team'], 'gid': p['gid']})
cnt = Counter(slug(d['first'] + ' ' + d['last']) for d in demo)
used = set(gid_to_id.values())
drecs = []
for d in demo:
    i = gid_to_id.get(d['gid'])
    if not i:
        b = slug(d['first'] + ' ' + d['last'])
        i = b if cnt[b] == 1 and b not in used else f"{b}-{slug(d['team'])}-2026"
    pr = proj.get(d['gid'])
    drecs.append({'id': i, 'name': f"{d['first']} {d['last']}", 'team': d['team'], 'team_id': slug(d['team']), 'rtn_ids': [int(d['gid'])],
                  'proj': {ev: pr[ev] for ev in PROJ_KEYS if pr and ev in pr} or None})
json.dump({'generated_at': now, 'season': 'demo', 'demo': True, 'note': 'DEMO only: 2026 D1 rosters from Road to Nationals.', 'gymnasts': drecs},
          open(f'{ROOT}/data/demo/gymnasts-2026.json', 'w'), separators=(',', ':'))
print(json.dumps(cov, indent=1))
for t in team_out: print(f"{t['name']:<22} {t['roster_status']:<22} {t['roster_count']:>3} {t['roster_source']} {t['stale_check']}")
mh = Counter(m['match'] for m in people); print(mh)
