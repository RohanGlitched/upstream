"""Shared loaders + name normalisation for the Upstream chain."""
import csv, json, re, os, glob, collections, datetime as dt, unicodedata
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(BASE, *a)
SUFFIX = r'\b(private|pvt|limited|ltd|llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|s\.a|spa|s\.p\.a|srl|s\.r\.l|plc|bv|b\.v|nv|kg|kgaa|sas|s\.a\.s|ab|as|oy|pte|pty|sdn|bhd|kk|k\.k|lp|l\.p|usa|us|the|of|and|unit|plant|division|formulation|formulations|pharmaceuticals?|pharma|laboratories|laboratory|labs?|healthcare|industries|industry|international|holdings?|group|manufacturing|mfg)\b'
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(.*?\)', ' ', s); s = s.replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s); s = re.sub(SUFFIX, ' ', s)
    return ' '.join(s.split())
def core(s):  # first two meaningful tokens: used for loose firm matching
    t = norm(s).split(); return ' '.join(t[:2])
def d(s):
    s = (s or '').strip()
    for f in ('%Y-%m-%d', '%m/%d/%Y', '%Y%m%d'):
        try: return dt.datetime.strptime(s[:10] if f == '%Y-%m-%d' else s, f).date()
        except ValueError: pass
    return None
ISO3 = {'USA': 'United States', 'IND': 'India', 'CHN': 'China', 'DEU': 'Germany', 'ITA': 'Italy', 'FRA': 'France', 'CAN': 'Canada', 'JPN': 'Japan', 'KOR': 'Korea (the Republic of)', 'ESP': 'Spain', 'GBR': 'United Kingdom', 'IRL': 'Ireland', 'CHE': 'Switzerland', 'ISR': 'Israel', 'PRT': 'Portugal', 'AUT': 'Austria', 'BEL': 'Belgium', 'DNK': 'Denmark', 'SWE': 'Sweden', 'NLD': 'Netherlands', 'MEX': 'Mexico', 'TWN': 'Taiwan', 'SGP': 'Singapore', 'HUN': 'Hungary', 'SVN': 'Slovenia', 'POL': 'Poland', 'CZE': 'Czechia', 'TUR': 'Turkey', 'BRA': 'Brazil', 'ARG': 'Argentina', 'JOR': 'Jordan', 'PRI': 'Puerto Rico', 'BGD': 'Bangladesh', 'FIN': 'Finland', 'GRC': 'Greece', 'CYP': 'Cyprus', 'MLT': 'Malta', 'HRV': 'Croatia', 'AUS': 'Australia'}
def load_decrs():
    """DUNS -> site dict, union of current + Wayback snapshots (current wins). Contact columns dropped."""
    sites = {}
    files = sorted(glob.glob(P('raw/decrs/wb_*/drls_reg.txt'))) + [P('raw/decrs/drls_reg.txt')]
    for f in files:
        src = 'current' if 'wb_' not in f else os.path.basename(os.path.dirname(f))[3:11]
        rd = csv.reader(open(f, encoding='latin-1'), delimiter='\t'); h = [x.strip() for x in next(rd)]
        for r in rd:
            x = dict(zip(h, [c.strip() for c in r]))
            if not x.get('DUNS_NUMBER'): continue
            m = re.search(r'\(([A-Z]{3})\)\s*$', x.get('ADDRESS', ''))
            sites[x['DUNS_NUMBER'].zfill(9)] = dict(fei=x['FEI_NUMBER'].lstrip('0'), name=x['FIRM_NAME'], address=x['ADDRESS'], iso3=m.group(1) if m else '', ops=x.get('OPERATIONS', ''), registrant=x.get('REGISTRANT_NAME', ''), src=src)
    return sites
def load_inspections():
    by = collections.defaultdict(list)
    for r in csv.DictReader(open(P('raw/dd/inspections.csv'), encoding='utf-8')):
        if r['Product Type'] != 'Drugs': continue
        end = d(r['Inspection End Date']); f145 = d(r.get('FMD-145 Date') or '')
        # 'known' = when the outcome plausibly became known: FMD-145 letter date, else end date + 90 days
        known = f145 or (end + dt.timedelta(days=90) if end else None)
        by[r['FEI Number'].lstrip('0')].append(dict(date=known, end=end, cls=r['Classification'][-4:-1], area=r['Project Area'], name=r['Legal Name'], country=r['Country/Area'], city=r['City'], insp_id=r['Inspection ID'], fmd145=r.get('FMD-145 Date')))
    return by
def load_actions():
    by = collections.defaultdict(list)
    for r in csv.DictReader(open(P('raw/dd/compliance_actions.csv'), encoding='utf-8')):
        if r['Product Type'] != 'Drugs': continue
        by[r['FEI Number'].lstrip('0')].append(dict(date=d(r['Action Taken Date']), type=r['Action Type'], name=r['Legal Name'], country=r['Country/Area']))
    return by
def load_import_alerts():
    by = collections.defaultdict(list)
    for f in glob.glob(P('samples/import_alert_66-*_redlist.csv')):
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if r['alert'] not in ('66-40', '66-79'): continue
            by[norm(r['firm'])].append(dict(date=d(r['date_published']), alert=r['alert'], firm=r['firm'], country=r['country'], address=r['address']))
    return by
def load_recalls():
    E = json.load(open(P('raw/openfda/drug-enforcement-0001-of-0001.json'), encoding='utf-8'))['results']
    byname = collections.defaultdict(list); byndc = collections.defaultdict(list)
    for r in E:
        x = dict(date=d(r['recall_initiation_date']), report=d(r['report_date']), cls=r['classification'], firm=r['recalling_firm'], country=r['country'], reason=r['reason_for_recall'][:160], product=r['product_description'][:120], recall_number=r['recall_number'])
        byname[norm(r['recalling_firm'])].append(x)
        for n in r.get('openfda', {}).get('product_ndc', []): byndc[n].append(x)
    return byname, byndc
