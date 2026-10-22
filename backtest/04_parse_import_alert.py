"""Parse an FDA import alert page (accessdata.fda.gov/cms_ia/importalert_N.html) red list into CSV:
country, firm, address, date_published (firm-level). No FEI on the page: join by normalised name+country.
Fetch needs a browser User-Agent. Usage: python -I scripts/04_parse_import_alert.py in.html out.csv alert_no"""
import re, html, csv, sys
t = open(sys.argv[1], encoding='utf-8', errors='replace').read()
out = []
country = None
for m in re.finditer(r'<div class="center"><h4>([^<]+)</h4></div>|<div class="div-info">\s*<div class="div-name floatleft">(.*?)</div>\s*<div class="div-name floatright">Date Published\s*:\s*([0-9/]+)</div>\s*<div class="clear">(.*?)</div>', t, re.S):
    if m.group(1): country = html.unescape(m.group(1)).strip(); continue
    firm = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', m.group(2))).split())
    addr = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', m.group(4))).split())
    out.append([sys.argv[3], country, firm, addr, m.group(3)])
with open(sys.argv[2], 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['alert', 'country', 'firm', 'address', 'date_published']); w.writerows(out)
print(len(out), 'firms')
