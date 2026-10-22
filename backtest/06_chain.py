"""End-to-end chain + preliminary back-test.

shortage episode (generic name, first 'Current' posting date T) -> package NDCs -> SPL set IDs
 -> SPL establishments (DUNS, business operations) -> DECRS (DUNS->FEI, country)
 -> FDA Data Dashboard inspections (OAI/VAI) + compliance actions (warning letter / injunction / seizure)
 -> import alerts 66-40 / 66-79 (normalised firm-name match) -> openFDA recalls (labeler/site name match).

Back-test: a signal dated in [T-730d, T) at a manufacturing site of a product in the shortage.
Controls: random non-shortage Rx products (role=control in spl_establishments.csv) with T drawn from the case Ts.

Usage: python -I scripts/06_chain.py [since=2022-01-01] [win=730] [date=known|end] [constrained=0|1] [tag=name]
  date=end    : date inspections by inspection end date (483 handed over) instead of FMD-145 letter / end+90
  constrained : only NDC rows whose availability was not 'Available' while Current (the companies actually short)
"""
import csv, sys, os, random, collections, datetime as dt, json, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sitelib import *

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
SINCE = d(ARGS.get('since', '2022-01-01'))
WIN = int(ARGS.get('win', 730))
DATE_MODE = ARGS.get('date', 'known')
CONSTRAINED = ARGS.get('constrained', '0') == '1'
TAG = ARGS.get('tag', '')
OK_AVAIL = ('Available', 'Inventory is currently av', 'Discontinued')
MAKE = {'MANUFACTURE', 'API MANUFACTURE', 'STERILIZE', 'PARTICLE SIZE REDUCTION',
        'POSITRON EMISSION TOMOGRAPHY DRUG PRODUCTION'}
STRONG_PREFIX = ('inspection_OAI', 'warning_letter', 'injunction', 'seizure', 'import_alert')

sites = load_decrs()
insp = load_inspections()
if DATE_MODE == 'end':
    for L in insp.values():
        for x in L:
            x['date'] = x['end']
acts = load_actions()
ia = load_import_alerts()
rec_name, rec_ndc = load_recalls()
if ARGS.get('recall', 'initiation') == 'report':  # date recalls by enforcement-report publication
    for L in rec_name.values():
        for x in L:
            x['date'] = x['report']

name2fei = collections.defaultdict(set)
for fei, L in insp.items():
    for x in L:
        name2fei[norm(x['name'])].add(fei)

# import-alert firms -> FEI via inspections legal name (+ country check); IA pages carry no FEI
fei_country = {fei: L[0]['country'].lower() for fei, L in insp.items()}
fei_city = {fei: {x['city'].lower() for x in L if x['city'] and x['city'] != '-'} for fei, L in insp.items()}
ia_fei = collections.defaultdict(list)
for nm, L in ia.items():
    for x in L:
        for fei in name2fei.get(nm, ()):
            c = fei_country.get(fei, '')
            # same firm name is shared by many plants (e.g. Sun Pharma Halol vs Dadra): require the city in the IA address
            if c[:5] == x['country'].lower()[:5] and any(ct in x['address'].lower() for ct in fei_city.get(fei, ())):
                ia_fei[fei].append(x)
ep = {r['generic']: r for r in csv.DictReader(open(P('samples/shortage_episodes.csv'), encoding='utf-8'))}
H = list(csv.DictReader(open(P('samples/shortage_history_rows.csv'), encoding='utf-8')))
n2s = {r['package_ndc']: r['set_id'] for r in csv.DictReader(open(P('samples/ndc_to_setid.csv'), encoding='utf-8'))}
est = collections.defaultdict(list)
setinfo = {}
role = {}
for r in csv.DictReader(open(P('samples/spl_establishments.csv'), encoding='utf-8')):
    role[r['set_id']] = r['role']
    setinfo[r['set_id']] = (r['title'], r['labeler'], r['labeler_duns'], r['source'])
    if (r['est_duns'] or r['establishment']) and r['source'] != 'drugsfda_sponsor':
        est[r['set_id']].append(r)


