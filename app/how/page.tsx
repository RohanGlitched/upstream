import type { Metadata } from "next";
import Link from "next/link";
import { EvalCompare } from "@/components/EvalCompare";
import { InlineMd } from "@/components/Code";
import { readJson, fdaManifest } from "@/components/server/data";
import { engineReadme, tableAfter, zetarisNotes, isTrap } from "@/components/server/docs";
import { fmtDate, fmtInt, fmtStamp } from "@/components/lib/format";
import "./how.css";

export const metadata: Metadata = {
  title: "How it works",
  description: "Upstream's architecture, the sponsor map from action to engine to spec, conformance results, the Scout eval and the Zetaris traps.",
};

interface Conformance {
  at: string;
  vendorCommit: string;
  node: string;
  platform: string;
  results: { engine: string; module: string; spec: string; pass: boolean; summary: string; ms: number; tail?: string }[];
}

interface Metric {
  value: number;
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
  ["intent_accuracy", "Intent accuracy"],
  ["risk_level_accuracy", "Risk-level accuracy"],
  ["block_recall", "Block recall"],
  ["block_precision", "Block precision"],
  ["injection_recall", "Injection recall"],
  ["clarification_accuracy", "Clarification accuracy"],
  ["tool_plan_recall", "Tool-plan recall"],
  ["parameter_binding", "Parameter binding"],
  ["contract_scope_correct", "Contract scope correct"],
];

function m(x: unknown): Metric | null {
  const o = x as Metric;
  return o && typeof o.value === "number" ? o : null;
}

