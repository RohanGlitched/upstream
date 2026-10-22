import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { EvalCompare, type EvalTrace } from "@/components/EvalCompare";
import { InlineMd } from "@/components/Code";
import { readJson, fdaManifest } from "@/components/server/data";
import { engineReadme, tableAfter, zetarisNotes, isTrap } from "@/components/server/docs";
import { fmtDate, fmtInt } from "@/components/lib/format";
import { UslSheet, type ExplainFile, type FdaDq } from "@/components/UslSheet";
import { FDA_FILES_REGISTERED } from "@/src/lib/lineage";
import "./how.css";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Upstream as a drawing set: the architecture from fifteen sources (three hospital systems and 12 FDA files) through Zetaris to the engines and the verifier, the semantic layer and its measured keys, the sponsor map, conformance, the Scout eval and what Zetaris taught us.",
};

interface Conformance {
  at: string;
  vendorCommit: string;
  node: string;
  platform: string;
  results: { engine: string; module: string; spec: string; pass: boolean; summary: string; ms: number; tail?: string }[];
}

interface Metric {
  value: number | null;
  n: number;
  d: number;
}
interface ScoutEval {
  at: string;
  corpus: string;
  selfTest?: { probes: number; maxMs: number; medianMs: number };
  metrics: Record<string, Record<string, Metric | number | { p50: number; p95: number; max: number }>>;
}

const METRICS: [string, string][] = [
  ["block_recall", "Block recall"],
  ["block_precision", "Block precision"],
  ["injection_recall", "Injection recall"],
  ["intent_accuracy", "Intent accuracy"],
  ["risk_level_accuracy", "Risk-level accuracy"],
  ["clarification_accuracy", "Clarification accuracy"],
  ["tool_plan_recall", "Tool-plan recall"],
  ["parameter_binding", "Parameter binding"],
  ["contract_scope_correct", "Contract scope correct"],
];

function m(x: unknown): Metric | null {
  const o = x as Metric;
  return o && typeof o.value === "number" ? o : null;
}

function isEval(x: unknown): x is EvalTrace {
  const o = x as EvalTrace;
  return Boolean(o && o.summary && o.summary.upstream && Array.isArray(o.rows));
}

/** The title block in each sheet's corner, the way a drawing set carries one. */
function TitleBlock({ sheet, title, date, of }: { sheet: string; title: string; date: string; of: number }) {
  return (
    <dl className="hw-tb" aria-label={`Sheet ${sheet}`}>
      <div className="hw-tb__proj">
        <dt>Project</dt>
        <dd>Upstream</dd>
      </div>
      <div className="hw-tb__title">
        <dt>Drawing</dt>
        <dd>{title}</dd>
      </div>
      <div>
        <dt>Sheet</dt>
        <dd className="hw-type">
          {sheet} of A-{of}
        </dd>
      </div>
      <div>
        <dt>Date</dt>
        <dd className="hw-type">{date}</dd>
      </div>
    </dl>
  );
}

