// The batch record sheet: the whole investigation as one ruled, three-hole-punched ledger page, part by
// part, ending in signatures. Server-rendered; only the citation marks and slips are interactive.
import type { Case, Hospital } from "../../src/agent/types";
import { tallMan } from "../../src/agent/util";
import { parseDecisionContent } from "../../src/engines/decision-text";
import { Cite, Cites } from "../Evidence";
import { BoxStamp, TallName, TickMark } from "../record/bits";
import { Signature } from "../record/Signature";
import { countryName, firmCase, fmtInt, ndc542 } from "../lib/format";
import { dataSystems } from "../lib/sources";
import { caseSystems, lineageLine, systemOf } from "../../src/lib/lineage";
import { drugTitle } from "../lib/drug";
import { Findings } from "./Findings";
import { Gloss, Glossed } from "../Gloss";
import "./batch.css";

const HOSPITALS: Hospital[] = ["Corvale General", "Corvale East", "Corvale Lakeside"];
const NEEDS = (s: string) => s.replace(/\s*\(.*\)$/, "").replace(/^./, (c) => c.toUpperCase());
const HEALTH_TONE = { signal: "red", watch: "amber", clear: "clear", unknown: "ink" } as const;
// a tenth of a day everywhere, the same rounding as the desk above
const days = (d: number | null) => (d === null ? "n/a" : d.toFixed(1));