decrs_core = collections.defaultdict(list)
for du, s in sites.items():
    decrs_core[core(s['name'])].append((norm(s['name']), du, s))


def decrs_by_text(text):
    """Match a free-text 'Manufactured by' string to a DECRS site: DECRS normalised name must prefix the text;
    ties broken by city/country words of the DECRS address appearing in the text."""
    nt = norm(text)
    cands = [(n, du, s) for n, du, s in decrs_core.get(core(text), []) if n and nt.startswith(n)]
    if not cands:
        return None
    feis = {s['fei'] for _, _, s in cands}
    if len(feis) == 1:
        return cands[0]
    low = text.lower()
    best = [c for c in cands if any(w and w.lower() in low for w in c[2]['address'].split(',')[-3:-1])]
    feis = {s['fei'] for _, _, s in best}
    return best[0] if len(feis) == 1 else None


def site_of(e):
    duns = e['est_duns'].zfill(9) if e['est_duns'] else ''
    s = sites.get(duns)
    if s:
        return dict(s, duns=duns, how='DUNS->DECRS(' + s['src'] + ')')
    if e.get('source') == 'label_text':
        m = decrs_by_text(e['note'] or e['establishment'])
        if m:
            return dict(m[2], duns=m[1], how='label_text->DECRS')
    f = name2fei.get(norm(e['establishment']))
    if f and len(f) == 1:
        fei = next(iter(f))
        x = insp[fei][0]
        return dict(fei=fei, name=e['establishment'], iso3='', country=x['country'], ops='', duns=duns,
                    how='name->inspections')
    return dict(fei='', name=e['establishment'], iso3='', ops='', duns=duns, how='unresolved')


def signals(s, names):
    out = []
    fei = s.get('fei')
    if fei:
        for x in insp.get(fei, []):
            if x['cls'] in ('OAI', 'VAI'):
                out.append(dict(kind='inspection_' + x['cls'], date=x['date'],
                                detail=f"{x['name']}, {x['city']}, {x['country']} (inspection {x['insp_id']} ended {x['end']}, {x['area']})"))
        for x in acts.get(fei, []):
            out.append(dict(kind=x['type'].lower().replace(' ', '_'), date=x['date'], detail=f"{x['name']}, {x['country']}"))
        for x in ia_fei.get(fei, []):
            out.append(dict(kind='import_alert_' + x['alert'], date=x['date'], detail=f"{x['firm']}, {x['country']} (via FEI)"))
    for nm in set(norm(n) for n in names if n):
        if not nm:
            continue
        city_words = [w.strip().lower() for w in (s.get('address') or '').split(',')[-3:-1] if len(w.strip()) > 3]
        for x in ([] if fei and fei in ia_fei else ia.get(nm, [])):
            # name-only match: require a DECRS address city/state word in the IA address when we know the site address
            if city_words and not any(w.split()[0] in x['address'].lower() for w in city_words if w.split()):
                continue
            out.append(dict(kind='import_alert_' + x['alert'], date=x['date'], detail=f"{x['firm']}, {x['country']}"))
        for x in rec_name.get(nm, []):
            if x['cls'] in ('Class I', 'Class II'):
                out.append(dict(kind='recall_' + x['cls'].split()[-1], date=x['date'],
                                detail=f"{x['firm']}: {x['reason'][:90]}"))
    return out


def window(sig, T):
    return [x for x in sig if x['date'] and T - dt.timedelta(days=WIN) <= x['date'] < T]


