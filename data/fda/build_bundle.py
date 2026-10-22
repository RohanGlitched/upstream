#!/usr/bin/env python3
"""Build Upstream's FDA bundle: clean, drugs-only CSVs that Zetaris reads in place as file tables.

    python data/fda/build_bundle.py [--raw ../research/raw] [--samples ../research/samples] [--out data/fda/bundle]

Inputs are FDA's own public files (see data/fda/README.md for each URL and how it was fetched).
DailyMed SPL XML for formulary products not yet cached is fetched (4 at a time) into <raw>/spl/.
Outputs, one row per record, snake_case columns, ISO dates:
  ndc_packages, spl_establishments, registrations, inspections, citations, compliance_actions,
  import_alerts, recalls, shortage_presentations, shortage_episodes, shortage_current, dmf_api
Contact names and emails in FDA's registration file are dropped.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import csv
import datetime as dt
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import spl  # noqa: E402

UA = {"User-Agent": "upstream/0.1 (Open Agent Hackathon; drug shortage research)"}

SUFFIX = (r"\b(private|pvt|limited|ltd|llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|"
          r"s\.a|spa|s\.p\.a|srl|s\.r\.l|plc|bv|b\.v|nv|kg|kgaa|sas|s\.a\.s|ab|as|oy|pte|pty|sdn|bhd|kk|"
          r"k\.k|lp|l\.p|usa|us|the|of|and|unit|plant|division|formulation|formulations|pharmaceuticals?|"
          r"pharma|laboratories|laboratory|labs?|healthcare|industries|industry|international|holdings?|"
          r"group|manufacturing|mfg)\b")


def norm(s: str) -> str:
    """Firm name key: ASCII, lower case, no punctuation or legal suffixes."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s).replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(SUFFIX, " ", s)
    return " ".join(s.split())


def iso(s: str) -> str:
    s = (s or "").strip()
    for f in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return dt.datetime.strptime(s[:10] if f == "%Y-%m-%d" else s, f).date().isoformat()
        except ValueError:
            pass
    return ""


def to_ndc11(ndc: str) -> str:
    a, b, c = (ndc.split("-") + ["", "", ""])[:3]
    if len(a) == 4:
        a = "0" + a
    elif len(b) == 3:
        b = "0" + b
    elif len(c) == 1:
        c = "0" + c
    digits = a + b + c
    return digits if len(digits) == 11 and digits.isdigit() else ""


