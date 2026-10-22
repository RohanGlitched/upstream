import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceProvider } from "@/components/Evidence";
import { TraceAndRuler } from "@/components/Trace";
import { DrugName, StateBadge, STATE_WORDS, WhyList, Dropped } from "@/components/CaseBits";
import {
  StockSection,
  OptionsSection,
  MarketSection,
  FdaListSection,
  StepsSection,
  DataQualitySection,
  MemorySection,
  GateSection,
  UsageSection,
} from "@/components/case/CaseSections";
import { CaseGraph, type Graph } from "@/components/case/CaseGraph";
import { Memo } from "@/components/case/Memo";
import { buildRuler, buildTrace } from "@/components/lib/trace";
import { loadCase, realCases } from "@/components/server/data";
import { drugTitle, tallText } from "@/components/lib/drug";
import { fmtDate, fmtMs, fmtStamp } from "@/components/lib/format";
import "../case-page.css";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCase(slug);
  if (!c) return { title: "Case not found" };
  return { title: `${drugTitle(c.molecule)} shortage`, description: c.explanation?.headline ?? c.question };
}

const TOC = [
  ["trace", "Shelf to factory"],
  ["why", "Why"],
  ["stock", "Our stock"],
  ["options", "Options"],
  ["market", "Who else makes it"],
  ["steps", "The steps"],
  ["quality", "Data quality"],
  ["memory", "Last time"],
  ["gate", "Gate log"],
  ["graph", "Graph"],
  ["memo", "Memo"],
  ["usage", "Usage"],
] as const;

