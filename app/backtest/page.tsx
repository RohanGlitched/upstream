import type { Metadata } from "next";
import Link from "next/link";
import { BacktestFull, type BacktestSummary } from "@/components/Backtest";
import { findingOf } from "@/components/BacktestFinding";
import { EvalCompare, type EvalTrace, type VerifierCheck } from "@/components/EvalCompare";
import { readJson } from "@/components/server/data";
import { fmtDate } from "@/components/lib/format";
import "./backtest-page.css";

export const metadata: Metadata = {
  title: "Accuracy",
  description:
    "NVIDIA Nemotron alone against Upstream, the verifier against planted errors, then the back-test over FDA's shortage history: it explains, it does not forecast.",
};

// Local copies: the components are client modules, so their helpers can't be called from this server page.
// A server page cannot call a client module's functions, so the shape checks live here.
function isVerifier(x: unknown): x is VerifierCheck {
  const o = x as VerifierCheck;
  return Boolean(o && o.adversarial && typeof o.adversarial.caught === "number" && typeof o.adversarial.of === "number");
}

function isBacktest(x: unknown): x is BacktestSummary {
  const o = x as BacktestSummary;
  return Boolean(o && typeof o === "object" && o.cases && o.strict && o.endDated && Array.isArray(o.examples) && Array.isArray(o.caveats));
}
function isEval(x: unknown): x is EvalTrace {
  const o = x as EvalTrace;
  return Boolean(o && o.summary && o.summary.upstream && Array.isArray(o.rows));
}
const frac = (x: string | undefined) => {
  const m = /(\d+)\/(\d+)/.exec(x ?? "");
  return m ? `${m[1]} of ${m[2]}` : null;
};
function windowText(w: BacktestSummary["window"]): string {
  if (!w) return "FDA's shortage history";
  if (typeof w === "string") return w.replace(/;.*$/, "");
  return w.from && w.to ? `${fmtDate(w.from)} to ${fmtDate(w.to)}` : "FDA's shortage history";
}

