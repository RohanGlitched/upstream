"""Helper: fetch SPL XML for set IDs in samples/ndc_to_setid.csv (reverse order, 6 threads) into raw/spl/.
Usage: python -I scripts/05c_fetch_parallel.py"""
import csv, os, urllib.request, concurrent.futures as cf, time
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ids = sorted(set(r['set_id'] for r in csv.DictReader(open(os.path.join(B, 'samples/ndc_to_setid.csv'), encoding='utf-8'))), reverse=True)
def f(s):
    p = os.path.join(B, 'raw/spl', s + '.xml')
    if os.path.exists(p): return 0
    try:
        b = urllib.request.urlopen(urllib.request.Request(f'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{s}.xml', headers={'User-Agent': 'upstream-research/0.1'}), timeout=90).read()
        if not os.path.exists(p): open(p, 'wb').write(b)
        return 1
    except Exception: return 0
t = time.time()
with cf.ThreadPoolExecutor(6) as ex: n = sum(ex.map(f, ids))
print('fetched', n, 'in', round(time.time() - t), 's')
