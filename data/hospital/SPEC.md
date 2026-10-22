# Corvale Health: synthetic hospital data (spec for `generate.py`)

Corvale Health is a **fictional** three-hospital system. Its pharmacy data lives in three systems with three different schemas. Upstream never copies this data: Zetaris queries each source in place, and the Unified Semantic Layer maps all three to one model. The data is synthetic, but every NDC, labeler and product is real, taken from FDA's NDC directory. That way the hospital data joins to real FDA records.

## Inputs
Paths are given as CLI args, with defaults relative to the repo root.
- `--ndc` is FDA's NDC directory bulk JSON (`drug-ndc-0001-of-0001.json`). Default: `../research/raw/openfda/drug-ndc-0001-of-0001.json`. It is about 244 MB, so stream it with `ijson` if available. Otherwise load it once; there is enough memory.
- `--shortages` is the shortage episodes CSV (`generic, category, min_posting_current, ..., statuses, companies, reasons, ndcs`). Default: `../research/samples/shortage_episodes.csv`.
- `--scenarios` is an optional JSON file of overrides (see below). Default: `data/hospital/scenarios.json`.
- `--out` is the output directory. Default: `data/hospital/out`.
- `--seed` is the RNG seed. Default: 20261022. Output must be byte-identical for the same inputs and seed.

## The formulary (about 350 generic products)
1. **Shortage injectables, about 120.** Take every generic from the shortages CSV whose status includes `Current` and whose name says injection, injectable, infusion, for injection, vial, or emulsion. Cap at 130, ranked by `n_companies` descending, then by name.
2. **Common hospital drugs, about 230.** Use the list in `common_generics.txt` next to this spec: one generic name per line, some with a dosage form. Generate that file too, with about 260 real, commonly stocked US hospital drugs covering:
   - antibiotics (IV and oral);
   - anticoagulants;
   - analgesics, including opioids;
   - anaesthesia and induction agents;
   - neuromuscular blockers;
   - vasopressors;
   - electrolytes;
   - antiemetics;
   - insulin;
   - oncology agents such as carboplatin, cisplatin, etoposide, fluorouracil, methotrexate, vincristine and cytarabine;
   - cardiovascular drugs;
   - GI drugs;
   - CNS drugs;
   - steroids;
   - immunosuppressants;
   - IV fluids;
   - vaccines are excluded.
3. **Pick package NDCs.** For each generic, choose 1 to 3 package NDCs from the NDC directory. The product must be:
   - `product_type == "HUMAN PRESCRIPTION DRUG"`;
   - currently marketed, meaning `marketing_end_date` is empty or in the future;
   - matched on `generic_name`, case-insensitive with normalised whitespace, with the dosage form matching where one is given.

   Prefer different labelers for the 2nd and 3rd NDC. Keep `product_ndc`, `package_ndc`, `labeler_name`, `brand_name`, `dosage_form`, `route`, `active_ingredients` (name and strength), the `openfda.manufacturer_name` and `openfda.spl_set_id` when present, the `packaging` description, and the pack size if it can be parsed.
4. **Therapeutic class.** Assign each item a class from the list above using a keyword map. Set `is_critical` to true for anaesthesia, vasopressor, neuromuscular blocker, oncology and emergency drugs (epinephrine, atropine, sodium bicarbonate, calcium chloride, dextrose 50%, naloxone, amiodarone, adenosine, lidocaine for injection).

