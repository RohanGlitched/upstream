#!/usr/bin/env python3
"""Corvale Health synthetic hospital pharmacy data generator.

See data/hospital/SPEC.md. Stdlib + optional ijson. Deterministic for a given seed.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

DEFAULT_NDC = REPO_ROOT.parent / "research/raw/openfda/drug-ndc-0001-of-0001.json"
DEFAULT_SHORTAGES = REPO_ROOT.parent / "research/samples/shortage_episodes.csv"
DEFAULT_SCENARIOS = HERE / "scenarios.json"
DEFAULT_OUT = HERE / "out"
DEFAULT_SEED = 20261022

AS_OF = datetime(2026, 10, 21, 23, 0, 0, tzinfo=timezone.utc)
AS_OF_DATE = date(2026, 10, 21)
DISPENSE_DAYS = 180
EAST_WEEKS = 26

INJECTABLE_KEYS = (
    "injection",
    "injectable",
    "infusion",
    "for injection",
    "vial",
    "emulsion",
)

WHOLESALERS = (
    "Northline",
    "Keystone Medical Supply",
    "Atlas Pharma Distribution",
)

CG_LOCATIONS = (
    "main pharmacy",
    "OR satellite",
    "oncology infusion",
    "ED",
    "ICU",
)

EAST_ONLY_EXTRA = 20
LAKESIDE_TARGET = 140
INTERCHANGE_TARGET = 40

# FDA / ISMP Tall Man list (Lakeside free-text descriptions only).
# epinephrine is intentionally absent — leave it in normal case.
TALL_MAN = {
    "cisplatin": "CISplatin",
    "carboplatin": "CARBOplatin",
    "vinblastine": "vinBLAStine",
    "vincristine": "vinCRIStine",
    "hydralazine": "hydrALAZINE",
    "hydroxyzine": "hydrOXYzine",
    "hydromorphone": "HYDROmorphone",
    "morphine": "morphine",
    "dobutamine": "DOBUTamine",
    "dopamine": "DOPamine",
    "nifedipine": "NIFEdipine",
    "nicardipine": "niCARdipine",
    "oxcarbazepine": "OXcarbazepine",
    "carbamazepine": "carBAMazepine",
    "pentobarbital": "PENTobarbital",
    "phenobarbital": "PHENobarbital",
    "glipizide": "glipiZIDE",
    "glyburide": "glyBURIDE",
    "prednisone": "predniSONE",
    "prednisolone": "prednisoLONE",
    "methylprednisolone": "methylPREDNISolone",
    "ketorolac": "KETorolac",
}

# Parenteral dosage-form / route tokens (shortage injectables).
PARENTERAL_FORM_PREFIX = "INJECTION"  # INJECTION*
PARENTERAL_FORM_CONTAINS = ("FOR INJECTION", "EMULSION")
PARENTERAL_ROUTES = (
    "INTRAVENOUS",
    "INTRAMUSCULAR",
    "SUBCUTANEOUS",
    "EPIDURAL",
    "INTRATHECAL",
    "INFILTRATION",
    "INTRA-ARTERIAL",
    "INTRA-ARTICULAR",
    "INTRAVITREAL",
)

IV_TO_PO_MOLECULES = (
    "pantoprazole",
    "metronidazole",
    "levetiracetam",
    "famotidine",
    "linezolid",
    "azithromycin",
    "fluconazole",
    "levofloxacin",
    "ciprofloxacin",
    "acetaminophen",
)

RULE_ALT_MFR = "same product, alternate manufacturer"
RULE_ALT_CONC = "same molecule, alternate concentration or vial size"
RULE_IV_PO = "IV-to-PO conversion per P&T protocol"
RULE_ONC = "protocol-specific, oncologist approval"

CLASS_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("oncology", (
        "carboplatin", "cisplatin", "etoposide", "fluorouracil", "methotrexate",
        "vincristine", "cytarabine", "paclitaxel", "docetaxel", "doxorubicin",
        "cyclophosphamide", "ifosfamide", "gemcitabine", "oxaliplatin",
        "irinotecan", "topotecan", "bleomycin", "vinblastine", "dacarbazine",
        "bendamustine", "rituximab", "bevacizumab", "trastuzumab", "leucovorin",
        "mesna", "filgrastim", "pegfilgrastim", "zoledronic", "pamidronate",
        "azacitidine", "decitabine", "asparaginase", "idarubicin", "daunorubicin",
        "mitomycin", "thiotepa", "melphalan", "busulfan", "hydroxyurea",
    )),
    ("neuromuscular blocker", (
        "rocuronium", "succinylcholine", "vecuronium", "atracurium", "pancuronium",
        "cisatracurium", "sugammadex", "neostigmine",
    )),
    ("anticholinergic", (
        "atropine", "glycopyrrolate",
    )),
    ("benzodiazepine", (
        "midazolam", "lorazepam",
    )),
    ("anaesthesia", (
        "propofol", "etomidate", "ketamine", "dexmedetomidine",
        "sevoflurane", "isoflurane", "desflurane", "thiopental", "methohexital",
        "remifentanil", "sufentanil", "bupivacaine", "ropivacaine",
    )),
    ("vasopressor", (
        "norepinephrine", "vasopressin", "epinephrine", "phenylephrine",
        "dopamine", "dobutamine", "ephedrine", "milrinone", "isoproterenol",
    )),
    ("insulin", ("insulin",)),
    ("anticoagulant", (
        "heparin", "enoxaparin", "warfarin", "apixaban", "rivaroxaban",
        "dabigatran", "argatroban", "bivalirudin", "fondaparinux", "protamine",
        "alteplase", "tenecteplase",
    )),
    ("analgesic", (
        "morphine", "fentanyl", "hydromorphone", "oxycodone", "hydrocodone",
        "tramadol", "acetaminophen", "ibuprofen", "ketorolac", "naproxen",
        "aspirin", "celecoxib", "gabapentin", "pregabalin", "lidocaine",
        "codeine",
    )),
    ("antibiotic", (
        "vancomycin", "ceftriaxone", "cefazolin", "cefepime", "piperacillin",
        "meropenem", "ampicillin", "amoxicillin", "azithromycin", "ciprofloxacin",
        "levofloxacin", "metronidazole", "clindamycin", "linezolid", "daptomycin",
        "gentamicin", "tobramycin", "oxacillin", "nafcillin", "penicillin",
        "doxycycline", "sulfamethoxazole", "trimethoprim", "nitrofurantoin",
        "cephalexin", "cefuroxime", "ceftazidime", "ertapenem", "imipenem",
        "aztreonam", "fluconazole", "micafungin", "caspofungin", "voriconazole",
        "acyclovir", "valacyclovir", "oseltamivir", "ganciclovir", "cefotaxime",
    )),
    ("antiemetic", (
        "ondansetron", "metoclopramide", "prochlorperazine", "promethazine",
        "granisetron", "aprepitant", "fosaprepitant", "droperidol", "scopolamine",
        "meclizine",
    )),
    ("electrolyte", (
        "potassium chloride", "magnesium sulfate", "calcium chloride",
        "calcium gluconate", "sodium bicarbonate", "sodium phosphate",
        "potassium phosphate", "potassium acetate", "sodium acetate",
        "magnesium chloride", "calcium acetate",
    )),
    ("steroid", (
        "dexamethasone", "methylprednisolone", "hydrocortisone", "prednisone",
        "prednisolone", "betamethasone", "triamcinolone", "fludrocortisone",
        "budesonide",
    )),
    ("immunosuppressant", (
        "tacrolimus", "mycophenolate", "cyclosporine", "sirolimus", "azathioprine",
        "basiliximab", "antithymocyte", "everolimus", "belatacept",
    )),
    ("iv fluid", (
        "sodium chloride", "dextrose", "sterile water", "amino acid", "fat emulsion",
        "albumin", "hetastarch", "plasma protein", "water for injection",
    )),
    ("cardiovascular", (
        "metoprolol", "atenolol", "propranolol", "carvedilol", "labetalol",
        "amlodipine", "diltiazem", "verapamil", "amiodarone", "adenosine",
        "nitroglycerin", "isosorbide", "furosemide", "bumetanide", "torsemide",
        "hydrochlorothiazide", "spironolactone", "lisinopril", "enalapril",
        "losartan", "valsartan", "digoxin", "clopidogrel", "hydralazine",
        "nitroprusside", "nicardipine", "esmolol",
    )),
    ("gi", (
        "pantoprazole", "omeprazole", "esomeprazole", "lansoprazole", "famotidine",
        "ranitidine", "sucralfate", "polyethylene glycol", "lactulose", "docusate",
        "senna", "bisacodyl", "octreotide", "ursodiol", "mesalamine", "infliximab",
    )),
    ("cns", (
        "diazepam", "alprazolam", "clonazepam", "haloperidol",
        "olanzapine", "quetiapine", "risperidone", "aripiprazole", "sertraline",
        "fluoxetine", "escitalopram", "venlafaxine", "bupropion", "levetiracetam",
        "phenytoin", "fosphenytoin", "valproic", "divalproex", "carbamazepine",
        "lamotrigine", "topiramate", "zolpidem", "donepezil", "memantine",
        "sumatriptan", "baclofen", "cyclobenzaprine", "tizanidine",
    )),
]

CRITICAL_CLASSES = {
    "anaesthesia",
    "vasopressor",
    "neuromuscular blocker",
    "oncology",
    "benzodiazepine",
}

CRITICAL_DRUGS = (
    "epinephrine",
    "atropine",
    "sodium bicarbonate",
    "calcium chloride",
    "dextrose 50",
    "naloxone",
    "amiodarone",
    "adenosine",
    "lidocaine",
)

# Per-class base daily dispense units (General, main use).
CLASS_BASE_DAILY = {
    "antibiotic": 18.0,
    "anticoagulant": 12.0,
    "analgesic": 22.0,
    "anaesthesia": 8.0,
    "neuromuscular blocker": 4.0,
    "vasopressor": 6.0,
    "electrolyte": 15.0,
    "antiemetic": 10.0,
    "insulin": 14.0,
    "oncology": 3.5,
    "cardiovascular": 16.0,
    "gi": 11.0,
    "cns": 9.0,
    "steroid": 8.0,
    "immunosuppressant": 3.0,
    "iv fluid": 40.0,
    "anticholinergic": 4.0,
    "benzodiazepine": 7.0,
    "other": 5.0,
}

APPROVERS = (
    "Jordan Hale, PharmD",
    "Sam Rivera, MD",
    "Alex Morgan, PharmD",
    "Casey Nguyen, MD",
    "Riley Brooks, PharmD",
)


# ---------------------------------------------------------------------------
# NDC helpers
# ---------------------------------------------------------------------------

def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def to_ndc11(package_ndc: str) -> str:
    """Convert FDA 10-digit (dashed) package NDC to HIPAA 11-digit (no dashes).

    Formats: 4-4-2 → 0+4+4+2; 5-3-2 → 5+0+3+2; 5-4-1 → 5+4+0+1.
    """
    raw = (package_ndc or "").strip()
    digits_only = re.sub(r"\D", "", raw)
    if len(digits_only) == 11:
        return digits_only
    parts = raw.split("-")
    if len(parts) != 3:
        raise ValueError(f"unrecognized NDC format: {package_ndc!r}")
    a, b, c = parts
    if len(a) == 4 and len(b) == 4 and len(c) == 2:
        return f"0{a}{b}{c}"
    if len(a) == 5 and len(b) == 3 and len(c) == 2:
        return f"{a}0{b}{c}"
    if len(a) == 5 and len(b) == 4 and len(c) == 1:
        return f"{a}{b}0{c}"
    raise ValueError(f"unrecognized NDC segment lengths: {package_ndc!r}")


def ndc_digit_keys(package_ndc: str) -> set[str]:
    """Normalised digit strings used to match shortage-list NDCs to packages."""
    keys: set[str] = set()
    raw = (package_ndc or "").strip()
    if not raw:
        return keys
    digits = re.sub(r"\D", "", raw)
    if digits:
        keys.add(digits)
        if len(digits) == 11 and digits.startswith("0"):
            keys.add(digits[1:])
        if len(digits) == 10:
            keys.add("0" + digits)
            keys.add(digits[:5] + "0" + digits[5:])
            keys.add(digits[:9] + "0" + digits[9:])
            try:
                keys.add(to_ndc11(raw))
            except ValueError:
                pass
    try:
        keys.add(to_ndc11(raw))
    except ValueError:
        pass
    return {k for k in keys if k}


def ismp_human_text(text: str) -> str:
    """Apply ISMP error-prone abbreviation fixes to human-readable text."""
    if not text:
        return text
    s = str(text)
    s = s.replace("µg", "mcg")
    s = re.sub(r"(?<![A-Za-z])ug(?![A-Za-z])", "mcg", s, flags=re.I)
    s = re.sub(r"\[iU\]", "units", s, flags=re.I)
    s = re.sub(r"\[IU\]", "units", s)
    s = re.sub(r"\[USP'U\]", "USP units", s)
    # Leading-decimal strengths: ".1 mg/mL" → "0.1 mg/mL"
    s = re.sub(r"(^|[^\d])\.(\d)", r"\g<1>0.\2", s)
    return s


def parse_pack_size(description: str) -> int | None:
    """Best-effort pack size from FDA packaging description."""
    if not description:
        return None
    # Prefer trailing "N UNIT in 1 CONTAINER"
    m = re.search(
        r"(\d+(?:\.\d+)?)\s*(?:mL|g|mg|mcg|L|ea|each)?\s+in\s+1\s+\w+",
        description,
        re.I,
    )
    if m:
        try:
            return int(float(m.group(1)))
        except ValueError:
            pass
    m = re.match(r"(\d+)", description)
    if m:
        return int(m.group(1))
    return None


MEASURE_WORDS = {"ml", "l", "g", "mg", "mcg", "kg", "oz", "meq", "unit", "units"}


def parse_units_per_package(description: str) -> int:
    """Units of use in one package, from the outer segment of FDA's packaging description.

    "1 VIAL, MULTI-DOSE in 1 CARTON / 60 mL in 1 VIAL" -> 1 (vial); "100 TABLET in 1 BOTTLE" -> 100;
    "10 mL in 1 VIAL" -> 1 (the vial is the package). parse_pack_size above reads the inner volume (60), which
    is what Lakeside's descriptions print; East's pkg_size is a count, so it needs this one.
    """
    outer = (description or "").split(" / ")[0]
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s+([A-Za-z]+)", outer)
    if not m or m.group(2).lower() in MEASURE_WORDS:
        return 1
    try:
        return max(1, int(float(m.group(1))))
    except ValueError:
        return 1


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_marketed(product: dict[str, Any], as_of: date = AS_OF_DATE) -> bool:
    end = product.get("marketing_end_date") or ""
    if not end:
        return True
    try:
        y, m, d = int(end[:4]), int(end[4:6]), int(end[6:8])
        return date(y, m, d) >= as_of
    except (ValueError, IndexError):
        return True


def is_parenteral(dosage_form: str = "", route: str = "") -> bool:
    """True when dosage form or route indicates a parenteral product."""
    df = (dosage_form or "").upper()
    rt = (route or "").upper()
    if df.startswith(PARENTERAL_FORM_PREFIX) or PARENTERAL_FORM_PREFIX in df:
        return True
    for tok in PARENTERAL_FORM_CONTAINS:
        if tok in df:
            return True
    for tok in PARENTERAL_ROUTES:
        if tok in rt or tok in df:
            return True
    return False


def assign_class(generic_name: str, dosage_form: str = "", route: str = "") -> str:
    g = normalize_ws(generic_name)
    df = normalize_ws(dosage_form)
    blob = f"{g} {df}"
    # Benzodiazepine class is for midazolam / lorazepam injectables only.
    if any(k in g for k in ("midazolam", "lorazepam")):
        if is_parenteral(dosage_form, route):
            return "benzodiazepine"
        # Non-injectable forms fall through (CNS / other).
        for cls, keys in CLASS_KEYWORDS:
            if cls == "benzodiazepine":
                continue
            for k in keys:
                if k in blob:
                    return cls
        return "other"
    for cls, keys in CLASS_KEYWORDS:
        for k in keys:
            if k in blob:
                return cls
    return "other"


def is_critical(generic_name: str, therapeutic_class: str, dosage_form: str = "") -> bool:
    if therapeutic_class in CRITICAL_CLASSES:
        return True
    g = normalize_ws(generic_name)
    df = normalize_ws(dosage_form)
    for drug in CRITICAL_DRUGS:
        if drug in g:
            if drug == "lidocaine" and "inject" not in df and "inject" not in g:
                continue
            if drug == "dextrose 50" and "50" not in g and "50%" not in g:
                continue
            return True
    return False


def sql_str(s: Any) -> str:
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def sql_bool(b: bool) -> str:
    return "TRUE" if b else "FALSE"


def sql_num(n: Any) -> str:
    if n is None:
        return "NULL"
    if isinstance(n, float):
        return f"{n:.4f}".rstrip("0").rstrip(".") if "." in f"{n:.4f}" else str(int(n))
    return str(n)


# ---------------------------------------------------------------------------
# Load inputs
# ---------------------------------------------------------------------------

def load_ndc_products(path: Path) -> list[dict[str, Any]]:
    """Load HUMAN PRESCRIPTION DRUG products that are currently marketed."""
    products: list[dict[str, Any]] = []
    try:
        import ijson  # type: ignore

        with open(path, "rb") as f:
            for item in ijson.items(f, "results.item"):
                if item.get("product_type") != "HUMAN PRESCRIPTION DRUG":
                    continue
                if not is_marketed(item):
                    continue
                if not item.get("packaging"):
                    continue
                products.append(item)
        return products
    except ImportError:
        pass

    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for item in data.get("results", []):
        if item.get("product_type") != "HUMAN PRESCRIPTION DRUG":
            continue
        if not is_marketed(item):
            continue
        if not item.get("packaging"):
            continue
        products.append(item)
    return products


def build_ndc_index(
    products: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    idx: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in products:
        key = normalize_ws(p.get("generic_name") or "")
        if key:
            idx[key].append(p)
    return idx


def load_shortage_injectables(path: Path, cap: int = 130) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            statuses = r.get("statuses") or ""
            if "Current" not in statuses:
                continue
            name = (r.get("generic") or "").lower()
            if not any(k in name for k in INJECTABLE_KEYS):
                continue
            rows.append(r)
    rows.sort(
        key=lambda r: (-int(r.get("n_companies") or 0), r.get("generic") or ""),
    )
    return rows[:cap]


def load_common_generics(path: Path) -> list[str]:
    lines: list[str] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            lines.append(line)
    return lines


def load_scenarios(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.is_file():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and "scenarios" in data:
        return list(data["scenarios"])
    if isinstance(data, list):
        return data
    raise ValueError("scenarios file must be a JSON list or {scenarios: [...]}")


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

_FORM_SUFFIXES = sorted(
    [
        "for injection",
        "injectable emulsion",
        "injection solution",
        "injection",
        "injectable",
        "infusion",
        "emulsion",
        "vial",
        "solution",
        "suspension",
        "tablet",
        "capsule",
        "cream",
        "ointment",
        "powder",
        "bags",
        "syringes",
        "auto-injector",
    ],
    key=len,
    reverse=True,
)


def split_generic_and_form(raw: str) -> tuple[str, str | None]:
    """Split 'Cisplatin Injection' / 'vancomycin | injection' into name + form hint."""
    s = raw.strip()
    if "|" in s:
        left, right = s.split("|", 1)
        return left.strip(), right.strip() or None
    low = s.lower()
    for suf in _FORM_SUFFIXES:
        if low.endswith(" " + suf):
            return s[: len(s) - len(suf)].strip(" -,"), suf
        if low.endswith("," + suf) or low.endswith(", " + suf):
            return re.sub(r",?\s*" + re.escape(suf) + r"\s*$", "", s, flags=re.I).strip(), suf
    return s, None


def strip_parenthetical(s: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", s).strip()


def dosage_form_matches(dosage_form: str, hint: str | None) -> bool:
    if not hint:
        return True
    df = normalize_ws(dosage_form)
    h = normalize_ws(hint)
    if h in df or df in h:
        return True
    # Map common shortage wording onto FDA dosage_form tokens.
    inject_hints = ("injection", "injectable", "for injection", "vial", "infusion", "emulsion")
    if any(x in h for x in inject_hints):
        return any(
            t in df
            for t in (
                "injection",
                "injectable",
                "infusion",
                "emulsion",
                "solution",
                "powder",
                "lyophilized",
            )
        )
    return False


def candidate_keys(base: str) -> list[str]:
    """Generate normalized lookup keys for a generic base name."""
    keys: list[str] = []
    b = strip_parenthetical(base)
    b = re.sub(r",\s*", " ", b)
    # Drop trailing strength / percent clauses for matching.
    b2 = re.sub(
        r"\s+\d+(\.\d+)?\s*%(\s|$)",
        " ",
        b,
        flags=re.I,
    )
    b2 = re.sub(
        r"\s+\d+(\.\d+)?\s*(mg|mcg|g|ml|meq)/?\w*.*$",
        "",
        b2,
        flags=re.I,
    )
    b2 = re.sub(
        r"\s+(concentrate|bags|syringes|auto-injector|lyophilized powder|"
        r"protein-bound particles|adult and pediatric).*$",
        "",
        b2,
        flags=re.I,
    )
    for candidate in (base, b, b2):
        n = normalize_ws(candidate)
        if n and n not in keys:
            keys.append(n)
    # Salt / hydrate variants: try adding common suffixes if bare molecule.
    extras: list[str] = []
    for n in keys:
        for suf in (
            " hydrochloride",
            " sodium",
            " sulfate",
            " bitartrate",
            " acetate",
            " phosphate",
            " mesylate",
            " potassium",
            " calcium",
            " injectable emulsion",
        ):
            extras.append(n + suf)
        # Drop trailing salt words to find bare form.
        for suf in (
            " hydrochloride",
            " sodium",
            " sulfate",
            " bitartrate",
            " acetate",
            " phosphate",
            " mesylate",
            " potassium",
            " calcium",
            " trihydrate",
            " heptahydrate",
        ):
            if n.endswith(suf):
                extras.append(n[: -len(suf)].strip())
    for e in extras:
        e = normalize_ws(e)
        if e and e not in keys:
            keys.append(e)
    return keys


def find_matching_products(
    generic_line: str,
    idx: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    base, form_hint = split_generic_and_form(generic_line)
    hits: list[dict[str, Any]] = []
    seen_ndc: set[str] = set()
    for key in candidate_keys(base):
        for p in idx.get(key, []):
            if not dosage_form_matches(p.get("dosage_form") or "", form_hint):
                continue
            pndc = p.get("product_ndc") or ""
            if pndc in seen_ndc:
                continue
            seen_ndc.add(pndc)
            hits.append(p)
        if hits:
            break
    # Fallback: substring match on index keys (conservative).
    if not hits:
        nbase = normalize_ws(strip_parenthetical(base))
        if len(nbase) >= 5:
            for key, plist in idx.items():
                if nbase == key or key.startswith(nbase + " ") or nbase.startswith(key + " "):
                    for p in plist:
                        if not dosage_form_matches(p.get("dosage_form") or "", form_hint):
                            continue
                        pndc = p.get("product_ndc") or ""
                        if pndc in seen_ndc:
                            continue
                        seen_ndc.add(pndc)
                        hits.append(p)
                    if hits:
                        break
    return hits


def pick_packages(
    products: list[dict[str, Any]],
    rng: random.Random,
    n: int | None = None,
) -> list[dict[str, Any]]:
    """Pick 1–3 package NDCs, preferring distinct labelers."""
    if n is None:
        n = rng.randint(1, 3)
    # Flatten packages with product metadata.
    pkgs: list[dict[str, Any]] = []
    for p in products:
        for pack in p.get("packaging") or []:
            pkg_ndc = pack.get("package_ndc")
            if not pkg_ndc:
                continue
            try:
                ndc11 = to_ndc11(pkg_ndc)
            except ValueError:
                continue
            openfda = p.get("openfda") or {}
            ings = p.get("active_ingredients") or []
            strength = ""
            if ings:
                strength = ings[0].get("strength") or ""
            route = p.get("route") or []
            if isinstance(route, list):
                route_s = "|".join(route)
            else:
                route_s = str(route)
            pkgs.append({
                "strength_raw": strength,
                "product_ndc": p.get("product_ndc"),
                "package_ndc": pkg_ndc,
                "ndc11": ndc11,
                "labeler_name": p.get("labeler_name") or "",
                "brand_name": p.get("brand_name") or "",
                "generic_name": p.get("generic_name") or "",
                "dosage_form": p.get("dosage_form") or "",
                "route": route_s,
                "active_ingredients": ings,
                "strength": ismp_human_text(strength),
                "manufacturer_name": (openfda.get("manufacturer_name") or [None])[0],
                "spl_set_id": (openfda.get("spl_set_id") or [None])[0],
                "packaging_description": pack.get("description") or "",
                "pack_size": parse_pack_size(pack.get("description") or ""),
                "units_per_pkg": parse_units_per_package(pack.get("description") or ""),
            })
    if not pkgs:
        return []
    rng.shuffle(pkgs)
    chosen: list[dict[str, Any]] = []
    used_labelers: set[str] = set()
    # First: greedy distinct labelers.
    for pkg in pkgs:
        if len(chosen) >= n:
            break
        lab = normalize_ws(pkg["labeler_name"])
        if lab in used_labelers and len(chosen) > 0:
            continue
        chosen.append(pkg)
        used_labelers.add(lab)
    # Fill remaining ignoring labeler constraint.
    if len(chosen) < n:
        for pkg in pkgs:
            if len(chosen) >= n:
                break
            if pkg["ndc11"] in {c["ndc11"] for c in chosen}:
                continue
            chosen.append(pkg)
    return chosen[:n]


def build_package_index(products: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Every marketed package, keyed by each normalised digit form of its NDC."""
    index: dict[str, dict[str, Any]] = {}
    for p in products:
        for pkg in pick_packages([p], random.Random(0), n=10_000):
            for key in ndc_digit_keys(pkg["package_ndc"]):
                index.setdefault(key, pkg)
    return index