def product_eval(sid, T):
    title, lab, labduns, note = setinfo.get(sid, ('', '', '', 'missing'))
    rows = []
    cnt = collections.Counter()
    for e in est.get(sid, []):
        ops = set(e['operations'].split(';')) if e['operations'] else set()
        s = site_of(e)
        make = bool(ops & MAKE)
        sig = signals(s, [e['establishment'], s.get('name')])
        w = window(sig, T) if make else []
        for x in w:
            cnt[x['kind']] += 1
        rows.append(dict(set_id=sid, title=title, labeler=lab, site=e['establishment'], duns=s.get('duns'),
                         fei=s.get('fei'), iso3=s.get('iso3'), how=s['how'], ops=e['operations'], make=make,
                         prior=[(x['kind'], str(x['date']), x['detail']) for x in sorted(w, key=lambda x: x['date'])],
                         after=[(x['kind'], str(x['date'])) for x in sorted(sig, key=lambda x: x['date'] or dt.date.min)
                                if x['date'] and x['date'] >= T and x['kind'] != 'inspection_VAI'][:6]))
    lw = [x for x in window(signals({}, [lab]), T) if x['kind'].startswith('recall')]
    for x in lw:
        cnt['labeler_' + x['kind']] += 1
    return rows, cnt, lw


def strong(c):
    return any(k.startswith(STRONG_PREFIX) for k in c)


case_rows, ep_out, prod_cases = [], [], []
gen_ndcs = collections.defaultdict(set)
gen_comp = collections.defaultdict(set)
for h in H:
    _av = [a for a in (h['availability_when_current'] or '').split('|') if a]
    if CONSTRAINED and _av and all(a.startswith(OK_AVAIL) for a in _av):
        continue
    if 'Current' in h['statuses'] and h['ndc']:
        gen_ndcs[h['generic']].add(h['ndc'])
        gen_comp[h['generic']].add(h['company'])
link = collections.Counter()
for g, e in ep.items():
    T = d(e['min_posting_current'])
    if not T:
        continue
    nd = gen_ndcs.get(g, set())
    sids = sorted(set(n2s[n] for n in nd if n in n2s))
    link['episodes'] += 1
    link['ep_has_ndc'] += bool(nd)
    link['ep_has_spl'] += bool(sids)
    allrows, cnt, labrec = [], collections.Counter(), []
    for sid in sids:
        rows, c, lw = product_eval(sid, T)
        allrows += rows
        cnt.update(c)
        labrec += lw
        if T >= SINCE:
            prod_cases.append((sid, T, c, rows))
    mk = [r for r in allrows if r['make']]
    link['ep_has_establishment'] += bool(allrows)
    link['ep_has_make_site'] += bool(mk)
    link['ep_has_fei'] += any(r['fei'] for r in mk)
    link['ep_has_inspection_record'] += any(r['fei'] in insp for r in mk if r['fei'])
    ep_out.append(dict(
        generic=g, T=str(T), n_ndc=len(nd), n_spl=len(sids), n_sites=len(set(r['site'] for r in mk)),
        n_fei=len(set(r['fei'] for r in mk if r['fei'])),
        countries='|'.join(sorted(set(r['iso3'] for r in mk if r['iso3']))),
        prior_counts=dict(cnt), strong=strong(cnt),
        prior_examples=list(dict.fromkeys((r['site'], r['iso3'], r['fei'], tuple(p)) for r in mk for p in r['prior'] if not p[0].endswith('VAI')))[:12],
        labeler_recalls=[(x['date'].isoformat(), x['detail'][:80]) for x in labrec][:3],
        companies='|'.join(sorted(c for c in gen_comp[g] if c))[:200]))
    for r in allrows:
        case_rows.append(dict(generic=g, T=str(T), **{k: (json.dumps(v) if isinstance(v, list) else v) for k, v in r.items()}))