## Hospital 1: Corvale General
600 beds, the flagship. Postgres, schema `cg`. Write `out/corvale_general.sql` (CREATE TABLE and INSERT, idempotent: DROP SCHEMA IF EXISTS cg CASCADE first).
- `cg.formulary_item(item_id serial pk, ndc11 char(11)` holds the 11-digit HIPAA form with no dashes, zero-padded from the 10-digit label NDC by FDA's rules (4-4-2 → 0xxxx-xxxx-xx and so on). The other columns: `generic_name, strength, dosage_form, route, therapeutic_class, is_critical bool, unit_of_use text)`.
- `cg.inventory_snapshot(item_id fk, location text, qty_units numeric, par_units numeric, as_of timestamptz)`. Locations are main pharmacy, OR satellite, oncology infusion, ED and ICU. As of Oct 21 2026 23:00 UTC.
- `cg.dispense_daily(item_id fk, day date, units numeric)`: 180 days to Oct 21 2026. Use a realistic per-class base level, a weekday/weekend pattern and noise. Oncology runs weekdays only.
- `cg.purchase_order(po_id text pk, item_id fk, ndc11, wholesaler text` (one of three fictional wholesalers: Northline, Cardinal-style "Keystone Medical Supply", "Atlas Pharma Distribution"; no real company names), plus `qty_packages, unit_cost_usd numeric, ordered_at timestamptz, status text)` (filled, backordered, partial, cancelled). Backorders cluster on the shortage drugs.
- `cg.therapeutic_interchange(item_id fk, alt_item_id fk, rule text, approved_by text, approved_on date, notes text)`. This is the P&T committee's approved interchanges for about 40 shortage drugs. Use plausible, conservative pairs only, such as the same molecule in another concentration or presentation, or alternatives a P&T committee commonly lists during a shortage. Mark oncology pairs `rule = 'protocol-specific, oncologist approval'`. Use fictional approver names.

## Hospital 2: Corvale East
250 beds. Postgres, schema `east`, with **deliberately different conventions**. Write `out/corvale_east.sql`.
- `east.items(id text pk` such as 'E-004213', plus `descr text` (uppercase description, e.g. 'CARBOPLATIN 10MG/ML 45ML MDV'), `mfr text` (an abbreviated labeler name), `pkg_ndc text` (the dashed 10-digit form exactly as FDA lists it), `pkg_size int, uom text)`.
- `east.stock(id fk, on_hand_pkgs numeric, reorder_pt_pkgs numeric, counted_at timestamptz)`.
- `east.usage_weekly(id fk, week_start date, pkgs_used numeric)`: 26 weeks.
- About 85% of General's items, plus about 20 items only East stocks.

## Hospital 3: Corvale Lakeside
120 beds, critical access. It has no database, only nightly CSV exports from its automated dispensing cabinets, kept in object storage. Write to `out/lakeside/`:
- `cabinet_export_20261021.csv` with columns `MedID,MedDescription,NDC,Qty,Unit,Station`.
  - MedDescription is free text with Tall Man lettering for look-alike names, e.g. "CISplatin 1 mg/mL 50 mL vial" or "hydrALAZINE 20 mg/mL".
  - NDC is blank in about 8% of rows. In about 4% it is in another format (11-digit without dashes, or a missing leading zero). These are the data-quality cases the semantic layer must flag.
  - Stations are ED-1, ICU-A, OR-2, MEDSURG-3 and PHARM.
- `usage_30d.csv` with columns `MedID,Units30d`.
- About 140 items.

## Scenarios (overrides)
`scenarios.json` sets specific quantities so the demo stories hold. For example:
```json
{"generic": "Cisplatin Injection", "general": {"days_on_hand": 9}, "east": {"surplus_pkgs": 14}, "lakeside": {"absent": true}}
```
Implement `days_on_hand` by setting on-hand stock to the average daily use over the last 28 days times that number of days. Implement `surplus_pkgs` by setting East's stock to its reorder point plus that number. If the file is missing, use no overrides. Write an example `scenarios.example.json` with 3 entries.

## Outputs
- `out/corvale_general.sql`
- `out/corvale_east.sql`
- `out/lakeside/*.csv`
- `out/formulary_master.csv`: our ground truth, used only by tests. Zetaris never reads it.
- `out/manifest.json`: counts, seed, input file hashes.

## Quality
- Python 3.12. Standard library plus optional `ijson`; nothing else.
- Unit tests in `data/hospital/test_generate.py`, runnable with `python -m pytest` or `python -m unittest`. They cover:
  - NDC 10→11 conversion for all three FDA formats;
  - determinism;
  - every NDC in General exists in the directory;
  - the counts of Lakeside's bad and blank NDC rows fall in their ranges;
  - scenario overrides applied.
- No real hospital, wholesaler or person names.
- Clear comments only where the logic is not obvious.
