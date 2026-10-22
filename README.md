<!-- cover: docs/cover.png is added with the first deploy -->
# Upstream

**Why is it short? Upstream traces a drug shortage from a hospital's shelf to the factory, and cites every step.**

A hospital pharmacy buyer asks *"Carboplatin is short again. Why, and what do we do?"*. In about 30 seconds Upstream answers from the hospitals' own stock systems, read in place, and FDA's public record, cleaned once into files Zetaris reads as tables:

> Our Accord carboplatin is made at Intas Pharmaceuticals' plant in Sanand, India (FEI 3004011473). FDA's inspection there ended 2022-12-02 and was classified OAI; the classification letter is dated 2023-04-05, **23 days before FDA posted the carboplatin shortage** on 2023-04-28. An import alert followed on 2023-06-01 and a warning letter on 2023-07-28. Corvale Lakeside has 1.5 days of the 60 mL vials and 2.5 days of the 5 mL vials; Corvale East can send 3 and 10 of them and still keep two weeks (counted in vials, presentation by presentation).

Every sentence carries citation ids (`E16`, `D8`). Each id opens the Zetaris query and the row it came from, and a deterministic verifier drops any sentence the cited rows do not support: its dates, numbers and counts, the field a stock figure claims to be, the event and direction of a day gap, a plant's OAI/VAI/NAI on the same row as the plant, and any cause, status change or absence the record does not state. Against 30 false sentences written to slip past it (`scripts/verifier-adversarial.mts`, two rounds of judges), it drops 30 and keeps all 6 true ones.

