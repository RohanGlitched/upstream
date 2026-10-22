import type { Metadata } from "next";
import Link from "next/link";
import { BacktestFull, type BacktestSummary } from "@/components/Backtest";
import { findingOf } from "@/components/BacktestFinding";
import { EvalCompare, type EvalTrace, type VerifierCheck } from "@/components/EvalCompare";
import { readJson } from "@/components/server/data";
import { fmtDate } from "@/components/lib/format";
import "./backtest-page.css";

export const metadata: Metadata = {
  title: "Back-test",
  description:
    "The trace run over FDA's shortage history and over products that never went short: what it explains, what it doesn't predict, and Nemotron alone against Upstream.",
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
      <section className="btp-hero" aria-labelledby="bt-title">
        <div className="wrap btp-hero__grid">
          <div className="btp-hero__text">
            <h1 id="bt-title">Does the public record explain past shortages?</h1>
            <p>
              The same trace Upstream runs for a buyer, run over FDA&apos;s shortage history and over products that never went
              short. It tests whether the trail is there, not whether a shortage could have been called in advance.
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

      <section className="btp-eval" aria-labelledby="ev-title" id="proof">
        <div className="wrap">
          <header className="btp-eval__head">
            <h2 id="ev-title">Nemotron alone against Upstream</h2>
            <p>
              Separately from the back-test: is the trace itself right? Upstream&apos;s plant and last-inspection answers, marked
              pair by pair against ground truth from FDA&apos;s raw files, beside the same model answering from memory.
            </p>
          </header>
          <EvalCompare full data={ev} verifier={verifier} />
        </div>
      </section>

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
