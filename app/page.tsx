import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceProvider } from "@/components/Evidence";
import { RecordDesk } from "@/components/record/RecordDesk";
import { buildDesk } from "@/components/record/model";
import { BoxStamp } from "@/components/record/bits";
import { AskBox } from "@/components/AskBox";
import { Film } from "@/components/film";
import type { EvalFile, PlantsFile } from "@/components/film";
import { Watershed } from "@/components/watershed";
import { NightBand } from "@/components/chronograph/NightBand";
import { BacktestHome, type BacktestSummary } from "@/components/Backtest";
import { EvalCompare, type EvalTrace } from "@/components/EvalCompare";
import { fdaManifest, loadCase, readJson, realCases } from "@/components/server/data";
import { fmtInt, fmtMs } from "@/components/lib/format";
import { drugTitle } from "@/components/lib/drug";
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
  ["About a third of labels name no plant", "When a label lists no establishment, Upstream falls back to the application holder and says so. It does not guess the factory."],
  ["Ingredient plants are mostly invisible", "Labels name finished-dose plants. The plant making the active ingredient rarely appears in a public file, so a problem there can go unseen."],
  ["History has look-ahead bias", "Today's FDA files include classifications that were not public at the time. The ruler marks the day each finding became known."],
  ["A finding is not a cause", "An OAI classification means FDA found serious problems at a plant. It does not prove they caused this shortage; the answer says linked, never caused."],
  ["It informs, it does not order", "Upstream ranks options and drafts a memo. Transfers, substitutions and contract changes are signed by a named pharmacist or the P&T committee."],
];

export default async function Home() {
  const c = await loadCase("carboplatin");
  if (!c) notFound();
  const [plants, trace, backtest, manifest, cases] = await Promise.all([
    readJson<PlantsFile>("data/plants.json"),
    readJson<EvalFile & EvalTrace>("data/eval/trace.json"),
    readJson<BacktestSummary>("data/backtest/summary.json"),
    fdaManifest(),
    realCases(),
  ]);
  const m = buildDesk(c, "carboplatin");
  const { graph, ...lean } = c;
  const plantsLean = plants && {
    asOf: plants.asOf,
    queryId: plants.queryId,
    plants: plants.plants.map((p) => ({ name: p.name, fei: p.fei, country_iso3: p.country_iso3, lat: p.lat, lon: p.lon, health: p.health })),
  };
  const evalLean = trace ? ({ summary: trace.summary } as EvalFile) : null;
  const fdaRows = manifest ? Object.values(manifest.counts).reduce((a, b) => a + b, 0) : null;
  const title = drugTitle(c.molecule);
  const v = c.explanation?.verifier;

  const flow = [
    {
      who: "You ask",
      engine: "Scout Intent",
      what: "Names the intent and its risk, then signs an execution contract listing what may run. Every later tool call is checked against it. Orders are always refused.",
      here: `${c.intent.name}, ${c.intent.risk} risk, contract ${c.intent.contractId?.slice(-8) ?? "none"}`,
    },
    {
      who: "Upstream reads the sources",
      engine: "Zetaris",
      what: "Federated SQL through one semantic layer, over two Postgres servers, a folder of CSV exports and FDA's files, read where they live. Every query is kept with its id, SQL and rows.",
      here: `${c.usage.zetarisQueries} queries, ${fmtMs(c.usage.zetarisMs)}${fdaRows ? `, over ${fmtInt(fdaRows)} FDA rows` : ""}`,
    },
    {
      who: "The chain is recorded",
      engine: "World Model",
      what: "Hospital item, package, product, labeler, plant and FDA action become a graph with provenance on every edge. The explanation may only cite what is in it.",
      here: `${graph?.nodes.length ?? 0} nodes, ${graph?.edges.length ?? 0} edges`,
    },
    {
      who: "What did we do last time?",
      engine: "H-MEM",
      what: "Recalls past decisions on the drug with who signed them, and records a new one only after a named pharmacist signs.",
      here: `${c.memory.length} past decisions recalled`,
    },
    {
      who: "The answer is written",
      engine: "NVIDIA Nemotron and the verifier",
      what: "Nemotron writes from the evidence. A deterministic check then drops any sentence whose dates, numbers or citations are not in the rows it cites.",
      here: `${v?.checked ?? 0} claims checked, ${v?.rejected.length ?? 0} dropped`,
    },
    {
      who: "Overnight, every drug",
      engine: "Markovian",
      what: "The watch walks the whole formulary in fixed-size chunks with a fresh contract for each, so the morning report costs the same at 30 drugs or 300.",
      here: "215 drugs, 18 chunks, a flat prompt",
    },
  ];

  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <RecordDesk
        m={m}
        signHref="/case/carboplatin#memo"
        lede={
          <>
            <b>Upstream</b> follows a short drug from our shelves to the plant that makes it, and lays FDA&apos;s record out to scale. This morning a buyer asked about {title}:
          </>
        }
      >
        <Link href="/case/carboplatin" className="rd-go">
          Open the full file
        </Link>
      </RecordDesk>

      <section className="hm-sec hm-ask" aria-label="Ask Upstream">
        <div className="hm-in">
          <AskBox id="home-ask" />
        </div>
      </section>

      <section className="hm-film" aria-label="Follow one vial upstream">
        <Film caseData={lean} plants={plantsLean} evalData={evalLean} offsetTop={66} answerHref="/case/carboplatin" />
      </section>

      <section className="hm-sec" aria-labelledby="ws-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="ws-h">The same supply, as a watershed</h2>
            <p>
              Plants are springs, labelers are confluences, our hospitals are reservoirs. Stream width is real daily use, and FDA&apos;s record
              replays as silt and dry beds.
            </p>
          </div>
        </div>
        <Watershed caseData={lean} />
      </section>

      <section className="hm-sec" aria-labelledby="problem-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="problem-h">The problem, in the ledger</h2>
            <p>
              A buyer learns a drug is short when the wholesaler cuts the order. The cause is usually already on public record, spread across FDA
              files nobody has time to join.
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

      <section className="hm-sec" id="proof" aria-labelledby="eval-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="eval-h">Nemotron alone against Upstream</h2>
            <p>
              The same model, asked from memory which plant makes each product and what FDA found there, against Upstream reading FDA&apos;s
              files. Both are marked against answers computed separately from the raw files.
            </p>
          </div>
          <EvalCompare data={trace} />
        </div>
      </section>

      <section className="hm-sec" aria-labelledby="bt-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="bt-h">Does the ruler hold up on past shortages?</h2>
            <p>The same trace, run over FDA&apos;s shortage history and a set of drugs that were never short. It explains; it does not predict.</p>
          </div>
          <BacktestHome data={backtest} />
        </div>
      </section>

      <div className="hm-night">
        <NightBand />
      </div>

      <section className="hm-sec" aria-labelledby="how-h">
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
                <span className="hm-flow__what">{f.what}</span>
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

      <section className="hm-sec" aria-labelledby="limits-h">
        <div className="hm-in">
          <div className="rec-head">
            <h2 id="limits-h">What Upstream can&apos;t see</h2>
            <p>Stated plainly, because a buyer acting on this needs to know where it stops.</p>
          </div>
          <ol className="hm-limits">
            {LIMITS.map(([h, p], i) => (
              <li key={h}>
                <BoxStamp tone="ink" tilt={i % 2 ? 1.5 : -1.5}>
                  {`NOTE ${i + 1}`}
                </BoxStamp>
                <h3>{h}</h3>
                <p>{p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </EvidenceProvider>
  );
}
