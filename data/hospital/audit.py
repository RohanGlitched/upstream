"""Pharmacist audit of the generated Corvale data: python data/hospital/audit.py

Exits non-zero if any interchange pair or shortage item breaks the rules in FIXES-1.md.
"""
import collections
import csv
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"
PARENTERAL = ("INJECT", "INTRAVEN", "INTRAMUSC", "SUBCUT", "INFUS", "EMULSION", "EPIDURAL",
              "INTRATHEC", "INFILTRATION", "INTRA-ARTER", "INTRA-ARTICU", "INTRAVITREAL")
IV_PO = ("pantoprazole", "metronidazole", "levetiracetam", "famotidine", "linezolid", "azithromycin",
         "fluconazole", "levofloxacin", "ciprofloxacin", "acetaminophen")


def main() -> int:
    rows = list(csv.DictReader(open(OUT / "formulary_master.csv", encoding="utf8")))
    by_id = {r["item_id"]: r for r in rows}
    problems = []

    for r in rows:
        if r["from_shortage"] == "True" and not any(k in (r["dosage_form"] + r["route"]).upper() for k in PARENTERAL):
            problems.append(f"shortage item not parenteral: {r['generic_name']} | {r['dosage_form']} | {r['route']}")
        if re.search(r"(^|[^0-9])\.\d", r["strength"]) or re.search(r"\bug\b|µg|\[iU\]|\[USP'U\]", r["strength"]):
            problems.append(f"ISMP strength: {r['generic_name']} {r['strength']}")

    sql = (OUT / "corvale_general.sql").read_text(encoding="utf8")
    seg = sql[sql.find("INSERT INTO cg.therapeutic_interchange"):]
    seg = seg[: seg.find(";\n")]
    pairs = re.findall(r"\((\d+), (\d+), '([^']+)'", seg)
    rules = collections.Counter(rule for _, _, rule in pairs)
    for a, b, rule in pairs:
        A, B = by_id[a], by_id[b]
        ga, gb = (A["generic_name"].lower().removeprefix("sterile ") for A in (A, B))
        same_mol = ga.split()[0] == gb.split()[0]
        if a == b or A["package_ndc"] == B["package_ndc"]:
            problems.append(f"self pair {a}")
        if rule.startswith("IV-to-PO"):
            if not any(m in ga for m in IV_PO):
                problems.append(f"IV-to-PO not on list: {ga}")
        elif not (set(A["route"].split("|")) & set(B["route"].split("|"))) or (
            any(k in (A["dosage_form"] + A["route"]).upper() for k in PARENTERAL)
            != any(k in (B["dosage_form"] + B["route"]).upper() for k in PARENTERAL)
        ):
            problems.append(f"route mismatch [{rule}]: {ga} {A['route']} -> {gb} {B['route']}")
        if rule.startswith("protocol-specific") and (same_mol or "cisplatin" not in ga or "carboplatin" not in gb):
            problems.append(f"oncology rule misuse: {ga} -> {gb}")
        if rule.startswith("same product") and (not same_mol or A["strength"] != B["strength"] or A["labeler_name"] == B["labeler_name"]):
            problems.append(f"alt-manufacturer pair not same product: {ga} {A['strength']} {A['labeler_name']} -> {gb} {B['strength']} {B['labeler_name']}")

    print("items", len(rows), "| interchange pairs", len(pairs), dict(rules))
    print("ndc_source", collections.Counter(r.get("ndc_source", "?") for r in rows))
    for p in problems:
        print("PROBLEM", p)
    print(f"{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
