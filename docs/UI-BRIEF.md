# Upstream UI brief (for the interface build)

## What Upstream is
An agent for hospital pharmacy buyers. They ask "carboplatin is short again, why, and what do we do?", and Upstream answers with a cited trace from **our shelf to the factory**:

our stock in three hospitals → NDC → labeler → the plants named on the product's own FDA label filing (SPL) → each plant's FDA inspections (OAI/VAI), Form 483 observations, warning letters, import alerts and recalls → FDA's shortage listing.

It then gives:
- days on hand;
- ranked options: transfer between sister hospitals, the same product from another maker, P&T-approved interchanges;
- what we decided last time;
- a memo for a named pharmacist to approve.

**Entry.** Open Agent Hackathon 2026, Track 2 "The Agent That Can Explain Why".

**Judging.** Impact 30, Technical 20, Innovation 15, Demo 15, Product & UX 10, Sponsor tech 10.

**Judges.** The CTO of Zetaris (data federation, semantic layer, data quality), a SpaceXAI partnerships lead, and three people from GenAI Works.

**The field.** 5,290 registered, mostly building with Claude Code. This UI has to look like a real product made for pharmacists, not a hackathon template.

## Sponsor tech, which the UI must make visible
- **Zetaris** queries every source where it lives, with nothing copied. The sources:
  - two hospital Postgres servers;
  - one hospital's CSV cabinet exports;
  - 12 FDA files.

  Upstream's **Unified Semantic Layer** (USL) joins them. Its foreign keys generate data-quality rules: for example, 12 Lakeside cabinet rows fail the NDC rule, and Upstream reports them instead of guessing.

  Every claim cites a Zetaris query by id (`Q-ab12cd`) and an evidence row (`E12`). The UI shows the SQL and the rows.
- **Meterless engines:**
  - **Scout Intent** (our own implementation): every request gets an intent, a risk level and a signed execution contract, and every tool call is checked against it. The gate log shows allowed, needs approval and refused. Orders are always refused.
  - **H-MEM:** past decisions, with who approved them and an audit trail.
  - **World Model:** the supply-chain graph each case builds (`case.graph`: nodes and edges).
  - **Markovian:** the overnight watch over the whole formulary, run in chunks.
- **NVIDIA Nemotron** (Ultra) writes the explanation. A deterministic verifier drops any sentence whose citations, dates or numbers are not in the evidence it cites. `explanation.verifier.rejected` lists what was dropped; show it, because it is a trust signal.

## Hard rules
- **What to touch.** Work only in `app/` (pages, layouts, CSS) and `components/` (create it), plus `public/` for static assets. Do not edit `src/agent/`, `src/engines/`, `src/lib/`, `scripts/`, `data/`, `zetaris/` or `infra/`. The API routes under `app/api/` already exist: read them, and don't change their contracts. If you need a field that isn't there, note it and work around it.
- **Stack.** Next.js 15 app router, React 19, TypeScript strict, plain CSS (CSS modules or one global stylesheet with tokens). No Tailwind, no UI kit. You may add small, well-known dependencies if they clearly pay off: d3-geo plus world-atlas topojson for the plant map, or d3-shape. Fonts come from `next/font/google`: Public Sans.
- **Design.** Read `docs/DESIGN.md` and follow it. The essentials:
  - Tall Man lettering for drug names (`src/agent/util.ts` exports `tallMan()`; import it).
  - Syringe-label colours as small drug-class marks only.
  - Public Sans.
  - A cool cabinet-white background, not cream.
  - Signal red, caution amber and clear green used only for FDA classifications.
  - Calm, modest headings in sentence case.
  - Avoid the generic AI-page tells: all-caps eyebrow labels, gradient blobs, identical SaaS cards everywhere, a "→" on every link, monospace data labels, emoji.
- **The one memorable moment.** The **trace with its lead-time ruler**. A horizontal chain on desktop, vertical on phones:

  our shelf (days left per hospital) → our NDCs → labelers → plants (name, country, FEI) → FDA actions

  Under it, a time axis puts each signal against the day FDA posted the shortage. For carboplatin:
  - OAI inspection ended 2022-12-02;
  - OAI letter 2023-04-05, which is 23 days before the posting;
  - shortage posted 2023-04-28;
  - import alert 2023-06-01;
  - warning letter 2023-07-28;
  - still listed today, 42 months on.

  The chain draws itself in step by step as the investigation streams. Respect reduced motion.
- **Every claim is one click from its row.** Citation chips (`E16`, `D8`) open an evidence drawer: the label, the fields, the query id, the SQL, the sources it read, and live or replay.
- **Three honest states** (`explanation.state`): confirmed, check, no_signal. Never alarmist copy.
- **Pages never end quickly.** Every page is a full document down to a rich footer: sitemap, data sources with dates, credits, the "fictional health system, real FDA data" note. Plan the sections before building.
- **Mobile.** Every page works at 390 and 375 px: no sideways scroll, tap targets of 44 px or more, the ask box right after the hero on phones. Visible keyboard focus. Readable contrast in light and dark mode (`prefers-color-scheme`).
- **Every state is designed:** loading (skeletons the size of the content), empty, error, replay and live.
- **No AI attribution** anywhere in the UI or code comments.
- **Self-critique with screenshots.** Use Playwright from `I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright`, or install your own. Take full-page shots of every page at 1440 and 390 px, light and dark. Fix overlaps, cramped or empty regions and broken wrapping before you finish.
- **Dev server.** Port 3240 (`npx next dev -p 3240`). Never run `next build` while it is running, because they share `.next`. To check a production build, stop the dev server first.

