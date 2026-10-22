# Upstream redesign: brief for the direction mockups

**Product.** Upstream is a drug shortage investigator for hospital pharmacy buyers. The live site is https://upstream-shortage.vercel.app.

**Why a redesign.** The owner says the current UI looks "simple" and wants it fabulous enough to blow the judges' minds, for the Open Agent Hackathon 2026. The judges are Zetaris's CTO (data federation), a SpaceXAI partnerships lead, and three people from GenAI Works.

**The task.** Three designers each build ONE direction as a mockup, so the owner can pick before the full overhaul.

## Real data (use it, never placeholders)
Read `data/cases/carboplatin.json` (the hero case), `data/plants.json` (123 plants with lat/lon at country centroids), `data/watch/latest.json` and `data/eval/trace.json`. The hero story:
- **Our shelf.** Corvale Health has three hospitals:
  - Corvale General (Postgres), 9 days of carboplatin left;
  - Corvale East (Postgres), 18 days;
  - Corvale Lakeside (CSV cabinet exports), 1.9 days.
- **The products.** We stock NDC 16729-295-12 (Accord), 0703-4239-01 (Teva) and 60505-6282-1 (Apotex).
- **The plant.** Accord's label names Intas Pharmaceuticals, Sanand, Gujarat, India (FEI 3004011473).
- **The FDA timeline:**
  - 2022-12-02: FDA's inspection ends, later classified OAI;
  - 2023-04-05: OAI classification letter;
  - 2023-04-28: FDA posts the carboplatin shortage, 23 days after the letter;
  - 2023-06-01: import alert 66-40;
  - 2023-07-28: warning letter;
  - 2023-11-14: second import alert;
  - today, 2026-10-21: still listed, 42 months on.
- **The other plants:** Teyro Labs, India (VAI 2025-11-12, for Apotex) and Pharmachemie BV, Netherlands (for Teva).
- **The best move:** transfer 26 vials from Corvale East to Corvale Lakeside.
- **The proof:** against independent ground truth, Upstream reaches the right plant 88% of the time and the right inspection 95%. Nemotron with no tools gets 0 of 54 inspection dates right and invents 50.

## Owner's preferences (binding)
- **Calm type scale:**
  - hero headline at most about 58px;
  - section headings at most about 44px;
  - big figures 34–40px;
  - body about 17px.
- **The hero must render instantly:** SVG or CSS, no WebGL or three.js, nothing that takes seconds to appear. Motion is fine if it plays on load and respects reduced motion.
- **One memorable moment**, with everything around it disciplined and refined. It must look like a real, premium product for hospital pharmacists, not a hackathon template.
- **Avoid these AI-page tells:**
  - cream background with a terracotta accent;
  - black with an acid-green accent;
  - identical rounded SaaS cards everywhere;
  - all-caps eyebrow labels;
  - gradient blobs;
  - emoji;
  - "→" on every link.
- **Pharmacy vernacular is welcome:**
  - Tall Man lettering (CARBOplatin);
  - FDA paperwork (OAI, VAI, Form 483, warning letter, import alert 66-40);
  - NDC codes;
  - carton labels and barcodes;
  - syringe-label class colours.
- **Mobile at 390px** must look intentional, not just stacked.

## What to build
A single self-contained static HTML file at `docs/moods/<direction>/index.html`, with inline CSS and JS, Google Fonts allowed, and the data inlined from the JSON files.

It contains:
1. a header;
2. the full **hero**, including the signature interactive moment;
3. two more sections below it: "what the trace found" and "Nemotron alone against Upstream";
4. a footer stub.

Then take Playwright screenshots of the full page at 1440 and 390 (dark and/or light as the direction wants) into `docs/moods/<direction>/shots/`. Playwright is at `I:/Programs/ListofHackathon/hackathons/01-arbitrum-open-house/submission/video/node_modules/playwright`. Use `MSYS_NO_PATHCONV=1` in Git Bash.

Iterate on your own screenshots until the result is stunning. Don't touch any other file in the repo.