export default async function How() {
  const [readme, conf, scout, notes, manifest] = await Promise.all([
    engineReadme(),
    readJson<Conformance>("conformance.json"),
    readJson<ScoutEval>("src/engines/results/scout-pharmacy-eval.json"),
    zetarisNotes(),
    fdaManifest(),
  ]);
  const sponsor = tableAfter(readme, "Where each engine is used");
  const hmem = tableAfter(readme, "H-MEM recall");
  const world = tableAfter(readme, "World Model persistence");
  const splits = scout ? (["all", "tuning", "heldout"] as const).filter((k) => scout.metrics[k]) : [];

  return (
    <>
      <section className="how-hero" aria-labelledby="how-title">
        <div className="wrap">
          <h1 id="how-title">How Upstream is built</h1>
          <p className="lede">
            One question passes a gate, runs federated queries where the data lives, builds a graph, recalls past
            decisions, and comes back as sentences that each cite their rows. Here is each part, what it is built on, and
            what we measured.
          </p>
          <nav className="how-toc" aria-label="On this page">
            <a href="#arch">Architecture</a>
            <a href="#map">Sponsor map</a>
            <a href="#accuracy">Accuracy</a>
            <a href="#conf">Conformance</a>
            <a href="#scout">Scout eval</a>
            <a href="#engines">Engine measurements</a>
            <a href="#traps">Zetaris traps</a>
            <a href="#run">Run it locally</a>
          </nav>
        </div>
      </section>

      <section id="arch" className="section" aria-labelledby="arch-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="arch-h">Architecture</h2>
            <p className="lede">Top to bottom, the path of one question. Nothing in the hospitals or FDA&apos;s files is copied.</p>
          </div>
          <ol className="arch">
            <li className="arch-row">
              <span className="arch-k">Buyer</span>
              <div className="arch-boxes">
                <div className="arch-box">
                  <strong>Desk and ask box</strong>
                  <span>A question in plain words, or the overnight brief</span>
                </div>
              </div>
            </li>
            <li className="arch-row">
              <span className="arch-k">Gate</span>
              <div className="arch-boxes">
                <div className="arch-box arch-box--ink">
                  <strong>Scout Intent</strong>
                  <span>Intent, risk, a signed execution contract; every tool call checked; orders refused</span>
                </div>
              </div>
            </li>
            <li className="arch-row">
              <span className="arch-k">Investigate</span>
              <div className="arch-boxes arch-boxes--3">
                <div className="arch-box">
                  <strong>Zetaris</strong>
                  <span>
                    Federated SQL through the Unified Semantic Layer: two hospital Postgres servers, cabinet CSVs,
                    {manifest ? ` FDA's 12 files (${fmtInt(Object.values(manifest.counts).reduce((a, b) => a + b, 0))} rows)` : " FDA's 12 files"}
                  </span>
                </div>
                <div className="arch-box">
                  <strong>World Model</strong>
                  <span>The chain as a graph with provenance on every edge; the explanation may only cite what is in it</span>
                </div>
                <div className="arch-box">
                  <strong>H-MEM</strong>
                  <span>Past decisions with their approvers; a new one is stored only after a named approval</span>
                </div>
              </div>
            </li>
            <li className="arch-row">
              <span className="arch-k">Explain</span>
              <div className="arch-boxes arch-boxes--2">
                <div className="arch-box">
                  <strong>NVIDIA Nemotron Ultra</strong>
                  <span>Writes sentences from the evidence rows, each with citations</span>
                </div>
                <div className="arch-box">
                  <strong>Deterministic verifier</strong>
                  <span>Drops any sentence whose dates, numbers or citations are not in the rows it cites</span>
                </div>
              </div>
            </li>
            <li className="arch-row">
              <span className="arch-k">Answer</span>
              <div className="arch-boxes arch-boxes--2">
                <div className="arch-box">
                  <strong>The case</strong>
                  <span>Trace, lead-time ruler, options, memo for a named approver</span>
                </div>
                <div className="arch-box">
                  <strong>Markovian watch</strong>
                  <span>Overnight, the whole formulary in fixed-size chunks, a fresh contract per chunk</span>
                </div>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section id="map" className="section" aria-labelledby="map-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="map-h">The sponsor map</h2>
            <p className="lede">Each thing Upstream does, the engine that does it, the call, and the section of the spec it follows.</p>
          </div>
          {sponsor ? (
            <div className="table-wrap how-map">
              <table className="table">
                <caption className="sr-only">Upstream action, engine, API call and spec section</caption>
                <thead>
                  <tr>
                    {sponsor.head.map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sponsor.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} className={j === 1 ? "how-engine" : j === 2 ? "how-call" : undefined}>
                          <InlineMd text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">The engine README is not on this copy.</p>
          )}
        </div>
      </section>

      <section id="accuracy" className="section" aria-labelledby="acc-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="acc-h">Nemotron alone against Upstream</h2>
            <p className="lede">The reason for the federated path: a strong model answering from memory, scored on the same questions.</p>
          </div>
          <EvalCompare />
          <p className="how-more">
            <Link href="/backtest#ev-title">Every pair, row by row</Link>
          </p>
        </div>
      </section>

      <section id="conf" className="section" aria-labelledby="conf-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="conf-h">Conformance</h2>
            <p className="lede">
              The unmodified Meterless suites, run against Upstream&apos;s modules
              {conf ? ` on ${fmtStamp(conf.at)}, ${conf.platform}, Node ${conf.node.replace(/^v/, "")}` : ""}.
            </p>
          </div>
          {conf ? (
            <>
              <ul className="conf">
                {conf.results.map((r) => (
                  <li key={r.engine} className="conf-item">
                    <div className="conf-head">
                      <h3>{r.engine}</h3>
                      <span className={`conf-pass${r.pass ? "" : " is-fail"}`}>{r.pass ? "Pass" : "Fail"}</span>
                    </div>
                    <p className="conf-sum num">{r.summary}</p>
                    <p className="small muted">
                      <code className="ic">{r.module}</code>, {r.ms} ms
                    </p>
                    {r.tail ? (
                      <details className="more">
                        <summary>Show the runner&apos;s output</summary>
                        <pre className="conf-tail" tabIndex={0}>
                          {r.tail}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="small muted how-note">
                Vendored engines at commit {conf.vendorCommit.slice(0, 7)}. A Scout pass shows the plumbing is spec-shaped:
                its corpus repeats its own registry examples, so it is not a quality claim. The pharmacy eval below is.
              </p>
            </>
          ) : (
            <p className="muted">No conformance run on this copy.</p>
          )}
        </div>
      </section>

      <section id="scout" className="section" aria-labelledby="scout-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="scout-h">The Scout eval</h2>
            <p className="lede">
              59 pharmacy prompts labelled by hand: paraphrases, disguised orders, injections inside a quoted FDA notice,
              dosing questions, approval bypasses. 15 were held out before any scorer code existed.
            </p>
          </div>
          {scout && splits.length ? (
            <div className="table-wrap">
              <table className="table scout-table">
                <caption className="sr-only">Scout pharmacy eval by split</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {splits.map((s) => (
                      <th key={s} scope="col" className="r">
                        {s === "all" ? "All" : s === "tuning" ? "Tuning" : "Held out"}{" "}
                        <span className="muted">({String(scout.metrics[s].examples)})</span>
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
                          <td key={s} className="r num">
                            {v ? (
                              <>
                                <strong>{v.value.toFixed(3)}</strong> <span className="muted">{v.n}/{v.d}</span>
                              </>
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
            <p className="muted">No Scout eval results on this copy.</p>
          )}
          <div className="grid-2 scout-notes">
            <div>
              <h3>The two misses</h3>
              <p>
                A held-out status question containing the word &ldquo;order&rdquo; was refused as an order: a false
                refusal, the safe direction. &ldquo;Handle the shortage&rdquo; picked the wrong intent but still asked
                for clarification, so nothing ran.
              </p>
            </div>
            <div>
              <h3>Limits</h3>
              <p>
                One author, 59 prompts, 4 held-out block cases. Treat it as a regression set with a held-out check, not a
                benchmark.
                {scout?.selfTest
                  ? ` Stage-one scan: median ${scout.selfTest.medianMs} ms over ${scout.selfTest.probes} probes.`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="engines" className="section" aria-labelledby="eng-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="eng-h">Engine measurements</h2>
            <p className="lede">What we changed in the engines we build on, and the numbers that justified it.</p>
          </div>
          <div className="grid-2">
            {hmem ? (
              <div>
                <h3 className="how-h3">H-MEM recall on a labelled fixture</h3>
                <div className="table-wrap">
                  <table className="table">
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
                          {r.map((c, j) => (
                            <td key={j} className={j > 0 ? "num" : undefined}>
                              <InlineMd text={c} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted how-note">The threshold was picked on this fixture: a calibration, not an evaluation.</p>
              </div>
            ) : null}
            {world ? (
              <div>
                <h3 className="how-h3">World Model persistence</h3>
                <div className="table-wrap">
                  <table className="table">
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
                          {r.map((c, j) => (
                            <td key={j} className="num">
                              <InlineMd text={c} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted how-note">Same file contents either way; a reload after the flush gives an identical state.</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section id="traps" className="section" aria-labelledby="traps-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="traps-h">What Zetaris taught us</h2>
            <p className="lede">The setup scripts, and the traps each one works around, in the comments we left for the next person.</p>
          </div>
          {notes.length ? (
            <ul className="traps">
              {notes.map((n) => (
                <li key={n.file} className="trap">
                  <code className="ic trap-file">zetaris/{n.file}</code>
                  <p className="trap-title">{n.title}</p>
                  {n.notes.length ? (
                    <ul className="trap-notes">
                      {n.notes.map((x, i) => (
                        <li key={i} className={isTrap(x) ? "is-trap" : undefined}>
                          <InlineMd text={x} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">The Zetaris scripts are not on this copy.</p>
          )}
        </div>
      </section>

      <section id="run" className="section" aria-labelledby="run-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="run-h">Run it locally</h2>
            <p className="lede">
              Without Zetaris credentials it replays the recorded investigations. With them, set <code className="ic">UPSTREAM_LIVE=1</code> and every
              question runs live.
            </p>
          </div>
          <div className="grid-2">
            <ol className="run-steps">
              <li>
                <span>Install</span>
                <pre tabIndex={0}>npm install</pre>
              </li>
              <li>
                <span>Start the app on port 3240</span>
                <pre tabIndex={0}>npx next dev -p 3240</pre>
              </li>
              <li>
                <span>Run live against Zetaris (optional)</span>
                <pre tabIndex={0}>UPSTREAM_LIVE=1 npx next dev -p 3240</pre>
              </li>
            </ol>
            <ol className="run-steps">
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
          {manifest ? <p className="small muted how-note">FDA bundle built {fmtDate(manifest.built)}.</p> : null}
        </div>
      </section>
    </>
  );
}