def write(out: Path, name: str, fields: list[str], rows) -> int:
    n = 0
    with open(out / f"{name}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(fields)
        for r in rows:
            w.writerow([("" if r.get(k) is None else r.get(k)) for k in fields])
            n += 1
    print(f"  {name}: {n} rows")
    return n


def get(url: str, tries: int = 3) -> bytes | None:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(REPO.parent / "research" / "raw"))
    ap.add_argument("--samples", default=str(REPO.parent / "research" / "samples"))
    ap.add_argument("--formulary", default=str(REPO / "data" / "hospital" / "out" / "formulary_master.csv"))
    ap.add_argument("--out", default=str(HERE / "bundle"))
    ap.add_argument("--no-fetch", action="store_true", help="use only cached SPL XML")
    args = ap.parse_args()
    raw, samples, out = Path(args.raw), Path(args.samples), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}

    # NDC directory --------------------------------------------------------------
    print("NDC directory")
    ndc = json.load(open(raw / "openfda" / "drug-ndc-0001-of-0001.json", encoding="utf-8"))["results"]
    pkg_rows = []
    for p in ndc:
        if p.get("product_type") != "HUMAN PRESCRIPTION DRUG":
            continue
        of = p.get("openfda") or {}
        ings = p.get("active_ingredients") or []
        for pk in p.get("packaging") or []:
            pkg_rows.append({
                "package_ndc": pk.get("package_ndc"),
                "ndc11": to_ndc11(pk.get("package_ndc") or ""),
                "product_ndc": p.get("product_ndc"),
                "generic_name": p.get("generic_name"),
                "brand_name": p.get("brand_name"),
                "labeler_name": p.get("labeler_name"),
                "dosage_form": p.get("dosage_form"),
                "route": "|".join(p.get("route") or []),
                "strength": "; ".join(f"{i.get('name')} {i.get('strength')}" for i in ings),
                "marketing_category": p.get("marketing_category"),
                "application_number": p.get("application_number"),
                "spl_set_id": (of.get("spl_set_id") or [""])[0],
                "marketing_start_date": iso(p.get("marketing_start_date") or ""),
                "marketing_end_date": iso(p.get("marketing_end_date") or ""),
                "package_description": (pk.get("description") or "")[:200],
            })
    counts["ndc_packages"] = write(out, "ndc_packages", list(pkg_rows[0].keys()), pkg_rows)
    set_by_pkg = {r["package_ndc"]: r["spl_set_id"] for r in pkg_rows if r["spl_set_id"]}

    # SPL set ids we need: formulary + every shortage product seen in research ------------
    need: set[str] = set()
    if Path(args.formulary).is_file():
        for r in csv.DictReader(open(args.formulary, encoding="utf-8")):
            sid = set_by_pkg.get(r["package_ndc"]) or r.get("spl_set_id")
            if sid:
                need.add(sid)
    for f in ("ndc_to_setid.csv", "spl_roles.csv"):
        if (samples / f).is_file():
            need |= {r["set_id"] for r in csv.DictReader(open(samples / f, encoding="utf-8")) if r.get("set_id")}
    spl_dir = raw / "spl"
    spl_dir.mkdir(parents=True, exist_ok=True)
    missing = sorted(s for s in need if not (spl_dir / f"{s}.xml").is_file())
    print(f"SPLs needed {len(need)}, cached {len(need) - len(missing)}, to fetch {0 if args.no_fetch else len(missing)}")

    def fetch(sid: str) -> bool:
        b = get(f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{sid}.xml")
        if b:
            (spl_dir / f"{sid}.xml").write_bytes(b)
            return True
        return False

    if missing and not args.no_fetch:
        with cf.ThreadPoolExecutor(4) as ex:
            ok = sum(ex.map(fetch, missing))
        print(f"  fetched {ok} of {len(missing)}")

    # Drugs@FDA sponsor, the fallback when an SPL names no plant ---------------------------
    apps = collections.defaultdict(set)
    for p in ndc:
        for s in (p.get("openfda") or {}).get("spl_set_id", []):
            if p.get("application_number"):
                apps[s].add(p["application_number"])
    dfda = json.load(open(raw / "openfda" / "drug-drugsfda-0001-of-0001.json", encoding="utf-8"))["results"]
    sponsor = {r["application_number"]: r.get("sponsor_name", "") for r in dfda}

    print("SPL establishments")
    est_rows = []
    for sid in sorted(need):
        f = spl_dir / f"{sid}.xml"
        if not f.is_file():
            est_rows.append({"set_id": sid, "source": "spl_not_fetched"})
            continue
        try:
            d = spl.parse(str(f))
        except Exception as e:  # malformed XML is rare; keep the row so the gap is visible
            est_rows.append({"set_id": sid, "source": "spl_parse_error", "note": str(e)[:80]})
            continue
        lab = d.get("labeler") or {}
        base = {"set_id": sid, "spl_version": d.get("version"), "spl_effective": iso(d.get("effective") or ""),
                "title": (d.get("title") or "")[:160], "labeler": lab.get("name"), "labeler_duns": lab.get("duns")}
        for e in d["establishments"]:
            est_rows.append({**base, "establishment": e.get("name"), "est_duns": (e.get("duns") or "").zfill(9) if e.get("duns") else "",
                             "operations": ";".join(e.get("operations") or []), "ndcs_covered": ";".join(e.get("ndcs") or [])[:400],
                             "source": "spl_establishment"})
        if not d["establishments"]:
            texts = [t for t in d.get("text_manufacturers") or [] if not t.startswith("MADE_IN:")]
            made_in = [t[8:] for t in d.get("text_manufacturers") or [] if t.startswith("MADE_IN:")]
            for t in texts:
                est_rows.append({**base, "establishment": t.split(",")[0][:100], "operations": "MANUFACTURE",
                                 "source": "label_text", "note": t[:160]})
            sp = sorted({sponsor.get(a, "") for a in apps.get(sid, []) if sponsor.get(a)})
            if not texts:
                for s in sp:
                    est_rows.append({**base, "establishment": s, "operations": "MANUFACTURE",
                                     "source": "drugsfda_sponsor", "note": "made_in=" + "|".join(made_in)})
            if not texts and not sp:
                est_rows.append({**base, "source": "no_site_info", "note": "made_in=" + "|".join(made_in)})
    est_fields = ["set_id", "spl_version", "spl_effective", "title", "labeler", "labeler_duns", "establishment",
                  "est_duns", "operations", "ndcs_covered", "source", "note"]
    counts["spl_establishments"] = write(out, "spl_establishments", est_fields, est_rows)

    # Registrations (DECRS): DUNS <-> FEI, address, country. Current file wins over Wayback copies.
    print("Registrations")
    sites: dict[str, dict] = {}
    files = sorted((raw / "decrs").glob("wb_*/drls_reg.txt")) + [raw / "decrs" / "drls_reg.txt"]
    for f in files:
        src = "current" if "wb_" not in str(f) else f.parent.name[3:11]
        rd = csv.reader(open(f, encoding="latin-1"), delimiter="\t")
        head = [x.strip() for x in next(rd)]
        for r in rd:
            x = dict(zip(head, [c.strip() for c in r]))
            if not x.get("DUNS_NUMBER"):
                continue
            m = re.search(r"\(([A-Z]{3})\)\s*$", x.get("ADDRESS", ""))
            sites[x["DUNS_NUMBER"].zfill(9)] = {
                "duns": x["DUNS_NUMBER"].zfill(9), "fei": x.get("FEI_NUMBER", "").lstrip("0"),
                "firm_name": x.get("FIRM_NAME"), "address": x.get("ADDRESS"), "country_iso3": m.group(1) if m else "",
                "operations": x.get("OPERATIONS"), "registrant_name": x.get("REGISTRANT_NAME"),
                "registrant_duns": (x.get("REGISTRANT_DUNS") or "").zfill(9), "expiration_date": iso(x.get("EXPIRATION_DATE", "")),
                "snapshot": src,
            }
    counts["registrations"] = write(out, "registrations", list(next(iter(sites.values())).keys()), sites.values())

    # Data Dashboard: inspections, citations, compliance actions (drugs only) --------------
    print("Data Dashboard")
    insp_rows, drug_insp_ids = [], set()
    for r in csv.DictReader(open(raw / "dd" / "inspections.csv", encoding="utf-8")):
        if r["Product Type"] != "Drugs":
            continue
        m = re.search(r"\((NAI|VAI|OAI)\)", r["Classification"])
        drug_insp_ids.add(r["Inspection ID"])
        end, fmd = iso(r["Inspection End Date"]), iso(r.get("FMD-145 Date") or "")
        insp_rows.append({
            "inspection_id": r["Inspection ID"], "fei": r["FEI Number"].lstrip("0"), "legal_name": r["Legal Name"],
            "city": r["City"], "state": r["State"], "country": r["Country/Area"], "fiscal_year": r["Fiscal Year"],
            "end_date": end, "classification": m.group(1) if m else r["Classification"],
            "project_area": r["Project Area"], "posted_citations": r["Posted Citations"],
            "fmd145_date": fmd,
            # When the outcome could be known: the classification letter, else 90 days after close (FDA's median is 97).
            "known_date": fmd or (iso((dt.date.fromisoformat(end) + dt.timedelta(days=90)).isoformat()) if end else ""),
            "known_date_basis": "fmd145_letter" if fmd else "end_plus_90_estimate",
        })
    counts["inspections"] = write(out, "inspections", list(insp_rows[0].keys()), insp_rows)

    cit_rows = []
    for r in csv.DictReader(open(raw / "dd" / "citations.csv", encoding="utf-8")):
        if r["Inspection ID"] not in drug_insp_ids:
            continue
        cit_rows.append({"inspection_id": r["Inspection ID"], "fei": r["FEI Number"].lstrip("0"),
                         "end_date": iso(r["Inspection End Date"]), "cfr": r["Act/CFR Number"],
                         "short_description": r["Short Description"], "long_description": r["Long Description"][:600]})
    counts["citations"] = write(out, "citations", list(cit_rows[0].keys()), cit_rows)

    ca_rows = []
    for r in csv.DictReader(open(raw / "dd" / "compliance_actions.csv", encoding="utf-8")):
        if r["Product Type"] != "Drugs":
            continue
        ca_rows.append({"fei": r["FEI Number"].lstrip("0"), "legal_name": r["Legal Name"], "state": r["State"],
                        "country": r["Country/Area"], "action_date": iso(r["Action Taken Date"]),
                        "action_type": r["Action Type"], "case_id": r["Case/Injunction ID"]})
    counts["compliance_actions"] = write(out, "compliance_actions", list(ca_rows[0].keys()), ca_rows)

    # Import alerts: firm name + address only. Match to an FEI only when a drug inspection of the
    # same normalised firm name ran in a city that appears in the alert's address (FIXES the Sun
    # Halol / Dadra trap in research/DATA.md section 6).
    print("Import alerts")
    insp_by_name = collections.defaultdict(list)
    for r in insp_rows:
        insp_by_name[norm(r["legal_name"])].append(r)
    ia_rows = []
    for f in sorted(samples.glob("import_alert_66-*_redlist.csv")):
        for r in csv.DictReader(open(f, encoding="utf-8")):
            cands = insp_by_name.get(norm(r["firm"]), [])
            addr = (r["address"] or "").lower()
            hits = sorted({c["fei"] for c in cands if c["city"] and c["city"].lower() in addr})
            ia_rows.append({"alert": r["alert"], "country": r["country"], "firm": r["firm"], "address": r["address"],
                            "date_published": iso(r["date_published"]), "fei": hits[0] if len(hits) == 1 else "",
                            "fei_match": "name_and_city" if len(hits) == 1 else ("ambiguous" if hits else "none"),
                            "firm_key": norm(r["firm"])})
    counts["import_alerts"] = write(out, "import_alerts", list(ia_rows[0].keys()), ia_rows)

    # Recalls (openFDA enforcement, drugs, initiated 2016 on) ------------------------------
    print("Recalls")
    enf = json.load(open(raw / "openfda" / "drug-enforcement-0001-of-0001.json", encoding="utf-8"))["results"]
    rc_rows = []
    for r in enf:
        init = iso(r.get("recall_initiation_date") or "")
        if not init or init < "2016-01-01":
            continue
        rc_rows.append({
            "recall_number": r.get("recall_number"), "recalling_firm": r.get("recalling_firm"), "firm_key": norm(r.get("recalling_firm") or ""),
            "city": r.get("city"), "state": r.get("state"), "country": r.get("country"),
            "classification": r.get("classification"), "status": r.get("status"),
            "initiation_date": init, "report_date": iso(r.get("report_date") or ""),
            "reason": (r.get("reason_for_recall") or "")[:300], "product_description": (r.get("product_description") or "")[:300],
            "product_ndcs": "|".join((r.get("openfda") or {}).get("product_ndc", [])),
        })
    counts["recalls"] = write(out, "recalls", list(rc_rows[0].keys()), rc_rows)

    # Shortages: FDA history (Wayback snapshots), episodes, and the current openFDA list -----
    print("Shortages")
    hist = list(csv.DictReader(open(samples / "shortage_history_rows.csv", encoding="utf-8")))
    counts["shortage_presentations"] = write(out, "shortage_presentations",
        ["generic", "company", "package_ndc", "presentation", "initial_posting_date", "first_seen", "last_seen", "statuses", "reasons"],
        ({"generic": h["generic"], "company": h["company"], "package_ndc": h["ndc"], "presentation": h["presentation"][:200],
          "initial_posting_date": iso(h["initial_posting"]), "first_seen": iso(h["first_seen"]), "last_seen": iso(h["last_seen"]),
          "statuses": h["statuses"], "reasons": h["reasons"]} for h in hist))
    eps = list(csv.DictReader(open(samples / "shortage_episodes.csv", encoding="utf-8")))
    counts["shortage_episodes"] = write(out, "shortage_episodes",
        ["generic", "category", "first_posting", "first_seen", "last_seen", "resolved_first_seen", "statuses", "n_companies", "companies", "reasons"],
        ({"generic": e["generic"], "category": e["category"], "first_posting": iso(e["min_posting_current"]), "first_seen": iso(e["first_seen_snapshot"]),
          "last_seen": iso(e["last_seen_snapshot"]), "resolved_first_seen": iso(e["resolved_first_seen"]), "statuses": e["statuses"],
          "n_companies": e["n_companies"], "companies": e["companies"], "reasons": e["reasons"]} for e in eps))
    cur = json.load(open(raw / "openfda" / "drug-shortages-0001-of-0001.json", encoding="utf-8"))["results"]
    counts["shortage_current"] = write(out, "shortage_current",
        ["package_ndc", "generic_name", "company_name", "status", "dosage_form", "presentation", "initial_posting_date",
         "update_date", "discontinued_date", "therapeutic_category", "related_info", "spl_set_id", "application_number"],
        ({"package_ndc": s.get("package_ndc"), "generic_name": s.get("generic_name"), "company_name": s.get("company_name"),
          "status": s.get("status"), "dosage_form": s.get("dosage_form"), "presentation": (s.get("presentation") or "")[:200],
          "initial_posting_date": iso(s.get("initial_posting_date") or ""), "update_date": iso(s.get("update_date") or ""),
          "discontinued_date": iso(s.get("discontinued_date") or ""), "therapeutic_category": "|".join(s.get("therapeutic_category") or []),
          "related_info": (s.get("related_info") or "")[:400], "spl_set_id": ((s.get("openfda") or {}).get("spl_set_id") or [""])[0],
          "application_number": ((s.get("openfda") or {}).get("application_number") or [""])[0]} for s in cur))

    # DMF list: active Type II (drug substance) files, the API layer by molecule -------------
    print("DMF")
    dmf_rows = []
    with open(raw / "dmf" / "dmf.csv", encoding="utf-8", errors="replace") as fh:
        rd = csv.reader(fh)
        for r in rd:
            if len(r) >= 6 and r[0].isdigit() and r[1].strip() == "A" and r[2].strip() == "II":
                dmf_rows.append({"dmf_number": r[0], "submit_date": iso(r[3]), "holder": r[4].strip(),
                                 "holder_key": norm(r[4]), "subject": r[5].strip()[:200]})
    counts["dmf_api"] = write(out, "dmf_api", ["dmf_number", "submit_date", "holder", "holder_key", "subject"], dmf_rows)

    manifest = {"built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "counts": counts,
                "spl_sets": len(need)}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
