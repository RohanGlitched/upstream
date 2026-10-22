import type { Metadata } from "next";
import Link from "next/link";
import { Investigation } from "@/components/desk/Investigation";
import { WatchSummary, WatchList, WatchEngine } from "@/components/desk/Watch";
import { DrugName, StateBadge } from "@/components/CaseBits";
import { realCases, isLive } from "@/components/server/data";
import { fmtDate, fmtDays } from "@/components/lib/format";
import { tallText } from "@/components/lib/drug";
import "./desk.css";

export const metadata: Metadata = {
  title: "Buyer's desk",
  description: "The overnight formulary watch, the drugs at risk on our shelves, and the ask box.",
};

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function Desk({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.slice(0, 400);
  const cases = await realCases();
  const live = isLive();
  const today = new Date(Date.UTC(2026, 9, 22));

  return (
    <>
      <section className="desk-hero" aria-labelledby="desk-title">
        <div className="wrap desk-hero__grid">
          <div>
            <p className="desk-date">
              {DAYS[today.getUTCDay()]}, {fmtDate("2026-10-22")}
            </p>
            <h1 id="desk-title">The buyer&apos;s desk</h1>
            <p className="lede desk-lede">What changed overnight across Corvale Health&apos;s formulary, and the drugs to look at first.</p>
          </div>
          <div className="desk-hero__brief">
            <h2 className="sr-only">Overnight watch</h2>
            <WatchSummary />
          </div>
        </div>
      </section>

      <section className="section desk-ask" aria-label="Ask Upstream">
        <div className="wrap">
          <Investigation initial={q} />
          <p className="small muted desk-mode">
            <span className={`mode${live ? " mode--live" : ""}`}>
              {live ? "Live: questions run against Zetaris" : "Replay: this copy streams recorded investigations step by step"}
            </span>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="risk-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="risk-title">Drugs at risk, by days on hand</h2>
            <p className="lede">Each one has a full investigation on file: the trace, the evidence and the options.</p>
          </div>
          {cases.length ? (
            <ol className="risk">
              {cases.map((c) => (
                <li key={c.slug}>
                  <Link href={`/case/${c.slug}`} className="risk-card">
                    <span className="risk-days">
                      <span className="risk-days__n num">{fmtDays(c.minDays)}</span>
                      <span className="small muted">days at the shortest shelf</span>
                    </span>
                    <span className="risk-main">
                      <DrugName molecule={c.molecule} className="risk-name" />
                      <span className="risk-h">{c.headline ? tallText(c.headline) : c.question}</span>
                      <span className="risk-meta">
                        <StateBadge state={c.state as "confirmed" | "check" | "no_signal" | null} />
                        <span className="small muted">
                          {c.status
                            ? `FDA: ${c.status}${c.firstPosting ? ` since ${fmtDate(c.firstPosting)}` : ""}`
                            : c.firstPosting
                              ? `FDA first posted it ${fmtDate(c.firstPosting)}`
                              : "Not on FDA's list"}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="notice">
              <span className="notice__mark" aria-hidden="true">i</span>
              <h3>No investigations on file yet</h3>
              <p>Ask about a drug above. Each finished investigation is kept here with its evidence.</p>
            </div>
          )}
        </div>
      </section>

      <section className="section" aria-labelledby="watch-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="watch-title">Flagged overnight</h2>
            <p className="lede">
              The watch checks every drug on the formulary against our stock and FDA&apos;s files. Most are quiet; these
              are not.
            </p>
          </div>
          <WatchList />
        </div>
      </section>

      <section className="section" aria-labelledby="engine-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="engine-title">How the watch ran</h2>
            <p className="lede">
              Markovian walks the formulary in fixed-size chunks. The drug list, the cursor and the findings live in the
              World Model, not in the prompt, so each chunk&apos;s prompt stays the same size however long the list.
              Scout issues a fresh contract for every chunk.
            </p>
          </div>
          <WatchEngine />
        </div>
      </section>
    </>
  );
}
