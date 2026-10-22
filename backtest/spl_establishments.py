"""Parse establishment (site) data from a DailyMed SPL XML.
Returns labeler (name, DUNS) + list of establishments: name, DUNS, operations, NDCs covered.
Usage as script: python -I scripts/spl_establishments.py file1.xml [file2.xml ...]
"""
import sys, json, re, xml.etree.ElementTree as ET
NS = {'v3': 'urn:hl7-org:v3'}
def _t(e, path):
    x = e.find(path, NS); return x
def parse(path_or_bytes):
    root = ET.fromstring(path_or_bytes) if isinstance(path_or_bytes, (bytes, str)) and not str(path_or_bytes).endswith('.xml') else ET.parse(path_or_bytes).getroot()
    out = {'set_id': None, 'version': None, 'effective': None, 'title': None, 'labeler': None, 'registrant': None, 'establishments': []}
    sid = root.find('v3:setId', NS); out['set_id'] = sid.get('root') if sid is not None else None
    ver = root.find('v3:versionNumber', NS); out['version'] = ver.get('value') if ver is not None else None
    eff = root.find('v3:effectiveTime', NS); out['effective'] = eff.get('value') if eff is not None else None
    ti = root.find('v3:title', NS); out['title'] = ' '.join(''.join(ti.itertext()).split())[:200] if ti is not None else None
    ro = root.find('v3:author/v3:assignedEntity/v3:representedOrganization', NS)
    if ro is None: return out
    def org(o):
        i = o.find('v3:id', NS); n = o.find('v3:name', NS)
        return {'name': n.text.strip() if n is not None and n.text else None, 'duns': i.get('extension') if i is not None else None}
    out['labeler'] = org(ro)
    # registrant (level 2) and establishments (level 3)
    for ae in ro.findall('v3:assignedEntity', NS):
        ao = ae.find('v3:assignedOrganization', NS)
        if ao is None: continue
        if ao.find('v3:name', NS) is not None and out['registrant'] is None: out['registrant'] = org(ao)
        for ae2 in ao.findall('v3:assignedEntity', NS):
            eo = ae2.find('v3:assignedOrganization', NS)
            if eo is None: continue
            est = org(eo)
            addr = eo.find('v3:addr', NS)
            if addr is not None:
                est['country'] = (addr.findtext('v3:country', default='', namespaces=NS) or '').strip()
                est['city'] = (addr.findtext('v3:city', default='', namespaces=NS) or '').strip()
            fei = [i.get('extension') for i in eo.findall('v3:id', NS) if i.get('root') == '1.3.6.1.4.1.519.1']
            ops = {}
            for p in ae2.findall('v3:performance', NS):
                c = p.find('v3:actDefinition/v3:code', NS)
                op = c.get('displayName') if c is not None else None
                ndcs = [k.get('code') for k in p.findall('.//v3:manufacturedMaterialKind/v3:code', NS)]
                ops.setdefault(op, set()).update(ndcs)
            est['operations'] = sorted(set(o.upper() for o in ops if o))
            est['ndcs'] = sorted(set().union(*ops.values())) if ops else []
            out['establishments'].append(est)
    out['text_manufacturers'] = text_manufacturers(root)
    return out
MFD = re.compile(r'(?:Manufactured|Mfd\.?|Made|Produced)\s+(?:in\s+[A-Za-z ]+\s+)?(?:by|By|BY)\s*:?\s*(.{3,160}?)(?=(?:Manufactured|Mfd|Distributed|Marketed|Made in|Revised|Rev\.|Iss\.|Product of|Code No|Licensed|$))', re.S)
def text_manufacturers(root):
    """'Manufactured by: X, City, Country' strings from label text (fallback when no establishment section)."""
    txt = ' '.join(' '.join(root.itertext()).split())
    out = []
    for m in MFD.finditer(txt):
        v = m.group(1).strip(' ,;:.')
        if v and v not in out: out.append(v[:160])
    for m in re.finditer(r'Made in ([A-Z][A-Za-z]+(?: [A-Z][a-z]+)?)', txt):
        v = 'MADE_IN:' + m.group(1)
        if v not in out: out.append(v)
    return out[:8]
if __name__ == '__main__':
    for f in sys.argv[1:]:
        r = parse(f); print(json.dumps(r, indent=1)[:4000])
