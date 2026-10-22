"""Build a historical drug-shortage table from monthly Wayback snapshots of FDA's
Drugshortages.cfm CSV (+ today's live CSV).
Usage: python -I scripts/02_build_history.py raw/wayback raw/fdads/current_2026-10-22.csv samples/
Outputs: shortage_history_rows.csv (per generic+company+presentation, first/last seen)
         shortage_episodes.csv (per generic name: earliest initial posting while 'Current', statuses seen, companies, reasons)
"""
import csv, glob, os, re, sys, collections, datetime as dt
wb, live, out = sys.argv[1], sys.argv[2], sys.argv[3]
files = sorted(glob.glob(os.path.join(wb, 'ds_*.csv')))
snaps = [(re.search(r'ds_(\d{8})', f).group(1), f) for f in files if os.path.getsize(f) > 1000]
snaps.append(('20261022', live))
def d(s):
    s = (s or '').strip()
    for fmt in ('%m/%d/%Y', '%Y-%m-%d'):
        try: return dt.datetime.strptime(s, fmt).date()
        except ValueError: pass
    return None
rows = {}
ep = {}
for ts, f in snaps:
    with open(f, encoding='utf-8-sig', errors='replace', newline='') as fh:
        rd = csv.reader(fh)
        hdr = next(rd)
        while not any(c.strip() for c in hdr): hdr = next(rd)
        hdr = [h.strip() for h in hdr]
        for r in rd:
            if len(r) < len(hdr): continue
            x = dict(zip(hdr, [c.strip() for c in r]))
            g = x.get('Generic Name'); st = x.get('Status')
            if not g: continue
            ndcm = re.findall(r'NDC\s*([0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2})', x.get('Presentation', ''))
            key = (g, x.get('Company Name'), x.get('Presentation'))
            k = rows.setdefault(key, dict(generic=g, company=x.get('Company Name'), presentation=x.get('Presentation'), ndc=ndcm[0] if ndcm else '',
                                          first_seen=ts, last_seen=ts, statuses=set(), initial_posting=x.get('Initial Posting Date'), reasons=set(), avail=set()))
            k['last_seen'] = ts; k['statuses'].add(st)
            if x.get('Reason for Shortage'): k['reasons'].add(x['Reason for Shortage'])
            if st == 'Current' and x.get('Availability Information'): k['avail'].add(x['Availability Information'][:40])
            e = ep.setdefault(g, dict(generic=g, first_seen=ts, last_seen=ts, min_posting_current=None, statuses=collections.OrderedDict(), companies=set(), reasons=set(), ndcs=set(), resolved_seen=None, category=x.get('Therapeutic Category','')))
            e['last_seen'] = ts; e['statuses'][st] = ts if st not in e['statuses'] else e['statuses'][st]
            e['companies'].add(x.get('Company Name')); 
            if ndcm: e['ndcs'].add(ndcm[0])
            if x.get('Reason for Shortage'): e['reasons'].add(x['Reason for Shortage'])
            p = d(x.get('Initial Posting Date'))
            if st == 'Current' and p and (e['min_posting_current'] is None or p < e['min_posting_current']): e['min_posting_current'] = p
            if st == 'Resolved' and not e['resolved_seen']: e['resolved_seen'] = ts
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'shortage_history_rows.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['generic','company','ndc','presentation','initial_posting','first_seen','last_seen','statuses','reasons','availability_when_current'])
    for k in rows.values(): w.writerow([k['generic'],k['company'],k['ndc'],k['presentation'],k['initial_posting'],k['first_seen'],k['last_seen'],'|'.join(sorted(s for s in k['statuses'] if s)),'|'.join(sorted(k['reasons'])),'|'.join(sorted(k['avail']))])
with open(os.path.join(out, 'shortage_episodes.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['generic','category','min_posting_current','first_seen_snapshot','last_seen_snapshot','resolved_first_seen','statuses','n_companies','companies','reasons','ndcs'])
    for e in sorted(ep.values(), key=lambda e: str(e['min_posting_current'])):
        w.writerow([e['generic'], e['category'], e['min_posting_current'] or '', e['first_seen'], e['last_seen'], e['resolved_seen'] or '', '|'.join(k for k in e['statuses'] if k), len(e['companies']), '|'.join(sorted(c for c in e['companies'] if c)), '|'.join(sorted(e['reasons'])), '|'.join(sorted(e['ndcs']))])
print('snapshots', len(snaps), 'rows', len(rows), 'generics', len(ep))
c = collections.Counter((e['min_posting_current'].year if e['min_posting_current'] else None) for e in ep.values())
print('generics by earliest Current posting year', sorted(c.items(), key=lambda x: str(x[0])))
