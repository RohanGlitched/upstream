# Upstream UI overhaul: "The Record"

## Why
The owner wants a UI that judges have never seen: "fabulous, be ambitious, boil the ocean". It must still be calm, fast and true to the data.

Five direction mockups were built. The chosen system combines four of them:
- **The batch record** (`docs/moods/batch-record/`) is the base identity. Investigations are physical evidence: documents on a pressboard desk, the red thread, stamps, carbon slips and real barcodes.
- **The watershed** (`docs/moods/watershed/`) is the second signature. The supply is drawn as an engraved river map: plants are springs, streams flow through labelers to hospital reservoirs, stream width is real daily use, and FDA's record replays as silt and dry beds.
- **Powers of Ten** (`docs/moods/powers-of-ten/`) becomes the home page's prologue film: a scroll that dives from one vial through its real barcode out to the globe and down to the plant's FDA record. Restyle it into the Record palette.
- **The time machine** (`docs/moods/time-machine/`) supplies the azimuthal chronograph, centred on Corvale with a calendar bezel. It becomes the world view of all plants, in the night band on `/plants`.

Study the mockups' `index.html` and `shots/` before building. They are hand-tuned for carboplatin. **Your job is to turn them into data-driven React components that work for every case.**

## The data
- `data/cases/*.json`: about 215 cases, one per formulary molecule. The batch run is still writing them, so there will be at least 5 now and about 215 when it ends.
  - The slug is the filename; the newer files also carry `slug`.
  - The type is `Case & { graph }` in `src/agent/types.ts`.
  - Design for the hard cases too:
    - **Many plants** (lidocaine has around 10).
    - **No placed plant:** every plant is "named on label, not placed" or "sponsor only".
    - **Not on FDA's list:** `shortage.listed=false` and `explanation.state="no_signal"`.
    - **No timeline before the posting**, or a posting in 2012 (fentanyl).
    - **Long drug names** ("isoleucine, leucine, lysine acetate…").
    - **Only one hospital** stocking the drug.
- The other data files:
  - `data/watch/latest.json`: the overnight watch, 215 drugs; 22 to act on, 39 on watch.
  - `data/plants.json`: 123 plants; lat/lon are country centroids.
  - `data/backtest/summary.json`.
  - `data/eval/trace.json`.
- **APIs** under `app/api/*`: do not change their contracts.
  - `/api/investigate` streams NDJSON.
  - `/api/memo` and `/api/approve` handle the memo and approval flow.
  - `/api/cases`, `/api/watch`, `/api/plants`, `/api/backtest`, `/api/eval` and `/api/mcp`.
  - `src/lib/cases.ts` has `listCases()` and `getCase()` for server components.

## Design system
- **Tokens** are in `app/record-tokens.css` (palette, five type roles, a calm scale). Use the variables; don't invent new colours.
- **Fonts** load through `next/font/google` in `app/layout.tsx`, exposing these CSS variables:
  - `--font-source-serif` (Source Serif 4, with an opsz axis);
  - `--font-public-sans`;
  - `--font-courier-prime`;
  - `--font-archivo` (variable, with the `wdth` axis);
  - `--font-im-fell` (IM Fell English with its italic).
- **Colour meaning:**
  - FDA red only where FDA found a problem: OAI, warning letters, the thread, stamps.
  - Carbon blue for what Upstream verified: citations, slips, its answers.
  - Magenta for import alerts.
  - Water blues for supply.
  - Amber for VAI or watch; green for NAI or fine stock.
- **Owner's calm scale:** hero at most 56px, sections at most 42px, figures 30–40px, body 17px.
  - No all-caps eyebrow labels, gradient blobs, emoji, "→" on links, or identical rounded SaaS cards.
  - Paper has square corners and real shadows and grain.
- **Performance:** the first paint of every hero is instant (SVG or CSS, server-rendered where possible). No WebGL. d3-geo, world-atlas and topojson-client are already installed. Respect reduced motion: show the finished state.
- **Mobile at 390 and 375** is designed, not stacked: no sideways scroll, tap targets of 44px or more.
- **Light and dark:** the record is a light paper world. In dark mode the desk becomes graphite and the papers a dim stock. The night band stays dark in both modes.
- **Every claim stays one click from its row.** Citation marks (E12, D8, Q-xxxxxx) open the evidence as a carbon slip, using the existing data in `case.evidence` and `case.queries`.
- **Known traps from earlier projects:**
  - `backdrop-filter` on a sticky header traps fixed-position children, so put it on `::before`.
  - Same-page hash links don't change the pathname, so close the menu on click.
  - Charts must work by touch and keyboard.
  - Dark-mode faint text must reach 4.5:1.
