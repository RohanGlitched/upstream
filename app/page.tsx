import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceProvider } from "@/components/Evidence";
import { RecordDesk } from "@/components/record/RecordDesk";
import { buildDesk } from "@/components/record/model";
import { BoxStamp } from "@/components/record/bits";
import { Film, prepareFilm } from "@/components/film";
import type { EvalFile, PlantsFile } from "@/components/film";
import { Defer } from "@/components/record/Defer";
import { SectionIndex } from "@/components/chrome/SectionIndex";
import { leanCase } from "@/components/record/lean";
import { Glossed } from "@/components/Gloss";
import { Watershed } from "@/components/watershed";
import { NightBand } from "@/components/chronograph/NightBand";
import { BacktestHome, type BacktestSummary } from "@/components/Backtest";
import { EvalCompare, type EvalTrace } from "@/components/EvalCompare";
import { fdaManifest, loadCase, readJson, realCases } from "@/components/server/data";
import { fmtInt } from "@/components/lib/format";
import { drugTitle } from "@/components/lib/drug";
import { caseSystems, lineageLine } from "@/src/lib/lineage";
import "./home.css";

const PROBLEM = [
  {
    n: "20 million",
    unit: "hours",
    what: "of staff time a year, and nearly $900 million in labour, go to managing drug shortages in US hospitals.",
    src: "Vizient survey, 2023 data, published June 2025",
    href: "https://www.vizient.com/newsroom/news-releases/2025/new-vizient-survey-finds-drug-shortages-cost-hospitals-nearly-900m-annually-in-labor-expenses",
  },
  {
    n: "59",
    unit: "per cent",
    what: "of the shortages ASHP tracked in 2025 had a cause that was unknown or not disclosed.",
    src: "ASHP data, reported by AJMC",
    href: "https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter",
  },
  {
    n: "227",
    unit: "shortages",
    what: "active in the US in the second quarter of 2026, a third straight quarterly rise.",
    src: "ASHP, Q2 2026, reported by AJMC",
    href: "https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter",
  },
];

const LIMITS = [
  ["The hospitals are fictional", "Corvale Health, its stock, usage, people and past decisions are invented. The FDA records it traces are real and dated."],
  // Measured by scripts/dq-fda.mts (data/dq/fda.json); the heading below is filled from it.
  ["LABELS", "When a label lists no establishment, Upstream falls back to the label's text or the application holder and says so. It does not guess the factory."],
  ["Ingredient plants are mostly invisible", "Labels name finished-dose plants. The plant making the active ingredient rarely appears in a public file, so a problem there can go unseen."],
  ["Today's files hold more than was public then", "Today's FDA files include classifications that were not public at the time. The ruler marks the day each finding became known."],
  ["A finding is not a cause", "An OAI classification means FDA found serious problems at a plant. It does not prove they caused this shortage; the answer says linked, never caused."],
  ["It informs, it does not order", "Upstream ranks options and drafts a memo. Transfers, substitutions and contract changes are signed by a named pharmacist or the P&T committee."],
];

const SECTIONS = [
  { id: "why", label: "Why" },
  { id: "film", label: "The trip" },
  { id: "supply", label: "Supply map" },
  { id: "accuracy", label: "Accuracy" },
  { id: "world", label: "The world" },
  { id: "how", label: "How it runs" },
  { id: "limits", label: "Limits" },
];

/** Three things to do, in order, for someone with a few minutes. */
function JudgePath({ drug, drugs }: { drug: string; drugs: number }) {
  return (
    <section id="start" className="hm-path" aria-labelledby="start-h">
      <h2 id="start-h" className="sr-only">
        Where to start
      </h2>
      <p className="hm-path__real">What&apos;s real: Corvale Health&apos;s three hospitals are fictional; every FDA record is real and dated.</p>
      <ol className="hm-path__steps">
        <li>
          <a href="#why">
            <span className="hm-path__n">1</span>
            <b>Read a why</b>
            <span>{drug}, line by line. Every claim opens the FDA or hospital row it rests on.</span>
          </a>
        </li>
        <li>
          <Link href="/desk">
            <span className="hm-path__n">2</span>
            <b>Ask about any of {drugs} drugs</b>
            <span>Ask replays recorded runs of the live agent (Zetaris and Nemotron run locally); each is a real run.</span>
          </Link>
        </li>
        <li>
          <a href="#accuracy">
            <span className="hm-path__n">3</span>
            <b>Check the accuracy</b>
            <span>Nemotron alone against Upstream, then a back-test on past shortages.</span>
          </a>
        </li>
      </ol>
    </section>
  );
}