function Part({ id, n, title, desc, children }: { id?: string; n: string; title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="br-part" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="br-part__l">Part {n}</div>
      <div className="br-part__body">
        <h3 id={id ? `${id}-h` : undefined}>{title}</h3>
        {desc ? <p className="br-part__d">{desc}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function BatchRecord({ c }: { c: Case }) {
  const title = drugTitle(c.molecule);
  const steps = c.steps;
  const systems = caseSystems(c);
  const hospitalSystems = systems.filter((s) => s.kind === "hospital").length;
  const totalMs = steps.reduce((a, s) => a + s.ms, 0);
  const totalRows = steps.reduce((a, s) => a + s.rows, 0);
  const contract = c.intent.contractId?.slice(-8) ?? "none";
  const v = c.explanation?.verifier;

  const seen = new Set<string>();
  const opts = [...c.options].sort((a, b) => a.rank - b.rank).filter((o) => !seen.has(o.title) && seen.add(o.title));
  const shownOpts = opts.slice(0, 6);
  const moreOpts = opts.slice(6);

  const market = [...c.market].sort((a, b) => Number(b.inOurStock) - Number(a.inOurStock) || Number(b.onShortageList) - Number(a.onShortageList));
  const shownMarket = market.slice(0, 10);
  const best = opts[0];
  // NDCs as FDA's files record them (dashed package NDC); market lines carry only the 11-digit form, labelled so
  const pkgNdc = new Map(c.chain.map((p) => [p.ndc11, p.packageNdc]));

  return (
    <div className="br-sheet">
      <div className="br-holes" aria-hidden="true" />
      <div className="br-in">
        <div className="br-tblock">
          <div>
            <span className="br-fl">Record</span>
            <span className="br-fv br-type">{c.id}</span>
          </div>
          <div>
            <span className="br-fl">Product</span>
            <span className="br-fv br-prod">
              <TallName name={title} />
            </span>
          </div>
          <div>
            <span className="br-fl">Data as of</span>
            <span className="br-fv br-type">{c.asOf}</span>
          </div>
          <div>
            <span className="br-fl">Meterless Scout contract</span>
            <span className="br-fv br-type">{contract}</span>
          </div>
          <div>
            <span className="br-fl">Run</span>
            <span className="br-fv br-type">{c.usage.mode}</span>
          </div>
        </div>

        <Part
          id="steps"
          n="A"
          title="Steps performed"
          desc={
            <>
              {steps.length} steps, {c.usage.zetarisQueries} federated statements across {systems.length} physical systems ({hospitalSystems} hospital, {systems.length - hospitalSystems} FDA files). Each step ran under contract {contract}; select a query id to read its SQL.
            </>
          }
        >
          <table className="br-steps">
            <thead>
              <tr>
                <th>No.</th>
                <th>Step</th>
                <th>Result</th>
                <th>Systems read</th>
                <th className="r">Rows</th>
                <th className="r">Time</th>
                <th className="c">Checked</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className={s.status !== "ok" ? `is-${s.status}` : undefined}>
                  <td className="br-n">{i + 1}</td>
                  <td className="br-op">
                    <b>{s.title}</b>
                    <span>{s.purpose}</span>
                  </td>
                  <td className="br-res">
                    {tallMan(s.finding)}
                    {s.queryIds.length ? (
                      <span className="br-qids">
                        {s.queryIds.slice(0, 4).map((q) => (
                          <Cite key={q} id={q} label={s.title} />
                        ))}
                        {s.queryIds.length > 4 ? <span className="br-more">+{s.queryIds.length - 4}</span> : null}
                      </span>
                    ) : null}
                  </td>
                  <td className="br-srcs">
                    {s.queryIds.length ? <span className="br-srcs__n">{lineageLine(dataSystems(s.sources).length, s.queryIds.length, s.ms)}</span> : null}
                    {[...new Map(s.sources.map((x) => [systemOf(x).id, systemOf(x)])).values()].map((x) => (
                      <span key={x.id} title={s.sources.filter((t) => systemOf(t).id === x.id).join(", ")}>
                        {x.name}
                      </span>
                    ))}
                  </td>
                  <td className="br-ms br-rw">{fmtInt(s.rows)}</td>
                  <td className="br-ms">{fmtInt(s.ms)} ms</td>
                  <td className="br-ck">{s.status === "ok" ? <TickMark size={22} /> : <BoxStamp tone="amber">{s.status.toUpperCase()}</BoxStamp>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>
                  {steps.length} steps, {fmtInt(totalRows)} rows read, {fmtInt(totalMs)} ms of query time. Every action was allowed in contract scope {contract}.
                </td>
              </tr>
            </tfoot>
          </table>
        </Part>

        <Part
          id="findings"
          n="B"
          title="Why it is short, as written and checked"
          desc="Every sentence carries the records it rests on. Open a mark in the margin to read that source row."
        >
          {c.explanation && c.explanation.sentences.length ? (
            <Findings explanation={c.explanation} evidence={c.evidence} />
          ) : (
            <p className="br-empty">Every sentence the model wrote failed the verifier, so none is entered here. The steps and rows above still stand.</p>
          )}
        </Part>

        <Part
          id="stock"
          n="C"
          title="Our stock, hospital by hospital"
          desc="Read in place from each hospital's own system and converted by the semantic layer to units of use (East counts packages). Days are per presentation, never pooled across strengths or vial sizes; the 14-day mark is the transfer floor."
        >
          <div className="br-stock">
            {HOSPITALS.map((h) => {
              const lines = c.stock.filter((s) => s.hospital === h);
              if (!lines.length) return null;
              const on = lines.reduce((a, s) => a + s.onHand, 0);
              const use = lines.reduce((a, s) => a + s.dailyUse, 0);
              // The headline is the shortest presentation at this hospital; older recordings pool every line.
              const pres = (c.presentations ?? []).map((p) => p.hospitals.find((x) => x.hospital === h)).filter((x) => x && x.days !== null) as { days: number }[];
              const d = pres.length ? Math.min(...pres.map((x) => x.days)) : use > 0 ? on / use : null;
              return (
                <div key={h} className="br-hosp">
                  <div className="br-hosp__h">
                    <h4>{h}</h4>
                    <span className={`br-hosp__d${d !== null && d < 7 ? " is-low" : ""}`}>
                      {days(d)}
                      <small> days</small>
                    </span>
                  </div>
                  <table className="br-lines">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>
                          <Gloss term="NDC">NDC</Gloss>
                        </th>
                        <th className="r">On hand</th>
                        <th className="r">A day</th>
                        <th className="r">Days</th>
                        <th>Row</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((s) => (
                        <tr key={s.itemKey}>
                          <td>
                            <b>{tallMan(s.description)}</b>
                            <span>
                              {s.itemKey}, {s.labeler ?? "labeler not found"}
                              {s.presentationLabel ? `; ${s.presentationLabel}` : ""}
                            </span>
                          </td>
                          <td className="br-type">
                            {pkgNdc.get(s.ndc11) ?? ndc542(s.ndc11)}
                            <span className="br-match">{s.ndcMatch}</span>
                          </td>
                          <td className="r br-type" title={s.unitBasis || undefined}>
                            {fmtInt(s.onHand)} <small>{s.unit}</small>
                            {s.unitBasis && /^packages/.test(s.unitBasis) ? <span className="br-match">{s.unitBasis}</span> : null}
                          </td>
                          <td className="r br-type">{s.dailyUse.toFixed(1)}</td>
                          <td className={`r br-type${s.days !== null && s.days < 7 ? " is-low" : ""}`}>{days(s.days)}</td>
                          <td>
                            <Cite id={s.evidence} label={s.description} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </Part>

        <Part
          id="options"
          n="D"
          title="What we can do, ranked by rule"
          desc="Transfers first: same product, no clinical change, no new supplier. Each line names who must sign before anything moves."
        >
          {shownOpts.length ? (
            <ol className="br-opts">
              {shownOpts.map((o, i) => (
                <li key={i}>
                  <span className="br-rk">{i + 1}</span>
                  <div className="br-opt">
                    <b>{tallMan(o.title)}</b>
                    <span>{tallMan(o.detail)}</span>
                    {o.why ? (
                      <em>
                        <Glossed text={o.why} />
                      </em>
                    ) : null}
                  </div>
                  <div className="br-sign">
                    <span className="br-sign__line" aria-hidden="true" />
                    <span className="br-sign__who">{NEEDS(o.needs)}</span>
                    <Cites ids={o.evidence.slice(0, 5)} label={o.title} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="br-empty">No option passed the rules for this drug. Upstream does not invent one.</p>
          )}
          {moreOpts.length ? (
            <details className="br-details">
              <summary>
                {moreOpts.length} more {moreOpts.length === 1 ? "option" : "options"}, lower in the ranking
              </summary>
              <ol className="br-opts br-opts--more">
                {moreOpts.map((o, i) => (
                  <li key={i}>
                    <span className="br-rk">{shownOpts.length + i + 1}</span>
                    <div className="br-opt">
                      <b>{tallMan(o.title)}</b>
                      <span>{tallMan(o.detail)}</span>
                    </div>
                    <div className="br-sign">
                      <span className="br-sign__who">{NEEDS(o.needs)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </Part>

        <Part
          id="market"
          n="E"
          title="Who else makes it"
          desc={`Every labeler of ${tallMan(c.molecule.toLowerCase())} in the same form, the plants named on its label or FDA's application file, and whether FDA lists it short.`}
        >
          {shownMarket.length ? (
            <table className="br-mk">
              <thead>
                <tr>
                  <th>Labeler and NDC (11-digit)</th>
                  <th>Plants on the label</th>
                  <th>FDA&apos;s list</th>
                </tr>
              </thead>
              <tbody>
                {shownMarket.map((mk, i) => (
                  <tr key={i} className={mk.inOurStock ? "is-ours" : undefined}>
                    <td>
                      <b>{mk.labeler}</b>
                      <span className="br-type">
                        {ndc542(mk.ndc11)}
                        {mk.inOurStock ? ", on our shelves" : ""}
                      </span>
                    </td>
                    <td>
                      {mk.plants.length ? (
                        <ul className="br-plants">
                          {mk.plants.slice(0, 3).map((p, j) => (
                            <li key={j}>
                              <span className={`br-dot br-dot--${HEALTH_TONE[p.health]}`} aria-hidden="true" />
                              {firmCase(p.name)}
                              {p.country ? `, ${countryName(p.country)}` : ""}
                              {p.last ? <span className="br-type br-last"> {p.last}</span> : <span className="br-none"> {p.fei ? "no classified inspection" : "not placed"}</span>}
                            </li>
                          ))}
                          {mk.plants.length > 3 ? <li className="br-none">and {mk.plants.length - 3} more</li> : null}
                        </ul>
                      ) : (
                        <span className="br-none">The label names no plant</span>
                      )}
                    </td>
                    <td>{mk.onShortageList ? <BoxStamp tone="red">LISTED</BoxStamp> : <span className="br-none">not listed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="br-empty">No other labeler of this form is on file.</p>
          )}
          {market.length > shownMarket.length ? (
            <p className="br-note">
              and {market.length - shownMarket.length} more {market.length - shownMarket.length === 1 ? "labeler" : "labelers"} in the World Model below.
            </p>
          ) : null}
          {c.shortage.companies.length ? (
            <>
              <h4 className="br-sub">What FDA&apos;s shortage listing says, company by company</h4>
              <table className="br-co">
                <tbody>
                  {c.shortage.companies.slice(0, 12).map((co, i) => (
                    <tr key={i}>
                      <td>
                        <b>{co.company}</b>
                      </td>
                      <td>
                        <BoxStamp tone={co.status === "Current" ? "red" : co.status === "Resolved" ? "clear" : "amber"} tilt={i % 2 ? 1.5 : -1.5}>
                          {co.status.toUpperCase()}
                        </BoxStamp>
                      </td>
                      <td className="br-type">{co.updated}</td>
                      <td className="br-info">{co.info || "No note"}</td>
                      <td>
                        <Cite id={co.evidence} label={co.company} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </Part>

        <Part id="quality" n="F" title="Which links can't be trusted" desc="The semantic layer's key rules, run over each hospital's stock before anything was joined.">
          {c.dataQuality.length ? (
            <table className="br-dq">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Rule</th>
                  <th className="r">Rows</th>
                  <th className="r">Failing</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {c.dataQuality.map((d, i) => (
                  <tr key={i}>
                    <td className="br-type">{d.table}</td>
                    <td>{d.rule}</td>
                    <td className="r br-type">{fmtInt(d.total)}</td>
                    <td className={`r br-type${d.invalid ? " is-low" : ""}`}>{fmtInt(d.invalid)}</td>
                    <td>
                      {d.invalid ? (
                        <BoxStamp tone="red" tilt={1}>
                          FAIL
                        </BoxStamp>
                      ) : (
                        <BoxStamp tone="clear" tilt={-1}>
                          PASS
                        </BoxStamp>
                      )}{" "}
                      <span className="br-dq__n">{d.note}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="br-empty">No key rules ran for this case.</p>
          )}
        </Part>

        <Part
          id="memory"
          n="G"
          title="What we decided last time"
          desc={
            <>
              Recalled from <Gloss term="H-MEM">H-MEM</Gloss>, each decision with the pharmacist who signed it.
            </>
          }
        >
          {c.memory.length ? (
            <div className="br-mem">
              {c.memory.map((m) => {
                // Recalled decisions are the approver's own words, stored and shown as a quote.
                const d = parseDecisionContent(m.text);
                const why = d.rationale;
                return (
                  <blockquote key={m.id}>
                    <p>
                      <span className="br-mem__q">&ldquo;{tallMan(d.quote.replace(/^./, (x) => x.toUpperCase()))}&rdquo;</span>
                    </p>
                    <p className="br-mem__said">In the words of {m.approvedBy ?? d.approvedBy ?? "the approver"}, as recorded.</p>
                    {why ? <p className="br-mem__why">Rationale: {why.replace(/\s*\(demo history\)\.?$/, "")}.</p> : null}
                    <footer>
                      {m.approvedBy ? <Signature name={m.approvedBy} className="br-mem__sig" /> : null}
                      <cite>
                        {m.approvedBy ?? "No signature on file"}
                        {m.when ? `, ${m.when}` : ""}
                      </cite>
                    </footer>
                  </blockquote>
                );
              })}
            </div>
          ) : (
            <p className="br-empty">No past decision on this drug is in memory. The first one signed below becomes it.</p>
          )}
        </Part>

        <div className="br-signoff">
          <div className="br-sig">
            <div className="br-sig__line">
              <span className="br-ss">/s/ {(c.explanation?.model ?? "no model").replace(/^nvidia\//, "").replace(/-\d+b-a\d+b$/, "")}</span>
            </div>
            <div className="br-sig__who">Written by</div>
            <div className="br-sig__what">
              <span className="br-type">{c.explanation?.model ?? "No model call"}</span>
              <br />
              {c.usage.modelCalls} model {c.usage.modelCalls === 1 ? "call" : "calls"}, {fmtInt(c.usage.tokensIn)} tokens in, {fmtInt(c.usage.tokensOut)} out
            </div>
          </div>
          <div className="br-sig">
            <div className="br-sig__line">
              <span className="br-ss">/s/ upstream-verifier</span>
            </div>
            <div className="br-sig__who">Checked by</div>
            <div className="br-sig__what">
              Upstream verifier
              <br />
              {v ? `${c.explanation?.sentences.length ?? 0} sentences and the headline kept, ${v.rejected.length} rejected, ${v.repaired ?? 0} repaired` : "Nothing to check"}
            </div>
          </div>
          <div className="br-sig is-pending">
            <div className="br-sig__line">
              <a href="#memo">awaiting signature</a>
            </div>
            <div className="br-sig__who">Released by</div>
            <div className="br-sig__what">{best ? `${NEEDS(best.needs)}, for: ${tallMan(best.title)}` : "Pharmacy director"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