- **No AI attribution anywhere.** Keep Tall Man names via `tallMan()` from `src/agent/util.ts`.

## Ownership (strict: touch only your own files)
- **Builder A** (record, chrome, case, desk), **builder B** (watershed, film) and **builder C** (chronograph, plants, back-test, how) each own the paths listed below.
- **Shared:** `app/record-tokens.css` is owned by the lead. Ask before changing it, and only add variables if one is truly missing.
- **Dev servers:** run your own on your own port. A uses 3241, B 3242, C 3243. Never run `next build`, because the servers share `.next`. Use `npx tsc --noEmit -p .` and `npx eslint <your paths>` to check.
- **Screenshots:** review your own at 1440 and 390, light and dark, with Playwright from `I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright`. Iterate until they are stunning, and keep the shots in `docs/overhaul-shots/<builder>/`.
- **Commits:** none. The lead commits.

### Builder A: the record, the chrome, the case page and the desk
**Owns:**
- `app/layout.tsx`, `app/globals.css`;
- `components/chrome/*` (new: header and footer);
- `components/record/*` (new);
- `app/case/**`, `components/case/**`;
- `app/desk/**`, `components/desk/**`;
- `components/Evidence.tsx`, `components/AskBox.tsx`;
- the existing `components/Trace.tsx` and `components/Ruler.tsx`, which you may replace or retire;
- and, at the end, `app/page.tsx` and `app/home.css` (the home page; see below).

**Builds:**
1. **Fonts and chrome:**
   - The fonts above.
   - A new header: a refined masthead with the nav (Desk, Investigations, Plants, Proof, How it works) and the watch status.
   - A new rich footer: sitemap, data sources with dates, the "fictional health system, real FDA data" note, credits, and the sponsor stack.
2. **`components/record/RecordDesk.tsx`:** a data-driven version of the batch-record hero for any case.
   - **The shelf label:** the drug in Tall Man lettering, a hazardous band if the drug is oncology, days left per hospital with a 14-day mark, and all our NDCs.
   - **The carton:** a real UPC-A and GS1 DataMatrix, encoded from the primary NDC with the encoders in the mockup.
   - **The label's establishment block** for the primary chain, with the FEI ringed.
   - **The other plants** as small cards.
   - **The red thread** to a true-to-scale ruler, with FDA's records hanging from it on clips:
     - inspections with stamps (OAI in red, VAI in amber);
     - the FMD-145 letter;
     - the shortage posting;
     - import alerts;
     - warning letters;
     - recalls;
     - a "still listed" card.
   - **Dimension lines** for the lead times.
   - **The best move** as a carbon-set slip.
   - It must lay out sensibly for up to about 12 events and up to about 10 plants, and say so plainly when there is nothing to hang.
3. **`/case/[slug]`**, restyled entirely in the Record language. The batch record itself is the page:
   - the steps as a run sheet;
   - the explanation with margin citation marks that open carbon slips;
   - stock;
   - ranked options with sign-off lines;
   - who else makes it;
   - data quality;
   - memory (past decisions, signed);
   - the Scout gate log as a stamped register;
   - the World Model graph;
   - the memo and approval as a real signature flow, with the audit trail typed out;
   - usage.

   Embed Builder B's `<Watershed caseData={c} />` as the "supply map" section. Import it from `components/watershed`; until it exists, render a placeholder.
4. **`/case` (new):** an index of every investigation as a filing cabinet or ledger, searchable and sorted by days on hand, with the state stamp.
5. **`/desk`:** the buyer's morning.
   - The watch as a printed overnight report: 22 act, 39 watch, 154 quiet.
   - The ask box as a typed request slip. The streaming investigation shows each step as a document being filed, then the finished RecordDesk.
6. **The home page, last**, once B and C have delivered. Compose it from the components:
   - the hero: RecordDesk for carboplatin, with the headline;
   - the ask slip;
   - B's film, "follow one vial upstream";
   - B's watershed for carboplatin;
   - the problem as a ledger, with sourced figures;
   - the proof, Nemotron against Upstream, as a graded answer sheet;
   - the back-test summary;
   - C's night band, "the world behind our shelf";
   - how it works;
   - the footer.

