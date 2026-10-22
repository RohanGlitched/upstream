"""Join test: for a list of shortage episodes, print the resolved chain per manufacturing site with the
last Drug Quality Assurance inspection before the posting date (end date + classification + FMD-145 letter date),
any WL/injunction/import alert within 2 years before, and the first strong signal after.
Reads samples/chain_sites.csv (from 06_chain.py). Writes samples/join_test.csv and prints a markdown table.
Usage: python -I scripts/07_join_test.py "Generic 1" "Generic 2" ...
"""
import csv, sys, os, json, datetime as dt, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sitelib import *
insp = load_inspections(); acts = load_actions()
rows = list(csv.DictReader(open(P('samples/chain_sites.csv'), encoding='utf-8')))
H = list(csv.DictReader(open(P('samples/shortage_history_rows.csv'), encoding='utf-8')))
ep = {r['generic']: r for r in csv.DictReader(open(P('samples/shortage_episodes.csv'), encoding='utf-8'))}
out = []
for g in sys.argv[1:]:
    e = ep.get(g)
    if not e:
        print('NOT FOUND', g); continue
    T = d(e['min_posting_current'])
    hr = [h for h in H if h['generic'] == g and 'Current' in h['statuses'] and h['ndc']]
    rs = [r for r in rows if r['generic'] == g]
    mk = [r for r in rs if r['make'] == 'True']
    seen = set()
    n_ndc = len(set(h['ndc'] for h in hr)); n_spl = len(set(r['set_id'] for r in rs))
    for r in mk:
        key = (r['site'], r['fei'])
        if key in seen: continue
        seen.add(key)
        L = sorted([x for x in insp.get(r['fei'], []) if x['area'] == 'Drug Quality Assurance' and x['end'] and x['end'] < T], key=lambda x: x['end'])
        last = L[-1] if L else None
        A = [x for x in acts.get(r['fei'], []) if x['date'] and T - dt.timedelta(days=730) <= x['date'] < T]
        after = [x for x in json.loads(r['after']) if not x[0].startswith('recall')][:2]
        out.append(dict(drug=g, posted=str(T), n_ndc=n_ndc, n_spl=n_spl, labeler=r['labeler'], site=r['site'][:45], country=r['iso3'],
                        duns=r['duns'], fei=r['fei'], how=r['how'], ops=r['ops'],
                        last_dqa=f"{last['cls']} ended {last['end']} (letter {last['fmd145'] if last['fmd145'] not in ('', '-') else 'n/a'})" if last else '',
                        actions_2y=';'.join(f"{x['type']} {x['date']}" for x in A),
                        prior_2y=';'.join(f"{p[0]} {p[1]}" for p in json.loads(r['prior']) if not p[0].startswith(('recall', 'inspection_VAI')))[:120],
                        after=';'.join(f'{a[0]} {a[1]}' for a in after)))
with open(P('samples/join_test.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
cols = ['drug', 'posted', 'labeler', 'site', 'country', 'duns', 'fei', 'last_dqa', 'actions_2y', 'after']
print('| ' + ' | '.join(cols) + ' |'); print('|' + '---|' * len(cols))
for o in out:
    print('| ' + ' | '.join(str(o[c]).replace('|', '/') for c in cols) + ' |')