## Data available to you now
- `data/cases/*.json`: real investigations of carboplatin, lidocaine, cisplatin, methotrexate and fentanyl. The type is `Case & { graph }`, where `Case` is defined in `src/agent/types.ts`. Read the carboplatin file first; it is the hero.
- **APIs, which already exist:**
  - `GET /api/cases` returns summaries.
  - `GET /api/cases/[slug]` returns one case.
  - `POST /api/investigate {question}` returns an NDJSON stream of lines:
    - `{type:"decision", intent, risk, reason, clarification}`
    - `{type:"step", mode, step}`
    - `{type:"case", mode, case}`
    - `{type:"refused", reason}`
    - `{type:"unrecorded", drug, reason}`
    - `{type:"error", message}`

    It replays recorded cases unless the server has `UPSTREAM_LIVE=1`. Show live or replay plainly.
- **Coming from the backend:** read these if present, and show a designed placeholder if missing.
  - `GET /api/watch`, from `data/watch/latest.json`:
    ```
    { ranAt, drugs, chunks, ms, tokens:{estimated|measured}, flagged:[{molecule, minDays, hospital, state, headline, signal, slug?}], quiet:number }
    ```
  - `GET /api/backtest`, from `data/backtest/summary.json`:
    ```
    { builtAt, window, cases:{n, withPlant, withSignal}, strict:{share, liftVsControl, p}, endDated:{share, lift, p}, leadDays:{median, iqr:[a,b]}, controls:{n, share}, examples:[{molecule, plant, country, events:[{date, kind, label}], posted}], caveats:[string] }
    ```
  - `GET /api/plants`, from `data/plants.json`:
    ```
    { plants:[{name, fei, country_iso3, lat?, lon?, health, last, products:[{labeler, molecule}], signals:number}] }
    ```
    Plot by country centroid when lat/lon are missing.
  - `POST /api/memo {slug}` returns `{draft, contractId, risk, needs}`.
  - `POST /api/approve {slug, contractId, approver}` returns `{status, memoryId, audit:[{at, actor, action}]}`.

## Pages and sections (plan each before building)
1. **`/` (home)**
   - **Hero.** One line of headline copy ("Why is it short? Upstream traces it from your shelf to the factory.", or better) and the carboplatin trace with its ruler, playing.
   - **Ask box** with three example questions.
   - **The problem**, with sourced numbers:
     - Vizient: about 20M staff hours and nearly $900M a year in labour managing shortages (2023 data, published June 2025).
     - ASHP: 59% of 2025 shortages had an unknown or undisclosed cause.
     - ASHP: 227 active shortages in Q2 2026.

     Link the sources. They are in `../research/LANDSCAPE.md`, outside your folder; the links are listed here:
     - https://www.vizient.com/newsroom/news-releases/2025/new-vizient-survey-finds-drug-shortages-cost-hospitals-nearly-900m-annually-in-labor-expenses
     - https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter
   - **Three systems, nothing copied.** A diagram: Corvale General (Postgres), Corvale East (Postgres, different schema and units), Corvale Lakeside (CSV cabinet exports), FDA's 12 files and openFDA, all meeting at Zetaris and its semantic layer. Show the data-quality catch.
   - **What the carboplatin trace found**, with real numbers from the case.
   - **The back-test** (from `/api/backtest`), with honest framing: it explains rather than predicts.
   - **How it works:** Zetaris, the four Meterless engines, Nemotron, the verifier. Map each user action to an engine.
   - **Limits**, stated plainly. Hospital data is fictional. About a third of labels name no plant. API plants are mostly invisible. History has look-ahead bias.
   - **Footer.**
2. **`/desk`**: the buyer's morning.
   - The overnight watch brief (`/api/watch`).
   - Drugs at risk, sorted by days on hand (`/api/cases`).
   - The ask box, with the streaming investigation shown inline (step cards appear as they arrive) and a link to the full case.
3. **`/case/[slug]`**: the investigation.
   - Header: Tall Man drug name, state, headline.
   - The trace and ruler.
   - The why: verified sentences with citation chips, and "dropped by the verifier" folded away.
   - Our stock by hospital, with days-on-hand bars.
   - Options, ranked, with who must approve each.
   - Who else makes it: the market, each maker's plant health and its shortage-list status.
   - The steps, as query cards: title, purpose, finding, ms, sources and the query ids.
   - Data quality: the USL rule results.
   - Memory: past decisions, with approver and date.
   - The gate log.
   - The supply-chain graph, from `case.graph`, as SVG.
   - The memo: a draft button, then an approve step with a named approver and the contract id.
   - Usage: queries, ms, tokens.
   - The evidence drawer.
4. **`/plants`**: the atlas.
   - A world map of the plants behind the formulary, coloured by health.
   - A list with filters.
   - Each plant links to the cases that use it.
5. **`/backtest`**:
   - the method;
   - the case set, written down before the run;
   - strict versus end-dated results side by side;
   - the lead-time distribution;
   - controls and base rate;
   - examples, each as a mini ruler;
   - caveats.
6. **`/how`**:
   - the architecture;
   - the sponsor map (action → engine → API → spec section; see `src/engines/README.md`);
   - conformance results (`CONFORMANCE.md`, `src/engines/results/*.json`);
   - the Scout eval numbers;
   - the Zetaris traps we hit and how we handled them (`zetaris/*.sql` header comments);
   - how to run it locally.

## Finish with
A short report that covers:
- the pages built;
- the components;
- any new dependencies;
- every API field you needed but didn't find;
- the screenshots you reviewed and what you fixed.