export default async function CasePage({ params }: Params) {
  const { slug } = await params;
  const c = await loadCase(slug);
  if (!c) notFound();
  const others = (await realCases()).filter((x) => x.slug !== slug);
  const trace = buildTrace(c);
  const ruler = buildRuler(c);
  const state = c.explanation?.state ?? null;
  const approvers = [...new Set(["Jordan Hale, PharmD", "Riley Brooks, PharmD", "Alex Morgan, PharmD", ...c.memory.map((m) => m.approvedBy).filter((x): x is string => Boolean(x))])];
  const decisions = [...c.options].sort((a, b) => a.rank - b.rank).slice(0, 8).map((o) => tallText(o.title));

  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <header className="case-head">
        <div className="wrap">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/desk">Desk</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{drugTitle(c.molecule)}</span>
          </nav>
          <div className="case-head__grid">
            <div>
              <DrugName molecule={c.molecule} as="h1" className="case-title" />
              <p className="case-headline">{c.explanation ? tallText(c.explanation.headline) : "Upstream found no explanation it could verify."}</p>
              <div className="case-tags">
                <StateBadge state={state} />
                {c.shortage.listed ? (
                  <span className="tag tag--outline">
                    On FDA&apos;s list since {fmtDate(c.shortage.firstPosting)}
                  </span>
                ) : (
                  <span className="tag tag--outline">Not on FDA&apos;s list</span>
                )}
                <span className={`mode${c.usage.mode === "live" ? " mode--live" : ""}`}>
                  {c.usage.mode === "live" ? "Recorded from a live run" : "Replayed run"}
                </span>
              </div>
            </div>
            <dl className="case-meta">
              <div>
                <dt>Asked</dt>
                <dd>&ldquo;{c.question}&rdquo;</dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>{fmtStamp(c.askedAt)}, data as of {fmtDate(c.asOf)}</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd className="num">
                  {c.intent.contractId ?? "none"}, {c.intent.risk} risk
                </dd>
              </div>
              {state ? (
                <div>
                  <dt>State</dt>
                  <dd>{STATE_WORDS[state].long}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </header>

      <section id="trace" className="case-trace" aria-labelledby="trace-title">
        <div className="wrap">
          <h2 id="trace-title" className="sr-only">
            From our shelf to the factory
          </h2>
          <div className="panel case-trace__panel">
            <TraceAndRuler
              trace={trace}
              ruler={ruler}
              caption={<>{c.steps.length} steps, {c.usage.zetarisQueries} Zetaris queries, {fmtMs(c.usage.zetarisMs)}. Select any box or chip to see the row behind it.</>}
            />
          </div>
        </div>
      </section>

      <div className="wrap case-layout">
        <nav className="case-toc" aria-label="On this page">
          <p className="case-toc__h">On this page</p>
          <ul>
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="case-body">
          <section id="why" className="cs" aria-labelledby="why-h">
            <h2 id="why-h">Why, in sentences that cite their rows</h2>
            {c.explanation && c.explanation.sentences.length ? (
              <>
                <p className="cs-lede">
                  Written by {c.explanation.model.replace(/^nvidia\//, "")}, then checked: each sentence below cites rows
                  that contain its dates and numbers.
                </p>
                <WhyList explanation={c.explanation} numbered />
                <Dropped explanation={c.explanation} />
              </>
            ) : (
              <div className="notice">
                <span className="notice__mark" aria-hidden="true">i</span>
                <h3>No verified explanation</h3>
                <p>Every sentence the model wrote failed the verifier, so none is shown. The trace and rows above still stand.</p>
              </div>
            )}
          </section>

          <section id="stock" className="cs" aria-labelledby="stock-h">
            <h2 id="stock-h">Our stock, hospital by hospital</h2>
            <p className="cs-lede">Read in place from each hospital&apos;s own system, in its own units.</p>
            <StockSection c={c} />
          </section>

          <section id="options" className="cs" aria-labelledby="opt-h">
            <h2 id="opt-h">What we can do, ranked</h2>
            <p className="cs-lede">Transfers first: same product, no clinical change. Every option names who must approve it.</p>
            <OptionsSection c={c} />
          </section>

          <section id="market" className="cs" aria-labelledby="mk-h">
            <h2 id="mk-h">Who else makes it</h2>
            <p className="cs-lede">Every labeler of this drug in the same form, the plants on its label, and FDA&apos;s listing.</p>
            <MarketSection c={c} />
            <h3 className="cs-sub">What FDA&apos;s shortage listing says</h3>
            <FdaListSection c={c} />
          </section>

          <section id="steps" className="cs" aria-labelledby="steps-h">
            <h2 id="steps-h">The steps, as they ran</h2>
            <p className="cs-lede">Each step is one or more Zetaris queries. Select a query id to see its SQL and sources.</p>
            <StepsSection c={c} />
          </section>

          <section id="quality" className="cs" aria-labelledby="dq-h">
            <h2 id="dq-h">Which links can&apos;t be trusted</h2>
            <DataQualitySection c={c} />
          </section>

          <section id="memory" className="cs" aria-labelledby="mem-h">
            <h2 id="mem-h">What we decided last time</h2>
            <p className="cs-lede">Recalled from H-MEM with the pharmacist who approved each decision.</p>
            <MemorySection c={c} />
          </section>

          <section id="gate" className="cs" aria-labelledby="gate-h">
            <h2 id="gate-h">The gate log</h2>
            <p className="cs-lede">Scout checked every tool call against the signed contract before it ran.</p>
            <GateSection c={c} />
          </section>

          <section id="graph" className="cs" aria-labelledby="graph-h">
            <h2 id="graph-h">The supply-chain graph</h2>
            <p className="cs-lede">What the World Model recorded for this case, from our items to FDA&apos;s records.</p>
            <CaseGraph graph={c.graph as unknown as Graph | undefined} />
          </section>

          <section id="memo" className="cs" aria-labelledby="memo-h">
            <h2 id="memo-h">The memo</h2>
            <Memo slug={slug} molecule={c.molecule} asOf={c.asOf} approvers={approvers} decisions={decisions} />
          </section>

          <section id="usage" className="cs" aria-labelledby="usage-h">
            <h2 id="usage-h">What it took</h2>
            <UsageSection c={c} />
          </section>

          {others.length ? (
            <section className="cs cs--others" aria-labelledby="others-h">
              <h2 id="others-h">Other recorded cases</h2>
              <ul className="others">
                {others.map((o) => (
                  <li key={o.slug}>
                    <Link href={`/case/${o.slug}`} className="other">
                      <DrugName molecule={o.molecule} className="other-name" />
                      <span className="other-h">{o.headline ? tallText(o.headline) : o.question}</span>
                      <span className="other-meta">
                        <StateBadge state={o.state as "confirmed" | "check" | "no_signal" | null} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </EvidenceProvider>
  );
}
