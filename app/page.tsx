import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceProvider, Cites } from "@/components/Evidence";
import { TraceAndRuler } from "@/components/Trace";
import { AskBox } from "@/components/AskBox";
import { SourcesDiagram } from "@/components/SourcesDiagram";
import { BacktestHome } from "@/components/Backtest";
import { EvalCompare } from "@/components/EvalCompare";
import { StateBadge, WhyList, Dropped } from "@/components/CaseBits";
import { buildRuler, buildTrace } from "@/components/lib/trace";
import { fdaManifest, isLive, loadCase } from "@/components/server/data";
import { fmtDate, fmtDays, fmtInt, fmtMs } from "@/components/lib/format";
import { drugTitle, tallText } from "@/components/lib/drug";
import "./home.css";

export default async function Home() {
  const c = await loadCase("carboplatin");
  if (!c) notFound();
  const manifest = await fdaManifest();
  const trace = buildTrace(c);
  const ruler = buildRuler(c);
  const fdaRows = manifest ? Object.values(manifest.counts).reduce((a, b) => a + b, 0) : null;

  const signals = c.chain.flatMap((p) => p.plants.flatMap((pl) => pl.signals));
  const count = (k: string) => signals.filter((s) => s.kind === k).length;
  const placed = c.chain.flatMap((p) => p.plants).filter((p) => p.linkQuality === "registered plant").length;
  const plants = c.chain.reduce((a, p) => a + p.plants.length, 0);
  const lowest = [...trace.shelf].sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9))[0];
  const listedCompanies = c.shortage.companies.filter((x) => x.status === "Current").length;
  const firstOption = [...c.options].sort((a, b) => a.rank - b.rank)[0];
  const graphNodes = c.graph?.nodes.length ?? 0;
  const graphEdges = c.graph?.edges.length ?? 0;
  const live = isLive();

  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="wrap">
          <div className="hero-top">
            <div className="hero-copy">
              <h1 id="hero-title">Why is it short? Upstream traces it from your shelf to the factory.</h1>
              <p className="lede">
                Ask about a drug. Upstream reads our stock at three hospitals and FDA&apos;s public files where they
                live, follows each label to the plant that makes it, and lines up what FDA found there against the day
                the shortage was posted. Every claim opens to the row behind it.
              </p>
            </div>
            <aside className="hero-case" aria-label="The case drawn below">
              <p className="hero-case__k">A buyer at Corvale Health asked</p>
              <p className="hero-case__q">&ldquo;{c.question}&rdquo;</p>
              <div className="hero-case__meta">
                <StateBadge state={c.explanation?.state} />
                <span className="muted small">Data as of {fmtDate(c.asOf)}</span>
              </div>
              <Link href="/case/carboplatin" className="btn btn--small hero-case__go">
                Open the full case
              </Link>
            </aside>
          </div>
          <div className="hero-trace panel">
            <TraceAndRuler
              trace={trace}
              ruler={ruler}
              caption={
                <>
                  {drugTitle(c.molecule)} at Corvale Health: {c.usage.zetarisQueries} Zetaris queries across three
                  hospitals and FDA&apos;s files, {fmtMs(c.usage.zetarisMs)} in all. Select any box to see its row.
                </>
              }
            />
          </div>
        </div>
      </section>

      <section className="section section--ask" aria-label="Ask Upstream">
        <div className="wrap ask-wrap">
          <AskBox id="home-ask" />
          <p className="ask-aside small muted">
            {live
              ? "Questions run live against Zetaris and FDA's files."
              : "This copy replays recorded investigations, step by step, and says so on every answer. Questions about drugs without a recording are refused plainly rather than guessed."}{" "}
            Scout Intent reads every question first: it answers why and what to do, and refuses orders, stock changes
            and dosing advice.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="problem-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="problem-title">Shortages cost hospitals time they don&apos;t have</h2>
            <p className="lede">
              A buyer learns a drug is short when the wholesaler cuts the order. The cause is usually already on public
              record, spread across FDA files nobody has time to join.
            </p>
          </div>
          <ul className="problem">
            <li>
              <p className="problem__n num">20 million hours</p>
              <p>
                of staff time a year, and nearly $900 million in labour, go to managing drug shortages in US hospitals.
              </p>
              <a
                className="problem__src"
                href="https://www.vizient.com/newsroom/news-releases/2025/new-vizient-survey-finds-drug-shortages-cost-hospitals-nearly-900m-annually-in-labor-expenses"
                rel="noopener noreferrer"
              >
                Vizient survey, 2023 data, published June 2025
              </a>
            </li>
            <li>
              <p className="problem__n num">59%</p>
              <p>of the shortages ASHP tracked in 2025 had a cause that was unknown or not disclosed.</p>
              <a className="problem__src" href="https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter" rel="noopener noreferrer">
                ASHP data, reported by AJMC
              </a>
            </li>
            <li>
              <p className="problem__n num">227</p>
              <p>active drug shortages in the US in the second quarter of 2026, a third straight quarterly rise.</p>
              <a className="problem__src" href="https://www.ajmc.com/view/active-us-drug-shortages-rise-for-third-straight-quarter" rel="noopener noreferrer">
                ASHP, Q2 2026, reported by AJMC
              </a>
            </li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="sources-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="sources-title">Three hospitals and FDA, and nothing copied</h2>
            <p className="lede">
              Corvale Health&apos;s three hospitals keep stock three different ways. Zetaris queries each one where it
              lives, and Upstream&apos;s semantic layer joins them to FDA&apos;s files in one model.
            </p>
          </div>
          <SourcesDiagram dq={c.dataQuality} fdaRows={fdaRows} fdaBuilt={manifest?.built ? fmtDate(manifest.built) : null} />
        </div>
      </section>

      <section className="section" aria-labelledby="found-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="found-title">What the {drugTitle(c.molecule)} trace found</h2>
            <p className="lede">The answer as the buyer read it, with every sentence checked against the rows it cites.</p>
          </div>
          <div className="found">
            <div className="found-why">
              {c.explanation ? (
                <>
                  <p className="found-head">{tallText(c.explanation.headline)}</p>
                  <WhyList explanation={c.explanation} />
                  <Dropped explanation={c.explanation} />
                </>
              ) : null}
            </div>
            <dl className="found-facts">
              <div>
                <dt>Shortest shelf</dt>
                <dd>
                  <span className="found-n num">{fmtDays(lowest?.days)} days</span> at {lowest?.hospital}
                  <Cites ids={lowest?.evidence.slice(0, 1) ?? []} />
                </dd>
              </div>
              <div>
                <dt>Plants behind our NDCs</dt>
                <dd>
                  <span className="found-n num">{plants}</span> named on {c.chain.length} labels, {placed} placed in
                  FDA&apos;s registration file
                </dd>
              </div>
              <div>
                <dt>FDA actions at those plants</dt>
                <dd>
                  <span className="found-n num">{count("inspection_oai")} OAI</span>, {count("warning_letter")} warning
                  letter, {count("import_alert")} import-alert listings, {count("inspection_vai")} VAI inspections
                </dd>
              </div>
              {ruler.lead ? (
                <div>
                  <dt>Lead before the posting</dt>
                  <dd>
                    <span className="found-n num">{ruler.lead.days} days</span> from the OAI letter to FDA&apos;s posting
                    {ruler.lead.evidence ? <Cites ids={[ruler.lead.evidence]} /> : null}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>On FDA&apos;s list</dt>
                <dd>
                  <span className="found-n num">{ruler.months} months</span>, {listedCompanies} companies current
                </dd>
              </div>
              {firstOption ? (
                <div>
                  <dt>First option</dt>
                  <dd>
                    {firstOption.title}. Needs the {firstOption.needs}.
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>The work</dt>
                <dd className="num">
                  {c.usage.zetarisQueries} queries in {fmtMs(c.usage.zetarisMs)}, {c.usage.modelCalls} model call,{" "}
                  {fmtInt(c.usage.tokensIn + c.usage.tokensOut)} tokens
                </dd>
              </div>
            </dl>
          </div>
          <div className="found-go">
            <Link href="/case/carboplatin" className="btn btn--primary">
              Open the full case
            </Link>
            <Link href="/desk" className="btn">
              Go to the buyer&apos;s desk
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="eval-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="eval-title">Nemotron alone against Upstream</h2>
            <p className="lede">
              The same model, asked from memory which plant makes each product and what FDA found there, against
              Upstream reading FDA&apos;s files through Zetaris. Both are scored on answers computed separately from the
              raw files.
            </p>
          </div>
          <EvalCompare />
        </div>
      </section>

      <section className="section" aria-labelledby="bt-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="bt-title">Does the ruler hold up on past shortages?</h2>
            <p className="lede">
              The same trace, run over FDA&apos;s shortage history and a set of drugs that were never short. It explains
              rather than predicts.
            </p>
          </div>
          <BacktestHome />
        </div>
      </section>

      <section className="section" aria-labelledby="how-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="how-title">What runs when you ask</h2>
            <p className="lede">
              One question, in order. Each step names the engine that does it, and what it did for {drugTitle(c.molecule)}.
            </p>
          </div>
          <ol className="pipeline">
            <li>
              <span className="pipeline__do">You ask a question</span>
              <span className="pipeline__engine">Scout Intent</span>
              <span className="pipeline__what">
                Names the intent and its risk, then signs an execution contract listing what may run. Every later tool
                call is checked against it. Orders are always refused.
              </span>
              <span className="pipeline__case num">
                {c.intent.name}, {c.intent.risk} risk, contract {c.intent.contractId?.slice(-8)}
              </span>
            </li>
            <li>
              <span className="pipeline__do">Upstream reads the sources</span>
              <span className="pipeline__engine">Zetaris</span>
              <span className="pipeline__what">
                Federated SQL through the semantic layer, over two Postgres servers, a folder of CSV exports and
                FDA&apos;s files. Every query is kept with its id, SQL and rows.
              </span>
              <span className="pipeline__case num">
                {c.usage.zetarisQueries} queries, {fmtMs(c.usage.zetarisMs)}
              </span>
            </li>
            <li>
              <span className="pipeline__do">The chain is recorded</span>
              <span className="pipeline__engine">World Model</span>
              <span className="pipeline__what">
                Hospital item, package, product, labeler, plant and FDA action become a graph with provenance on every
                edge. The explanation may only cite what is in it.
              </span>
              <span className="pipeline__case num">
                {graphNodes} nodes, {graphEdges} edges
              </span>
            </li>
            <li>
              <span className="pipeline__do">&ldquo;What did we do last time?&rdquo;</span>
              <span className="pipeline__engine">H-MEM</span>
              <span className="pipeline__what">
                Recalls past decisions on the drug with who approved them, and records a new one only after a named
                pharmacist approves.
              </span>
              <span className="pipeline__case num">{c.memory.length} past decisions recalled</span>
            </li>
            <li>
              <span className="pipeline__do">The answer is written</span>
              <span className="pipeline__engine">NVIDIA Nemotron and the verifier</span>
              <span className="pipeline__what">
                Nemotron Ultra writes from the evidence. A deterministic check then drops any sentence whose dates,
                numbers or citations are not in the rows it cites.
              </span>
              <span className="pipeline__case num">
                {c.explanation?.verifier.checked ?? 0} checked, {c.explanation?.verifier.rejected.length ?? 0} dropped
              </span>
            </li>
            <li>
              <span className="pipeline__do">Overnight, every drug</span>
              <span className="pipeline__engine">Markovian</span>
              <span className="pipeline__what">
                The watch walks the whole formulary in fixed-size chunks with a fresh contract for each, so the morning
                brief costs the same at 30 drugs or 300.
              </span>
              <span className="pipeline__case num">
                <Link href="/desk">See the morning brief</Link>
              </span>
            </li>
          </ol>
          <p className="pipeline-more">
            <Link href="/how">Architecture, conformance results and the eval</Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="limits-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="limits-title">What Upstream can&apos;t see</h2>
            <p className="lede">Stated plainly, because a buyer acting on this needs to know where it stops.</p>
          </div>
          <ul className="limits">
            <li>
              <h3>The hospitals are fictional</h3>
              <p>
                Corvale Health, its stock, usage, people and past decisions are invented. The FDA records it traces are
                real and dated.
              </p>
            </li>
            <li>
              <h3>About a third of labels name no plant</h3>
              <p>
                When a label lists no establishment, Upstream falls back to the application holder and says so. It does
                not guess the factory.
              </p>
            </li>
            <li>
              <h3>Ingredient plants are mostly invisible</h3>
              <p>
                Labels name finished-dose plants. The plant making the active ingredient rarely appears in a public
                file, so a problem there can go unseen.
              </p>
            </li>
            <li>
              <h3>History has look-ahead bias</h3>
              <p>
                Today&apos;s FDA files include classifications that were not public at the time. The ruler marks the day
                each finding became known, and the back-test reports both dates.
              </p>
            </li>
            <li>
              <h3>A finding is not a cause</h3>
              <p>
                An OAI classification means FDA found serious problems at a plant. It doesn&apos;t prove they caused
                this shortage; the answer says &ldquo;linked&rdquo;, never &ldquo;caused&rdquo;.
              </p>
            </li>
            <li>
              <h3>It informs, it doesn&apos;t order</h3>
              <p>
                Upstream ranks options and drafts a memo. Transfers, substitutions and contract changes are approved by
                a named pharmacist or the P&amp;T committee.
              </p>
            </li>
          </ul>
        </div>
      </section>
    </EvidenceProvider>
  );
}
