<!-- cover: docs/cover.png is added with the first deploy -->
# Upstream

**Why is it short? Upstream traces a drug shortage from a hospital's shelf to the factory, and cites every step.**

A hospital pharmacy buyer asks *"Carboplatin is short again. Why, and what do we do?"*. In about 30 seconds Upstream answers from the hospital's own stock and FDA's public record, queried in place:

> Our Accord carboplatin is made at Intas Pharmaceuticals' plant in Sanand, India (FEI 3004011473). FDA's inspection there ended 2022-12-02 and was classified OAI; the classification letter is dated 2023-04-05, **23 days before FDA posted the carboplatin shortage** on 2023-04-28. An import alert followed on 2023-06-01 and a warning letter on 2023-07-28. Corvale Lakeside has 2 days left; transfer 26 vials from Corvale East, which keeps two weeks.

Every sentence carries citation ids (`E16`, `D8`). Each id opens the Zetaris query and the row it came from, and a verifier drops any sentence whose dates or numbers are not in the rows it cites.

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
- 59 labelled pharmacy prompts, 15 of them held out.
- **Block recall 100% (22 of 22)**: orders, inventory changes, dosing advice and injection attempts are always refused.
- Intent accuracy 96%.
- Contract scope correct 58 of 58.

The details are in `src/engines/results/scout-pharmacy-eval.md`.

## How it works
```
Corvale General (Postgres) ─┐
Corvale East (Postgres)     ├─► Zetaris ─► Unified Semantic Layer ─► Upstream investigator ─► cited brief
Corvale Lakeside (CSV)      │   (queries each       (product, plant, inspection,      (fixed moves, every tool call
FDA: 12 files + openFDA ────┘    source in place)    stock; FK data-quality rules)     checked against a Scout contract)
                                                                                         │
                         Meterless: Scout Intent · H-MEM · World Model · Markovian ◄─────┘   NVIDIA Nemotron writes, a verifier checks
```

### Zetaris (load-bearing)
- **Seven sources, nothing copied:**
  - two hospital Postgres servers, reached through a read-only account that sees only the reporting views each hospital publishes;
  - one hospital's nightly CSV cabinet exports;
  - FDA's NDC directory, plant lists from 1,532 DailyMed label filings, plant registrations, 40,361 drug inspections, 46,893 Form 483 observations, 2,972 compliance actions, 1,007 import-alert listings, 12,341 recalls, shortage history and DMFs, all as file tables.
- **One semantic layer** (`zetaris/04-usl.sql`): `product`, `site`, `site_fei`, `product_site`, `inspection` and one stock table per hospital.
- **Foreign keys become data-quality rules.** `RUN DQ` finds the 12 Lakeside cabinet rows whose NDC FDA does not list. Upstream reports them as "check this" instead of guessing.
- **Every claim cites its query** (`Q-xxxxxx`), and each query is recorded, so the hosted site can replay real results.

### Meterless (all four engines, each doing real work)
| What Upstream does | Engine | Call |
|---|---|---|
| Decide what is asked, how risky it is, and what the agent may touch; refuse orders and dosing | **Scout Intent** (our implementation of the spec) | `scout.decide()` → HMAC-signed execution contract; `assertContract()` before every tool |
| Remember what we decided last time, and who approved it | **H-MEM** | `rememberDecision()` only after a named pharmacist approves; `recallForDrug()` |
| Hold the supply chain as grounded entities shared by the steps | **World Model** | `upsert` / `relate` with provenance; writes about unknown ids are refused |
| Watch the whole formulary overnight at flat cost | **Markovian** | `FormularyWatch`: 215 drugs in 18 chunks, cursor and findings kept in World Model |

Conformance with their unmodified suites: **H-MEM 13/13, World Model 8/8, Markovian 8/8, Scout harness PASS** (`CONFORMANCE.md`; the README there says what the Scout harness does not check).

### NVIDIA Nemotron
- **Nemotron 3 Ultra** writes the explanation and the P&T memo.
- **Nemotron 3.5 Lightning** writes the overnight brief.
- The model never decides a fact:
  - the state (confirmed, check, no signal) is decided by rule;
  - every sentence must cite evidence ids;
  - a deterministic verifier checks each date and number against the cited rows, and drops the sentence otherwise;
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
- **Transfers:** proposed only when the donor keeps two weeks of stock.
- **Approvals:** memory writes are refused until a named pharmacist approves the decision contract.

## Zetaris lessons (2.4.3.1), for other builders
- **Postgres schemas:** only a source's `public` schema is listed. We publish read-only views there.
- **Bulk registration:** `REGISTER DATASOURCE TABLES` returned a bare "Bad Request" for one source. Registering tables one at a time works.
- **Token timing:** the sign-in token's not-before time is rounded up to the next second, so an immediate call fails with a bare "Bad Request". Wait for `nbf`.
- **USL `COMPILE`:** it fails as "Invalid DDL statement" when a table has no primary key, or when two FK-linked tables share a non-key column name.
- **USL `ACTIVATE`:** it needs `COALESCE` on columns declared `NOT NULL`.
- **`RUN DQ`:** it fails with `MISSING_ATTRIBUTES` when an activation contains aggregate subqueries or references the same table twice. We push the aggregation into a source view (`stock_position`).

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
The MCP server is at `/api/mcp` (Streamable HTTP), with six tools; every call goes through Scout.

## Limits
- **Corvale Health is fictional.** Its stock is synthetic, but every NDC, labeler and plant is real FDA data.
- **About a third of labels name no plant.** Upstream falls back to the label's own text or the application holder, and says so.
- **Plants that make the active ingredient (API plants) are almost invisible** on labels.
- **History has look-ahead bias:** plant lists and import-alert lists are today's.
- **Not a forecast:** the back-test shows the record explains shortages; it does not predict them.
- **The hosted site replays recorded live runs.** Live runs need the local Zetaris instance.

MIT licence. The Meterless engines in `vendor/meterless` are Apache-2.0 (see `PROVENANCE.md`).