export default async function BacktestPage() {
  const [rawB, rawE, rawV] = await Promise.all([
    readJson<unknown>("data/backtest/summary.json"),
    readJson<unknown>("data/eval/trace.json"),
    readJson<unknown>("data/eval/verifier.json"),
  ]);
  const verifier = isVerifier(rawV) ? rawV : null;
  const b: BacktestSummary | null = isBacktest(rawB) ? rawB : null;
  const ev: EvalTrace | null = isEval(rawE) ? rawE : null;

  return (
    <div className="btp">
      <section className="btp-hero" aria-labelledby="acc-title">
        <div className="wrap btp-hero__grid">
          <div className="btp-hero__text">
            <h1 id="acc-title">The model alone against Upstream</h1>
            <p>
              The same NVIDIA Nemotron model, asked from memory which plant makes each product and what FDA last found there, and then
              given FDA&apos;s files through Upstream. Both are marked against answers computed separately from FDA&apos;s raw files.
            </p>
          </div>
          {ev ? (
            <aside className="btp-card" aria-label="The result">
              <div className="btp-card__row">
                <span>Result</span>
                <span className="btp-type">{ev.summary.truthRows} marked rows</span>
              </div>
              <dl>
                <div>
                  <dt>Model alone</dt>
                  <dd>
                    {frac(ev.summary.baseline?.dateCorrect) ?? "none"} inspection dates right
                    {ev.summary.baseline?.inventedDates ? `, ${ev.summary.baseline.inventedDates} invented` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Upstream</dt>
                  <dd>
                    {frac(ev.summary.upstream.plantFound)} plants found, {frac(ev.summary.upstream.lastInspectionMatch)} last inspections right
                  </dd>
                </div>
                {verifier ? (
                  <div>
                    <dt>Verifier</dt>
                    <dd>
                      caught {verifier.adversarial.caught} of {verifier.adversarial.of} sentences with planted errors
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="btp-card__ans">
                <span>Then the back-test.</span> Over FDA&apos;s shortage history the trail explains; it does not forecast.{" "}
                <a href="#backtest">Read it</a>
              </p>
            </aside>
          ) : null}
        </div>
      </section>

      <section className="btp-eval" aria-labelledby="ev-title" id="proof">
        <div className="wrap">
          <header className="btp-eval__head">
            <h2 id="ev-title">Nemotron alone against Upstream, pair by pair</h2>
            <p>
              Upstream&apos;s plant and last-inspection answers, marked against ground truth from FDA&apos;s raw files, beside the same
              model answering from memory. Then the verifier, handed sentences with planted errors.
            </p>
          </header>
          <EvalCompare full data={ev} verifier={verifier} />
        </div>
      </section>

      <section className="btp-hero btp-hero--bt" id="backtest" aria-labelledby="bt-title">
        <div className="wrap btp-hero__grid">
          <div className="btp-hero__text">
            <h2 id="bt-title">The back-test: it explains, it does not forecast</h2>
            <p>
              Separately, does the public record explain past shortages? The same trace, run over FDA&apos;s shortage history and
              over products that never went short. It tests whether the trail is there, not whether a shortage could be called in advance.
            </p>
          </div>
          <aside className="btp-card" aria-label="Study record">
            <div className="btp-card__row">
              <span>Study record</span>
              <span className="btp-type">UPS-BT-06</span>
            </div>
            <dl>
              <div>
                <dt>Question</dt>
                <dd>{b?.question ?? "When FDA posted a shortage, had FDA already acted against a plant on the label?"}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>{b ? windowText(b.window) : "FDA's shortage history from 2022"}</dd>
              </div>
              <div>
                <dt>Shortages</dt>
                <dd>
                  {b ? `${b.cases.n}, with ${b.controls.n} control products` : "Not on this copy yet"}
                </dd>
              </div>
            </dl>
            {b && (b.conclusion || findingOf(b)) ? (
              <p className="btp-card__ans">
                <span>Short answer.</span> {findingOf(b)?.strict ?? b.conclusion} Dated by when the inspection closed it is more
                common, but only with hindsight. The trail explains; it does not forecast.
              </p>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="btp-method" aria-labelledby="method-title">
        <div className="wrap">
          <div className="btp-sheet">
            <header className="btp-sheet__head">
              <h2 id="method-title">The method, signed before the run</h2>
              <span className="btp-folio">p. 1</span>
            </header>
            <ol className="btp-steps">
              <li>
                <h3>Fix the case set</h3>
                <p>
                  Every shortage FDA first posted in the window, written down before any signal was counted. Each one is
                  followed to the products FDA names and the labels behind them.
                </p>
              </li>
              <li>
                <h3>Follow the label to the plant</h3>
                <p>
                  The plants named on each label, placed by FEI in FDA&apos;s registration file. A shortage whose labels name
                  no plant we can place drops out, and the count of those is reported.
                </p>
              </li>
              <li>
                <h3>Look back two years, twice</h3>
                <p>
                  Count FDA actions at those plants in the 730 days before the posting: once dated by when each became public,
                  once by when the inspection closed. Then do the same for products that never went short.
                </p>
              </li>
            </ol>
            <div className="btp-sign">
              <div>
                <span className="btp-sign__line btp-type">backtest/06_chain.py</span>
                <span className="btp-sign__k">Method, as run</span>
              </div>
              <div>
                <span className="btp-sign__line btp-type">{b ? fmtDate(b.builtAt) : "not yet run"}</span>
                <span className="btp-sign__k">Date of the run</span>
              </div>
              <div>
                <span className="btp-sign__line btp-type">6 variants, 2 reported</span>
                <span className="btp-sign__k">Variants</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <BacktestFull data={b} />

      <section className="btp-next" aria-label="Next">
        <div className="wrap btp-next__in">
          <Link href="/case/carboplatin" className="btp-btn btp-btn--ink">
            See one trace in full
          </Link>
          <Link href="/plants" className="btp-btn">
            Every plant on the night map
          </Link>
          <Link href="/how" className="btp-btn">
            How Upstream is built
          </Link>
        </div>
      </section>
    </div>
  );
}
