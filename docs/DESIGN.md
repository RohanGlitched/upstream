# Upstream: design plan

**Subject.** The drug shortage desk in a hospital pharmacy.
**Audience.** Pharmacy buyers and pharmacy directors first; judges second.
**Primary job.** Answer "why is it short, and what do we do?" with evidence that can be checked in one glance.

## Vernacular we borrow (real, from the subject's world)
- **Tall Man lettering.** FDA and ISMP mixed-case drug names (CISplatin, CARBOplatin, vinCRIStine, hydrALAZINE) that keep look-alike names from being confused. Every drug name in the product uses the official list. The type treatment carries meaning, so it is not decoration.
- **Syringe label colours** (ASTM D4774 / ISO 26825). The colours anaesthesia teams use for drug classes:
  - induction agents: yellow;
  - benzodiazepines: orange;
  - opioids: blue;
  - neuromuscular blockers: fluorescent red;
  - vasopressors: violet;
  - local anaesthetics: grey;
  - anticholinergics: green;
  - antiemetics: salmon.

  They appear only as small class marks beside a drug, never as page decoration.
- **NDC codes and carton barcodes.** Codes are set in tabular figures of the UI face, never a monospace.
- **FDA paperwork.** Form 483 observations, OAI/VAI/NAI classifications and warning letters are shown by their real names, with their real dates.

## Tokens
| Name | Hex | Role |
|---|---|---|
| shelf | #F6F7F5 | page background, a cool cabinet white (not cream) |
| card | #FFFFFF | raised panels |
| ink | #18222C | text |
| rule | #D6DADD | hairlines, table rules |
| steel | #5B6873 | secondary text |
| signal | #E3342F | an FDA action that matters: OAI, warning letter, import alert |
| caution | #E8A317 | VAI, a recall, a weaker signal |
| clear | #2F8F5B | NAI, stock that's fine |
| link | #1F5FAD | interactive |

Dark mode (judges may prefer it):
- shelf #10171D
- card #172129
- ink #E9EEF1
- rule #2A3640
- signal, caution and clear lifted for contrast

**Type.** Public Sans for everything: it is the US Web Design System face that FDA's own sites use, so the product reads like the documents it cites.
- Weights: 400 body, 600 labels, 800 headlines.
- Scale: 1.250 ratio from a 16px base, so 13 / 16 / 20 / 25 / 31 / 39 / 49.
- Body measure: 68ch or less. Tabular figures everywhere numbers align.
- Headlines are sentence case at modest sizes (the "calm type" rule).

## The one memorable moment: the trace and its lead-time ruler
The investigation draws a single chain from **our shelf** to **the plant**:

```
 [our shelf: 9 days left] ─ [NDC 0703-5748] ─ [Teva] ─ [plant, Gujarat IN · FEI 3002807…] ─ [OAI inspection]
                                                                         │
 time ────●─────────────●──────────────────────────────●───────▶
      inspection OAI    warning letter          FDA lists shortage
      12 Mar 2025       30 Jun 2025             21 Jul 2025
      └────────────── 131 days of warning ─────────────┘
```

Each link appears as its Zetaris query returns. It carries the query id and opens to the SQL and the row behind it. Under the chain, the **lead-time ruler** puts the signals on a time axis against the day FDA posted the shortage. That ruler is the product's signature, and it is also the back-test's unit of measure.

Desktop shows the chain left to right. On phones it runs top to bottom, with the ruler as a vertical timeline.

## Layout and pages
- **Home.** Hero with the cisplatin trace playing, then:
  - problem stats, sourced;
  - "ask Upstream";
  - the health system's three data sources, drawn as staying where they are;
  - back-test results;
  - how it works (Zetaris, the four Meterless engines, Nemotron);
  - limits;
  - a rich footer.
- **Desk** (`/desk`). The buyer's workspace:
  - morning brief from the overnight watch;
  - the formulary at risk, sorted by days of stock and signal strength;
  - an ask box.
- **Investigation** (`/case/[id]`):
  - the trace and ruler;
  - the evidence ledger, with SQL, rows and data-quality results;
  - options: sister-hospital stock, approved interchanges, other makers ranked by plant health;
  - the memory panel ("last time we…", with its audit trail);
  - the P&T memo draft, which a named person approves through the Scout contract;
  - the gate log: what Scout allowed, what needed approval, what it refused.
- **Atlas** (`/plants`). Every FDA-registered plant making drugs on our formulary, on a map, coloured by its latest classification.
- **Evidence** (`/backtest`). The set of cases fixed before the run, the first-run results, lead-time distribution, false-alarm rate, misses.
- **How it works** (`/how`). Architecture, the sponsor map (action → engine → spec section), conformance results.

## Principles
1. **Every claim is one click from its row.** No sentence without a source chip.
2. **Three honest states:**
   - confirmed signal at a linked plant;
   - check this: the link is weak, a name match or a data-quality failure;
   - no public signal found.
3. **Copy is calm, not alarmist.** "FDA classified this plant OAI on 12 Mar 2025" beats "plant in trouble!".
4. **Motion is limited to the trace drawing itself in,** with reduced motion respected.
5. **Mobile first-class:** at 390px the ask box sits right after the hero trace.