### Builder B: the watershed and the film
**Owns:**
- `components/watershed/**`;
- `components/film/**`;
- `app/lab/**` (demo routes for testing your components alone).

**Builds:**
1. **`components/watershed/Watershed.tsx`** (a client component), data-driven from any `Case`.
   - **Springs:** plants placed by rough geography (country). Plants without an FEI are marked as approximate positions, the way the mockup does.
   - **Confluences:** labelers.
   - **Reservoirs:** one per hospital that stocks the drug.
   - **Stream widths:** each hospital's real daily use per product (`case.stock`).
   - **Reservoir fill:** days on hand, with a 0–21 day gauge staff and a 14-day ring.
   - **Replay scrubber:** from the earliest relevant event to `asOf`, autoplaying once.
     - An OAI clouds the spring, then silts it red at the letter date.
     - The shortage posting turns the affected labeler channel into a dashed dry bed with a red thread.
     - Import alerts appear as magenta marks at "FDA's import frontier".
     - Warning letters are marks at the plant.
     - VAI is amber.
   - **Particles** flow along the streams on a light canvas layer.
   - **The transfer preview:** the best transfer option fills a proposed canal.
   - **Mobile:** it flows top to bottom.
   - **Engraved cartography:** contour hachures and IM Fell italics for water names.
   - **Scale:** it must handle 1 to about 10 plants, 1 to about 8 labelers and 1 to 3 hospitals, and degrade gracefully when there is no placed plant or no FDA event.
   - **Test cases:** carboplatin, lidocaine, cisplatin, fentanyl and methotrexate, plus whatever else exists in `data/cases`.
2. **`components/film/Film.tsx`:** the Powers of Ten prologue, data-driven from the carboplatin case. It may stay specific to carboplatin, but every figure and citation must come from the data. Restyle it into the Record palette and type:
   - the cabinet drawer and vial;
   - the label;
   - the real UPC-A barcode, whose bars become lanes;
   - the dive into a bar to night;
   - the globe arc to the plant (d3-geo);
   - the registration record;
   - the inspection record, with the OAI stamp landing;
   - the lead-time ruler;
   - the answer, with the proof.

   Keep it to one sticky stage with scroll-linked progress and a depth gauge. Reduced motion steps through the stops. It must be smooth at 60fps and work at 390.

### Builder C: the night band, the plants, the back-test and how it works
**Owns:**
- `components/chronograph/**`;
- `app/plants/**`, `components/plants/**`;
- `app/backtest/**`, `components/Backtest.tsx`, `components/backtest.css`, `components/EvalCompare.tsx`;
- `app/how/**`.

**Builds:**
1. **`components/chronograph/Chronograph.tsx`:** the time machine's azimuthal-equidistant world centred on Corvale, in the night palette.
   - All 123 plants from `data/plants.json`, coloured by health, with great-circle spokes to Corvale and range rings.
   - The calendar bezel replays FDA actions over 2022–2026 across all plants. Spokes flash as warning letters, OAIs and import alerts happen, using the per-plant data you can derive from the cases' signals and from `plants.json`.
   - Selecting a plant shows its record card and the cases that use it, linked by FEI.
   - It must work by touch and keyboard.
2. **`/plants`:** the chronograph as a full-bleed night-band hero, then an atlas ledger of all plants (filters, search, detail cards) in the Record style.
3. **`/backtest`:** restyled as a laboratory notebook or study record.
   - The method signed at the top;
   - the case set "fixed before the run";
   - strict against end-dated results as two facing pages;
   - the lead-time distribution;
   - controls;
   - the four examples as mini red-thread rulers (Baxter and Hurricane Helene marked as the counter-example);
   - the caveats as numbered footnotes;
   - the Nemotron against Upstream proof as a graded answer sheet (`EvalCompare.tsx`).
4. **`/how`:** restyled as an engineering drawing set with a title block.
   - The architecture as a schematic of the seven sources, Zetaris and the semantic layer, the four Meterless engines, Nemotron and the verifier.
   - The sponsor map (action, engine, API, spec section).
   - Conformance.
   - The Scout eval.
   - The Zetaris lessons.
   - How to run it.
5. **`components/chronograph/NightBand.tsx`:** a compact version for the home page that links to `/plants`.

## Done means
- Every page is a long, rich document down to the footer, with screenshots reviewed at 1440 and 390 in both themes.
- `npx tsc --noEmit -p .` is clean, and eslint is clean on your paths.
- The report lists files, components, shots and anything unfinished.
