"""Resolve shortage NDCs -> SPL set IDs -> DailyMed SPL XML -> establishments.
Usage: python -I scripts/05_fetch_spls.py [--controls N]
Reads samples/shortage_history_rows.csv, raw/openfda/drug-ndc-0001-of-0001.json, raw/openfda/drug-shortages-*.json
Writes samples/ndc_to_setid.csv, samples/spl_establishments.csv; caches XML in raw/spl/
--controls N: also sample N Rx ANDA/NDA/BLA products never seen in the shortage list (seeded random), same form mix.
"""
import csv, json, os, sys, time, random, urllib.request, urllib.error, concurrent.futures as cf, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spl_establishments as SE
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(BASE, *a)
UA = {'User-Agent': 'upstream-research/0.1 (hackathon data feasibility)'}
def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(2 * (i + 1))
        except Exception: time.sleep(2 * (i + 1))
    return None
N = json.load(open(P('raw/openfda/drug-ndc-0001-of-0001.json'), encoding='utf-8'))['results']
pn = {r['product_ndc']: r for r in N}
pk = {p['package_ndc']: r for r in N for p in r.get('packaging', [])}
S = json.load(open(P('raw/openfda/drug-shortages-0001-of-0001.json'), encoding='utf-8'))['results']
sh_set = {s['package_ndc']: s['openfda']['spl_set_id'][0] for s in S if s.get('openfda', {}).get('spl_set_id')}
H = list(csv.DictReader(open(P('samples/shortage_history_rows.csv'), encoding='utf-8')))
ndcs = sorted(set(h['ndc'] for h in H if h['ndc'] and 'Current' in h['statuses']))
res = {}
miss = []
for n in ndcs:
    r = pk.get(n) or pn.get('-'.join(n.split('-')[:2]))
    if r and r['openfda'].get('spl_set_id'): res[n] = (r['openfda']['spl_set_id'][0], 'ndc_directory', r['labeler_name'])
    elif n in sh_set: res[n] = (sh_set[n], 'openfda_shortages', '')
    else: miss.append(n)
print('ndcs', len(ndcs), 'resolved locally', len(res), 'to DailyMed lookup', len(miss))
def dm_lookup(n):
    b = get(f'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?ndc={n}')
    try: d = json.loads(b)['data'] if b else []
    except Exception: d = []
    return n, d
with cf.ThreadPoolExecutor(4) as ex:
    for n, d in ex.map(dm_lookup, miss):
        if d: res[n] = (d[0]['setid'], 'dailymed_ndc', d[0]['title'][-80:])
print('resolved total', len(res))
with open(P('samples/ndc_to_setid.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['package_ndc', 'set_id', 'source', 'labeler_or_title']); [w.writerow([n, *v]) for n, v in sorted(res.items())]
sets = {v[0]: 'case' for v in res.values()}
if '--controls' in sys.argv:
    k = int(sys.argv[sys.argv.index('--controls') + 1])
    shortage_generics = set(h['generic'].split()[0].lower() for h in H)
    shortage_labelprods = set('-'.join(n.split('-')[:2]) for n in ndcs)
    pool = [r for r in N if r.get('marketing_category') in ('ANDA', 'NDA', 'BLA', 'NDA AUTHORIZED GENERIC') and r['product_type'] == 'HUMAN PRESCRIPTION DRUG'
            and r['product_ndc'] not in shortage_labelprods and r.get('generic_name') and r['generic_name'].split()[0].lower() not in shortage_generics
            and r['openfda'].get('spl_set_id') and 'repack' not in r['labeler_name'].lower()]
    random.seed(42); pick = random.sample(pool, k)
    for r in pick: sets.setdefault(r['openfda']['spl_set_id'][0], 'control')
    print('control pool', len(pool), 'picked', k)
os.makedirs(P('raw/spl'), exist_ok=True)
def fetch(sid):
    f = P('raw/spl', sid + '.xml')
    if os.path.exists(f) and os.path.getsize(f) > 500: return sid, True
    b = get(f'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{sid}.xml')
    if b: open(f, 'wb').write(b); return sid, True
    return sid, False
t0 = time.time()
with cf.ThreadPoolExecutor(4) as ex:
    ok = dict(ex.map(fetch, sorted(sets)))
print('spl fetched', sum(ok.values()), 'of', len(sets), 'in', round(time.time() - t0), 's')
rows = []
for sid, role in sets.items():
    if not ok.get(sid): rows.append([role, sid, '', '', '', '', '', '', '', 'FETCH_FAILED']); continue
    try: d = SE.parse(P('raw/spl', sid + '.xml'))
    except Exception as e: rows.append([role, sid, '', '', '', '', '', '', '', 'PARSE_ERR ' + str(e)[:60]]); continue
    lab = d['labeler'] or {}
    if not d['establishments']: rows.append([role, sid, d['title'], d['effective'], lab.get('name'), lab.get('duns'), '', '', '', 'NO_ESTABLISHMENTS'])
    for e in d['establishments']:
        rows.append([role, sid, d['title'], d['effective'], lab.get('name'), lab.get('duns'), e['name'], e['duns'], ';'.join(e['operations']), ''])
with open(P('samples/spl_establishments.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['role', 'set_id', 'title', 'effective', 'labeler', 'labeler_duns', 'establishment', 'est_duns', 'operations', 'note']); w.writerows(rows)
c = collections.Counter(r[9] or 'ok' for r in rows); print('establishment rows', len(rows), c)
