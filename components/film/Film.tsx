"use client";
/**
 * <Film caseData={carboplatin} plants={plantsJson} evalData={traceJson} />: the prologue. One sticky stage
 * that dives, as you scroll, from a vial in the hospital's cabinet drawer through its label and its real UPC-A
 * barcode, down one bar into the night, out to the globe and along the arc to the plant, then into FDA's
 * registration and inspection records (the OAI stamp lands), the lead-time ruler, and back to the shelf with
 * the answer and the proof. A depth gauge (powers of ten) and the record date run down the left edge.
 *
 * Props
 *   caseData     Case (src/agent/types). Built for carboplatin; works for any case whose supply reaches a plant
 *                with an OAI inspection and a posted shortage. Every figure and citation is read from it.
 *   plants?      data/plants.json, for the plant rings on the globe, Corvale's position and plant counts.
 *   evalData?    data/eval/trace.json, for the proof row in the last stop (Upstream against Nemotron alone).
 *   offsetTop?   px of sticky header above the stage (default 0). The stage sticks below it.
 *   answerHref?  where "Draft the transfer request" goes (default /case/<first word of the molecule>).
 *   id?          id for the section (default "film").
 *
 * Scroll drives it (about 9.6 screens); Previous and Next buttons step through the eight stops. Reduced motion
 * shows each stop finished, without the zooms. Smooth at 60fps: one rAF per scroll change, transforms and
 * viewBox only, the globe in SVG through d3-geo with land loaded after first paint.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Case } from "../../src/agent/types";
import type { EvalFile, PlantsFile } from "./model";
import { buildFilm } from "./model";
import { buildMicro } from "./micro";
import "./film.css";

export interface FilmProps {
  caseData: Case;
  plants?: PlantsFile | null;
  evalData?: EvalFile | null;
  offsetTop?: number;
  answerHref?: string;
  id?: string;
}

const TMAX = 7.6;
const STOPS = [0, 1.12, 2.5, 3.58, 4.15, 5.25, 6.62, 7.5];
const BOUNDS = [0.6, 1.6, 2.84, 3.76, 4.62, 5.7, 6.85];

export function Film({ caseData, plants = null, evalData = null, offsetTop = 0, answerHref, id = "film" }: FilmProps) {
  const D = useMemo(() => buildFilm(caseData, plants, evalData), [caseData, plants, evalData]);
  const micro = useMemo(() => buildMicro(D.pockets, D.cabinet, D.totalLine), [D]);
  const rootRef = useRef<HTMLElement>(null);
  const href = answerHref ?? `/case/${caseData.molecule.split(" ")[0].toLowerCase()}`;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let destroy = () => {};
    let alive = true;
    import("./engine").then((m) => { if (alive) destroy = m.runFilm(root, D, micro.geo, { TMAX, STOPS, BOUNDS, offsetTop }); });
    return () => { alive = false; destroy(); };
  }, [D, micro, offsetTop]);

  const pct = (a: number, b: number) => Math.round((a / Math.max(1, b)) * 100);
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
  const cap0 = D.caps[0];
  return (
    <section ref={rootRef} className="fm" id={id} aria-label={`One ${D.drug} vial, followed upstream in eight stops`} style={{ ["--fm-top" as string]: `${offsetTop}px` }}>
      <div className="fm-stage" data-f="stage">
        <div className="fm-void" data-f="void" />
        <svg className="fm-micro" data-f="micro" viewBox="-12 -12 684 428" preserveAspectRatio="xMidYMid meet" aria-hidden="true" dangerouslySetInnerHTML={{ __html: micro.svg }} />
        <svg className="fm-globe" data-f="globe" aria-hidden="true" />
        <div className="fm-maplabels" data-f="maplabels" aria-hidden="true">
          <div className="fm-sitemark nf" data-f="nextframe"><i /></div>
          <div className="fm-sitemark" data-f="sitemark">
            <i />
            <em>100 m</em>
            <span>{D.plant.ll[1].toFixed(3)} N, {D.plant.ll[0].toFixed(3)} E<br />{D.plant.placed ? "placed from the registered address" : "the country’s centre"}</span>
          </div>
        </div>
        <div className="fm-lanes" data-f="lanes" aria-hidden="true">
          {D.lanes.map((l) => (
            <div key={l.g} className={`fm-lane${l.g === "lab" ? " on" : ""}`} data-lane={l.g}>
              <b>{l.d || micro.geo.digits.slice(-1)}</b>
              <span className="fm-long">{l.r}</span><span className="fm-short">{l.rs}</span>
            </div>
          ))}
        </div>
        <div className="fm-labcard fm-doc" data-f="labcard" aria-hidden="true">
          <div className="fm-dh"><span>NDC directory and the label</span><span>Labeler code</span></div>
          <h3>{D.focus.codes[0]} is {D.focus.labeler}</h3>
          <p className="p1">Product {D.focus.codes[1]} is {D.focus.product}. Package {D.focus.codes[2]} is {D.focus.pkg}.</p>
          <div className="to">
            <p>{D.focus.labelerShort}&rsquo;s label{D.focus.setId ? <>, SPL set <code>{D.focus.setId}</code>,</> : ""} names the plant that makes it:</p>
            <strong>{D.plant.name}</strong>
            <p>{D.plant.quality === "registered plant" ? "Registered plant" : "Named on the label"}, FEI <code>{D.plant.fei}</code>, {D.plant.countryName}. {D.plant.ops}.</p>
          </div>
          <p className="fm-ev">Evidence <b>{D.caps[2].e[1][1]}</b> from Zetaris query <b>{D.caps[2].e[0][1]}</b></p>
        </div>

        <article className="fm-reg fm-doc" data-f="reg" aria-hidden="true">
          <div className="fm-dh"><span>FDA establishment registration</span><span>{D.plant.quality === "registered plant" ? "Registered plant" : "Label link"}</span></div>
          <h3>{D.plant.name}</h3>
          <p className="addr">{D.plant.address}</p>
          <dl className="fm-kv">
            <div><dt>FEI</dt><dd><code>{D.plant.fei}</code></dd></div>
            {D.plant.duns && <div><dt>DUNS</dt><dd><code>{D.plant.duns}</code></dd></div>}
            <div><dt>Operations</dt><dd>{D.plant.ops}</dd></div>
          </dl>
          <ul className="fm-hist" aria-label="Inspection history">
            {D.plant.history.map((h, i) => (
              <li key={i} className={h.cls === "OAI" ? "hot" : ""} data-f={h.cls === "OAI" && i === D.plant.history.map((x) => x.cls).lastIndexOf("OAI") ? "regOai" : undefined}>
                <span>{h.date}</span>
                <span className={`fm-cls ${h.cls.toLowerCase()}`}>{h.cls}</span>
                <span>Inspection {h.id}<span className="fm-long">, {h.cls === "OAI" ? "Official" : "Voluntary"} Action Indicated</span></span>
              </li>
            ))}
          </ul>
          <p className="fm-ev">Evidence <b>{D.caps[4].e[0][1].split(" ")[1]}</b> from <b>{D.caps[4].e[0][1].split(" ")[0]}</b>; inspections <b>{D.caps[4].e[1][1].split(" ").slice(1).join(" ")}</b> from <b>{D.caps[4].e[1][1].split(" ")[0]}</b></p>
        </article>

        {D.oai && (
          <article className="fm-insp fm-doc" data-f="insp" aria-hidden="true">
            <div className="fm-dh"><span>FDA inspection classification</span><span>Inspection <code>{D.oai.id}</code></span></div>
            <h3>{D.plant.name}{D.plant.placed ? `, ${D.plant.place.split(",")[0]}` : ""}</h3>
            <div className="grid">
              <div><span>Inspection ended</span><b>{D.oai.end}</b></div>
              <div><span>Classification</span><b>Official Action Indicated</b></div>
              <div><span>Classification letter (FMD-145)</span><b>{D.oai.letter}</b></div>
              <div><span>FEI</span><b><code>{D.plant.fei}</code></b></div>
            </div>
            {D.oai.areas.length > 0 && (
              <div className="obs">
                <h4>Form 483{D.oai.obs ? `: ${D.oai.obs} observations, recorded under` : ""}</h4>
                <ol>{D.oai.areas.map((a, i) => <li key={i}><span>{a.k || "Area"}</span>{a.v}</li>)}</ol>
              </div>
            )}
            <p className="fm-ev">{D.caps[5].e.map(([k, v], i) => <span key={i}>{i ? "; " : ""}{k} <b>{v.split(" ")[1]}</b> from <b>{v.split(" ")[0]}</b></span>)}</p>
            <div className="fm-stamp" data-f="stamp" aria-hidden="true">
              <svg viewBox="0 0 190 112">
                <defs>
                  <filter id={`${id}ink`} x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={4} result="n" /><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.45" result="m" /><feComposite in="SourceGraphic" in2="m" operator="in" /></filter>
                </defs>
                <g filter={`url(#${id}ink)`} className="fm-stamp-ink">
                  <rect x="4" y="4" width="182" height="104" rx="6" strokeWidth="5" fill="none" />
                  <rect x="12" y="12" width="166" height="88" rx="3" strokeWidth="1.6" fill="none" />
                  <text x="95" y="68" textAnchor="middle" className="big">OAI</text>
                  <text x="95" y="90" textAnchor="middle" className="small">OFFICIAL ACTION INDICATED</text>
                </g>
              </svg>
            </div>
          </article>
        )}

        <svg className="fm-ruler" data-f="ruler" aria-hidden="true" />
        {D.lead && (
          <>
            <div className="fm-rfig" data-f="rHead" aria-hidden="true"><b>{D.lead.days} days</b><span>from FDA&rsquo;s OAI letter to {D.plant.name.split(" ")[0]} on <span className="nb">{D.lead.letter}</span> to the shortage posting on <span className="nb">{D.lead.posted}</span></span></div>
            <div className="fm-rfig" data-f="rTail" aria-hidden="true"><b>{D.lead.months} months</b><span>and {D.molecule.split(" ")[0]} is still on FDA&rsquo;s shortage list today</span></div>
          </>
        )}

        <div className="fm-answer" data-f="answer">
          <p className="fm-a-n">8 of 8: back at the shelf</p>
          {D.answer ? (
            <>
              <h2 className="fm-a-t">{D.answer.title}</h2>
              <p className="fm-a-b">{D.answer.why} {D.answer.note}</p>
              <div className="fm-hosp" data-f="hosp">
                {D.answer.rows.map((r, i) => (
                  <div key={r.key} className={`fm-h-row${r.low ? " low" : ""}`} data-row={i}>
                    <div className="fm-h-name">{r.key}<span>{r.src}</span></div>
                    <div className="fm-h-bar"><i style={{ width: `${Math.min(1, r.b / 21) * 100}%` }} /><span className="fl" /></div>
                    <div className="fm-h-days"><b>{fmt1(r.b)}</b> days</div>
                  </div>
                ))}
                <div className="fm-h-axis"><span /><div><span style={{ left: 0 }}>0</span><span style={{ left: "33.33%" }}>7</span><span style={{ left: "66.67%" }}>14 days, two weeks</span><span style={{ left: "100%" }}>21</span></div><span /></div>
                <div className="fm-pips" data-f="pips" />
              </div>
              <div className="fm-a-act">
                <a className="fm-btn" href={href}>Draft the transfer request</a>
                <span>Goes to the {D.answer.needs.replace(/\s*\(.*\)$/, "")} to approve.</span>
              </div>
              <p className="fm-ev">{D.caps[7].e.map(([k, v], i) => <span key={i}>{i ? "; " : ""}{k}, <b>{v}</b></span>)}</p>
            </>
          ) : (
            <h2 className="fm-a-t">No transfer covers {D.hospital.key}.</h2>
          )}
          {D.proof && (
            <div className="fm-proofrow">
              <div><b>{pct(D.proof.plant[0], D.proof.plant[1])}%</b><span>right plant, {D.proof.plant[0]} of {D.proof.plant[1]}, against FDA ground truth</span></div>
              <div><b>{pct(D.proof.last[0], D.proof.last[1])}%</b><span>right last inspection, {D.proof.last[0]} of {D.proof.last[1]}</span></div>
              <div className="nem"><b>{D.proof.nemDates[0]} of {D.proof.nemDates[1]}</b><span>inspection dates right for Nemotron alone. It invented {D.proof.invented}.</span></div>
            </div>
          )}
        </div>

        <div className="fm-intro" data-f="intro">
          <h2 className="fm-h1">Follow one vial upstream to the plant that made it short.</h2>
          <p className="fm-lede">Upstream reads stock where each hospital keeps it, follows the label to the plant FDA registered, and reads that plant&rsquo;s inspection file. Scroll to make the trip with one {D.drug} vial.</p>
          <p className="fm-cue"><i />Scroll to zoom in</p>
        </div>
        <div className="fm-callout" data-f="callout" aria-hidden="true"><b>{D.callout.big}</b><span>{D.callout.small}</span></div>

        <aside className="fm-gauge" aria-label="Scale of view">
          <div className="fm-ro">10<sup data-f="roE">0</sup><small>m</small></div>
          <div className="fm-ro-f" data-f="roF">1 m across</div>
          <div className="fm-ladder" data-f="ladder">
            {Array.from({ length: 11 }, (_, i) => 7 - i).map((ex) => (
              <div key={ex} className="fm-tick" data-ex={ex}><em><span className="t10">10</span><sup>{ex < 0 ? "−" + -ex : ex}</sup></em><i /></div>
            ))}
            <div className="fm-needle" data-f="needle"><i /><b data-f="needleName">a drawer</b></div>
          </div>
          <div className="fm-clock"><span>Record date</span><b data-f="clk">{D.asOf}</b><em data-f="clkNote">today</em></div>
        </aside>

        <div className="fm-cap" data-f="cap" aria-live="polite">
          <div className="fm-cap-in" data-f="capIn">
            <p className="fm-cap-n">1 of 8</p>
            <h3 className="fm-cap-t">{cap0.t}</h3>
            <p className="fm-cap-b">{cap0.b}</p>
            <p className="fm-cap-ev">{cap0.e.map(([k, v]) => <span key={k}>{k}<b>{v}</b></span>)}</p>
          </div>
          <div className="fm-cap-nav">
            <button type="button" data-f="prevB" disabled>Previous</button>
            <button type="button" data-f="nextB">Next stop</button>
          </div>
        </div>
      </div>
    </section>
  );
}
export default Film;