export default async function Home() {
  const c = await loadCase("carboplatin");
  const watch = await readJson<{ drugs: number; chunks: number }>("data/watch/latest.json");
  if (!c) notFound();
  const [plants, trace, backtest, manifest, cases, dq] = await Promise.all([
    readJson<PlantsFile>("data/plants.json"),
    readJson<EvalFile & EvalTrace>("data/eval/trace.json"),
    readJson<BacktestSummary>("data/backtest/summary.json"),
    fdaManifest(),
    realCases(),
    readJson<{ labels: { labels: number; pctNameNoPlant: number; pctListNoEstablishment: number }; plants: { pctUnplaced: number } }>("data/dq/fda.json"),
  ]);
  const limits = LIMITS.map(([h, p]) =>
    h !== "LABELS"
      ? [h, p]
      : dq
        ? [
            `${Math.round(dq.labels.pctNameNoPlant)}% of labels name no plant at all`,
            `${Math.round(dq.labels.pctListNoEstablishment)}% of the ${fmtInt(dq.labels.labels)} labels list no plant in their establishment block; after the fallbacks below, ${Math.round(dq.labels.pctNameNoPlant)}% still name none. ${dq.plants.pctUnplaced}% of the plants named are not in FDA's registration file. ${p}`,
          ]
        : ["Many labels name no plant", p],
  );
  const slug = cases.find((x) => x.slug === "carboplatin" || x.molecule.toLowerCase() === c.molecule.toLowerCase())?.slug ?? "carboplatin";
  const m = buildDesk(c, slug);
  const graph = (c as typeof c & { graph?: { nodes: unknown[]; edges: unknown[] } }).graph;
  const lean = leanCase(c);
  const plantsLean = plants && {
    asOf: plants.asOf,
    queryId: plants.queryId,
    plants: plants.plants.map((p) => ({ name: p.name, fei: p.fei, country_iso3: p.country_iso3, lat: p.lat, lon: p.lon, health: p.health })),
  };
  const evalLean = trace ? ({ summary: trace.summary } as EvalFile) : null;
  // The film's figures are computed here; the client gets them, not the case.
  const film = prepareFilm(c, plantsLean, evalLean);
  const fdaRows = manifest ? Object.values(manifest.counts).reduce((a, b) => a + b, 0) : null;
  const title = drugTitle(c.molecule);
  const v = c.explanation?.verifier;

  const flow = [
    {
      who: "You ask",
      engine: "Meterless Scout Intent",
      what: "Names the intent and its risk, then signs an execution contract listing what may run. Every later tool call is checked against it. Orders are always refused.",
      here: `${c.intent.name}, ${c.intent.risk} risk, contract ${c.intent.contractId?.slice(-8) ?? "none"}`,
    },
    {
      who: "Upstream reads the sources",
      engine: "Zetaris",
      what: "Federated SQL through one semantic layer. Two Postgres servers and a folder of CSV exports are read in place; FDA's public files are cleaned once into CSVs that Zetaris reads as file tables. Every query is kept with its id, SQL and rows.",
      here: `${lineageLine(caseSystems(c).length, c.usage.zetarisQueries, c.usage.zetarisMs)}${fdaRows ? `, over ${fmtInt(fdaRows)} FDA rows` : ""}`,
    },
    {
      who: "The chain is recorded",
      engine: "Meterless World Model",
      what: "Hospital item, package, product, labeler, plant and FDA action become a graph with provenance on every edge. The explanation may only cite what is in it.",
      here: `${graph?.nodes.length ?? 0} nodes, ${graph?.edges.length ?? 0} edges`,
    },
    {
      who: "What did we do last time?",
      engine: "Meterless H-MEM",
      what: "Recalls past decisions on the drug with who signed them, and records a new one only after a signed-in pharmacist or the director signs: a demo sign-in here, single sign-on in a hospital.",
      here: `${c.memory.length} past decisions recalled`,
    },
    {
      who: "The answer is written",
      engine: "NVIDIA Nemotron and the verifier",
      what: "Nemotron writes from the evidence. A deterministic check then drops any sentence whose dates, numbers or citations are not in the rows it cites.",
      here: `${c.explanation?.sentences.length ?? 0} sentences and the headline kept, ${v?.rejected.length ?? 0} dropped`,
    },
    {
      who: "Overnight, every drug",
      engine: "Meterless Markovian",
      what: "The watch walks the whole formulary in fixed-size chunks with a fresh contract for each, so the morning report costs the same at 30 drugs or 300.",
      here: watch ? `${watch.drugs} drugs, ${watch.chunks} chunks, a flat prompt` : "the whole formulary, a flat prompt",
    },
  ];

  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <SectionIndex items={SECTIONS} />
      <RecordDesk
        m={m}
        signHref={`/case/${slug}#memo`}
        between={<JudgePath drug={title} drugs={cases.length} />}
        others={false}
        more={
          <Link href={`/case/${slug}`} className="rd-go rd-go--line">
            Open {title}&apos;s full file
          </Link>
        }
      />

      <section className="hm-film" aria-label="Follow one vial upstream">
        <Film film={film} offsetTop={108} answerHref={`/case/${slug}`} />
      </section>

      <section className="hm-sec" id="supply" aria-labelledby="ws-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="ws-h">Where our {title} comes from, drawn as rivers</h2>
            <p>
              Plants are springs, labelers confluences, our hospitals reservoirs. Stream width is real daily use.
            </p>
          </div>
        </div>
        <Watershed caseData={lean} />
      </section>

      <section className="hm-sec" aria-labelledby="problem-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="problem-h">The problem: a shortage arrives without its cause</h2>
            <p>
              A buyer learns a drug is short when the order is cut. The cause is often already in FDA files nobody has time to join.
            </p>
          </div>
          <ol className="hm-ledger">
            {PROBLEM.map((p, i) => (
              <li key={i}>
                <span className="hm-ledger__no">{String(i + 1).padStart(2, "0")}</span>
                <span className="hm-ledger__n">
                  {p.n}
                  <small>{p.unit}</small>
                </span>
                <span className="hm-ledger__what">{p.what}</span>
                <a className="hm-ledger__src" href={p.href} rel="noopener noreferrer">
                  {p.src}
                </a>
              </li>
            ))}
            <li className="hm-ledger__total">
              <span className="hm-ledger__no" />
              <span className="hm-ledger__n">
                {cases.length}
                <small>investigations</small>
              </span>
              <span className="hm-ledger__what">
                on file for Corvale&apos;s formulary, each with its cause traced to a plant, or a plain statement that FDA&apos;s record holds none.
              </span>
              <Link className="hm-ledger__src" href="/case">
                Open the cabinet
              </Link>
            </li>
          </ol>
        </div>
      </section>

      <section className="hm-sec" id="accuracy" aria-labelledby="eval-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="eval-h">The same AI model, from memory and with FDA&apos;s files</h2>
            <p>
              NVIDIA Nemotron from memory, against Upstream giving it FDA&apos;s files, both marked against answers computed from the raw files.
            </p>
          </div>
          <Defer minHeight={900}>
            <EvalCompare data={trace} />
          </Defer>
        </div>
      </section>

      <section className="hm-sec" aria-labelledby="bt-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="bt-h">Does it hold up on past shortages?</h2>
            <p>The same trace, run over FDA&apos;s shortage history and a set of drugs that were never short. It explains; it does not predict.</p>
          </div>
          <Defer minHeight={700}>
            <BacktestHome data={backtest} />
          </Defer>
        </div>
      </section>

      <Defer className="hm-night" id="world" minHeight={1000}>
        <NightBand title="Where the plants are, and what FDA found there" />
      </Defer>

      <section className="hm-sec" id="how" aria-labelledby="how-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="how-h">What runs when you ask</h2>
            <p>One question, in order. Each line names the engine that does it, and what it did for {title}.</p>
          </div>
          <ol className="hm-flow">
            {flow.map((f, i) => (
              <li key={i}>
                <span className="hm-flow__no">{i + 1}</span>
                <span className="hm-flow__who">
                  <b>{f.who}</b>
                  <span>{f.engine}</span>
                </span>
                <span className="hm-flow__what">
                  <Glossed text={f.what} />
                </span>
                <span className="hm-flow__here">
                  <span className="hm-flow__k">{title}</span>
                  {f.here}
                </span>
              </li>
            ))}
          </ol>
          <p className="hm-more">
            <Link href="/how">The drawing set: architecture, conformance and the Scout eval</Link>
          </p>
        </div>
      </section>

      <section className="hm-sec" id="limits" aria-labelledby="limits-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="limits-h">What Upstream can&apos;t see</h2>
            <p>Stated plainly, because a buyer acting on this needs to know where it stops.</p>
          </div>
          <ol className="hm-limits">
            {limits.map(([h, p], i) => (
              <li key={h}>
                <BoxStamp tone="ink" tilt={i % 2 ? 1.5 : -1.5}>
                  {`NOTE ${i + 1}`}
                </BoxStamp>
                <h3>{h}</h3>
                <p>
                  <Glossed text={p} />
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </EvidenceProvider>
  );
}
