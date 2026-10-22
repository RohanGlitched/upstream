"""Add a stratified control sample (e.g. injectables) to samples/spl_roles.csv and fetch their SPL XML.
Controls = Rx ANDA/NDA/BLA products whose product NDC and first generic word never appear in the shortage history.
Usage: python -I scripts/05d_add_controls.py N injectable|oral [seed]
Then re-run 05b_parse_spls.py and 06_chain.py.
"""
import csv, json, os, sys, random, urllib.request, concurrent.futures as cf
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(B, *a)
k, stratum = int(sys.argv[1]), sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 99
N = json.load(open(P('raw/openfda/drug-ndc-0001-of-0001.json'), encoding='utf-8'))['results']
H = list(csv.DictReader(open(P('samples/shortage_history_rows.csv'), encoding='utf-8')))
sg = set(h['generic'].split()[0].lower() for h in H)
sp = set('-'.join(h['ndc'].split('-')[:2]) for h in H if h['ndc'])
roles = list(csv.DictReader(open(P('samples/spl_roles.csv'), encoding='utf-8')))
have = set(r['set_id'] for r in roles)
def is_inj(r):
    return 'INJECT' in (r.get('dosage_form') or '').upper() or any(x in ('INTRAVENOUS', 'INTRAMUSCULAR', 'SUBCUTANEOUS') for x in r.get('route', []))
pool = [r for r in N if r.get('marketing_category') in ('ANDA', 'NDA', 'BLA', 'NDA AUTHORIZED GENERIC')
        and r['product_type'] == 'HUMAN PRESCRIPTION DRUG' and r['product_ndc'] not in sp and r.get('generic_name')
        and r['generic_name'].split()[0].lower() not in sg and r['openfda'].get('spl_set_id')
        and 'repack' not in r['labeler_name'].lower() and r['openfda']['spl_set_id'][0] not in have
        and (is_inj(r) if stratum == 'injectable' else not is_inj(r))]
random.seed(seed)
pick = list({r['openfda']['spl_set_id'][0]: r for r in random.sample(pool, min(k, len(pool)))})
print('pool', len(pool), 'picked', len(pick))
def f(s):
    p = P('raw/spl', s + '.xml')
    if os.path.exists(p): return 1
    try:
        b = urllib.request.urlopen(urllib.request.Request(f'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{s}.xml',
                                   headers={'User-Agent': 'upstream-research/0.1'}), timeout=90).read()
        open(p, 'wb').write(b); return 1
    except Exception:
        return 0
with cf.ThreadPoolExecutor(6) as ex:
    ok = sum(ex.map(f, pick))
print('fetched', ok)
with open(P('samples/spl_roles.csv'), 'a', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh)
    for s in pick:
        w.writerow(['control'] + [s] + [''] * (len(roles[0]) - 2))
