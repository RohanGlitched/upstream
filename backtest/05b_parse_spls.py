"""Parse cached SPL XML (raw/spl/*.xml) into samples/spl_establishments.csv. No network.
Roles (case/control) come from the set lists written by 05_fetch_spls.py (samples/spl_roles.csv, or the
existing spl_establishments.csv). Adds fallback rows from label text ("Manufactured by: ...", "Made in X")
and from the Drugs@FDA application sponsor when the SPL has no establishment section.
Usage: python -I scripts/05b_parse_spls.py
"""
import csv, os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spl_establishments as SE
from sitelib import P
roles = {}
src = P('samples/spl_roles.csv') if os.path.exists(P('samples/spl_roles.csv')) else P('samples/spl_establishments.csv')
for r in csv.DictReader(open(src, encoding='utf-8')):
    roles.setdefault(r['set_id'], r['role'])
# set_id -> application numbers (NDC directory) -> Drugs@FDA sponsor
N = json.load(open(P('raw/openfda/drug-ndc-0001-of-0001.json'), encoding='utf-8'))['results']
apps = collections.defaultdict(set)
for r in N:
    for s in r['openfda'].get('spl_set_id', []):
        if r.get('application_number'): apps[s].add(r['application_number'])
F = json.load(open(P('raw/openfda/drug-drugsfda-0001-of-0001.json'), encoding='utf-8'))['results']
sponsor = {r['application_number']: r.get('sponsor_name', '') for r in F}
rows = []
for sid, role in roles.items():
    f = P('raw/spl', sid + '.xml')
    if not os.path.exists(f):
        rows.append([role, sid, '', '', '', '', '', '', '', 'FETCH_FAILED', '']); continue
    try:
        d = SE.parse(f)
    except Exception as e:
        rows.append([role, sid, '', '', '', '', '', '', '', 'PARSE_ERR', str(e)[:60]]); continue
    lab = d['labeler'] or {}
    base = [role, sid, d['title'], d['effective'], lab.get('name'), lab.get('duns')]
    sp = '|'.join(sorted(set(sponsor.get(a, '') for a in apps.get(sid, []) if sponsor.get(a))))
    for e in d['establishments']:
        rows.append(base + [e['name'], e['duns'], ';'.join(e['operations']), 'spl_establishment', ''])
    if not d['establishments']:
        tm = [t for t in d['text_manufacturers'] if not t.startswith('MADE_IN:')]
        mi = [t[8:] for t in d['text_manufacturers'] if t.startswith('MADE_IN:')]
        for t in tm:
            rows.append(base + [t.split(',')[0][:100], '', 'MANUFACTURE', 'label_text', t[:160]])
        if sp and not tm:
            for s in sp.split('|'):
                rows.append(base + [s, '', 'MANUFACTURE', 'drugsfda_sponsor', 'made_in=' + '|'.join(mi)])
        if not tm and not sp:
            rows.append(base + ['', '', '', 'NO_SITE_INFO', 'made_in=' + '|'.join(mi)])
with open(P('samples/spl_establishments.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh)
    w.writerow(['role', 'set_id', 'title', 'effective', 'labeler', 'labeler_duns', 'establishment', 'est_duns', 'operations', 'source', 'note'])
    w.writerows(rows)
per = collections.defaultdict(set)
for r in rows: per[(r[0], r[1])].add(r[9])
c = collections.Counter()
for (role, sid), s in per.items():
    c[(role, 'spl_establishment' if 'spl_establishment' in s else 'label_text' if 'label_text' in s else 'drugsfda_sponsor' if 'drugsfda_sponsor' in s else sorted(s)[0])] += 1
print('SPLs by best site source:', sorted(c.items()))