def pick_distinct_labelers(pkgs: list[dict[str, Any]], n: int) -> list[dict[str, Any]]:
    """First package of each labeler in listing order, up to n."""
    chosen: list[dict[str, Any]] = []
    labelers: set[str] = set()
    for pkg in pkgs:
        lab = normalize_ws(pkg["labeler_name"])
        if lab in labelers:
            continue
        labelers.add(lab)
        chosen.append(pkg)
        if len(chosen) >= n:
            break
    return chosen


# ---------------------------------------------------------------------------
# Formulary build
# ---------------------------------------------------------------------------

def build_formulary(
    ndc_products: list[dict[str, Any]],
    shortage_rows: list[dict[str, str]],
    common_lines: list[str],
    rng: random.Random,
) -> list[dict[str, Any]]:
    idx = build_ndc_index(ndc_products)
    pkg_index = build_package_index(ndc_products)
    items: list[dict[str, Any]] = []
    seen_ndc11: set[str] = set()

    # Shortage injectables first (~120, hard cap 130). One package per shortage
    # generic by default; occasionally 2–3 when alternate labelers exist.
    shortage_item_cap = 130
    shortage_target = 120
    for row in shortage_rows:
        n_shortage = sum(1 for i in items if i["from_shortage"])
        if n_shortage >= shortage_item_cap:
            break
        # Prefer the exact package NDCs FDA lists for this shortage (FIXES-1 rule 1).
        listed = []
        for raw_ndc in (row.get("ndcs") or "").split("|"):
            for key in ndc_digit_keys(raw_ndc):
                pkg = pkg_index.get(key)
                if pkg and is_parenteral(pkg["dosage_form"], pkg["route"]) and pkg not in listed:
                    listed.append(pkg)
                    break
        if listed:
            ndc_source = "fda_shortage_listing"
            packages = pick_distinct_labelers(listed, 2 if n_shortage < shortage_target else 1)
        else:
            ndc_source = "directory_search"
            products = [
                p for p in find_matching_products(row["generic"], idx)
                if is_parenteral(p.get("dosage_form") or "", "|".join(p.get("route") or []))
            ]
            if not products:
                continue
            packages = pick_packages(products, rng, n=1)
        for pkg in packages:
            if pkg["ndc11"] in seen_ndc11:
                continue
            if sum(1 for i in items if i["from_shortage"]) >= shortage_item_cap:
                break
            gname = pkg["generic_name"]
            tclass = assign_class(gname, pkg["dosage_form"])
            items.append({
                **pkg,
                "source_query": row["generic"],
                "ndc_source": ndc_source,
                "from_shortage": True,
                "therapeutic_class": tclass,
                "is_critical": is_critical(gname, tclass, pkg["dosage_form"]),
                "unit_of_use": _unit_of_use(pkg),
            })
            seen_ndc11.add(pkg["ndc11"])

    # Common hospital drugs (~230 additional).
    common_target = 230
    for line in common_lines:
        n_common = sum(1 for i in items if not i["from_shortage"])
        if n_common >= common_target:
            break
        products = find_matching_products(line, idx)
        if not products:
            continue
        # One package per line keeps the count near 230.
        n_pkg = 1 if n_common >= common_target - 20 or rng.random() < 0.9 else 2
        packages = pick_packages(products, rng, n=n_pkg)
        for pkg in packages:
            if pkg["ndc11"] in seen_ndc11:
                continue
            if sum(1 for i in items if not i["from_shortage"]) >= common_target:
                break
            gname = pkg["generic_name"]
            tclass = assign_class(gname, pkg["dosage_form"])
            items.append({
                **pkg,
                "source_query": line,
                "ndc_source": "directory_search",
                "from_shortage": False,
                "therapeutic_class": tclass,
                "is_critical": is_critical(gname, tclass, pkg["dosage_form"]),
                "unit_of_use": _unit_of_use(pkg),
            })
            seen_ndc11.add(pkg["ndc11"])

    # Stable order for determinism beyond RNG: shortage first, then by generic/ndc.
    items.sort(
        key=lambda i: (
            0 if i["from_shortage"] else 1,
            normalize_ws(i["generic_name"]),
            i["ndc11"],
        )
    )
    # Assign sequential item ids after sort.
    for i, item in enumerate(items, start=1):
        item["item_id"] = i
    return items


