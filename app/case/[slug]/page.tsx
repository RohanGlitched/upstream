import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceProvider } from "@/components/Evidence";
import { RecordDesk } from "@/components/record/RecordDesk";
import { buildDesk } from "@/components/record/model";
import { BoxStamp, TallName } from "@/components/record/bits";
import { BatchRecord } from "@/components/case/BatchRecord";
import { GateRegister, Receipt } from "@/components/case/Registers";
import { CaseGraph, type Graph } from "@/components/case/CaseGraph";
import { Memo } from "@/components/case/Memo";
import { Watershed } from "@/components/watershed";
import { loadCase, realCases } from "@/components/server/data";
import { drugTitle, tallText } from "@/components/lib/drug";
import { fmtDate } from "@/components/lib/format";
import "../case-page.css";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const c = await loadCase(slug);
  if (!c) return { title: "Investigation not found" };
  return { title: `${drugTitle(c.molecule)} shortage`, description: c.explanation?.headline ?? c.question };
}

const TABS = [
  ["map", "Supply map"],
  ["record", "Batch record"],
  ["gate", "Gate register"],
  ["graph", "World Model"],
  ["memo", "Memo and signature"],
] as const;

const STATE = {
  confirmed: { word: "CONFIRMED", tone: "carbon" },
  check: { word: "CHECK", tone: "amber" },
  no_signal: { word: "NO SIGNAL", tone: "ink" },
} as const;

export default async function CasePage({ params }: Params) {
  const { slug } = await params;
  const c = await loadCase(slug);
  if (!c) notFound();
  const m = buildDesk(c, slug);
  const all = await realCases();
  const here = all.findIndex((x) => x.slug === slug);
  const next = [...all.slice(here + 1), ...all.slice(0, Math.max(0, here))].filter((x) => x.slug !== slug).slice(0, 4);
  const approvers = [...new Set(["Jordan Hale, PharmD", "Riley Brooks, PharmD", "Alex Morgan, PharmD", ...c.memory.map((x) => x.approvedBy).filter((x): x is string => Boolean(x))])];
  const seen = new Set<string>();
  const decisions = [...c.options]
    .sort((a, b) => a.rank - b.rank)
    .filter((o) => !seen.has(o.title) && seen.add(o.title))
    .slice(0, 8)
    .map((o) => tallText(o.title));
  const { graph, ...plain } = c;
  const title = drugTitle(c.molecule);

  return (
    <EvidenceProvider evidence={c.evidence} queries={c.queries}>
      <nav className="cp-crumbs" aria-label="Breadcrumb">
        <div className="cp-in">
          <Link href="/case">Investigations</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
          <span className="cp-crumbs__id">{c.id}</span>
        </div>
      </nav>

      <RecordDesk m={m} signHref="#memo" />

      <nav className="cp-tabs" aria-label="This investigation">
        <div className="cp-in">
          <ol>
            {TABS.map(([id, label], i) => (
              <li key={id} style={{ "--i": i } as React.CSSProperties}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      <section id="map" className="cp-sec cp-sec--map" aria-labelledby="map-h">
        <div className="cp-in">
          <div className="rec-head">
            <h2 id="map-h">The supply, drawn as a watershed</h2>
            <p>
              Plants are springs, labelers are confluences, our hospitals are reservoirs. Stream width is real daily use;
              FDA&apos;s record replays as silt and dry beds.
            </p>
          </div>
        </div>
        <Watershed caseData={plain} />
      </section>

      <section id="record" className="cp-sec" aria-labelledby="record-h">
        <div className="cp-in">
          <div className="rec-head">
            <h2 id="record-h">The batch record</h2>
            <p>
              The investigation as it ran, part by part: the steps, the explanation with its citations, our stock, the
              options, who else makes it, the data checks and what we decided last time.
            </p>
          </div>
          <BatchRecord c={c} />
        </div>
      </section>

      <section id="gate" className="cp-sec" aria-labelledby="gate-h">
        <div className="cp-in">
          <div className="rec-head">
            <h2 id="gate-h">The gate register</h2>
            <p>Scout Intent checked every tool call against the contract it signed for this question, before the call ran.</p>
          </div>
          <div className="cp-two">
            <GateRegister c={c} />
            <div className="cp-receipt">
              <h3 className="cp-h3">What it took</h3>
              <Receipt c={c} />
            </div>
          </div>
        </div>
      </section>

      <section id="graph" className="cp-sec" aria-labelledby="graph-h">
        <div className="cp-in">
          <div className="rec-head">
            <h2 id="graph-h">The World Model&apos;s graph</h2>
            <p>What the World Model recorded for this case, from our items to FDA&apos;s records. The explanation may cite only what is in it.</p>
          </div>
          <CaseGraph graph={graph as unknown as Graph | undefined} />
        </div>
      </section>

      <section id="memo" className="cp-sec" aria-labelledby="memo-h">
        <div className="cp-in">
          <div className="rec-head">
            <h2 id="memo-h">The memo, and the signature it needs</h2>
            <p>Upstream informs; a pharmacist decides. The decision enters H-MEM only under a named signature.</p>
          </div>
          <Memo slug={slug} molecule={c.molecule} asOf={c.asOf} approvers={approvers} decisions={decisions} />
        </div>
      </section>

      {next.length ? (
        <section className="cp-sec cp-next" aria-labelledby="next-h">
          <div className="cp-in">
            <div className="rec-head">
              <h2 id="next-h">The next files in the drawer</h2>
              <p>
                <Link href="/case">All {all.length} investigations</Link>, sorted by the shortest shelf.
              </p>
            </div>
            <ul className="cp-folders">
              {next.map((o, i) => {
                const st = o.state ? STATE[o.state as keyof typeof STATE] : null;
                return (
                  <li key={o.slug} style={{ "--i": i } as React.CSSProperties}>
                    <Link href={`/case/${o.slug}`} className="cp-folder">
                      <span className="cp-folder__tab">
                        <TallName name={drugTitle(o.molecule)} />
                      </span>
                      <span className="cp-folder__body">
                        <span className="cp-folder__h">{o.headline ? tallText(o.headline) : o.question}</span>
                        <span className="cp-folder__m">
                          {st ? <BoxStamp tone={st.tone}>{st.word}</BoxStamp> : null}
                          <span>
                            {o.minDays !== null ? `${o.minDays < 10 ? o.minDays.toFixed(1) : Math.round(o.minDays)} days at the shortest shelf` : "No stock on file"}
                            {o.firstPosting ? `. FDA posted it ${fmtDate(o.firstPosting)}` : ""}
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}
    </EvidenceProvider>
  );
}
