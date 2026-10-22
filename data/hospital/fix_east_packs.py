#!/usr/bin/env python3
"""One-off repair of data/hospital/out/corvale_east.sql, matching generate.py's fixed East pack sizes.

The first seed wrote the inner volume as East's pkg_size ("60 mL in 1 VIAL" -> 60) and its stock in units of use
under package column names. This rewrites it the way generate.py now writes it: pkg_size is the count of units of
use in one package (from FDA's packaging description in data/fda/bundle/ndc_packages.csv), and on_hand_pkgs,
reorder_pt_pkgs and pkgs_used are in packages. Idempotent: a repaired file carries the "pack sizes" header line.
The source openFDA NDC dump is no longer on disk, so regenerating from scratch is not an option here.

    python data/hospital/fix_east_packs.py
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from generate import parse_units_per_package  # noqa: E402

SQL = HERE / "out" / "corvale_east.sql"
NDC = HERE.parents[1] / "data" / "fda" / "bundle" / "ndc_packages.csv"
MARK = "-- pack sizes: pkg_size is units of use per package; stock and usage are in packages"

ITEM = re.compile(r"^(  \('(E-\d+)', '(?:[^']|'')*', '(?:[^']|'')*', '([^']*)', )(\d+)(, '[^']*'\),?;?)$")
STOCK = re.compile(r"^(  \('(E-\d+)', )([\d.]+), ([\d.]+)(, '[^']*'\),?;?)$")
USAGE = re.compile(r"^(  \('(E-\d+)', '[^']*', )([\d.]+)(\),?;?)$")


def num(x: float) -> str:
    t = f"{x:.4f}".rstrip("0").rstrip(".")
    return t or "0"


def main() -> int:
    text = SQL.read_text(encoding="utf-8")
    if MARK in text:
        print("already repaired")
        return 0
    desc: dict[str, str] = {}
    with open(NDC, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            desc.setdefault(r["package_ndc"], r["package_description"])
    upp: dict[str, int] = {}
    out: list[str] = []
    changed = missing = 0
    for line in text.split("\n"):
        m = ITEM.match(line)
        if m:
            d = desc.get(m.group(3))
            n = parse_units_per_package(d) if d else 1
            missing += d is None
            upp[m.group(2)] = n
            changed += int(m.group(4)) != n
            out.append(f"{m.group(1)}{n}{m.group(5)}")
            continue
        m = STOCK.match(line)
        if m and m.group(2) in upp:
            n = upp[m.group(2)]
            out.append(f"{m.group(1)}{num(float(m.group(3)) / n)}, {num(float(m.group(4)) / n)}{m.group(5)}")
            continue
        m = USAGE.match(line)
        if m and m.group(2) in upp:
            out.append(f"{m.group(1)}{num(float(m.group(3)) / upp[m.group(2)])}{m.group(4)}")
            continue
        out.append(line)
    if out and out[0].startswith("-- Corvale East"):
        out.insert(1, MARK)
    SQL.write_text("\n".join(out), encoding="utf-8")
    multi = sum(1 for v in upp.values() if v > 1)
    print(f"{len(upp)} items, {changed} pkg_size values corrected, {multi} with more than one unit per package, {missing} NDCs not in FDA's file (kept at 1)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