function Sheet({ id, n, title, lede, date, of, children, wide }: { id: string; n: string; title: string; lede?: ReactNode; date: string; of: number; children: ReactNode; wide?: boolean }) {
  return (
    <section id={id} className={`hw-sheet${wide ? " hw-sheet--wide" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="hw-frame">
        <span className="hw-zone hw-zone--t" aria-hidden="true">
          <i>1</i>
          <i>2</i>
          <i>3</i>
          <i>4</i>
        </span>
        <header className="hw-sheet__head">
          <span className="hw-sheet__n hw-type">{n}</span>
          <h2 id={`${id}-h`}>{title}</h2>
          {lede ? <p>{lede}</p> : null}
        </header>
        <div className="hw-sheet__body">{children}</div>
        <TitleBlock sheet={n} title={title} date={date} of={of} />
      </div>
    </section>
  );
}

function Balloon({ n }: { n: number }) {
  return (
    <span className="hw-balloon" aria-hidden="true">
      {n}
    </span>
  );
}

// FDA's files as registered with Zetaris, each with its public source: moved here from the footer, with row counts.
const FDA_FILES: { key: string; name: string; href: string }[] = [
  { key: "ndc_packages", name: "NDC directory", href: "https://open.fda.gov/apis/drug/ndc/" },
  { key: "spl_establishments", name: "Label establishments", href: "https://dailymed.nlm.nih.gov/dailymed/" },
  { key: "registrations", name: "Establishment registrations", href: "https://www.fda.gov/drugs/drug-approvals-and-databases/drug-establishments-current-registration-site" },
  { key: "inspections", name: "Inspection classifications", href: "https://datadashboard.fda.gov/ora/cd/inspections.htm" },
  { key: "citations", name: "Form 483 citations", href: "https://datadashboard.fda.gov/ora/cd/inspectioncitations.htm" },
  { key: "compliance_actions", name: "Warning letters and actions", href: "https://datadashboard.fda.gov/ora/cd/complianceactions.htm" },
  { key: "import_alerts", name: "Import alerts", href: "https://www.accessdata.fda.gov/cms_ia/ialist.html" },
  { key: "recalls", name: "Recalls", href: "https://open.fda.gov/apis/drug/enforcement/" },
  { key: "shortage_current", name: "Drug shortages", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "shortage_episodes", name: "Shortage history", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "shortage_presentations", name: "Shortage presentations", href: "https://www.accessdata.fda.gov/scripts/drugshortages/" },
  { key: "dmf_api", name: "Drug master files", href: "https://www.fda.gov/drugs/drug-master-files-dmfs/list-drug-master-files-dmfs" },
];

// The two Cursor sessions, as docs/cursor/README.md records them.
const CURSOR_SESSIONS: { n: string; title: string; id: string; prompt: string; made: string }[] = [
  {
    n: "1",
    title: "Build the hospital generator",
    id: "9c40599f-bff6-4e05-a69d-d67beea8e07b",
    prompt: "Implement `data/hospital/SPEC.md` completely, run the generator against the real FDA inputs, run the tests and fix anything that fails. Do not change the spec; do not commit.",
    made: "11.5 minutes, 14 file edits and 24 shell runs: `generate.py`, `common_generics.txt`, `scenarios.example.json` and `test_generate.py`.",
  },
  {
    n: "2",
    title: "Apply the pharmacist's fixes",
    id: "329b3dc5-3c5e-476e-9963-3035a4d4d499",
    prompt: "Apply every fix in `data/hospital/FIXES-1.md` (a pharmacist's review of session 1's output), write `scenarios.json`, re-run until the tests pass.",
    made: "8 edits to `generate.py` and 5 shell runs, then Cursor's free plan hit its usage limit; the rest of FIXES-1 was finished by hand and `audit.py` checks it.",
  },
];

export default async function How() {
  const [readme, conf, scout, notes, manifest, rawE, dq, plans] = await Promise.all([
    engineReadme(),
    readJson<Conformance>("conformance.json"),
    readJson<ScoutEval>("src/engines/results/scout-pharmacy-eval.json"),
    zetarisNotes(),
    fdaManifest(),
    readJson<unknown>("data/eval/trace.json"),
    readJson<FdaDq>("data/dq/fda.json"),
    readJson<ExplainFile>("data/zetaris/explain.json"),
  ]);
  const ev = isEval(rawE) ? rawE : null;
  const sponsor = tableAfter(readme, "Where each engine is used");
  const hmem = tableAfter(readme, "H-MEM recall");
  const world = tableAfter(readme, "World Model persistence");
  const splits = scout ? (["all", "tuning", "heldout"] as const).filter((k) => scout.metrics[k]) : [];
  const date = conf ? fmtDate(conf.at) : "22 Oct 2026";
  const OF = 8;
  const c = manifest?.counts ?? null;
  const n = (k: string) => (c && typeof c[k] === "number" ? fmtInt(c[k]) : null);
  const engines = new Set((sponsor?.rows ?? []).map((r) => r[1]));
  // Cursor is not a runtime engine, but it built part of the project: say so on the map, and what it did.
  const sponsorRows = sponsor
    ? [
        ...sponsor.rows,
        [
          "Corvale's three hospitals: the generated stock, usage and formulary data",
          "Cursor",
          "Cursor's agent wrote the Corvale hospital data generator (`data/hospital/generate.py`) and applied a pharmacist's fixes (session summary: `docs/cursor`)",
          "Build tool, not a runtime engine",
        ],
      ]
    : [];
  // The Scout eval's counts, read from its own output so every line on A-5 agrees with the table.
  const sAll = scout?.metrics.all;
  const sHeld = scout?.metrics.heldout;
  const nPrompts = sAll ? Number(sAll.examples) : null;
  const nHeld = sHeld ? Number(sHeld.examples) : null;
  const heldBlocks = sHeld ? m(sHeld.block_recall)?.d ?? null : null;

  const SOURCES: { k: string; t: string; s: string; who: "h" | "f" }[] = [
    { k: "1", t: "Corvale General", s: "Postgres, read-only reporting views", who: "h" },
    { k: "2", t: "Corvale East", s: "Postgres, its own schema", who: "h" },
    { k: "3", t: "Corvale Lakeside", s: "Nightly CSV cabinet exports", who: "h" },
    { k: "4", t: "NDC directory and label filings", s: n("ndc_packages") ? `${n("ndc_packages")} packages, ${n("spl_establishments")} label plants` : "Packages and the plants each label names", who: "f" },
    { k: "5", t: "Establishment registrations", s: n("registrations") ? `${n("registrations")} plants by FEI` : "Every plant by FEI and DUNS", who: "f" },
    { k: "6", t: "Inspections and enforcement", s: n("inspections") ? `${n("inspections")} inspections, ${n("compliance_actions")} letters, ${n("import_alerts")} import alerts, ${n("recalls")} recalls` : "Inspections, Form 483s, letters, import alerts, recalls", who: "f" },
    { k: "7", t: "Drug shortage history", s: n("shortage_episodes") ? `${n("shortage_episodes")} episodes, ${n("shortage_current")} current listings` : "Current listings and archived episodes", who: "f" },
  ];

  return (
    <div className="hw">
      <section className="hw-cover" aria-labelledby="how-title">
        <div className="hw-cover__in">
          <div className="hw-cover__text">
            <h1 id="how-title">How Upstream is built</h1>
            <p>
              One question passes a gate, runs federated queries where the data lives, builds a graph, recalls past decisions,
              and comes back as sentences that each cite their rows. Eight sheets: what each part is, what it is built on and
              what we measured.
            </p>
          </div>
          <nav className="hw-index" aria-label="Sheet index">
            <p className="hw-index__h">Sheet index</p>
            <ol>
              {[
                ["arch", "A-1", "Architecture"],
                ["usl", "A-2", "The semantic layer"],
                ["map", "A-3", "Sponsor map"],
                ["conf", "A-4", "Conformance"],
                ["scout", "A-5", "The Scout eval"],
                ["accuracy", "A-6", "Accuracy and engine measurements"],
                ["traps", "A-7", "What Zetaris taught us"],
                ["run", "A-8", "Run it locally"],
              ].map(([id, s, t]) => (
                <li key={id}>
                  <a href={`#${id}`}>
                    <span className="hw-type">{s}</span>
                    <span>{t}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </section>

      <Sheet
        id="arch"
        n="A-1"
        title="Architecture"
        date={date}
        of={OF}
        wide
        lede="The path of one question, from the sources to the answer. The hospital systems are read in place; FDA's public files are cleaned once into CSVs that Zetaris reads as file tables."
      >
        <div className="hw-sch" role="img" aria-label="Fifteen sources, three hospital systems and 12 FDA files, feed Zetaris and its semantic layer; the Upstream investigator, gated by Scout Intent and backed by World Model, H-MEM and Markovian, reads them; Nemotron writes and a verifier checks; the case goes to a pharmacist for approval.">
          <div className="hw-col hw-col--src">
            <p className="hw-col__h">
              Fifteen sources <Balloon n={1} />
            </p>
            <div className="hw-group">
              <span className="hw-group__k">Corvale Health, three systems, read in place</span>
              {SOURCES.filter((s) => s.who === "h").map((s) => (
                <div className="hw-box hw-box--src" key={s.k}>
                  <span className="hw-pin hw-type">S{s.k}</span>
                  <strong>{s.t}</strong>
                  <span>{s.s}</span>
                </div>
              ))}
            </div>
            <div className="hw-group hw-group--fda">
              <span className="hw-group__k">FDA&apos;s public record, {FDA_FILES_REGISTERED} files, cleaned once into CSVs</span>
              {SOURCES.filter((s) => s.who === "f").map((s) => (
                <div className="hw-box hw-box--src" key={s.k}>
                  <span className="hw-pin hw-type">S{s.k}</span>
                  <strong>{s.t}</strong>
                  <span>{s.s}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="hw-wire" aria-hidden="true" />
          <div className="hw-col hw-col--zet">
            <p className="hw-col__h">
              Federation <Balloon n={2} />
            </p>
            <div className="hw-box hw-box--big">
              <strong>Zetaris</strong>
              <span>Federated SQL: JDBC to the hospitals&apos; Postgres, file tables over Lakeside&apos;s exports and FDA&apos;s cleaned CSVs. Results come back with a query id (Q-xxxxxx) that every claim cites.</span>
              <div className="hw-box hw-box--inner">
                <strong>Unified Semantic Layer</strong>
                <span className="hw-type hw-tables">product, unit_of_use, site, site_fei, product_site, inspection, stock_general, stock_east, stock_lakeside</span>
              </div>
              <div className="hw-box hw-box--inner hw-box--red">
                <strong>RUN DQ</strong>
                <span>Foreign keys become data-quality rules: a Lakeside row whose NDC FDA does not list is reported, not guessed.</span>
              </div>
            </div>
          </div>
          <div className="hw-wire" aria-hidden="true" />
          <div className="hw-col hw-col--eng">
            <p className="hw-col__h">
              Investigation <Balloon n={3} />
            </p>
            <div className="hw-box hw-box--gate">
              <strong>Scout Intent</strong>
              <span>Intent, risk and a signed execution contract. Every tool call is checked; orders and dosing are refused.</span>
            </div>
            <div className="hw-box">
              <strong>Investigator</strong>
              <span>Nine fixed steps, from our stock to the plant&apos;s FDA record, FDA&apos;s list, who else makes it, interchanges, data quality and memory.</span>
            </div>
            <div className="hw-row3">
              <div className="hw-box hw-box--sm">
                <strong>World Model</strong>
                <span>The chain as a graph, provenance on every edge</span>
              </div>
              <div className="hw-box hw-box--sm">
                <strong>H-MEM</strong>
                <span>Past decisions and who approved them</span>
              </div>
              <div className="hw-box hw-box--sm">
                <strong>Markovian</strong>
                <span>The overnight watch, chunk by chunk</span>
              </div>
            </div>
          </div>
          <div className="hw-wire" aria-hidden="true" />
          <div className="hw-col hw-col--out">
            <p className="hw-col__h">
              Explanation <Balloon n={4} />
            </p>
            <div className="hw-box">
              <strong>NVIDIA Nemotron 3 Ultra</strong>
              <span>Writes sentences from the evidence rows, each with citations.</span>
            </div>
            <div className="hw-box hw-box--blue">
              <strong>Deterministic verifier</strong>
              <span>Drops any sentence whose dates, numbers or citations are not in the rows it cites.</span>
            </div>
            <div className="hw-box hw-box--doc">
              <strong>The case</strong>
              <span>Trace, ruler, options, a memo the verifier checks. A decision is stored in H-MEM only after a signed-in pharmacist or the director signs (demo sign-in here, single sign-on in a hospital).</span>
            </div>
          </div>
        </div>
        <ol className="hw-callouts">
          <li>
            <Balloon n={1} />
            <span>
              Two hospital Postgres servers through a read-only account that sees only published views and one hospital&apos;s
              nightly CSV cabinet, all read in place; and FDA&apos;s {FDA_FILES_REGISTERED} public files, downloaded and cleaned once by
              data/fda/build_bundle.py (it derives ndc11, firm keys, FEI matches and known dates) into CSVs read as file tables
              {c ? `, ${fmtInt(Object.values(c).reduce((a, b) => a + b, 0))} rows` : ""}.
            </span>
          </li>
          <li>
            <Balloon n={2} />
            <span>One semantic layer over all of them, so an NDC on a Lakeside shelf joins to the plant on FDA&apos;s label in one query.</span>
          </li>
          <li>
            <Balloon n={3} />
            <span>
              The four Meterless engines each do real work{engines.size ? `; ${sponsor?.rows.length} uses are scheduled on sheet A-3, beside the one build tool, Cursor` : ""}.
            </span>
          </li>
          <li>
            <Balloon n={4} />
            <span>The model never decides a fact. The state (confirmed, check, no signal) is set by rule, and the verifier has the last word.</span>
          </li>
        </ol>
      </Sheet>

      <section id="sources" className="hw-srcs" aria-labelledby="sources-h">
        <div className="hw-srcs__in">
          <h2 id="sources-h">Sources, with dates</h2>
          <p className="hw-note">
            Corvale General and Corvale East are Postgres servers read in place; Corvale Lakeside is nightly CSV cabinet exports. All three are
            fictional. FDA&apos;s files are real and public, {manifest ? `cleaned into CSVs on ${fmtDate(manifest.built)}` : "cleaned once into CSVs"} and read
            by Zetaris as file tables.
          </p>
          <ul className="hw-srcs__list">
            {FDA_FILES.map((f) => (
              <li key={f.key}>
                <a href={f.href} rel="noopener noreferrer">
                  {f.name}
                </a>
                <span className="hw-type">{n(f.key) ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Sheet
        id="usl"
        n="A-2"
        title="The semantic layer"
        date={date}
        of={OF}
        wide
        lede="Nine tables in one Zetaris USL, each tied to the system its activation reads. Its foreign keys are the data-quality rules RUN DQ measures, on the hospitals' side and on FDA's."
      >
        <UslSheet dq={dq} explain={plans} />
      </Sheet>

      <Sheet id="map" n="A-3" title="Sponsor map" date={date} of={OF} lede="Each thing Upstream does, the engine that does it, the call, and the section of the spec it follows.">
        {sponsor ? (
          <div className="hw-table-wrap" tabIndex={0} role="region" aria-label="Sponsor map table">
            <table className="hw-table hw-table--map">
              <caption className="sr-only">Upstream action, engine, API call and spec section</caption>
              <thead>
                <tr>
                  <th scope="col" className="hw-c-n">
                    Ref
                  </th>
                  {sponsor.head.map((h) => (
                    <th key={h} scope="col">
                      {h.replace(/\s*\(our module -> engine\)/, "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sponsorRows.map((r, i) => (
                  <tr key={i} className={i >= sponsor.rows.length ? "is-build" : undefined}>
                    <td className="hw-c-n hw-type" data-label="Ref">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    {r.map((cell, j) => (
                      <td
                        key={j}
                        data-label={sponsor.head[j]?.replace(/\s*\(our module -> engine\)/, "")}
                        className={j === 1 ? "hw-engine" : j === 2 ? "hw-call" : j === 3 ? "hw-spec" : undefined}
                      >
                        <InlineMd text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hw-empty">The engine README is not on this copy.</p>
        )}
        <section className="hw-cursor" aria-labelledby="cursor-h">
          <h3 id="cursor-h">What Cursor built: two headless sessions</h3>
          <ol>
            {CURSOR_SESSIONS.map((x) => (
              <li key={x.id}>
                <p className="hw-cursor__t">
                  <b>
                    Session {x.n}: {x.title}
                  </b>{" "}
                  <span className="hw-type">{x.id}</span>
                </p>
                <p>
                  <span className="hw-cursor__k">Prompt</span> <InlineMd text={x.prompt} />
                </p>
                <p>
                  <span className="hw-cursor__k">Produced</span> <InlineMd text={x.made} />
                </p>
              </li>
            ))}
          </ol>
          <p className="hw-note">
            The agent, the Zetaris setup, the Meterless engines and this site were written outside Cursor.{" "}
            <a href="https://github.com/RohanGlitched/upstream/tree/main/docs/cursor" rel="noopener noreferrer">
              The session summary in docs/cursor
            </a>
          </p>
        </section>
      </Sheet>

      <Sheet
        id="conf"
        n="A-4"
        title="Conformance"
        date={date}
        of={OF}
        lede={
          conf
            ? `The unmodified Meterless suites, run against Upstream's modules on ${fmtDate(conf.at)}, ${conf.platform}, Node ${conf.node.replace(/^v/, "")}.`
            : "The unmodified Meterless suites, run against Upstream's modules."
        }
      >
        {conf ? (
          <>
            <ul className="hw-conf">
              {conf.results.map((r) => (
                <li key={r.engine} className={`hw-cert${r.pass ? "" : " is-fail"}`}>
                  <div className="hw-cert__head">
                    <h3>{r.engine}</h3>
                    <span className="hw-cert__stamp">{r.pass ? "Pass" : "Fail"}</span>
                  </div>
                  <p className="hw-cert__sum">{r.summary}</p>
                  <dl>
                    <div>
                      <dt>Module</dt>
                      <dd className="hw-type">{r.module}</dd>
                    </div>
                    <div>
                      <dt>Spec</dt>
                      <dd className="hw-type">{r.spec.replace(/^vendor\/meterless\//, "")}</dd>
                    </div>
                    <div>
                      <dt>Run time</dt>
                      <dd className="hw-type">{r.ms} ms</dd>
                    </div>
                  </dl>
                  {r.tail ? (
                    <details className="hw-more">
                      <summary>The runner&apos;s output</summary>
                      <pre tabIndex={0}>{r.tail}</pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="hw-note">
              Vendored engines at commit <span className="hw-type">{conf.vendorCommit.slice(0, 7)}</span>. A Scout pass shows the
              plumbing is spec-shaped: its corpus repeats its own registry examples, so it is not a quality claim. The pharmacy
              eval on A-5 is.
            </p>
          </>
        ) : (
          <p className="hw-empty">No conformance run on this copy. Run it with npm run conformance.</p>
        )}
      </Sheet>

      <Sheet
        id="scout"
        n="A-5"
        title="The Scout eval"
        date={date}
        of={OF}
        lede={`${nPrompts ?? "The"} pharmacy prompts labelled by hand: paraphrases, disguised orders, injections inside a quoted FDA notice, dosing questions, approval bypasses. ${nHeld ?? "Some"} were held out before any scorer code existed.`}
      >
        {scout && splits.length ? (
          <div className="hw-table-wrap" tabIndex={0} role="region" aria-label="Scout eval table">
            <table className="hw-table hw-table--scout">
              <caption className="sr-only">Scout pharmacy eval by split</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {splits.map((s) => (
                    <th key={s} scope="col">
                      {s === "all" ? "All" : s === "tuning" ? "Tuning" : "Held out"} <span className="hw-muted">({String(scout.metrics[s].examples)})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([k, label]) => (
                  <tr key={k} className={k === "block_recall" ? "is-key" : undefined}>
                    <th scope="row">{label}</th>
                    {splits.map((s) => {
                      const v = m(scout.metrics[s][k]);
                      return (
                        <td key={s} data-label={`${s === "all" ? "All" : s === "tuning" ? "Tuning" : "Held out"} (${String(scout.metrics[s].examples)})`}>
                          {v && v.value !== null ? (
                            <span className="hw-gauge">
                              <span className="hw-gauge__bar" aria-hidden="true">
                                <span style={{ width: `${v.value * 100}%` }} />
                              </span>
                              <strong>{v.value.toFixed(3)}</strong>
                              <span className="hw-muted">
                                {v.n}/{v.d}
                              </span>
                            </span>
                          ) : (
                            "n/a"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hw-empty">No Scout eval results on this copy.</p>
        )}
        <div className="hw-two">
          <div>
            <h3>The two misses</h3>
            <p>
              A held-out status question containing the word &ldquo;order&rdquo; was refused as an order: a false refusal, the
              safe direction. &ldquo;Handle the shortage&rdquo; picked the wrong intent but still asked for clarification, so
              nothing ran.
            </p>
          </div>
          <div>
            <h3>Limits</h3>
            <p>
              One author, {nPrompts ?? "a few dozen"} prompts, {heldBlocks ?? "a handful of"} held-out block cases. Treat it as a regression
              set with a held-out check, not a benchmark.
              {scout?.selfTest ? ` Stage-one scan: median ${scout.selfTest.medianMs} ms over ${scout.selfTest.probes} probes.` : ""}
            </p>
          </div>
        </div>
      </Sheet>

      <Sheet
        id="accuracy"
        n="A-6"
        title="Accuracy and engine measurements"
        date={date}
        of={OF}
        lede="The reason for the federated path: a strong model answering from memory, marked on the same questions. Then what we changed in the engines we build on, and the numbers that justified it."
      >
        <EvalCompare data={ev} />
        <p className="hw-more-link">
          <Link href="/backtest#proof">Every product, marked row by row</Link>
        </p>
        <div className="hw-two hw-two--tables">
          {hmem ? (
            <div>
              <h3>H-MEM recall on a labelled fixture</h3>
              <div className="hw-table-wrap" tabIndex={0} role="region" aria-label="H-MEM recall table">
                <table className="hw-table">
                  <thead>
                    <tr>
                      {hmem.head.map((h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hmem.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((cell, j) => (
                          <td key={j} className={j > 0 ? "hw-num" : undefined} data-label={hmem.head[j]}>
                            <InlineMd text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hw-note">The threshold was picked on this fixture: a calibration, not an evaluation.</p>
            </div>
          ) : null}
          {world ? (
            <div>
              <h3>World Model persistence</h3>
              <div className="hw-table-wrap" tabIndex={0} role="region" aria-label="World Model persistence table">
                <table className="hw-table">
                  <thead>
                    <tr>
                      {world.head.map((h) => (
                        <th key={h} scope="col">
                          <InlineMd text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {world.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((cell, j) => (
                          <td key={j} className="hw-num" data-label={world.head[j]?.replace(/[`*]/g, "")}>
                            <InlineMd text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hw-note">Same file contents either way; a reload after the flush gives an identical state.</p>
            </div>
          ) : null}
        </div>
      </Sheet>

      <Sheet id="traps" n="A-7" title="What Zetaris taught us" date={date} of={OF} lede="General notes, taken from the comments in the setup scripts: what each one sets up, and the traps it works around. Traps are marked in red.">
        {notes.length ? (
          <ol className="hw-notes">
            {notes.map((nt) => (
              <li key={nt.file} className="hw-note-file">
                <p className="hw-note-file__h">
                  <span className="hw-type">zetaris/{nt.file}</span>
                  <span>{nt.title}</span>
                </p>
                {nt.notes.length ? (
                  <ul>
                    {nt.notes.map((x, i) => (
                      <li key={i} className={isTrap(x) ? "is-trap" : undefined}>
                        <InlineMd text={x} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="hw-empty">The Zetaris scripts are not on this copy.</p>
        )}
      </Sheet>

      <Sheet
        id="run"
        n="A-8"
        title="Run it locally"
        date={date}
        of={OF}
        lede={
          <>
            Without Zetaris credentials it replays the recorded investigations. With them, set <code className="hw-code">UPSTREAM_LIVE=1</code> and every
            question runs live.
          </>
        }
      >
        <div className="hw-two">
          <ol className="hw-steps">
            <li>
              <span>Install</span>
              <pre tabIndex={0}>npm install</pre>
            </li>
            <li>
              <span>Start the app on port 3240</span>
              <pre tabIndex={0}>npx next dev -p 3240</pre>
            </li>
            <li>
              <span>Build Corvale&apos;s three systems and FDA&apos;s 12 tables</span>
              <pre tabIndex={0}>{"python data/hospital/generate.py\npython data/fda/build_bundle.py"}</pre>
            </li>
            <li>
              <span>Start the hospital databases and mount the files into Zetaris</span>
              <pre tabIndex={0}>{"docker compose -f infra/hospital/docker-compose.yml \\\n  --env-file infra/hospital/.env up -d\nbash infra/zetaris/stage-files.sh"}</pre>
            </li>
            <li>
              <span>Register sources and build the semantic layer, in order</span>
              <pre tabIndex={0}>{"npx tsx scripts/zsql.mts zetaris/01-hospitals.sql\nnpx tsx scripts/zsql.mts zetaris/02-fda.sql\nnpx tsx scripts/zsql.mts zetaris/03-lakeside.sql\nnpx tsx scripts/zsql.mts zetaris/04-usl.sql"}</pre>
            </li>
            <li>
              <span>Run live against Zetaris</span>
              <pre tabIndex={0}>UPSTREAM_LIVE=1 npx next dev -p 3240</pre>
            </li>
          </ol>
          <ol className="hw-steps">
            <li>
              <span>Conformance against the Meterless suites</span>
              <pre tabIndex={0}>npm run conformance</pre>
            </li>
            <li>
              <span>The Scout pharmacy eval</span>
              <pre tabIndex={0}>npm run scout:eval</pre>
            </li>
            <li>
              <span>Engine unit tests</span>
              <pre tabIndex={0}>npm run test:engines</pre>
            </li>
          </ol>
        </div>
        {manifest ? <p className="hw-note">FDA bundle built {fmtDate(manifest.built)}.</p> : null}
      </Sheet>
    </div>
  );
}