print('LINK COVERAGE (episodes = generics ever Current in snapshots 2022-10..2026-10, with a posting date):')
print(' ', dict(link))
with open(P(f'samples/chain_sites{TAG}.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=list(case_rows[0].keys()))
    w.writeheader()
    w.writerows(case_rows)
with open(P(f'samples/chain_episodes{TAG}.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=list(ep_out[0].keys()))
    w.writeheader()
    for r in ep_out:
        w.writerow({k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in r.items()})

allbt = [r for r in ep_out if r['T'] >= str(SINCE)]
bt = [r for r in allbt if r['n_fei'] > 0]
print(f'\nBACKTEST episodes posted >= {SINCE}: {len(allbt)}; with >=1 resolved manufacturing-site FEI: {len(bt)}')


def summarize(lst, label):
    n = len(lst)
    s = sum(1 for r in lst if r['strong'])
    a = sum(1 for r in lst if r['prior_counts'])
    kinds = collections.Counter(k for r in lst for k in r['prior_counts'])
    print(f' {label}: n={n} any-signal(incl VAI/recall)={a} ({a / max(n, 1):.0%}) '
          f'strong(OAI/WL/IA/injunction/seizure)={s} ({s / max(n, 1):.0%})')
    print('   signal kinds (count of site-signals):', dict(kinds))


summarize(bt, 'episodes')
leads = []
for r in bt:
    L = [(dt.date.fromisoformat(r['T']) - dt.date.fromisoformat(p[1])).days
         for (_, _, _, p) in r['prior_examples'] if p[0].startswith(STRONG_PREFIX)]
    if L:
        leads.append(min(L))
if leads:
    leads.sort()
    print(f' lead time, most recent strong signal -> posting (days): n={len(leads)} median={statistics.median(leads)} '
          f'p25={leads[len(leads) // 4]} p75={leads[3 * len(leads) // 4]} min={leads[0]} max={leads[-1]}')

Ts = [T for _, T, _, _ in prod_cases]
random.seed(7)
ctrl = sorted(sid for sid, rl in role.items() if rl == 'control')
pc = []
for sid in ctrl:
    T = random.choice(Ts) if Ts else dt.date(2024, 1, 1)
    rows, c, lw = product_eval(sid, T)
    if any(r['fei'] for r in rows if r['make']):
        pc.append((sid, T, c, rows))
cases_res = [x for x in prod_cases if any(r['fei'] for r in x[3] if r['make'])]


def prate(L, label):
    n = max(len(L), 1)
    f = lambda pred: sum(1 for x in L if pred(x[2]))
    s = f(strong)
    oai = f(lambda c: 'inspection_OAI' in c)
    wl = f(lambda c: 'warning_letter' in c)
    iaa = f(lambda c: any(k.startswith('import_alert') for k in c))
    vai = f(lambda c: 'inspection_VAI' in c)
    rc = f(lambda c: any('recall' in k for k in c))
    print(f' {label}: products={len(L)} strong={s} ({s / n:.1%}) OAI={oai} ({oai / n:.1%}) WL={wl} ({wl / n:.1%}) '
          f'IA={iaa} ({iaa / n:.1%}) VAI={vai} ({vai / n:.1%}) recall I/II={rc} ({rc / n:.1%})')
    return s, len(L)


inj = lambda x: any(w in (setinfo.get(x[0], ('',))[0] or '').upper()
                    for w in ('INJECT', 'INFUSION', 'FOR SOLUTION', 'INTRAVENOUS', 'VIAL'))
print('\nPRODUCT-LEVEL by stratum:')
prate([x for x in cases_res if inj(x)], 'cases, injectable')
prate([x for x in pc if inj(x)], 'controls, injectable')
prate([x for x in cases_res if not inj(x)], 'cases, non-injectable')
prate([x for x in pc if not inj(x)], 'controls, non-injectable')
print(f'\nPRODUCT-LEVEL case/control (SPL products with >=1 resolved manufacturing-site FEI; {WIN}-day window before T):')
s1, n1 = prate(cases_res, 'shortage products (T = episode posting)')
s0, n0 = prate(pc, 'control products (T sampled from case Ts)')
if n1 and n0 and s0:
    print(f' relative risk (strong signal, case vs control) = {(s1 / n1) / (s0 / n0):.2f}')
    a, b, c_, d_ = s1, n1 - s1, s0, n0 - s0
    if b and c_:
        print(f' odds ratio = {(a * d_) / (b * c_):.2f}')
# unique-product dedupe: same SPL can be in several episodes
uc = {x[0] for x in cases_res}
print(f' (unique case SPLs: {len(uc)}; case product rows: {len(cases_res)})')
json.dump(dict(link=dict(link), since=str(SINCE), case_products=n1, case_strong=s1, control_products=n0,
               control_strong=s0, leads=leads), open(P(f'samples/chain_summary{TAG}.json'), 'w'), indent=1)