**Live site:** [upstream-shortage.vercel.app](https://upstream-shortage.vercel.app) (replays recorded live runs) · **Video:** _(link)_ · **Deck:** `docs/deck.pdf`

Built for the Open Agent Hackathon 2026, Track 2 "The Agent That Can Explain Why", on **Zetaris**, **Meterless** and **NVIDIA Nemotron**, with part of the build done in **Cursor**.

---

## The problem
- US hospitals spend about **20 million staff hours and nearly $900M a year** just managing drug shortages ([Vizient, 2025](https://www.vizient.com/newsroom/news-releases/2025/new-vizient-survey-finds-drug-shortages-cost-hospitals-nearly-900m-annually-in-labor-expenses)).
- In 2025, the cause of **59%** of shortages was unknown or undisclosed ([ASHP via AJMC](https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter)).
- There were **227** active shortages in Q2 2026.

Buyers piece the answer together by hand from FDA's website, wholesaler emails and their own stock spreadsheets. The facts that explain a shortage are public. They are just scattered across a dozen FDA systems, keyed differently, and none of them knows what is on your shelf.

## What Upstream measured

**1. The trace beats the model alone.** The ground truth is the plant and the last FDA inspection for 59 plant links across 18 recent shortages. It was built by independent Python over FDA's raw files (`backtest/07_join_test.py`), which imports nothing from Upstream.

| | Upstream (Zetaris path) | Nemotron Ultra, no tools |
|---|---|---|
| Reached the right plant | **52 of 59 (88%)** | 27 of 54 (50%) |
| Right FDA FEI number | follows from the plant | 0 of 54 |
| Right last inspection (class and date) | **56 of 59 (95%)** | class 30 of 54; date 0 of 54 |
| Invented an inspection date | never | 50 of 54 |
| Said it was confident | — | 54 of 54 |

**2. The back-test.** For shortages FDA posted from 2022 on, how often had FDA already acted against a plant named on the label?
- **Dated by when it was public:** 13% of shortages, with **no lift** over products that never went short.
- **Dated by when the inspection closed:** 23%, twice as common, but that uses hindsight.

So a plant's FDA record **explains** a shortage after the fact; it does not **predict** one. Upstream is built to explain. The full method, caveats and the Hurricane Helene counter-example are in `data/backtest/summary.json` and on `/backtest`.

**3. The intent and risk gate.**
- 61 labelled pharmacy prompts, 15 of them held out.
- **Block recall 100% (22 of 22)**: orders, inventory changes, dosing advice and injection attempts are always refused.
- Intent accuracy 96%.
- Contract scope correct 60 of 60.

The details are in `src/engines/results/scout-pharmacy-eval.md`.

## How it works
```
Corvale General (Postgres) ─┐
Corvale East (Postgres)     ├─► Zetaris ─► Unified Semantic Layer ─► Upstream investigator ─► cited brief
Corvale Lakeside (CSV)      │   (hospitals read     (product, plant, inspection,      (fixed moves, every tool call
FDA: 12 cleaned CSVs ───────┘    in place; FDA as    stock in units of use; FK         checked against a Scout contract)
                                 file tables)        data-quality rules)
                                                                                         │
                         Meterless: Scout Intent · H-MEM · World Model · Markovian ◄─────┘   NVIDIA Nemotron writes, a verifier checks
```

### Zetaris (load-bearing)
- **Fifteen sources: three hospital systems read in place, and FDA's 12 public files cleaned once.**
  - Two hospital Postgres servers, reached over JDBC through a read-only account that sees only the reporting views each hospital publishes, and one hospital's nightly CSV cabinet exports, read as file tables where they land. Nothing from the hospitals is copied.
  - FDA's files are not read in place: `data/fda/build_bundle.py` downloads openFDA, DailyMed and the Data Dashboard once and cleans them into 12 CSVs (it derives `ndc11`, `firm_key`, `fei_match` and `known_date`), which Zetaris reads as file tables: the NDC directory, plant lists from 1,532 DailyMed label filings, plant registrations, 40,361 drug inspections, 46,893 Form 483 observations, 2,972 compliance actions, 1,007 import-alert listings, 12,341 recalls, shortage listings, history and presentations, and DMFs.
- **One semantic layer** (`zetaris/04-usl.sql`, drawn on `/how` sheet A-2): `product`, `unit_of_use`, `site`, `site_fei`, `product_site`, `inspection` and one stock table per hospital. Lineage in the UI resolves every USL table to the system its activation reads, so a stock query shows "4 systems, 1 statement".
- **Units of use everywhere.** East counts packages; its activation multiplies by East's own `pkg_size`, so a transfer is in real vials. General's part-used vials are not counted as stock. Days on hand and transfers are per presentation (strength, form and vial size), never pooled.
- **Foreign keys become data-quality rules**, on both sides. `RUN DQ` finds the 11 Lakeside cabinet rows whose NDC FDA does not list, and that every stock row is in a shared unit of use. On FDA's side, 513 of 1,970 plants named on labels (26%) are not in FDA's registration file (510 have no DUNS on the label, 3 carry a DUNS the file does not list), and 47% of inspections are of an FEI the registration file no longer holds (`scripts/dq-fda.mts`, `data/dq/fda.json`).
- **NDC repair without guessing.** An undashed 10-digit NDC can be read three ways (4-4-2, 5-3-2, 5-4-1). The activation looks each reading up in FDA's NDC file and accepts it only when exactly one is listed; otherwise the row is marked ambiguous and left for the DQ rule.
- **Every claim cites its query** (`Q-xxxxxx`), and each query is recorded, so the hosted site can replay real results.

### Meterless (all four engines, each doing real work)
| What Upstream does | Engine | Call |
|---|---|---|
| Decide what is asked, how risky it is, and what the agent may touch; refuse orders and dosing | **Scout Intent** (our implementation of the spec) | `scout.decide()` → HMAC-signed execution contract; `assertContract()` before every tool |
| Remember what we decided last time, and who approved it | **H-MEM** | `rememberDecision()` only after a signed-in pharmacist or the director approves; the decision is stored as the approver's quoted words; `recallForDrug()` |
| Hold the supply chain as grounded entities shared by the steps | **World Model** | `upsert` / `relate` with provenance; writes about unknown ids are refused |
| Watch the whole formulary overnight at flat cost | **Markovian** | `FormularyWatch`: 215 drugs in 18 chunks, cursor and findings kept in World Model |

Conformance with their unmodified suites: **H-MEM 13/13, World Model 8/8, Markovian 8/8, Scout harness PASS** (`CONFORMANCE.md`; the README there says what the Scout harness does not check).

### NVIDIA Nemotron
- **Nemotron 3 Ultra** writes the explanation and the P&T memo.
- **Nemotron 3.5 Lightning** writes the overnight brief.
- The memo and the brief have no citations, so they get a grounding check after the model call: every date and number must be in the case's evidence lines (or the watch rows), causal claims ("caused", "due to", "led to") are dropped unless FDA's stated reason names that cause, and the page shows what was checked and dropped. Over the 214 recorded memos: 3,380 sentences checked, 38 dropped.
- The model never decides a fact:
  - the state (confirmed, check, no signal) is decided by rule;
  - every sentence must cite evidence ids;
  - a deterministic verifier (`src/agent/verify.ts`) checks dates, numbers, counts, stock fields, day-gap events and direction, firm and classification pairs, causes, status words and absence claims against the cited rows, and drops the sentence otherwise. It is pattern-based, so it is a strong filter, not a proof: `data/eval/verifier.json` lists the false sentences it was tested on;
  - citation repairs are counted.
- `nemotron-3-super` is listed in the catalogue but returned 404 when we tested it on Oct 22, so it is not used.

### Cursor
Cursor's agent built the Corvale hospital data generator from a written spec (`data/hospital/SPEC.md`; the session logs are in `docs/cursor/`). A pharmacist review then found clinically wrong interchange pairs. They were fixed under `data/hospital/FIXES-1.md`, with an audit script and tests.

## What a pharmacist would check, and what we did
- **Interchanges:** only pairs a P&T committee could defend.
  - First, the same product from another manufacturer.
  - Then the same molecule by the same route, with "recalculate dose" notes.
  - IV-to-oral only for the standard protocol list.
  - Cisplatin → carboplatin only "per treating oncologist".
- **Labelling:** drug names in Tall Man lettering (CARBOplatin). Strengths follow ISMP's rules on error-prone abbreviations (mcg, never ug).
- **Plant status:** a plant whose last inspection was OAI is never shown as "clear".
- **Transfers:** proposed only within one presentation, in its units of use, and only when the donor keeps two weeks of stock.
- **Approvals:** memory writes are refused until a pharmacist or the director approves the decision contract. The approver's name and role come from a short-lived session the server signs, never from the form. On the hosted demo that session comes from a demo sign-in: pick a name from Corvale's (fictional) pharmacy roster and enter the demo PIN printed beside it. In a hospital it would come from single sign-on. A buyer can sign in and draft, and Scout refuses the approval. The memo's contract is bound to the case and drug, and expires after five minutes.

## Zetaris lessons (2.4.3.1), for other builders
- **Postgres schemas:** only a source's `public` schema is listed. We publish read-only views there.
- **Bulk registration:** `REGISTER DATASOURCE TABLES` returned a bare "Bad Request" for one source. Registering tables one at a time works.
- **Token timing:** the sign-in token's not-before time is rounded up to the next second, so an immediate call fails with a bare "Bad Request". Wait for `nbf`.
- **USL `COMPILE`:** it fails as "Invalid DDL statement" when a table has no primary key, or when two FK-linked tables share a non-key column name.
- **USL `ACTIVATE`:** it needs `COALESCE` on columns declared `NOT NULL`.
- **`RUN DQ`:** it failed with `MISSING_ATTRIBUTES` when the stock activations aggregated the hospitals' JDBC tables in `GROUP BY` subqueries. We push that aggregation into a source view (`stock_position`). Three lookups of FDA's NDC file in one activation (`SELECT DISTINCT` subqueries over a file table) run fine, and so does `RUN DQ` on `product_site`, whose key uses `row_number()`.
- **`EXPLAIN`** works through the REST API. It shows the interchange query's NDC list pushed to Postgres as `In(ndc11, [...])`, and a USL table as a single opaque scan, so filters on a USL table are not pushed into its source (`scripts/explain-pushdown.mts`, sheet A-2 on `/how`).

## Run it yourself
You need Docker Engine (WSL2 is fine), Node 21+, Python 3.12, a Zetaris platform bundle, and an NVIDIA API key.
```bash
python data/hospital/generate.py          # Corvale's three systems (fictional, deterministic)
python data/fda/build_bundle.py           # FDA's public files -> 12 clean tables
bash infra/zetaris/stage-files.sh         # mount them into Zetaris (run in WSL)
docker compose -f infra/hospital/docker-compose.yml --env-file infra/hospital/.env up -d
npx tsx scripts/zsql.mts zetaris/01-hospitals.sql   # then 02, 03, 04
npx tsx scripts/seed-memory.mts
npx tsx scripts/investigate.mts "Carboplatin is short again. Why, and what do we do?"
npx tsx scripts/watch.mts                 # the overnight watch
UPSTREAM_LIVE=1 npm run dev               # the desk, live
```
The MCP server is at `/api/mcp` (Streamable HTTP), with six read-only tools. Every call goes through Scout, and each tool checks its contract for every capability it reads before it reads anything. Set `UPSTREAM_MCP_TOKEN` to require a bearer token; without one (the hosted demo) the server is open, read-only and limited to 30 requests a minute per address. CORS allows GET and POST from this site and `UPSTREAM_MCP_ORIGINS`.

## Limits
- **Corvale Health is fictional.** Its stock is synthetic, but every NDC, labeler and plant is real FDA data.
- **23% of labels name no plant, and 33% list none in their establishment block** (measured over the 1,532 labels in the bundle). Upstream falls back to the label's own text or the application holder, and says so.
- **Plants that make the active ingredient (API plants) are almost invisible** on labels.
- **History has look-ahead bias:** plant lists and import-alert lists are today's.
- **Not a forecast:** the back-test shows the record explains shortages; it does not predict them.
- **The hosted site replays recorded live runs.** Live runs need the local Zetaris instance.
- **The approver sign-in is a demo.** The PINs are printed on the page, so they prove nothing about who is at the keyboard; they show where a hospital's single sign-on plugs in. The server-side rule is real: no verified session with a pharmacist or director role, no approval.
- **On the hosted copy, approvals live only in that server instance's memory** (Vercel's file system is read-only).

MIT licence. The Meterless engines in `vendor/meterless` are Apache-2.0 (see `PROVENANCE.md`).
