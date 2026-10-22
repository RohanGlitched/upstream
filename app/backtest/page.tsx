import type { Metadata } from "next";
import Link from "next/link";
import { BacktestFull } from "@/components/Backtest";
import { EvalCompare } from "@/components/EvalCompare";
import "./backtest-page.css";

export const metadata: Metadata = {
  title: "Back-test",
  description: "The trace run over FDA's shortage history and products that never went short: what it explains, and what it doesn't predict.",
};

export default function BacktestPage() {
  return (
    <>
      <section className="bt-hero" aria-labelledby="bt-title">
        <div className="wrap bt-hero__grid">
          <div>
            <h1 id="bt-title">Does the public record explain past shortages?</h1>
            <p className="lede">
              The same trace Upstream runs for a buyer, run over FDA&apos;s shortage history and over products that never
              went short. It tests whether the trail is there, not whether a shortage could have been called in advance.
            </p>
          </div>
          <aside className="bt-hero__note">
            <p className="strong">The short answer</p>
            <p>
              Often the trail is there and explains a shortage after the fact. Dated strictly by what was public at the
              time, it does not predict one.
            </p>
          </aside>
        </div>
      </section>

      <section className="section" aria-labelledby="method-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="method-title">The method</h2>
            <p className="lede">Three steps. Six variants were run; the strictly dated one and the close-dated one are both shown.</p>
          </div>
          <ol className="method">
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
                Count FDA actions at those plants in the 730 days before the posting: once dated by when each became
                public, once by when the inspection closed. Then do the same for products that never went short.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <BacktestFull />

      <section className="section" aria-labelledby="ev-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="ev-title">Is the trace itself right?</h2>
            <p className="lede">
              Separately from the back-test: Upstream&apos;s plant and last-inspection answers, checked pair by pair
              against ground truth computed from FDA&apos;s raw files, beside the same model answering from memory.
            </p>
          </div>
          <EvalCompare full />
        </div>
      </section>

      <section className="section section--tight" aria-label="Next">
        <div className="wrap bt-next">
          <Link href="/case/carboplatin" className="btn btn--primary">
            See one trace in full
          </Link>
          <Link href="/how" className="btn">
            How Upstream is built
          </Link>
        </div>
      </section>
    </>
  );
}