# ---------------------------------------------------------------------------
# Therapeutic interchange (FIXES-1 rule 2)
# ---------------------------------------------------------------------------

def molecule_key(item: dict[str, Any]) -> str:
    """First active ingredient, normalised; falls back to the generic name."""
    ings = item.get("active_ingredients") or []
    name = (ings[0].get("name") if ings else "") or item.get("generic_name") or ""
    return normalize_ws(name)


def route_set(item: dict[str, Any]) -> set[str]:
    return {r.strip().upper() for r in (item.get("route") or "").split("|") if r.strip()}


def routes_compatible(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Same route family: they share a route, and both are parenteral or both are not."""
    if is_parenteral(a.get("dosage_form", ""), a.get("route", "")) != is_parenteral(
        b.get("dosage_form", ""), b.get("route", "")
    ):
        return False
    return bool(route_set(a) & route_set(b))


def build_interchange_pairs(items: list[dict[str, Any]]) -> list[tuple[dict, dict, str, str]]:
    by_mol: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for i in items:
        by_mol[molecule_key(i)].append(i)
    pairs: list[tuple[dict, dict, str, str]] = []
    seen: set[tuple[int, int]] = set()

    def add(src: dict, alt: dict, rule: str, note: str) -> None:
        key = (src["item_id"], alt["item_id"])
        if src["item_id"] == alt["item_id"] or src["ndc11"] == alt["ndc11"] or key in seen:
            return
        seen.add(key)
        pairs.append((src, alt, rule, note))

    for src in sorted((i for i in items if i["from_shortage"]), key=lambda i: i["item_id"]):
        mol = molecule_key(src)
        same = [x for x in by_mol[mol] if x["item_id"] != src["item_id"]]
        alt_mfr = [
            x for x in same
            if (x.get("strength_raw") or x["strength"]) == (src.get("strength_raw") or src["strength"])
            and normalize_ws(x["dosage_form"]) == normalize_ws(src["dosage_form"])
            and routes_compatible(src, x)
            and normalize_ws(x["labeler_name"]) != normalize_ws(src["labeler_name"])
        ]
        if alt_mfr:
            add(src, alt_mfr[0], RULE_ALT_MFR,
                f"Same product from {alt_mfr[0]['labeler_name']}; substitute NDC, no clinical change.")
            continue
        alt_conc = [x for x in same if routes_compatible(src, x)]
        if alt_conc:
            add(src, alt_conc[0], RULE_ALT_CONC,
                "Recalculate dose and volume; pharmacist verification required.")
            continue
        if any(m in mol for m in IV_TO_PO_MOLECULES) and is_parenteral(src["dosage_form"], src["route"]):
            oral = [x for x in same if "ORAL" in route_set(x)]
            if oral:
                add(src, oral[0], RULE_IV_PO,
                    "Patients able to take oral medication, per the P&T IV-to-PO protocol.")

    # The one cross-molecule pair, and only in this direction.
    cis = [i for i in items if "cisplatin" in molecule_key(i) and i["from_shortage"]]
    carbo = [i for i in items if molecule_key(i).startswith("carboplatin")]
    if cis and carbo:
        add(cis[0], carbo[0], RULE_ONC,
            "Not interchangeable in all regimens; per treating oncologist.")
    return pairs


def _unit_of_use(pkg: dict[str, Any]) -> str:
    desc = (pkg.get("packaging_description") or "").lower()
    df = (pkg.get("dosage_form") or "").lower()
    if "vial" in desc or "vial" in df:
        return "vial"
    if "syringe" in desc:
        return "syringe"
    if "bag" in desc or "injection" in df:
        return "bag" if "bag" in desc else "each"
    if "tablet" in df:
        return "tablet"
    if "capsule" in df:
        return "capsule"
    return "each"


# ---------------------------------------------------------------------------
# Scenario helpers
# ---------------------------------------------------------------------------

def scenario_map(scenarios: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for s in scenarios:
        g = normalize_ws(s.get("generic") or "")
        if g:
            out[g] = s
    return out


def find_scenario(item: dict[str, Any], smap: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        normalize_ws(item.get("source_query") or ""),
        normalize_ws(item.get("generic_name") or ""),
        normalize_ws(split_generic_and_form(item.get("source_query") or "")[0]),
    ]
    for c in candidates:
        if c in smap:
            return smap[c]
        # Loose: scenario generic contained in item or vice versa.
    for key, sc in smap.items():
        for c in candidates:
            if key and c and (key in c or c in key):
                return sc
    return None


# ---------------------------------------------------------------------------
# Dispense / inventory simulation
# ---------------------------------------------------------------------------

def daily_base(item: dict[str, Any]) -> float:
    base = CLASS_BASE_DAILY.get(item["therapeutic_class"], CLASS_BASE_DAILY["other"])
    if item["is_critical"]:
        base *= 1.15
    # Scale down a bit for smaller packs / oncology.
    if item["therapeutic_class"] == "oncology":
        base = max(1.0, base)
    return base


def simulate_dispense(
    items: list[dict[str, Any]],
    rng: random.Random,
) -> dict[int, list[tuple[date, float]]]:
    """Return item_id -> list of (day, units) for DISPENSE_DAYS ending AS_OF_DATE."""
    start = AS_OF_DATE - timedelta(days=DISPENSE_DAYS - 1)
    out: dict[int, list[tuple[date, float]]] = {}
    for item in items:
        base = daily_base(item)
        series: list[tuple[date, float]] = []
        for i in range(DISPENSE_DAYS):
            day = start + timedelta(days=i)
            weekday = day.weekday()  # 0=Mon
            if item["therapeutic_class"] == "oncology" and weekday >= 5:
                units = 0.0
            else:
                factor = 1.0 if weekday < 5 else 0.55
                noise = rng.uniform(0.7, 1.3)
                units = round(base * factor * noise, 2)
                if units < 0.01:
                    units = 0.0
            series.append((day, units))
        out[item["item_id"]] = series
    return out


def avg_daily_use(series: list[tuple[date, float]], last_n: int = 28) -> float:
    recent = series[-last_n:] if len(series) >= last_n else series
    if not recent:
        return 0.0
    return sum(u for _, u in recent) / len(recent)


# ---------------------------------------------------------------------------
# Hospital 1: Corvale General
# ---------------------------------------------------------------------------

def write_corvale_general(
    out_dir: Path,
    items: list[dict[str, Any]],
    dispense: dict[int, list[tuple[date, float]]],
    scenarios: list[dict[str, Any]],
    rng: random.Random,
) -> dict[str, Any]:
    smap = scenario_map(scenarios)
    inventory_rows: list[tuple] = []
    po_rows: list[tuple] = []
    ti_rows: list[tuple] = []

    # Inventory
    for item in items:
        series = dispense[item["item_id"]]
        avg = avg_daily_use(series)
        sc = find_scenario(item, smap)
        days_on_hand = None
        if sc and isinstance(sc.get("general"), dict):
            days_on_hand = sc["general"].get("days_on_hand")

        shares = {
            "main pharmacy": 0.45,
            "OR satellite": 0.15,
            "oncology infusion": 0.15 if item["therapeutic_class"] == "oncology" else 0.05,
            "ED": 0.15,
            "ICU": 0.20,
        }
        total_share = sum(shares.values())
        for loc in CG_LOCATIONS:
            share = shares[loc]
            par = max(1.0, round(avg * 14 * share * rng.uniform(0.9, 1.1), 2))
            if days_on_hand is not None:
                # The scenario sets the hospital-wide total; each location holds its share of it.
                qty = round(avg * float(days_on_hand) * share / total_share, 2)
            else:
                # Typical 5–20 days on hand at main; less at satellites.
                doh = rng.uniform(3, 18) if loc != "main pharmacy" else rng.uniform(7, 25)
                if item["from_shortage"]:
                    doh *= rng.uniform(0.35, 0.8)
                qty = round(avg * doh * share / 0.45, 2) if loc == "main pharmacy" else round(par * rng.uniform(0.4, 1.2), 2)
            inventory_rows.append((
                item["item_id"], loc, qty, par, AS_OF.isoformat(),
            ))

    # Purchase orders
    po_n = 0
    for item in items:
        n_orders = rng.randint(1, 4)
        for _ in range(n_orders):
            po_n += 1
            status_roll = rng.random()
            if item["from_shortage"]:
                # Backorders cluster on shortage drugs.
                if status_roll < 0.45:
                    status = "backordered"
                elif status_roll < 0.65:
                    status = "partial"
                elif status_roll < 0.90:
                    status = "filled"
                else:
                    status = "cancelled"
            else:
                if status_roll < 0.75:
                    status = "filled"
                elif status_roll < 0.85:
                    status = "partial"
                elif status_roll < 0.93:
                    status = "backordered"
                else:
                    status = "cancelled"
            ordered_at = AS_OF - timedelta(days=rng.randint(1, 120), hours=rng.randint(0, 23))
            po_rows.append((
                f"PO-CG-{po_n:06d}",
                item["item_id"],
                item["ndc11"],
                rng.choice(WHOLESALERS),
                rng.randint(1, 40),
                round(rng.uniform(1.5, 450.0), 2),
                ordered_at.isoformat(),
                status,
            ))

    # Therapeutic interchange: only pairs a P&T committee could defend (FIXES-1 rule 2).
    pairs = build_interchange_pairs(items)

    for src, alt, rule, note in pairs:
        ti_rows.append((
            src["item_id"],
            alt["item_id"],
            rule,
            rng.choice(APPROVERS),
            (AS_OF_DATE - timedelta(days=rng.randint(30, 400))).isoformat(),
            note,
        ))

    path = out_dir / "corvale_general.sql"
    with open(path, "w", encoding="utf-8") as f:
        f.write("-- Corvale General (cg) synthetic pharmacy data\n")
        f.write("DROP SCHEMA IF EXISTS cg CASCADE;\n")
        f.write("CREATE SCHEMA cg;\n\n")
        f.write("""CREATE TABLE cg.formulary_item (
  item_id serial PRIMARY KEY,
  ndc11 char(11) NOT NULL,
  generic_name text,
  strength text,
  dosage_form text,
  route text,
  therapeutic_class text,
  is_critical boolean,
  unit_of_use text
);\n\n""")
        f.write("""CREATE TABLE cg.inventory_snapshot (
  item_id int REFERENCES cg.formulary_item(item_id),
  location text,
  qty_units numeric,
  par_units numeric,
  as_of timestamptz
);\n\n""")
        f.write("""CREATE TABLE cg.dispense_daily (
  item_id int REFERENCES cg.formulary_item(item_id),
  day date,
  units numeric
);\n\n""")
        f.write("""CREATE TABLE cg.purchase_order (
  po_id text PRIMARY KEY,
  item_id int REFERENCES cg.formulary_item(item_id),
  ndc11 char(11),
  wholesaler text,
  qty_packages int,
  unit_cost_usd numeric,
  ordered_at timestamptz,
  status text
);\n\n""")
        f.write("""CREATE TABLE cg.therapeutic_interchange (
  item_id int REFERENCES cg.formulary_item(item_id),
  alt_item_id int REFERENCES cg.formulary_item(item_id),
  rule text,
  approved_by text,
  approved_on date,
  notes text
);\n\n""")

        f.write("INSERT INTO cg.formulary_item "
                "(item_id, ndc11, generic_name, strength, dosage_form, route, "
                "therapeutic_class, is_critical, unit_of_use) VALUES\n")
        fi_vals = []
        for item in items:
            fi_vals.append(
                f"  ({item['item_id']}, {sql_str(item['ndc11'])}, "
                f"{sql_str(item['generic_name'])}, {sql_str(item['strength'])}, "
                f"{sql_str(item['dosage_form'])}, {sql_str(item['route'])}, "
                f"{sql_str(item['therapeutic_class'])}, {sql_bool(item['is_critical'])}, "
                f"{sql_str(item['unit_of_use'])})"
            )
        f.write(",\n".join(fi_vals))
        f.write(";\n\n")
        # Reset serial
        f.write(
            f"SELECT setval(pg_get_serial_sequence('cg.formulary_item','item_id'), "
            f"{items[-1]['item_id'] if items else 1});\n\n"
        )

        f.write("INSERT INTO cg.inventory_snapshot "
                "(item_id, location, qty_units, par_units, as_of) VALUES\n")
        f.write(",\n".join(
            f"  ({iid}, {sql_str(loc)}, {sql_num(qty)}, {sql_num(par)}, {sql_str(aso)})"
            for iid, loc, qty, par, aso in inventory_rows
        ))
        f.write(";\n\n")

        f.write("INSERT INTO cg.dispense_daily (item_id, day, units) VALUES\n")
        d_vals = []
        for item in items:
            for day, units in dispense[item["item_id"]]:
                d_vals.append(
                    f"  ({item['item_id']}, {sql_str(day.isoformat())}, {sql_num(units)})"
                )
        f.write(",\n".join(d_vals))
        f.write(";\n\n")

        f.write("INSERT INTO cg.purchase_order "
                "(po_id, item_id, ndc11, wholesaler, qty_packages, unit_cost_usd, "
                "ordered_at, status) VALUES\n")
        f.write(",\n".join(
            f"  ({sql_str(po)}, {iid}, {sql_str(ndc)}, {sql_str(wh)}, {qty}, "
            f"{sql_num(cost)}, {sql_str(oa)}, {sql_str(st)})"
            for po, iid, ndc, wh, qty, cost, oa, st in po_rows
        ))
        f.write(";\n\n")

        if ti_rows:
            f.write("INSERT INTO cg.therapeutic_interchange "
                    "(item_id, alt_item_id, rule, approved_by, approved_on, notes) VALUES\n")
            f.write(",\n".join(
                f"  ({a}, {b}, {sql_str(rule)}, {sql_str(who)}, {sql_str(when)}, {sql_str(notes)})"
                for a, b, rule, who, when, notes in ti_rows
            ))
            f.write(";\n")

    return {
        "formulary_items": len(items),
        "inventory_rows": len(inventory_rows),
        "dispense_rows": sum(len(v) for v in dispense.values()),
        "purchase_orders": len(po_rows),
        "therapeutic_interchanges": len(ti_rows),
    }


# ---------------------------------------------------------------------------
# Hospital 2: Corvale East
# ---------------------------------------------------------------------------

def abbreviate_mfr(name: str) -> str:
    name = (name or "UNK").strip()
    # Take first two tokens, uppercase, max ~18 chars.
    parts = re.split(r"[\s,]+", name)
    abbr = " ".join(parts[:2]).upper()
    return abbr[:18]


def east_description(item: dict[str, Any], strength: str) -> str:
    """East's item master style: 'CARBOPLATIN 10MG/ML 60ML MDV' (upper case, compact units, container code)."""
    name = re.sub(r"\s*\(.*?\)", "", item["generic_name"]).upper()
    s = re.sub(r"\s+", "", (strength or "").upper()).replace("/1", "")
    pack = (item.get("packaging_description") or "").upper()
    vol = re.search(r"(\d+(?:\.\d+)?)\s*ML IN 1 (VIAL|BAG|SYRINGE|AMPULE|BOTTLE|CARTRIDGE)", pack)
    kind = vol.group(2) if vol else ""
    code = {"VIAL": "MDV" if "MULTI-DOSE" in pack else "SDV", "BAG": "BAG", "SYRINGE": "SYR", "AMPULE": "AMP", "BOTTLE": "BTL", "CARTRIDGE": "CART"}.get(kind, "")
    form = (item.get("dosage_form") or "").upper()
    if not code:
        code = "TAB" if "TABLET" in form else "CAP" if "CAPSULE" in form else ""
    parts = [name, s, f"{vol.group(1)}ML" if vol else "", code]
    return re.sub(r"\s+", " ", " ".join(x for x in parts if x)).strip()[:60]


def write_corvale_east(
    out_dir: Path,
    general_items: list[dict[str, Any]],
    ndc_products: list[dict[str, Any]],
    scenarios: list[dict[str, Any]],
    rng: random.Random,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    smap = scenario_map(scenarios)
    # ~85% of General + ~20 East-only.
    n_overlap = max(1, int(round(len(general_items) * 0.85)))
    overlap = list(general_items)
    rng.shuffle(overlap)
    overlap = overlap[:n_overlap]

    # East-only: pick packages not in General.
    general_ndcs = {i["ndc11"] for i in general_items}
    idx = build_ndc_index(ndc_products)
    east_only: list[dict[str, Any]] = []
    # Draw from unmatched commons / random marketed injectables.
    candidates = [p for p in ndc_products if "INJECTION" in (p.get("dosage_form") or "").upper()]
    rng.shuffle(candidates)
    for p in candidates:
        if len(east_only) >= EAST_ONLY_EXTRA:
            break
        pkgs = pick_packages([p], rng, n=1)
        if not pkgs:
            continue
        pkg = pkgs[0]
        if pkg["ndc11"] in general_ndcs:
            continue
        if pkg["ndc11"] in {e["ndc11"] for e in east_only}:
            continue
        tclass = assign_class(pkg["generic_name"], pkg["dosage_form"])
        east_only.append({
            **pkg,
            "source_query": pkg["generic_name"],
            "from_shortage": False,
            "therapeutic_class": tclass,
            "is_critical": is_critical(pkg["generic_name"], tclass, pkg["dosage_form"]),
            "unit_of_use": _unit_of_use(pkg),
            "east_only": True,
        })

    east_items = overlap + east_only
    # Stable-ish order then assign East ids.
    east_items.sort(key=lambda i: (i["ndc11"],))
    for i, item in enumerate(east_items, start=1):
        item = dict(item)
        item["east_id"] = f"E-{i:06d}"
        east_items[i - 1] = item

    # Stock + weekly usage
    stock_rows: list[tuple] = []
    usage_rows: list[tuple] = []
    week0 = AS_OF_DATE - timedelta(days=AS_OF_DATE.weekday())  # Monday on/before as_of
    # Align to start of 26-week window.
    first_week = week0 - timedelta(weeks=EAST_WEEKS - 1)

    for item in east_items:
        sc = find_scenario(item, smap)
        # Skip lakeside-absent style; east surplus handled here.
        base_weekly = daily_base(item) * 5.5  # weekday-weighted
        reorder = max(1, int(round(base_weekly * rng.uniform(1.5, 3.0))))
        if sc and isinstance(sc.get("east"), dict) and "surplus_pkgs" in sc["east"]:
            on_hand = reorder + int(sc["east"]["surplus_pkgs"])
        else:
            on_hand = max(0, int(round(reorder * rng.uniform(0.3, 2.2))))
            if item.get("from_shortage"):
                on_hand = max(0, int(round(reorder * rng.uniform(0.1, 0.9))))
        # Simulated in units of use like the other hospitals, stored the way East counts: in packages.
        upp = item.get("units_per_pkg") or 1
        stock_rows.append((
            item["east_id"],
            round(on_hand / upp, 4),
            round(reorder / upp, 4),
            AS_OF.isoformat(),
        ))
        for w in range(EAST_WEEKS):
            ws = first_week + timedelta(weeks=w)
            used = round(base_weekly * rng.uniform(0.6, 1.4), 2)
            usage_rows.append((item["east_id"], ws.isoformat(), round(used / upp, 4)))

    path = out_dir / "corvale_east.sql"
    with open(path, "w", encoding="utf-8") as f:
        f.write("-- Corvale East (east) synthetic pharmacy data\n")
        f.write("-- pack sizes: pkg_size is units of use per package; stock and usage are in packages\n")
        f.write("DROP SCHEMA IF EXISTS east CASCADE;\n")
        f.write("CREATE SCHEMA east;\n\n")
        f.write("""CREATE TABLE east.items (
  id text PRIMARY KEY,
  descr text,
  mfr text,
  pkg_ndc text,
  pkg_size int,
  uom text
);\n\n""")
        f.write("""CREATE TABLE east.stock (
  id text REFERENCES east.items(id),
  on_hand_pkgs numeric,
  reorder_pt_pkgs numeric,
  counted_at timestamptz
);\n\n""")
        f.write("""CREATE TABLE east.usage_weekly (
  id text REFERENCES east.items(id),
  week_start date,
  pkgs_used numeric
);\n\n""")

        f.write("INSERT INTO east.items (id, descr, mfr, pkg_ndc, pkg_size, uom) VALUES\n")
        ivals = []
        for item in east_items:
            strength = item.get("strength") or ""
            descr = east_description(item, strength)
            # East counts stock in packages: pkg_size is how many units of use (uom) one package holds.
            pkg_size = item.get("units_per_pkg") or 1
            ivals.append(
                f"  ({sql_str(item['east_id'])}, {sql_str(descr)}, "
                f"{sql_str(abbreviate_mfr(item['labeler_name']))}, "
                f"{sql_str(item['package_ndc'])}, {int(pkg_size)}, "
                f"{sql_str(item.get('unit_of_use') or 'each')})"
            )
        f.write(",\n".join(ivals))
        f.write(";\n\n")

        f.write("INSERT INTO east.stock (id, on_hand_pkgs, reorder_pt_pkgs, counted_at) VALUES\n")
        f.write(",\n".join(
            f"  ({sql_str(i)}, {sql_num(oh)}, {sql_num(rp)}, {sql_str(ct)})"
            for i, oh, rp, ct in stock_rows
        ))
        f.write(";\n\n")

        f.write("INSERT INTO east.usage_weekly (id, week_start, pkgs_used) VALUES\n")
        f.write(",\n".join(
            f"  ({sql_str(i)}, {sql_str(ws)}, {sql_num(u)})"
            for i, ws, u in usage_rows
        ))
        f.write(";\n")

    counts = {
        "items": len(east_items),
        "overlap_with_general": n_overlap,
        "east_only": len(east_only),
        "stock_rows": len(stock_rows),
        "usage_rows": len(usage_rows),
    }
    return east_items, counts


# ---------------------------------------------------------------------------
# Hospital 3: Lakeside
# ---------------------------------------------------------------------------

def tall_man_name(generic: str) -> str:
    g = generic
    low = g.lower()
    for key, repl in TALL_MAN.items():
        if key in low:
            # Replace case-insensitively once.
            return re.sub(re.escape(key), repl, g, count=1, flags=re.I)
    return g


def write_lakeside(
    out_dir: Path,
    general_items: list[dict[str, Any]],
    scenarios: list[dict[str, Any]],
    rng: random.Random,
) -> dict[str, Any]:
    smap = scenario_map(scenarios)
    lakeside_dir = out_dir / "lakeside"
    lakeside_dir.mkdir(parents=True, exist_ok=True)

    # Filter out scenario-absent items; target ~140.
    pool = []
    for item in general_items:
        sc = find_scenario(item, smap)
        if sc and isinstance(sc.get("lakeside"), dict) and sc["lakeside"].get("absent"):
            continue
        pool.append(item)
    rng.shuffle(pool)
    # Items with a Lakeside scenario are always stocked there, so the story holds.
    forced = [i for i in pool if (find_scenario(i, smap) or {}).get("lakeside")]
    rest = [i for i in pool if i not in forced]
    selected = (forced + rest)[:LAKESIDE_TARGET]
    selected.sort(key=lambda i: i["ndc11"])

    stations = ["ED-1", "ICU-A", "OR-2", "MEDSURG-3", "PHARM"]
    n = len(selected)
    # ~8% blank NDC, ~4% alternate format.
    n_blank = max(1, int(round(n * 0.08)))
    n_bad = max(1, int(round(n * 0.04)))
    indices = list(range(n))
    rng.shuffle(indices)
    blank_set = set(indices[:n_blank])
    bad_set = set(indices[n_blank:n_blank + n_bad])

    cabinet_rows: list[dict[str, str]] = []
    usage_rows: list[dict[str, str]] = []

    for i, item in enumerate(selected):
        med_id = f"LS-{i + 1:04d}"
        strength = item.get("strength") or ""
        desc = f"{tall_man_name(item['generic_name'])} {strength}"
        unit_of_use = item.get("unit_of_use") or ""
        if item.get("pack_size") and unit_of_use in ("vial", "bag", "syringe", "ampule"):
            desc += f" {item['pack_size']} mL {unit_of_use}"
        desc = re.sub(r"\s+", " ", desc).strip()

        if i in blank_set:
            ndc_out = ""
        elif i in bad_set:
            # Alternate formats: 11-digit no dashes, or missing leading zero (10-digit).
            if rng.random() < 0.5:
                ndc_out = item["ndc11"]  # 11-digit without dashes
            else:
                # Strip one leading zero if present, else use dashed 10-digit as-is
                # but drop a digit to simulate missing leading zero on 11-form.
                if item["ndc11"].startswith("0"):
                    ndc_out = item["ndc11"][1:]  # 10 digits, missing leading 0
                else:
                    ndc_out = item["package_ndc"].replace("-", "")
        else:
            ndc_out = item["package_ndc"]

        # A 120-bed critical access hospital uses about a fifth of the flagship's volume.
        units30d = round(daily_base(item) * 30 * 0.2 * rng.uniform(0.7, 1.3), 1)
        sc_lake = (find_scenario(item, smap) or {}).get("lakeside") or {}
        days = sc_lake.get("days_on_hand") if isinstance(sc_lake, dict) else None
        if days is None:
            days = rng.uniform(5, 30)
        qty = max(0, int(round(units30d / 30 * days)))
        unit = item.get("unit_of_use") or "each"
        station = rng.choice(stations)
        cabinet_rows.append({
            "MedID": med_id,
            "MedDescription": desc,
            "NDC": ndc_out,
            "Qty": str(qty),
            "Unit": unit,
            "Station": station,
        })
        usage_rows.append({
            "MedID": med_id,
            "Units30d": str(units30d),
        })

    cab_path = lakeside_dir / "cabinet_export_20261021.csv"
    with open(cab_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["MedID", "MedDescription", "NDC", "Qty", "Unit", "Station"],
        )
        w.writeheader()
        w.writerows(cabinet_rows)

    usage_path = lakeside_dir / "usage_30d.csv"
    with open(usage_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["MedID", "Units30d"])
        w.writeheader()
        w.writerows(usage_rows)

    blank_count = sum(1 for r in cabinet_rows if not r["NDC"])
    # Bad = non-blank and not matching dashed 10-digit FDA form.
    bad_count = 0
    for r in cabinet_rows:
        ndc = r["NDC"]
        if not ndc:
            continue
        if re.fullmatch(r"\d{4,5}-\d{3,4}-\d{1,2}", ndc):
            continue
        bad_count += 1

    return {
        "items": len(selected),
        "cabinet_rows": len(cabinet_rows),
        "usage_rows": len(usage_rows),
        "blank_ndc_rows": blank_count,
        "bad_ndc_rows": bad_count,
    }


# ---------------------------------------------------------------------------
# Master + manifest
# ---------------------------------------------------------------------------

def write_formulary_master(out_dir: Path, items: list[dict[str, Any]]) -> None:
    path = out_dir / "formulary_master.csv"
    fields = [
        "item_id", "ndc11", "package_ndc", "product_ndc", "generic_name",
        "brand_name", "strength", "dosage_form", "route", "labeler_name",
        "therapeutic_class", "is_critical", "from_shortage", "unit_of_use",
        "pack_size", "source_query", "ndc_source", "strength_raw", "spl_set_id",
        "manufacturer_name",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for item in items:
            w.writerow({k: item.get(k, "") for k in fields})


def write_manifest(
    out_dir: Path,
    *,
    seed: int,
    ndc_path: Path,
    shortages_path: Path,
    scenarios_path: Path | None,
    counts: dict[str, Any],
) -> None:
    hashes = {
        "ndc": file_sha256(ndc_path) if ndc_path.is_file() else None,
        "shortages": file_sha256(shortages_path) if shortages_path.is_file() else None,
    }
    if scenarios_path and scenarios_path.is_file():
        hashes["scenarios"] = file_sha256(scenarios_path)
    manifest = {
        "seed": seed,
        "generated_at": AS_OF.isoformat(),
        "input_hashes": hashes,
        "counts": counts,
    }
    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
        f.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate(
    *,
    ndc_path: Path,
    shortages_path: Path,
    scenarios_path: Path | None,
    out_dir: Path,
    seed: int,
    common_path: Path | None = None,
) -> dict[str, Any]:
    rng = random.Random(seed)
    common_path = common_path or (HERE / "common_generics.txt")

    ndc_products = load_ndc_products(ndc_path)
    shortage_rows = load_shortage_injectables(shortages_path)
    common_lines = load_common_generics(common_path)
    scenarios = load_scenarios(scenarios_path)

    items = build_formulary(ndc_products, shortage_rows, common_lines, rng)
    if not items:
        raise RuntimeError("formulary is empty — check NDC matching")

    # Rebuild RNG streams in fixed phases so hospital sections stay stable.
    rng_dispense = random.Random(seed + 1)
    rng_general = random.Random(seed + 2)
    rng_east = random.Random(seed + 3)
    rng_lakeside = random.Random(seed + 4)

    dispense = simulate_dispense(items, rng_dispense)

    out_dir.mkdir(parents=True, exist_ok=True)
    cg_counts = write_corvale_general(out_dir, items, dispense, scenarios, rng_general)
    east_items, east_counts = write_corvale_east(
        out_dir, items, ndc_products, scenarios, rng_east,
    )
    ls_counts = write_lakeside(out_dir, items, scenarios, rng_lakeside)
    write_formulary_master(out_dir, items)

    counts = {
        "formulary_items": len(items),
        "shortage_items": sum(1 for i in items if i["from_shortage"]),
        "common_items": sum(1 for i in items if not i["from_shortage"]),
        "corvale_general": cg_counts,
        "corvale_east": east_counts,
        "lakeside": ls_counts,
        "ndc_products_loaded": len(ndc_products),
        "shortage_injectables_selected": len(shortage_rows),
        "common_generics_listed": len(common_lines),
        "scenarios": len(scenarios),
    }
    write_manifest(
        out_dir,
        seed=seed,
        ndc_path=ndc_path,
        shortages_path=shortages_path,
        scenarios_path=scenarios_path,
        counts=counts,
    )
    return counts


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate Corvale Health synthetic hospital data")
    p.add_argument("--ndc", type=Path, default=DEFAULT_NDC)
    p.add_argument("--shortages", type=Path, default=DEFAULT_SHORTAGES)
    p.add_argument("--scenarios", type=Path, default=DEFAULT_SCENARIOS)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--seed", type=int, default=DEFAULT_SEED)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    scenarios_path = args.scenarios
    # Missing scenarios file → no overrides (per spec).
    if not scenarios_path.is_file():
        scenarios_path = None
    counts = generate(
        ndc_path=args.ndc,
        shortages_path=args.shortages,
        scenarios_path=scenarios_path,
        out_dir=args.out,
        seed=args.seed,
    )
    print(json.dumps(counts, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
